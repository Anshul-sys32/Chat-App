const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");

const protect = async (req, res, next) => {
  const authorization = req.headers.authorization;
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : req.cookies?.token;
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  let decoded;
  try {
    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET must be configured");
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }

  try {
    const [users] = await pool.execute(
      `SELECT id, username, email, role, status,
              profile_picture AS profilePicture, google_picture AS googlePicture
       FROM users WHERE id = ? LIMIT 1`,
      [decoded.id]
    );
    const user = users[0];
    if (!user || user.status !== "active") {
      return res.status(401).json({ message: "This account is no longer active." });
    }
    req.user = user;
    return next();
  } catch (error) {
    console.error("Authentication database error:", error);
    return res.status(500).json({ message: "Authentication is temporarily unavailable." });
  }
};

module.exports = protect;
