const { pool } = require("../config/db");

const preferenceColumns = Object.freeze({
  browserNotifications: "browser_notifications",
  notificationSounds: "notification_sounds",
  directMessages: "direct_messages",
  groupMessages: "group_messages",
});

const readPreferences = async (userId) => {
  const [rows] = await pool.execute(
    `SELECT browser_notifications AS browserNotifications,
        notification_sounds AS notificationSounds,
        direct_messages AS directMessages,
        group_messages AS groupMessages
     FROM user_notification_preferences WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  return {
    browserNotifications: Boolean(row?.browserNotifications),
    notificationSounds: Boolean(row?.notificationSounds),
    directMessages: row ? Boolean(row.directMessages) : true,
    groupMessages: row ? Boolean(row.groupMessages) : true,
  };
};

const getNotificationPreferences = async (req, res) => {
  try {
    return res.json({ preferences: await readPreferences(req.user.id) });
  } catch (error) {
    console.error("Load notification preferences error:", error);
    return res.status(500).json({ message: "Could not load notification preferences." });
  }
};

const updateNotificationPreferences = async (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    return res.status(400).json({ message: "Provide notification preference values." });
  }
  const entries = Object.entries(updates);
  if (!entries.length || entries.some(([key, value]) =>
    !Object.hasOwn(preferenceColumns, key) || typeof value !== "boolean")) {
    return res.status(400).json({ message: "Notification preferences must use supported boolean values." });
  }

  const columns = entries.map(([key]) => preferenceColumns[key]);
  const assignments = columns.map((column) => `${column} = ?`).join(", ");
  const placeholders = entries.map(() => "?").join(", ");
  try {
    await pool.execute(
      `INSERT INTO user_notification_preferences (user_id, ${columns.join(", ")})
       VALUES (?, ${placeholders})
       ON DUPLICATE KEY UPDATE ${assignments}`,
      [req.user.id, ...entries.map(([, value]) => value), ...entries.map(([, value]) => value)]
    );
    return res.json({ preferences: await readPreferences(req.user.id) });
  } catch (error) {
    console.error("Update notification preferences error:", error);
    return res.status(500).json({ message: "Could not save notification preferences." });
  }
};

module.exports = { getNotificationPreferences, updateNotificationPreferences };
