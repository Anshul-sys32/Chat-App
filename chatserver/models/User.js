const { pool } = require("../config/db");

const findByEmail = async (email) => {
  const [rows] = await pool.execute(
    `SELECT id, username, email, password, google_sub AS googleSub, role, status
     FROM users WHERE email = ? LIMIT 1`,
    [email]
  );
  return rows[0] || null;
};

const findByGoogleSub = async (googleSub) => {
  const [rows] = await pool.execute(
    `SELECT id, username, email, password, google_sub AS googleSub, role, status
     FROM users WHERE google_sub = ? LIMIT 1`,
    [googleSub]
  );
  return rows[0] || null;
};

const findById = async (id) => {
  const [rows] = await pool.execute(
    `SELECT id, username, email, password, role, status
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

const listPublic = async () => {
  const [rows] = await pool.query(
    "SELECT id AS _id, username, email FROM users WHERE status = 'active' ORDER BY username"
  );
  return rows;
};

const listAdmin = async () => {
  const [rows] = await pool.query(
    `SELECT id AS _id, username, email, role, status, created_at AS createdAt
     FROM users ORDER BY created_at DESC, id DESC`
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
};