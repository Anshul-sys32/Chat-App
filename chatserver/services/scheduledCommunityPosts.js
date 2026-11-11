const { pool } = require("../config/db");
const { getActiveChannel, getGroupAccess, canAccessGroup, canPostInChannel } = require("./groupAccess");
const { loadCommunityEngagement } = require("./communityPosts");
const { notifyGroupMessage } = require("./realtimeMessageNotifications");

const toMysqlUtc = (date) => date.toISOString().slice(0, 19).replace("T", " ");

const nextScheduledAt = (scheduledAt, recurrence, now = new Date()) => {
  if (recurrence === "once") return null;
  const next = new Date(scheduledAt);
  const step = recurrence === "daily" ? 1 : 7;
  do {
    next.setUTCDate(next.getUTCDate() + step);
  } while (next <= now);
  return next;
};

const publishScheduledCommunityPosts = async (io, now = new Date()) => {
  const nowSql = toMysqlUtc(now);
  const [duePosts] = await pool.execute(
    `SELECT id FROM scheduled_community_posts
     WHERE status = 'scheduled' AND scheduled_at <= ?
     ORDER BY scheduled_at, id LIMIT 50`,
    [nowSql]
  );
  let published = 0;

  for (const duePost of duePosts) {
    const connection = await pool.getConnection();
    let createdMessage = null;
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT id, group_id AS groupId, channel_id AS channelId, sender_id AS senderId,
                content, recurrence,
                DATE_FORMAT(scheduled_at, '%Y-%m-%dT%H:%i:%s.000Z') AS scheduledAt
         FROM scheduled_community_posts
         WHERE id = ? AND status = 'scheduled' AND scheduled_at <= ?
         FOR UPDATE`,
        [duePost.id, nowSql]
      );
      const post = rows[0];
      if (!post) {
        await connection.rollback();
        continue;
      }

      const group = await getGroupAccess(post.groupId, post.senderId);
      const [users] = await connection.execute(
        "SELECT role FROM users WHERE id = ? AND status = 'active' LIMIT 1",
        [post.senderId]
      );
      const channel = await getActiveChannel(post.groupId, post.channelId);
      const canPublish = group?.groupType === "community"
        && users.length
        && canAccessGroup(group, users[0].role)
        && channel?.slug === "announcements"
        && await canPostInChannel(group, channel, users[0].role);

      if (!canPublish) {
        await connection.execute(
          "UPDATE scheduled_community_posts SET status = 'cancelled' WHERE id = ?",
          [post.id]
        );
        await connection.commit();
        continue;
      }

      const [inserted] = await connection.execute(
        `INSERT INTO group_messages
         (group_id, channel_id, sender_id, content, attachments, message_type, structured_data)
         VALUES (?, ?, ?, ?, JSON_ARRAY(), 'message', NULL)`,
        [post.groupId, post.channelId, post.senderId, post.content]
      );
      const next = nextScheduledAt(post.scheduledAt, post.recurrence, now);
      if (next) {
        await connection.execute(
          "UPDATE scheduled_community_posts SET scheduled_at = ? WHERE id = ?",
          [toMysqlUtc(next), post.id]
        );
      } else {
        await connection.execute(
          "UPDATE scheduled_community_posts SET status = 'published' WHERE id = ?",
          [post.id]
        );
      }
      const [messageRows] = await connection.execute(
        `SELECT gm.id AS _id, gm.group_id AS groupId, gm.channel_id AS channelId,
                channel.name AS channelName, gm.sender_id AS sender,
                u.username AS senderName, gm.content, gm.attachments, gm.reply_to_id AS replyToId,
                gm.message_type AS messageType, gm.structured_data AS structuredData,
                gm.accepted_answer_id AS acceptedAnswerId,
                gm.sticker_id AS stickerId, COALESCE(gm.sticker_url, stickers.image_url) AS stickerUrl,
                gm.is_deleted AS isDeleted, gm.created_at AS timestamp
         FROM group_messages gm JOIN users u ON u.id = gm.sender_id
         LEFT JOIN group_channels channel ON channel.id = gm.channel_id
         LEFT JOIN stickers ON stickers.id = gm.sticker_id
         WHERE gm.id = ?`,
        [inserted.insertId]
      );
      [createdMessage] = await loadCommunityEngagement(messageRows, post.senderId, connection.execute.bind(connection));
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }

    if (createdMessage) {
      io?.to(`group:${createdMessage.groupId}:channel:${createdMessage.channelId}`).emit("group-message", createdMessage);
      await notifyGroupMessage(io, createdMessage).catch((error) => {
        console.error("Scheduled community post notification error:", error.message);
      });
      published += 1;
    }
  }
  return published;
};

module.exports = { nextScheduledAt, publishScheduledCommunityPosts };