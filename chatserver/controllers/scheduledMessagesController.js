const { pool } = require("../config/db");
const { canAccessGroup, canPostInChannel, getActiveChannel, getGroupAccess } = require("../services/groupAccess");

const parseScheduledMessage = (body = {}) => {
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const scheduledAtMs = Date.parse(body.scheduledAt);
  if (!content || content.length > 10000 || !Number.isFinite(scheduledAtMs)
    || scheduledAtMs <= Date.now() || scheduledAtMs > Date.now() + 366 * 24 * 60 * 60 * 1000) {
    return { error: "Provide message text and a future delivery time within one year." };
  }
  return {
    content,
    scheduledAt: new Date(scheduledAtMs).toISOString().slice(0, 19).replace("T", " "),
    scheduledAtIso: new Date(scheduledAtMs).toISOString(),
  };
};

const authorizeTarget = async (type, conversationId, channelId, user) => {
  if (type === "direct") {
    if (channelId !== null) return { status: 400, message: "Direct messages do not use channels." };
    if (Number(conversationId) === Number(user.id)) return { status: 400, message: "Choose another person." };
    const [recipients] = await pool.execute(
      "SELECT id FROM users WHERE id = ? AND status = 'active' LIMIT 1",
      [conversationId]
    );
    if (!recipients.length) return { status: 404, message: "Recipient not found." };
    return { recipientId: Number(conversationId), channelId: null };
  }
  if (type !== "group") return { status: 400, message: "Choose a direct or group conversation." };
  const group = await getGroupAccess(conversationId, user.id);
  if (!group || !canAccessGroup(group, user.role)) return { status: 404, message: "Group not found." };
  if (group.groupType === "community") {
    if (!Number.isSafeInteger(Number(channelId)) || Number(channelId) < 1) return { status: 400, message: "Choose a community channel." };
    const channel = await getActiveChannel(conversationId, channelId);
    if (!channel) return { status: 404, message: "Channel not found." };
    if (!await canPostInChannel(group, channel, user.role)) return { status: 403, message: "You do not have permission to post in this channel." };
    return { group, channelId: channel.id };
  }
  if (channelId !== null) return { status: 400, message: "Standard groups do not have channels." };
  return { group, channelId: null };
};

const listScheduledMessages = async (req, res) => {
  const type = req.query.type;
  const conversationId = Number(req.query.conversationId);
  const channelId = req.query.channelId === undefined ? null : Number(req.query.channelId);
  if (!["direct", "group"].includes(type) || !Number.isSafeInteger(conversationId) || conversationId < 1
    || channelId !== null && (!Number.isSafeInteger(channelId) || channelId < 1)) {
    return res.status(400).json({ message: "Choose a valid conversation." });
  }
  try {
    const target = await authorizeTarget(type, conversationId, channelId, req.user);
    if (target.status) return res.status(target.status).json({ message: target.message });
    const [messages] = await pool.execute(
      `SELECT id, content, DATE_FORMAT(scheduled_at, '%Y-%m-%dT%H:%i:%s.000Z') AS scheduledAt
       FROM scheduled_messages
       WHERE sender_id = ? AND status = 'scheduled'
         AND ${type === "direct" ? "recipient_id = ? AND group_id IS NULL" : "group_id = ? AND recipient_id IS NULL"}
         AND channel_id <=> ?
       ORDER BY scheduled_at, id LIMIT 100`,
      [req.user.id, conversationId, target.channelId ?? null]
    );
    return res.json({ messages });
  } catch (error) {
    console.error("List scheduled messages error:", error);
    return res.status(500).json({ message: "Could not load scheduled messages." });
  }
};

const createScheduledMessage = async (req, res) => {
  const type = req.body?.conversationType;
  const conversationId = Number(req.body?.conversationId);
  const channelId = req.body?.channelId === undefined || req.body?.channelId === null ? null : Number(req.body.channelId);
  const parsed = parseScheduledMessage(req.body);
  if (!["direct", "group"].includes(type) || !Number.isSafeInteger(conversationId) || conversationId < 1
    || channelId !== null && (!Number.isSafeInteger(channelId) || channelId < 1)) {
    return res.status(400).json({ message: "Choose a valid conversation." });
  }
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  try {
    const target = await authorizeTarget(type, conversationId, channelId, req.user);
    if (target.status) return res.status(target.status).json({ message: target.message });
    const [result] = await pool.execute(
      `INSERT INTO scheduled_messages
       (sender_id, recipient_id, group_id, channel_id, content, scheduled_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, target.recipientId || null, type === "group" ? conversationId : null,
        target.channelId, parsed.content, parsed.scheduledAt]
    );
    return res.status(201).json({ message: { id: result.insertId, content: parsed.content, scheduledAt: parsed.scheduledAtIso } });
  } catch (error) {
    console.error("Create scheduled message error:", error);
    return res.status(500).json({ message: "Could not schedule this message." });
  }
};

const updateScheduledMessage = async (req, res) => {
  const messageId = Number(req.params.messageId);
  const parsed = parseScheduledMessage(req.body);
  if (!Number.isSafeInteger(messageId) || messageId < 1) return res.status(400).json({ message: "Invalid scheduled message." });
  if (parsed.error) return res.status(400).json({ message: parsed.error });
  try {
    const [result] = await pool.execute(
      `UPDATE scheduled_messages SET content = ?, scheduled_at = ?
       WHERE id = ? AND sender_id = ? AND status = 'scheduled' AND scheduled_at > UTC_TIMESTAMP()`,
      [parsed.content, parsed.scheduledAt, messageId, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Scheduled message not found or already due." });
    return res.json({ message: { id: messageId, content: parsed.content, scheduledAt: parsed.scheduledAtIso } });
  } catch (error) {
    console.error("Update scheduled message error:", error);
    return res.status(500).json({ message: "Could not update this scheduled message." });
  }
};

const cancelScheduledMessage = async (req, res) => {
  const messageId = Number(req.params.messageId);
  if (!Number.isSafeInteger(messageId) || messageId < 1) return res.status(400).json({ message: "Invalid scheduled message." });
  try {
    const [result] = await pool.execute(
      `UPDATE scheduled_messages SET status = 'cancelled'
       WHERE id = ? AND sender_id = ? AND status = 'scheduled' AND scheduled_at > UTC_TIMESTAMP()`,
      [messageId, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Scheduled message not found or already due." });
    return res.status(204).end();
  } catch (error) {
    console.error("Cancel scheduled message error:", error);
    return res.status(500).json({ message: "Could not cancel this scheduled message." });
  }
};

module.exports = {
  cancelScheduledMessage,
  createScheduledMessage,
  listScheduledMessages,
  parseScheduledMessage,
  updateScheduledMessage,
};
