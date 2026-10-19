require("dotenv").config();
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");
const { corsOrigin } = require("../utils/cors");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { uploadDirectory, allowedUploadTypes, maxFileSize } = require("../utils/uploads");

const connectedUsers = new Map();

const validateAttachments = (attachments, userId) => {
  if (attachments === undefined) return [];
  if (!Array.isArray(attachments) || attachments.length > 5) return null;
  const userFilePrefix = `/uploads/${userId}-`;
  const filenamePattern = /^[a-f0-9-]{36}\.[a-z0-9]{1,10}$/i;
  const validated = [];
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object"
      || typeof attachment.url !== "string"
      || !attachment.url.startsWith(userFilePrefix)) return null;
    const filename = attachment.url.slice("/uploads/".length);
    if (!filenamePattern.test(filename.slice(String(userId).length + 1))
      || !existsSync(path.join(uploadDirectory, filename))
      || typeof attachment.name !== "string" || !attachment.name.trim()
      || attachment.name.length > 255
      || !allowedUploadTypes.has(attachment.mimeType)
      || !Number.isSafeInteger(attachment.size)
      || attachment.size < 1 || attachment.size > maxFileSize) return null;
    validated.push({
      url: attachment.url,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
    });
  }
  return validated;
};

const initSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token || !process.env.JWT_SECRET) return next(new Error("Unauthorized"));
      const user = jwt.verify(token, process.env.JWT_SECRET);
      socket.data.authExpiresAt = user.exp * 1000;
      pool.execute(
        "SELECT id, role, status FROM users WHERE id = ? AND status = 'active' LIMIT 1",
        [user.id]
      ).then(([users]) => {
        if (!users[0]) return next(new Error("Unauthorized"));
        socket.userId = String(users[0].id);
        socket.userRole = users[0].role;
        return next();
      }).catch((error) => {
        console.error("Socket authentication database error:", error.message);
        return next(new Error("Authentication unavailable"));
      });
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    console.log("🔌 New socket connected:", socket.id);

    const tokenLifetime = socket.data.authExpiresAt - Date.now();
    if (tokenLifetime <= 0) {
      socket.disconnect(true);
      return;
    }
    socket.authExpirationTimer = setTimeout(() => socket.disconnect(true), tokenLifetime);

    const userSockets = connectedUsers.get(socket.userId) || new Set();
    userSockets.add(socket.id);
    connectedUsers.set(socket.userId, userSockets);
    socket.join(`user:${socket.userId}`);
    const onlineUsers = Array.from(connectedUsers.keys());
    io.emit("online-users", onlineUsers);
    socket.emit("online-users", onlineUsers);

    socket.on("send-message", async (payload = {}) => {
      try {
        const messagePayload = payload || {};
        const { receiver, content } = messagePayload;
        const attachments = validateAttachments(messagePayload.attachments, socket.userId);
        const receiverId = Number(receiver);
        if (!Number.isSafeInteger(receiverId) || receiverId < 1
          || attachments === null
          || (typeof content !== "string" || !content.trim()) && !attachments.length) {
          return socket.emit("message-error", { message: "A recipient and message are required." });
        }
        const [recipients] = await pool.execute(
          "SELECT id FROM users WHERE id = ? AND status = 'active' LIMIT 1",
          [receiverId]
        );
        if (!recipients.length) {
          return socket.emit("message-error", { message: "That recipient is not available." });
        }
        const [result] = await pool.execute(
          "INSERT INTO messages (sender_id, receiver_id, content, attachments) VALUES (?, ?, ?, ?)",
          [Number(socket.userId), receiverId, typeof content === "string" ? content.trim() : "", JSON.stringify(attachments)]
        );
        const [rows] = await pool.execute(
          `SELECT id AS _id, sender_id AS sender, receiver_id AS receiver, content,
                  attachments, is_deleted AS isDeleted, created_at AS timestamp FROM messages WHERE id = ?`,
          [result.insertId]
        );
        const message = rows[0];
        for (const socketId of connectedUsers.get(String(receiverId)) || []) {
          io.to(socketId).emit("receive-message", message);
        }
        socket.emit("message-sent", message);
      } catch (error) {
        console.error("❌ Message DB error:", error.message);
        socket.emit("message-error", { message: "Message could not be saved." });
      }
    });

    socket.on("join-group", async (payload = {}) => {
      const { groupId } = payload || {};
      const id = Number(groupId);
      if (!Number.isSafeInteger(id) || id < 1) return;
      try {
        const [memberships] = await pool.execute(
          "SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1",
          [id, Number(socket.userId)]
        );
        if (memberships.length || socket.userRole === "admin") socket.join(`group:${id}`);
        else socket.emit("message-error", { message: "You are not a member of this group." });
      } catch (error) {
        console.error("Group join DB error:", error.message);
        socket.emit("message-error", { message: "Could not join this group right now." });
      }
    });

    socket.on("group-message", async (payload = {}) => {
      const messagePayload = payload || {};
      const { groupId, content } = messagePayload;
      const attachments = validateAttachments(messagePayload.attachments, socket.userId);
      const id = Number(groupId);
      if (!Number.isSafeInteger(id) || id < 1 || attachments === null
        || (typeof content !== "string" || !content.trim()) && !attachments.length) {
        return socket.emit("message-error", { message: "A group and message are required." });
      }
      try {
        const [memberships] = await pool.execute(
          "SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1",
          [id, Number(socket.userId)]
        );
        if (!memberships.length && socket.userRole !== "admin") {
          return socket.emit("message-error", { message: "You are no longer a member of this group." });
        }
        const [result] = await pool.execute(
          "INSERT INTO group_messages (group_id, sender_id, content, attachments) VALUES (?, ?, ?, ?)",
          [id, Number(socket.userId), typeof content === "string" ? content.trim() : "", JSON.stringify(attachments)]
        );
        const [rows] = await pool.execute(
          `SELECT gm.id AS _id, gm.group_id AS groupId, gm.sender_id AS sender,
                  u.username AS senderName, gm.content, gm.attachments, gm.is_deleted AS isDeleted,
                  gm.created_at AS timestamp
           FROM group_messages gm JOIN users u ON u.id = gm.sender_id WHERE gm.id = ?`,
          [result.insertId]
        );
        io.to(`group:${id}`).emit("group-message", rows[0]);
        socket.emit("group-message", rows[0]);
      } catch (error) {
        console.error("Group message DB error:", error.message);
        socket.emit("message-error", { message: "Group message could not be saved." });
      }
    });

    for (const eventName of ["offer", "answer", "ice-candidate", "hangup"]) {
      socket.on(eventName, (payload = {}) => {
        const recipientId = String(payload.to || "");
        if (!connectedUsers.has(recipientId)) return;
        const { to, ...signalData } = payload;
        for (const targetSocket of connectedUsers.get(recipientId)) {
          io.to(targetSocket).emit(eventName, { ...signalData, from: socket.userId });
        }
      });
    }

    // Step 4: Handle disconnect
    socket.on("disconnect", () => {
      console.log(`❌ Socket disconnected: ${socket.id}`);
      clearTimeout(socket.authExpirationTimer);

      if (socket.userId) {
        const userSockets = connectedUsers.get(socket.userId);
        userSockets?.delete(socket.id);
        if (!userSockets?.size) connectedUsers.delete(socket.userId);
      }

      io.emit("online-users", Array.from(connectedUsers.keys()));
    });
  });

  return io;
};

module.exports = initSocket;
