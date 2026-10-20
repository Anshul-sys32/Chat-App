const User = require("../models/User");
const bcrypt = require("bcryptjs");
const { OAuth2Client } = require("google-auth-library");
const generateToken = require("../utils/generateToken");
const crypto = require("node:crypto");
const { pool } = require("../config/db");
const { sendSignupOtp, sendPasswordResetOtp } = require("../utils/email");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const sendSession = (res, user) => {
  const token = generateToken(user);
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000,
  });
  return {
    token,
    user: {
      _id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
      profilePicture: user.profilePicture || null,
      googlePicture: user.googlePicture || null,
    },
  };
};

exports.user = async (req, res) => {
  try {
    const scope = req.query.scope === "local" ? "local" : "global";
    const limit = Number(req.query.limit) || 30;
    let cursor;
    if (req.query.cursor) {
      try {
        cursor = JSON.parse(String(req.query.cursor));
      } catch {
        return res.status(400).json({ message: "Invalid user cursor." });
      }
    }
    res.json(await User.listPublic(req.user.id, scope, { limit, cursor }));
  } catch (err) {
    console.error("Fetch users error:", err);
    res.status(500).json({ message: "Failed to get users" });
  }
};

exports.updateOwnProfile = async (req, res) => {
  const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const newPassword = req.body.newPassword;
  const currentPassword = req.body.currentPassword;
  if (!/^[a-zA-Z0-9_.-]{2,100}$/.test(username)) {
    return res.status(400).json({ message: "Username must be 2-100 letters, numbers, dots, dashes, or underscores." });
  }
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: "Enter a valid email address." });
  }
  if (newPassword !== undefined && (typeof newPassword !== "string" || newPassword.length < 8)) {
    return res.status(400).json({ message: "New password must be at least 8 characters." });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found." });
    if (newPassword && user.password && (
      typeof currentPassword !== "string" || !await bcrypt.compare(currentPassword, user.password)
    )) {
      return res.status(403).json({ message: "Current password is incorrect." });
    }
    const hashedPassword = newPassword ? await bcrypt.hash(newPassword, 12) : undefined;
    await User.updateProfile(req.user.id, { username, email, password: hashedPassword });
    return res.json({
      user: {
        _id: req.user.id, username, email, role: user.role, status: user.status,
        profilePicture: user.profilePicture || null, googlePicture: user.googlePicture || null,
      },
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "That username or email is already in use." });
    }
    console.error("Update own profile error:", error);
    return res.status(500).json({ message: "Failed to update profile." });
  }
};

exports.updateAdminProfile = async (req, res) => {
  const userId = Number(req.params.userId);
  const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const newPassword = req.body.newPassword;
  if (!Number.isSafeInteger(userId) || userId < 1) {
    return res.status(400).json({ message: "Invalid user id." });
  }
  if (!/^[a-zA-Z0-9_.-]{2,100}$/.test(username)) {
    return res.status(400).json({ message: "Username must be 2-100 letters, numbers, dots, dashes, or underscores." });
  }
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: "Enter a valid email address." });
  }
  if (newPassword !== undefined && (typeof newPassword !== "string" || newPassword.length < 8)) {
    return res.status(400).json({ message: "Replacement password must be at least 8 characters." });
  }
  try {
    const target = await User.findById(userId);
    if (!target) return res.status(404).json({ message: "User not found." });
    const hashedPassword = newPassword ? await bcrypt.hash(newPassword, 12) : undefined;
    await User.updateProfile(userId, { username, email, password: hashedPassword });
    const io = req.app.get("io");
    io?.in(`user:${userId}`).emit("account-profile-updated", { username, email });
    if (hashedPassword) io?.in(`user:${userId}`).disconnectSockets(true);
    return res.json({
      user: {
        _id: userId, username, email, role: target.role, status: target.status,
        profilePicture: target.profilePicture || null, googlePicture: target.googlePicture || null,
      },
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "That username or email is already in use." });
    }
    console.error("Admin profile update error:", error);
    return res.status(500).json({ message: "Failed to update user profile." });
  }
};

