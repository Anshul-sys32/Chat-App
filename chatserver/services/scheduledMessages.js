const { pool } = require("../config/db");
const { canAccessGroup, canPostInChannel, getActiveChannel, getGroupAccess } = require("./groupAccess");
const { loadCommunityEngagement } = require("./communityPosts");
const { notifyDirectMessage, notifyGroupMessage } = require("./realtimeMessageNotifications");

const toMysqlUtc = (date) => date.toISOString().slice(0, 19).replace("T", " ");

const publishScheduledMessages = async (io, now = new Date()) => {
  const nowSql = toMysqlUtc(now);
  const [dueMessages] = await pool.execute(
    `SELECT id FROM scheduled_messages
     WHERE status = 'scheduled' AND scheduled_at <= ?
     ORDER BY scheduled_at, id LIMIT 50`,
    [nowSql]
  );
  let delivered = 0;

  for (const dueMessage of dueMessages) {
    const connection = await pool.getConnection();
    let directMessage = null;
    let groupMessage = null;
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT id, sender_id AS senderId, recipient_id AS recipientId,
                group_id AS groupId, channel_id AS channelId, content,
                DATE_FORMAT(scheduled_at, '%Y-%m-%dT%H:%i:%s.000Z') AS scheduledAt
         FROM scheduled_messages
         WHERE id = ? AND status = 'scheduled' AND scheduled_at <= ?
         FOR UPDATE`,
        [dueMessage.id, nowSql]
      );
      const scheduled = rows[0];
      if (!scheduled) {
        await connection.rollback();
        continue;
      }

      const [senders] = await connection.execute(
        "SELECT id, role FROM users WHERE id = ? AND status = 'active' LIMIT 1",
        [scheduled.senderId]
      );
      let canDeliver = senders.length > 0;
      if (scheduled.recipientId) {
        const [recipients] = await connection.execute(
          "SELECT id FROM users WHERE id = ? AND status = 'active' LIMIT 1",
          [scheduled.recipientId]
        );
        canDeliver = canDeliver && recipients.length > 0;
      } else {
        const group = await getGroupAccess(scheduled.groupId, scheduled.senderId);
        canDeliver = canDeliver && Boolean(group)
          && canAccessGroup(group, senders[0]?.role);
        if (group?.groupType === "community") {
          const channel = await getActiveChannel(scheduled.groupId, scheduled.channelId);
          canDeliver = canDeliver && Boolean(channel)
            && await canPostInChannel(group, channel, senders[0]?.role);
        } else {
          canDeliver = canDeliver && scheduled.channelId === null;
        }
      }

      if (!canDeliver) {
        await connection.execute(
          "UPDATE scheduled_messages SET status = 'cancelled' WHERE id = ?",
          [scheduled.id]
        );
        await connection.commit();
        io?.to(`user:${scheduled.senderId}`).emit("scheduled-message-updated", { id: scheduled.id, status: "cancelled" });
        continue;
      }

      if (scheduled.recipientId) {
        const [inserted] = await connection.execute(
          `INSERT INTO messages (sender_id, receiver_id, content, attachments)
           VALUES (?, ?, ?, JSON_ARRAY())`,
          [scheduled.senderId, scheduled.recipientId, scheduled.content]
        );
        const [messageRows] = await connection.execute(
          `SELECT message.id AS _id, message.sender_id AS sender, message.receiver_id AS receiver,
                  message.content, message.attachments, message.reply_to_id AS replyToId,
                  message.sticker_id AS stickerId, COALESCE(message.sticker_url, stickers.image_url) AS stickerUrl,
                  sender.username AS senderName,
                  message.created_at AS timestamp
           FROM messages message
           JOIN users sender ON sender.id = message.sender_id
           LEFT JOIN stickers ON stickers.id = message.sticker_id
           WHERE message.id = ?`,
          [inserted.insertId]
        );
        [directMessage] = messageRows;
      } else {
        const [inserted] = await connection.execute(
          `INSERT INTO group_messages
           (group_id, channel_id, sender_id, content, attachments, message_type, structured_data)
           VALUES (?, ?, ?, ?, JSON_ARRAY(), 'message', NULL)`,
          [scheduled.groupId, scheduled.channelId, scheduled.senderId, scheduled.content]
        );
        const [messageRows] = await connection.execute(
          `SELECT message.id AS _id, message.group_id AS groupId, message.channel_id AS channelId,
                  channel.name AS channelName, message.sender_id AS sender,
                  sender.username AS senderName, message.content, message.attachments,
                  message.reply_to_id AS replyToId, message.message_type AS messageType,
                  message.structured_data AS structuredData, message.accepted_answer_id AS acceptedAnswerId,
                  message.sticker_id AS stickerId, COALESCE(message.sticker_url, stickers.image_url) AS stickerUrl,
                  message.is_deleted AS isDeleted, message.created_at AS timestamp
           FROM group_messages message
           JOIN users sender ON sender.id = message.sender_id
           LEFT JOIN group_channels channel ON channel.id = message.channel_id
           LEFT JOIN stickers ON stickers.id = message.sticker_id
           WHERE message.id = ?`,
          [inserted.insertId]
        );
        [groupMessage] = await loadCommunityEngagement(messageRows, scheduled.senderId, connection.execute.bind(connection));
      }
      await connection.execute(
        "UPDATE scheduled_messages SET status = 'sent' WHERE id = ? AND status = 'scheduled'",
        [scheduled.id]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }

    if (directMessage) {
      io?.to(`user:${directMessage.sender}`).emit("scheduled-message-updated", { id: dueMessage.id, status: "sent" });
      io?.to(`user:${directMessage.sender}`).emit("message-sent", directMessage);
      io?.to(`user:${directMessage.receiver}`).emit("receive-message", directMessage);
      await notifyDirectMessage(io, directMessage).catch((error) => {
        console.error("Scheduled direct message notification error:", error.message);
      });
      delivered += 1;
    }
    if (groupMessage) {
      io?.to(`user:${groupMessage.sender}`).emit("scheduled-message-updated", { id: dueMessage.id, status: "sent" });
      const room = groupMessage.channelId
        ? `group:${groupMessage.groupId}:channel:${groupMessage.channelId}`
        : `group:${groupMessage.groupId}`;
      io?.to(room).emit("group-message", groupMessage);
      await notifyGroupMessage(io, groupMessage).catch((error) => {
        console.error("Scheduled group message notification error:", error.message);
      });
      delivered += 1;
    }
  }
  return delivered;
};

module.exports = { publishScheduledMessages };
