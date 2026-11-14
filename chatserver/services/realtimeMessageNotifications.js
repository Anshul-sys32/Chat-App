const { pool } = require("../config/db");

const messagePreview = (message) => {
  const content = typeof message.content === "string" ? message.content.trim() : "";
  if (content) return content.slice(0, 180);
  if (message.stickerId) return "Sent a sticker";
  return "Sent an attachment";
};

const notifyDirectMessage = async (io, message) => {
  const [recipients] = await pool.execute(
    `SELECT recipient.id AS userId, sender.username AS senderName
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
  if (!recipients.length) return 0;
  const recipient = recipients[0];
  io?.to(`user:${recipient.userId}`).emit("direct-message-notification", {
    title: `New message from ${recipient.senderName}`,
    body: messagePreview(message),
    notificationId: `direct-${message._id}`,
    targetType: "direct",
    targetId: Number(message.sender),
    targetName: recipient.senderName,
  });
  return 1;
};

const notifyGroupMessage = async (io, message) => {
  const [recipients] = await pool.execute(
    `SELECT member.user_id AS userId, sender.username AS senderName,
            group_record.name AS groupName, channel.name AS channelName
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
  const titleFor = (recipient) => recipient.channelName
    ? `${recipient.groupName} #${recipient.channelName}`
    : recipient.groupName;
  for (const recipient of recipients) {
    io?.to(`user:${recipient.userId}`).emit("group-message-notification", {
      title: `New message in ${titleFor(recipient)}`,
      body: `${recipient.senderName}: ${messagePreview(message)}`,
      notificationId: `group-${message._id}`,
      targetType: "group",
      targetId: Number(message.groupId),
      targetName: recipient.groupName,
      targetChannelId: message.channelId ? Number(message.channelId) : null,
      targetChannelName: recipient.channelName || null,
    });
  }
  return recipients.length;
};

module.exports = { notifyDirectMessage, notifyGroupMessage };
