const { pool } = require("../config/db");

const parseConversation = (req) => {
  const type = req.params.type;
  const id = Number(req.params.id);
  if (!['direct', 'group'].includes(type) || !Number.isSafeInteger(id) || id < 1) return null;
  return { type, id };
};

const canAccessConversation = async (userId, { type, id }) => {
  if (type === "direct") {
    const [users] = await pool.execute(
      "SELECT id FROM users WHERE id = ? AND id <> ? AND status = 'active' LIMIT 1",
      [id, userId]
    );
    return users.length > 0;
  }
  const [memberships] = await pool.execute(
    "SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1",
    [id, userId]
  );
  return memberships.length > 0;
};

const getConversationNotificationPreferences = async (req, res) => {
  const conversation = parseConversation(req);
  if (!conversation) return res.status(400).json({ message: "Invalid conversation." });
  try {
    if (!await canAccessConversation(req.user.id, conversation)) {
      return res.status(404).json({ message: "Conversation not found." });
    }
    const [rows] = await pool.execute(
      `SELECT muted FROM conversation_notification_preferences
       WHERE user_id = ? AND conversation_type = ? AND conversation_id = ? LIMIT 1`,
      [req.user.id, conversation.type, conversation.id]
    );
    return res.json({ muted: Boolean(rows[0]?.muted) });
  } catch (error) {
    console.error("Load conversation notification preference error:", error);
    return res.status(500).json({ message: "Could not load conversation notification preferences." });
  }
};

const updateConversationNotificationPreferences = async (req, res) => {
  const conversation = parseConversation(req);
  if (!conversation) return res.status(400).json({ message: "Invalid conversation." });
  if (typeof req.body?.muted !== "boolean") {
    return res.status(400).json({ message: "Muted must be a boolean value." });
  }
  try {
    if (!await canAccessConversation(req.user.id, conversation)) {
      return res.status(404).json({ message: "Conversation not found." });
    }
    await pool.execute(
      `INSERT INTO conversation_notification_preferences
         (user_id, conversation_type, conversation_id, muted)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE muted = ?`,
      [req.user.id, conversation.type, conversation.id, req.body.muted, req.body.muted]
    );
    return res.json({ muted: req.body.muted });
  } catch (error) {
    console.error("Update conversation notification preference error:", error);
    return res.status(500).json({ message: "Could not update conversation notification preferences." });
  }
};

module.exports = {
  getConversationNotificationPreferences,
  updateConversationNotificationPreferences,
};
