const { randomUUID } = require("node:crypto");
const { pool } = require("../config/db");

const notifyMessageReaction = async (io, { recipientId, reactorId, reactorName, messageId, emoji, targetType, targetId, targetName, channelId = null, channelName = null }) => {
  if (!recipientId || Number(recipientId) === Number(reactorId)) return null;
  const category = targetType === "group" ? "group_reaction" : "direct_reaction";
  const batchId = randomUUID();
  const title = "New message reaction";
  const body = `${reactorName} reacted ${emoji} to your message.`;
  await pool.execute(
    `INSERT INTO notifications
     (batch_id, user_id, sender_id, title, body, category, target_type, target_id,
      target_name, target_channel_id, target_channel_name, source_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE batch_id = VALUES(batch_id), sender_id = VALUES(sender_id),
       title = VALUES(title), body = VALUES(body), is_read = FALSE,
       target_type = VALUES(target_type), target_id = VALUES(target_id), target_name = VALUES(target_name),
       target_channel_id = VALUES(target_channel_id), target_channel_name = VALUES(target_channel_name),
       created_at = UTC_TIMESTAMP()`,
    [batchId, recipientId, reactorId, title, body, category, targetType, targetId,
      targetName, channelId, channelName, messageId]
  );
  const [rows] = await pool.execute(
    `SELECT id AS _id, user_id AS userId, title, body, category, target_type AS targetType,
            target_id AS targetId, target_name AS targetName,
            target_channel_id AS targetChannelId, target_channel_name AS targetChannelName,
            is_read AS isRead, created_at AS timestamp
     FROM notifications WHERE batch_id = ? LIMIT 1`,
    [batchId]
  );
  const [notification] = rows;
  if (notification) io?.in(`user:${recipientId}`).emit("notification", notification);
  return notification || null;
};

module.exports = { notifyMessageReaction };
