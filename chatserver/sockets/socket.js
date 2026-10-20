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
        const replyToId = Number(messagePayload.replyToId);
        const stickerId = Number(messagePayload.stickerId);
        const attachments = validateAttachments(messagePayload.attachments, socket.userId);
        const receiverId = Number(receiver);
        if (!Number.isSafeInteger(receiverId) || receiverId < 1
          || attachments === null
          || (typeof content !== "string" || !content.trim()) && !attachments.length && !(Number.isSafeInteger(stickerId) && stickerId > 0)) {
          return socket.emit("message-error", { message: "A recipient and message are required." });
        }
        const [recipients] = await pool.execute(
          "SELECT id FROM users WHERE id = ? AND status = 'active' LIMIT 1",
          [receiverId]
        );
        if (!recipients.length) {
          return socket.emit("message-error", { message: "That recipient is not available." });
        }
        const [replied] = Number.isSafeInteger(replyToId) && replyToId > 0
          ? await pool.execute(
            `SELECT id FROM messages
             WHERE id = ? AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))`,
            [replyToId, Number(socket.userId), receiverId, receiverId, Number(socket.userId)]
          )
          : [[]];
        if (messagePayload.replyToId !== undefined && !replied.length) {
          return socket.emit("message-error", { message: "The message being replied to was not found." });
        }
        const [sticker] = Number.isSafeInteger(stickerId) && stickerId > 0
          ? await pool.execute("SELECT id FROM stickers WHERE id = ?", [stickerId])
          : [[]];
        if (messagePayload.stickerId !== undefined && !sticker.length) {
          return socket.emit("message-error", { message: "That sticker is not available." });
        }
        const [result] = await pool.execute(
          "INSERT INTO messages (sender_id, receiver_id, content, attachments, reply_to_id, sticker_id) VALUES (?, ?, ?, ?, ?, ?)",
          [Number(socket.userId), receiverId, typeof content === "string" ? content.trim() : "", JSON.stringify(attachments), replyToId || null, stickerId || null]
        );
        const [rows] = await pool.execute(
          `SELECT messages.id AS _id, messages.sender_id AS sender, messages.receiver_id AS receiver,
                  messages.content, messages.attachments, messages.reply_to_id AS replyToId,
                  messages.sticker_id AS stickerId, stickers.image_url AS stickerUrl,
                  reply_user.username AS replySenderName,
                  CASE WHEN reply_message.is_deleted THEN 'This message was deleted' ELSE reply_message.content END AS replyContent,
                  messages.created_at AS timestamp
           FROM messages
           LEFT JOIN messages reply_message ON reply_message.id = messages.reply_to_id
           LEFT JOIN users reply_user ON reply_user.id = reply_message.sender_id
           LEFT JOIN stickers ON stickers.id = messages.sticker_id
           WHERE messages.id = ?`,
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
      const replyToId = Number(messagePayload.replyToId);
      const stickerId = Number(messagePayload.stickerId);
      const attachments = validateAttachments(messagePayload.attachments, socket.userId);
      const id = Number(groupId);
      if (!Number.isSafeInteger(id) || id < 1 || attachments === null
        || (typeof content !== "string" || !content.trim()) && !attachments.length && !(Number.isSafeInteger(stickerId) && stickerId > 0)) {
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
        const [replied] = Number.isSafeInteger(replyToId) && replyToId > 0
          ? await pool.execute("SELECT id FROM group_messages WHERE id = ? AND group_id = ?", [replyToId, id])
          : [[]];
        if (messagePayload.replyToId !== undefined && !replied.length) {
          return socket.emit("message-error", { message: "The message being replied to was not found." });
        }
        const [sticker] = Number.isSafeInteger(stickerId) && stickerId > 0
          ? await pool.execute("SELECT id FROM stickers WHERE id = ?", [stickerId])
          : [[]];
        if (messagePayload.stickerId !== undefined && !sticker.length) {
          return socket.emit("message-error", { message: "That sticker is not available." });
        }
        const [result] = await pool.execute(
          "INSERT INTO group_messages (group_id, sender_id, content, attachments, reply_to_id, sticker_id) VALUES (?, ?, ?, ?, ?, ?)",
          [id, Number(socket.userId), typeof content === "string" ? content.trim() : "", JSON.stringify(attachments), replyToId || null, stickerId || null]
        );
        const [rows] = await pool.execute(
          `SELECT gm.id AS _id, gm.group_id AS groupId, gm.sender_id AS sender,
                  u.username AS senderName, gm.content, gm.attachments, gm.reply_to_id AS replyToId,
                  gm.sticker_id AS stickerId, stickers.image_url AS stickerUrl,
                  reply_user.username AS replySenderName,
                  CASE WHEN reply_message.is_deleted THEN 'This message was deleted' ELSE reply_message.content END AS replyContent,
                  gm.is_deleted AS isDeleted,
                  gm.created_at AS timestamp
           FROM group_messages gm JOIN users u ON u.id = gm.sender_id
           LEFT JOIN group_messages reply_message ON reply_message.id = gm.reply_to_id
           LEFT JOIN users reply_user ON reply_user.id = reply_message.sender_id
           LEFT JOIN stickers ON stickers.id = gm.sticker_id
           WHERE gm.id = ?`,
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