exports.register = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const normalizedUsername = typeof username === "string" ? username.trim() : "";
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalizedUsername || normalizedUsername.length > 100 || !normalizedEmail || typeof password !== "string" || !password) {
      return res.status(400).json({ message: "Username, email, and password are required." });
    }
    if (!/^[a-zA-Z0-9_.-]{2,100}$/.test(normalizedUsername)) {
      return res.status(400).json({ message: "Username must be 2-100 letters, numbers, dots, dashes, or underscores." });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters." });
    }
    if (normalizedEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ message: "Enter a valid email address." });
    }

    const existingUser = await User.findByEmail(normalizedEmail);
    if (existingUser)
      return res.status(400).json({ message: "Email already registered." });
    if (await User.findByUsername(normalizedUsername)) {
      return res.status(409).json({ message: "Username already taken." });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const code = String(crypto.randomInt(100000, 1000000));
    const otpHash = crypto.createHash("sha256")
      .update(`${code}:${process.env.JWT_SECRET || "nfang-otp"}`)
      .digest("hex");
    const [existingPending] = await pool.execute(
      "SELECT last_sent_at FROM pending_signups WHERE email = ? LIMIT 1",
      [normalizedEmail]
    );
    if (existingPending[0] && Date.now() - new Date(existingPending[0].last_sent_at).getTime() < 60_000) {
      return res.status(429).json({ message: "Please wait before requesting another verification code." });
    }
    await sendSignupOtp(normalizedEmail, code);
    await pool.execute(
      `INSERT INTO pending_signups
         (email, username, password_hash, otp_hash, otp_expires_at, otp_attempts, last_sent_at)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), 0, NOW())
       ON DUPLICATE KEY UPDATE
         username = VALUES(username), password_hash = VALUES(password_hash),
         otp_hash = VALUES(otp_hash), otp_expires_at = VALUES(otp_expires_at),
         otp_attempts = 0, last_sent_at = VALUES(last_sent_at)`,
      [normalizedEmail, normalizedUsername, hashedPassword, otpHash]
    );
    return res.status(202).json({ message: "Verification code sent. Check your email to complete registration.", verificationRequired: true });
  } catch (err) {
    if (err.message?.startsWith("Email delivery is not configured")) {
      console.error("Registration email configuration error:", err.message);
      return res.status(503).json({ message: "Email verification is not configured on the server." });
    }
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Username or email is already registered." });
    }
    console.error("Registration Error:", err);
    return res.status(500).json({ message: "Server error during registration" });
  }
};

exports.verifySignup = async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const code = typeof req.body.code === "string" ? req.body.code.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ message: "Enter a valid email address and six-digit verification code." });
  }
  try {
    const [[pending]] = await pool.execute(
      "SELECT * FROM pending_signups WHERE email = ? LIMIT 1",
      [email]
    );
    if (!pending) return res.status(400).json({ message: "No pending signup was found for that email." });
    if (new Date(pending.otp_expires_at).getTime() <= Date.now()) {
      return res.status(400).json({ message: "That verification code has expired. Request a new one." });
    }
    if (pending.otp_attempts >= 5) {
      return res.status(429).json({ message: "Too many incorrect attempts. Request a new code." });
    }
    const hash = crypto.createHash("sha256")
      .update(`${code}:${process.env.JWT_SECRET || "nfang-otp"}`)
      .digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(pending.otp_hash))) {
      await pool.execute("UPDATE pending_signups SET otp_attempts = otp_attempts + 1 WHERE email = ?", [email]);
      return res.status(400).json({ message: "That verification code is incorrect." });
    }
    await User.create({ username: pending.username, email, password: pending.password_hash, role: "user" });
    await pool.execute("DELETE FROM pending_signups WHERE email = ?", [email]);
    return res.status(201).json({ message: "Email verified. Your account is awaiting administrator approval." });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "Username or email is already registered." });
    console.error("Signup verification error:", err);
    return res.status(500).json({ message: "Could not verify your email." });
  }
};

