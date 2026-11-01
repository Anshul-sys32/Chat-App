const { randomUUID } = require("node:crypto");
const { pool } = require("../config/db");

const notificationBody = (message) => {
  const content = typeof message.content === "string" ? message.content.trim() : "";
  if (content) return content.slice(0, 2000);
  if (message.stickerId) return "Sent a sticker";
  return "Sent an attachment";
};

const getRecipients = async (type, message) => {
  if (type === "direct") {
    const [rows] = await pool.execute(
      `SELECT recipient.id AS userId, sender.username AS senderName,
              COALESCE(preferences.direct_messages, TRUE) AS notificationsEnabled
       FROM users recipient
       JOIN users sender ON sender.id = ? AND sender.status = 'active'
       LEFT JOIN user_notification_preferences preferences ON preferences.user_id = recipient.id
       LEFT JOIN conversation_notification_preferences conversation_preferences
         ON conversation_preferences.user_id = recipient.id
        AND conversation_preferences.conversation_type = 'direct'
        AND conversation_preferences.conversation_id = sender.id
       WHERE recipient.id = ? AND recipient.status = 'active'
         AND COALESCE(preferences.direct_messages, TRUE) = TRUE
         AND COALESCE(conversation_preferences.muted, FALSE) = FALSE`,
      [message.sender, message.receiver]
    );
    return rows.map((row) => ({ ...row, targetName: row.senderName }));
  }
  if (type === "group") {
    const [rows] = await pool.execute(
      `SELECT member.user_id AS userId, sender.username AS senderName,
              group_record.name AS targetName, group_record.group_type AS groupType,
              channel.name AS targetChannelName,
              COALESCE(preferences.group_messages, TRUE) AS notificationsEnabled
       FROM group_members member
       JOIN users recipient ON recipient.id = member.user_id AND recipient.status = 'active'
       JOIN users sender ON sender.id = ? AND sender.status = 'active'
       JOIN chat_groups group_record ON group_record.id = member.group_id
      LEFT JOIN group_channels channel ON channel.id = ? AND channel.group_id = member.group_id
       LEFT JOIN user_notification_preferences preferences ON preferences.user_id = member.user_id
       LEFT JOIN conversation_notification_preferences conversation_preferences
         ON conversation_preferences.user_id = member.user_id
        AND conversation_preferences.conversation_type = 'group'
        AND conversation_preferences.conversation_id = member.group_id
       WHERE member.group_id = ? AND member.user_id <> ?
         AND COALESCE(preferences.group_messages, TRUE) = TRUE
         AND COALESCE(conversation_preferences.muted, FALSE) = FALSE`,
      [message.sender, message.channelId || null, message.groupId, message.sender]
    );
    return rows;
  }
  return [];
};

const createMessageNotifications = async ({ type, message, io }) => {
  const recipients = await getRecipients(type, message);
  if (!recipients.length) return 0;

  const isGroup = type === "group";
  const isChannel = isGroup && recipients[0].groupType === "community";
  const category = isGroup ? "group_message" : "direct_message";
  const targetType = isChannel ? "channel" : isGroup ? "group" : "direct";
  const targetId = isGroup ? Number(message.groupId) : Number(message.sender);
  const targetChannelId = isChannel ? Number(message.channelId) : null;
  const targetChannelName = isChannel ? recipients[0].targetChannelName : null;
  const senderName = recipients[0].senderName || "A user";
  const title = isGroup ? `New message in ${recipients[0].targetName}` : `New message from ${senderName}`;
  const body = notificationBody(message);
  const batchId = randomUUID();
  for (let offset = 0; offset < recipients.length; offset += 500) {
    const batch = recipients.slice(offset, offset + 500);
    const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const values = batch.flatMap((recipient) => [
      batchId,
      recipient.userId,
      message.sender,
      title,
      body,
      category,
      targetType,
      targetId,
      recipient.targetName,
      targetChannelId,
      targetChannelName,
      message._id,
    ]);
    await pool.execute(
      `INSERT IGNORE INTO notifications
         (batch_id, user_id, sender_id, title, body, category, target_type, target_id, target_name,
          target_channel_id, target_channel_name, source_message_id)
       VALUES ${placeholders}`,
      values
    );
  }

  const [notifications] = await pool.execute(
    `SELECT notification.id AS _id, notification.user_id AS userId,
            notification.title, notification.body, notification.category,
            notification.target_type AS targetType, notification.target_id AS targetId,
            notification.target_name AS targetName, notification.is_read AS isRead,
            notification.target_channel_id AS targetChannelId,
            notification.target_channel_name AS targetChannelName,
            notification.created_at AS timestamp, sender.username AS senderName
     FROM notifications notification
     LEFT JOIN users sender ON sender.id = notification.sender_id
     WHERE notification.batch_id = ?
     ORDER BY notification.id`,
    [batchId]
  );
  for (const notification of notifications) {
    io?.to(`user:${notification.userId}`).emit("notification", notification);
  }
  return notifications.length;
};

module.exports = { createMessageNotifications };
