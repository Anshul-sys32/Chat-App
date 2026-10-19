const User = require("../models/User");
const bcrypt = require("bcryptjs");
const { OAuth2Client } = require("google-auth-library");
const generateToken = require("../utils/generateToken");

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
    },
  };
};

exports.user = async (req, res) => {
  try {
    const users = await User.listPublic();
    res.json(users);
  } catch (err) {
    console.error("Fetch users error:", err);
    res.status(500).json({ message: "Failed to get users" });
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

    await User.create({
      username: normalizedUsername,
      email: normalizedEmail,
      password: hashedPassword,
      role: "user",
    });
    return res.status(202).json({ message: "Account created. An administrator must approve it before you can sign in." });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Username or email is already registered." });
    }
    console.error("Registration Error:", err);
    return res.status(500).json({ message: "Server error during registration" });
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
