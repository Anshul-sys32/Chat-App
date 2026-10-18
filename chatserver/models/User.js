const { pool } = require("../config/db");

const findByEmail = async (email) => {
  const [rows] = await pool.execute("SELECT * FROM users WHERE email = ? LIMIT 1", [email]);
  return rows[0] || null;
};

const listPublic = async () => {
  const [rows] = await pool.query("SELECT id AS _id, username, email FROM users ORDER BY username");
  return rows;
};

const create = async ({ username, email, password, role }) => {
  const [result] = await pool.execute(
    "INSERT INTO users (username, email, password, role, status) VALUES (?, ?, ?, ?, 'active')",
    [username, email, password, role]
  );
  return { id: result.insertId, username, email, role, status: "active" };
};

module.exports = { findByEmail, listPublic, create };