exports.resendSignupOtp = async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter a valid email address." });
  try {
    const [[pending]] = await pool.execute("SELECT * FROM pending_signups WHERE email = ? LIMIT 1", [email]);
    if (!pending) return res.status(404).json({ message: "No pending signup was found for that email." });
    if (Date.now() - new Date(pending.last_sent_at).getTime() < 60_000) {
      return res.status(429).json({ message: "Please wait before requesting another verification code." });
    }
    const code = String(crypto.randomInt(100000, 1000000));
    const otpHash = crypto.createHash("sha256").update(`${code}:${process.env.JWT_SECRET || "nfang-otp"}`).digest("hex");
    await sendSignupOtp(email, code);
    await pool.execute(
      "UPDATE pending_signups SET otp_hash = ?, otp_expires_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE), otp_attempts = 0, last_sent_at = NOW() WHERE email = ?",
      [otpHash, email]
    );
    return res.status(202).json({ message: "A new verification code was sent." });
  } catch (err) {
    if (err.message?.startsWith("Email delivery is not configured")) {
      console.error("Resend email configuration error:", err.message);
      return res.status(503).json({ message: "Email verification is not configured on the server." });
    }
    console.error("Resend signup OTP error:", err);
    return res.status(500).json({ message: "Could not send a verification code." });
  }
};

const otpHashFor = (code) => crypto.createHash("sha256")
  .update(`${code}:${process.env.JWT_SECRET || "nfang-otp"}`)
  .digest("hex");

exports.requestPasswordReset = async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const genericMessage = "If an account exists for that email, a password reset code has been sent.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(200).json({ message: genericMessage });
  }
  try {
    const user = await User.findByEmail(email);
    if (!user) return res.status(200).json({ message: genericMessage });
    const [[existing]] = await pool.execute(
      "SELECT last_sent_at FROM password_reset_otps WHERE email = ? LIMIT 1",
      [email]
    );
    if (existing && Date.now() - new Date(existing.last_sent_at).getTime() < 60_000) {
      return res.status(200).json({ message: genericMessage });
    }
    const code = String(crypto.randomInt(100000, 1000000));
    await sendPasswordResetOtp(email, code);
    await pool.execute(
      `INSERT INTO password_reset_otps (email, otp_hash, otp_expires_at, otp_attempts, last_sent_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), 0, NOW())
       ON DUPLICATE KEY UPDATE otp_hash = VALUES(otp_hash),
         otp_expires_at = VALUES(otp_expires_at), otp_attempts = 0, last_sent_at = VALUES(last_sent_at)`,
      [email, otpHashFor(code)]
    );
    return res.status(200).json({ message: genericMessage });
  } catch (error) {
    if (error.message?.startsWith("Email delivery is not configured")) {
      console.error("Password reset email configuration error:", error.message);
      return res.status(503).json({ message: "Password reset email is not configured on the server." });
    }
    console.error("Password reset request error:", error);
    return res.status(500).json({ message: "Could not request a password reset." });
  }
};

