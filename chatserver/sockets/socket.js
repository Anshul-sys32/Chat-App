require("dotenv").config();
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");
const { corsOrigin } = require("../utils/cors");

const connectedUsers = new Map();

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
      socket.userId = String(user.id);
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    console.log("🔌 New socket connected:", socket.id);

    const userSockets = connectedUsers.get(socket.userId) || new Set();
    userSockets.add(socket.id);
    connectedUsers.set(socket.userId, userSockets);
    socket.join(`user:${socket.userId}`);
    const onlineUsers = Array.from(connectedUsers.keys());
    io.emit("online-users", onlineUsers);
    socket.emit("online-users", onlineUsers);

    socket.on("send-message", async ({ receiver, content } = {}) => {
      try {
        const receiverId = Number(receiver);
        if (!Number.isSafeInteger(receiverId) || receiverId < 1 || !content?.trim()) {
          return socket.emit("message-error", { message: "A recipient and message are required." });
        }
        const [result] = await pool.execute(
          "INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)",
          [Number(socket.userId), receiverId, content.trim()]
        );
        const [rows] = await pool.execute(
          `SELECT id AS _id, sender_id AS sender, receiver_id AS receiver, content,
                  created_at AS timestamp FROM messages WHERE id = ?`,
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

    socket.on("join-group", async ({ groupId } = {}) => {
      const id = Number(groupId);
      if (!Number.isSafeInteger(id) || id < 1) return;
      try {
        const [memberships] = await pool.execute(
          "SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1",
          [id, Number(socket.userId)]
        );
        if (memberships.length) socket.join(`group:${id}`);
        else socket.emit("message-error", { message: "You are not a member of this group." });
      } catch (error) {
        console.error("Group join DB error:", error.message);
        socket.emit("message-error", { message: "Could not join this group right now." });
      }
    });

    socket.on("group-message", async ({ groupId, content } = {}) => {
      const id = Number(groupId);
      if (!Number.isSafeInteger(id) || id < 1 || !content?.trim()) {
        return socket.emit("message-error", { message: "A group and message are required." });
      }
      try {
        const [memberships] = await pool.execute(
          "SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1",
          [id, Number(socket.userId)]
        );
        if (!memberships.length) {
          return socket.emit("message-error", { message: "You are no longer a member of this group." });
        }
        const [result] = await pool.execute(
          "INSERT INTO group_messages (group_id, sender_id, content) VALUES (?, ?, ?)",
          [id, Number(socket.userId), content.trim()]
        );
        const [rows] = await pool.execute(
          `SELECT gm.id AS _id, gm.group_id AS groupId, gm.sender_id AS sender,
                  u.username AS senderName, gm.content, gm.created_at AS timestamp
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
