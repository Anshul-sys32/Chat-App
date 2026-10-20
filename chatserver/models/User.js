const { pool } = require("../config/db");

const findByEmail = async (email) => {
  const [rows] = await pool.execute(
    `SELECT id, username, email, password, google_sub AS googleSub,
            google_picture AS googlePicture, profile_picture AS profilePicture, role, status
     FROM users WHERE email = ? LIMIT 1`,
    [email]
  );
  return rows[0] || null;
};

const findByGoogleSub = async (googleSub) => {
  const [rows] = await pool.execute(
    `SELECT id, username, email, password, google_sub AS googleSub,
            google_picture AS googlePicture, profile_picture AS profilePicture, role, status
     FROM users WHERE google_sub = ? LIMIT 1`,
    [googleSub]
  );
  return rows[0] || null;
};

const findById = async (id) => {
  const [rows] = await pool.execute(
    `SELECT id, username, email, password, google_picture AS googlePicture,
            profile_picture AS profilePicture, role, status
     FROM users WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
};

const findByUsername = async (username) => {
  const [rows] = await pool.execute(
    "SELECT id FROM users WHERE username = ? LIMIT 1",
    [username]
  );
  return rows[0] || null;
};

const listPublic = async (userId, scope = "global", { limit = 30, cursor } = {}) => {
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 30));
  const localCondition = `EXISTS (
    SELECT 1 FROM messages conversation
    WHERE (conversation.sender_id = users.id AND conversation.receiver_id = ?)
       OR (conversation.sender_id = ? AND conversation.receiver_id = users.id)
  )`;
  const condition = scope === "local" ? localCondition : `NOT ${localCondition}`;
  const cursorCondition = cursor?.username !== undefined && Number.isSafeInteger(Number(cursor.id))
    ? "AND (users.username > ? OR (users.username = ? AND users.id > ?))"
    : "";
  const cursorParams = cursorCondition
    ? [String(cursor.username), String(cursor.username), Number(cursor.id)]
    : [];
  const [rows] = await pool.execute(
    `SELECT users.id AS _id, users.username, users.email,
            users.profile_picture AS profilePicture, users.google_picture AS googlePicture,
            COALESCE((
              SELECT COUNT(*) FROM messages unread
              LEFT JOIN direct_message_reads read_state
                ON read_state.user_id = ? AND read_state.other_user_id = unread.sender_id
              WHERE unread.sender_id = users.id AND unread.receiver_id = ?
                AND unread.id > COALESCE(read_state.last_read_message_id, 0)
            ), 0) AS unreadCount
     FROM users
     WHERE users.status = 'active' AND users.id <> ? AND ${condition}
     ${cursorCondition}
     ORDER BY users.username, users.id
     LIMIT ?`,
    [userId, userId, userId, userId, userId, ...cursorParams, pageSize + 1]
  );
  return {
    users: rows.slice(0, pageSize),
    hasMore: rows.length > pageSize,
  };
};

const listAdmin = async (names = []) => {
  const nameFilter = names.length
    ? `WHERE status = 'active' AND LOWER(username) IN (${names.map(() => "?").join(",")})`
    : "";
  const [rows] = await pool.execute(
    `SELECT id AS _id, username, email, role, status,
            profile_picture AS profilePicture, google_picture AS googlePicture,
            created_at AS createdAt
     FROM users ${nameFilter} ORDER BY created_at DESC, id DESC`,
    names.map((name) => name.toLowerCase())
  );
  return rows;
};

const create = async ({
  username,
  email,
  password = null,
  googleSub = null,
  googleName = null,
  googlePicture = null,
  role = "user",
  status = "pending",
}) => {
  const [result] = await pool.execute(
    `INSERT INTO users
     (username, email, password, google_sub, google_name, google_picture, role, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [username, email, password, googleSub, googleName, googlePicture, role, status]
  );
  return { id: result.insertId, username, email, googleSub, googleName, googlePicture, role, status };
};

const updateGoogleProfile = async (userId, { email, googleSub, googleName, googlePicture }) => {
  await pool.execute(
    `UPDATE users
     SET email = ?, google_sub = ?, google_name = ?, google_picture = ?
     WHERE id = ?`,
    [email, googleSub, googleName, googlePicture, userId]
  );
};

const updateProfile = async (userId, { username, email, password }) => {
  if (password) {
    await pool.execute(
      "UPDATE users SET username = ?, email = ?, password = ? WHERE id = ?",
      [username, email, password, userId]
    );
    return;
  }
  await pool.execute(
    "UPDATE users SET username = ?, email = ? WHERE id = ?",
    [username, email, userId]
  );
};

const updateProfilePicture = async (userId, profilePicture) => {
  await pool.execute(
    "UPDATE users SET profile_picture = ? WHERE id = ?",
    [profilePicture, userId]
  );
};

const updatePassword = async (userId, password) => {
  await pool.execute("UPDATE users SET password = ? WHERE id = ?", [password, userId]);
};

module.exports = {
  findByEmail,
  findByGoogleSub,
  findById,
  findByUsername,
  listPublic,
  listAdmin,
  create,
  updateGoogleProfile,
  updateProfile,
  updateProfilePicture,
  updatePassword,
};