exports.resetPassword = async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const code = typeof req.body.code === "string" ? req.body.code.trim() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ message: "Enter a valid email address and six-digit reset code." });
  }
  if (password.length < 8) return res.status(400).json({ message: "Password must be at least 8 characters." });
  try {
    const [[reset]] = await pool.execute("SELECT * FROM password_reset_otps WHERE email = ? LIMIT 1", [email]);
    if (!reset) return res.status(400).json({ message: "Invalid or expired reset code." });
    if (new Date(reset.otp_expires_at).getTime() <= Date.now()) {
      return res.status(400).json({ message: "Invalid or expired reset code." });
    }
    if (reset.otp_attempts >= 5) return res.status(429).json({ message: "Too many incorrect attempts. Request a new code." });
    const expected = Buffer.from(reset.otp_hash);
    const actual = Buffer.from(otpHashFor(code));
    if (!crypto.timingSafeEqual(actual, expected)) {
      await pool.execute("UPDATE password_reset_otps SET otp_attempts = otp_attempts + 1 WHERE email = ?", [email]);
      return res.status(400).json({ message: "Invalid or expired reset code." });
    }
    const user = await User.findByEmail(email);
    if (!user) return res.status(400).json({ message: "Invalid or expired reset code." });
    await User.updatePassword(user.id, await bcrypt.hash(password, 12));
    await pool.execute("DELETE FROM password_reset_otps WHERE email = ?", [email]);
    req.app.get("io")?.in(`user:${user.id}`).disconnectSockets(true);
    return res.json({ message: "Password reset successfully. You can now sign in." });
  } catch (error) {
    console.error("Password reset verification error:", error);
    return res.status(500).json({ message: "Could not reset the password." });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const user = await User.findByEmail(email?.trim().toLowerCase());
    if (!user)
      return res.status(400).json({ message: "Invalid email or password" });

    const isMatch = user.password ? await bcrypt.compare(password, user.password) : false;
    if (!isMatch)
      return res.status(400).json({ message: "Invalid email or password" });

    if (user.status !== "active") {
      return res
        .status(403)
        .json({ message: user.status === "pending"
          ? "Your account is awaiting administrator approval."
          : "This account is suspended. Please contact an administrator." });
    }

    return res.json(sendSession(res, user));
  } catch (err) {
    console.error("Login Error:", err);
    return res.status(500).json({ message: "Server error during login" });
  }
};

exports.googleLogin = async (req, res) => {
  const credential = req.body.credential;
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(503).json({ message: "Google sign-in is not configured on this server." });
  }
  if (typeof credential !== "string" || !credential) {
    return res.status(400).json({ message: "A Google credential is required." });
  }
  let claims;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    claims = ticket.getPayload();
    if (!claims?.sub || !claims.email || claims.email_verified !== true) {
      return res.status(401).json({ message: "Google did not verify this email address." });
    }
  } catch (err) {
    console.error("Google token verification error:", err.message);
    return res.status(401).json({ message: "Google sign-in could not be verified." });
  }
  try {
    const email = claims.email.trim().toLowerCase();
    const googleSub = claims.sub;
    const googleName = typeof claims.name === "string" ? claims.name.slice(0, 255) : null;
    const googlePicture = typeof claims.picture === "string" && claims.picture.length <= 2048
      ? claims.picture
      : null;
    let user = await User.findByGoogleSub(googleSub);
    if (user && user.email !== email) {
      const emailOwner = await User.findByEmail(email);
      if (emailOwner && Number(emailOwner.id) !== Number(user.id)) {
        return res.status(409).json({ message: "This Google email is already linked to another account." });
      }
    }
    if (!user) {
      user = await User.findByEmail(email);
      if (user?.googleSub && user.googleSub !== googleSub) {
        return res.status(409).json({ message: "This email is linked to a different Google account." });
      }
      if (!user) {
        const baseUsername = email.split("@")[0].replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80) || "user";
        let username = baseUsername;
        for (let suffix = 1; await User.findByUsername(username); suffix += 1) {
          username = `${baseUsername.slice(0, 90)}-${suffix}`;
        }
        user = await User.create({
          username,
          email,
          googleSub,
          googleName,
          googlePicture,
        });
      } else {
        await User.updateGoogleProfile(user.id, { email, googleSub, googleName, googlePicture });
        user = { ...user, email, googleSub, googleName, googlePicture };
      }
    } else {
      await User.updateGoogleProfile(user.id, { email, googleSub, googleName, googlePicture });
      user = { ...user, email, googleSub, googleName, googlePicture };
    }
    if (user.status !== "active") {
      return res.status(403).json({
        message: user.status === "pending"
          ? "Your account is awaiting administrator approval."
          : "This account is suspended. Please contact an administrator.",
      });
    }
    return res.json(sendSession(res, user));
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "This Google account or email is already linked to another account." });
    }
    console.error("Google account sign-in error:", err);
    return res.status(500).json({ message: "Google sign-in could not be completed." });
  }
};
