require("dotenv").config();
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");
const { corsOrigin } = require("../utils/cors");
const { notifyDirectMessage, notifyGroupMessage } = require("../services/realtimeMessageNotifications");
const { canNegotiateCallRoomOffer, canInviteToCallRoom, shouldUpgradeCallRoomToSfu } = require("../services/callRoomPolicy");
const { activeCallRooms } = require("../services/callRoomRegistry");
const { getGroupAccess, getActiveChannel, canAccessGroup, canPostInChannel } = require("../services/groupAccess");
const { loadCommunityEngagement, validateCommunityPost } = require("../services/communityPosts");
const { existsSync } = require("node:fs");
const path = require("node:path");
const {
  uploadDirectory,
  voiceDirectory,
  allowedUploadTypes,
  allowedVoiceTypes,
  maxFileSize,
  maxVoiceFileSize,
  maxVoiceDurationSeconds,
} = require("../utils/uploads");

const connectedUsers = new Map();

const validateAttachments = (attachments, userId) => {
  if (attachments === undefined) return [];
  if (!Array.isArray(attachments) || attachments.length > 5) return null;
  const userFilePrefix = `/uploads/${userId}-`;
  const voiceFilePrefix = `/api/voice-media/${userId}-voice-`;
  const filenamePattern = /^[a-f0-9-]{36}\.[a-z0-9]{1,10}$/i;
  const voiceFilenamePattern = /^[a-f0-9-]{36}\.(webm|ogg|m4a|mp3|wav)$/i;
  const validated = [];
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object" || typeof attachment.url !== "string") return null;
    const isVoiceMessage = attachment.url.startsWith(voiceFilePrefix);
    const filename = isVoiceMessage
      ? attachment.url.slice("/api/voice-media/".length)
      : attachment.url.startsWith(userFilePrefix)
        ? attachment.url.slice("/uploads/".length)
        : "";
    if (!filename || typeof attachment.name !== "string" || !attachment.name.trim()
      || attachment.name.length > 255
      || !Number.isSafeInteger(attachment.size)
      || attachment.size < 1 || attachment.size > (isVoiceMessage ? maxVoiceFileSize : maxFileSize)) return null;
    if (isVoiceMessage) {
      if (!voiceFilenamePattern.test(filename.slice(`${userId}-voice-`.length))
        || !allowedVoiceTypes.has(attachment.mimeType)
        || !Number.isSafeInteger(attachment.duration)
        || attachment.duration < 1 || attachment.duration > maxVoiceDurationSeconds
        || attachment.size > maxVoiceFileSize
        || !existsSync(path.join(voiceDirectory, filename))) return null;
    } else if (!filenamePattern.test(filename.slice(String(userId).length + 1))
      || !allowedUploadTypes.has(attachment.mimeType)
      || !existsSync(path.join(uploadDirectory, filename))) return null;
    validated.push({
      url: attachment.url,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      ...(isVoiceMessage ? { duration: attachment.duration } : {}),
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
  const commitSfuUpgrade = (roomId, room) => {
    if (!room || room.sfuCommitted || room.sfuReadyParticipants.size < room.acceptedParticipants.size) return;
    room.sfuCommitted = true;
    for (const participantId of room.acceptedParticipants) {
      for (const targetSocket of connectedUsers.get(participantId) || []) {
        io.to(targetSocket).emit("call-sfu-commit", { roomId: String(roomId) });
      }
    }
  };

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token || !process.env.JWT_SECRET) return next(new Error("Unauthorized"));
      const user = jwt.verify(token, process.env.JWT_SECRET);
      socket.data.authExpiresAt = user.exp * 1000;
      pool.execute(
        "SELECT id, username, role, status FROM users WHERE id = ? AND status = 'active' LIMIT 1",
        [user.id]
      ).then(([users]) => {
        if (!users[0]) return next(new Error("Unauthorized"));
        socket.userId = String(users[0].id);
        socket.userName = users[0].username;
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
          ? await pool.execute("SELECT id, image_url AS imageUrl FROM stickers WHERE id = ?", [stickerId])
          : [[]];
        if (messagePayload.stickerId !== undefined && !sticker.length) {
          return socket.emit("message-error", { message: "That sticker is not available." });
        }
        const [result] = await pool.execute(
          "INSERT INTO messages (sender_id, receiver_id, content, attachments, reply_to_id, sticker_id, sticker_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [Number(socket.userId), receiverId, typeof content === "string" ? content.trim() : "", JSON.stringify(attachments), replyToId || null, stickerId || null, sticker[0]?.imageUrl || null]
        );
        const [rows] = await pool.execute(
          `SELECT messages.id AS _id, messages.sender_id AS sender, messages.receiver_id AS receiver,
                  messages.content, messages.attachments, messages.reply_to_id AS replyToId,
                  messages.sticker_id AS stickerId, COALESCE(messages.sticker_url, stickers.image_url) AS stickerUrl,
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
        notifyDirectMessage(io, message).catch((error) => {
          console.error("Direct message system notification error:", error.message);
        });
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
      const requestedChannelId = payload?.channelId === undefined ? null : Number(payload.channelId);
      if (!Number.isSafeInteger(id) || id < 1) return;
      try {
        for (const room of Array.from(socket.rooms)) {
          if (/^group:\d+:channel:\d+$/.test(room)) socket.leave(room);
        }
        const group = await getGroupAccess(id, Number(socket.userId));
        if (!canAccessGroup(group, socket.userRole)) {
          return;
        }
        if (group.groupType === "community") {
          if (!Number.isSafeInteger(requestedChannelId) || requestedChannelId < 1) {
            return socket.emit("message-error", { message: "Choose a community channel." });
          }
          const channel = await getActiveChannel(id, requestedChannelId);
          if (!channel) return socket.emit("message-error", { message: "Channel not found." });
          socket.join(`group:${id}`);
          socket.join(`group:${id}:channel:${requestedChannelId}`);
        } else if (requestedChannelId !== null) {
          return socket.emit("message-error", { message: "Standard groups do not have channels." });
        } else {
          socket.join(`group:${id}`);
        }
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
      const requestedChannelId = messagePayload.channelId === undefined ? null : Number(messagePayload.channelId);
      const isStructuredPost = ["poll", "event"].includes(messagePayload.messageType);
      if (!Number.isSafeInteger(id) || id < 1 || attachments === null
        || (typeof content !== "string" || !content.trim()) && !attachments.length
          && !(Number.isSafeInteger(stickerId) && stickerId > 0) && !isStructuredPost) {
        return socket.emit("message-error", { message: "A group and message are required." });
      }
      try {
        const group = await getGroupAccess(id, Number(socket.userId));
        if (!canAccessGroup(group, socket.userRole)) {
          return socket.emit("message-error", { message: "You are no longer a member of this group." });
        }
        const post = validateCommunityPost(messagePayload, group.groupType === "community");
        if (post.error) return socket.emit("message-error", { message: post.error });
        let channelId = null;
        let channel = null;
        if (group.groupType === "community") {
          if (!Number.isSafeInteger(requestedChannelId) || requestedChannelId < 1) {
            return socket.emit("message-error", { message: "Choose a community channel." });
          }
          channel = await getActiveChannel(id, requestedChannelId);
          if (!channel) return socket.emit("message-error", { message: "Channel not found." });
          if (!canPostInChannel(group, channel, socket.userRole)) {
            return socket.emit("message-error", { message: "Only community leaders can post in this channel." });
          }
          channelId = channel.id;
        } else if (requestedChannelId !== null) {
          return socket.emit("message-error", { message: "Standard groups do not have channels." });
        }
        const [replied] = Number.isSafeInteger(replyToId) && replyToId > 0
          ? await pool.execute(
            "SELECT id FROM group_messages WHERE id = ? AND group_id = ? AND channel_id <=> ?",
            [replyToId, id, channelId]
          )
          : [[]];
        if (messagePayload.replyToId !== undefined && !replied.length) {
          return socket.emit("message-error", { message: "The message being replied to was not found." });
        }
        const [sticker] = Number.isSafeInteger(stickerId) && stickerId > 0
          ? await pool.execute("SELECT id, image_url AS imageUrl FROM stickers WHERE id = ?", [stickerId])
          : [[]];
        if (messagePayload.stickerId !== undefined && !sticker.length) {
          return socket.emit("message-error", { message: "That sticker is not available." });
        }
        const [result] = await pool.execute(
          "INSERT INTO group_messages (group_id, channel_id, sender_id, content, attachments, reply_to_id, sticker_id, sticker_url, message_type, structured_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [id, channelId, Number(socket.userId), post.content, JSON.stringify(attachments), replyToId || null, stickerId || null, sticker[0]?.imageUrl || null, post.messageType, post.structuredData ? JSON.stringify(post.structuredData) : null]
        );
        const [rows] = await pool.execute(
          `SELECT gm.id AS _id, gm.group_id AS groupId, gm.channel_id AS channelId,
                  channel.name AS channelName, gm.sender_id AS sender,
                  u.username AS senderName, gm.content, gm.attachments, gm.reply_to_id AS replyToId,
                  gm.message_type AS messageType, gm.structured_data AS structuredData,
                  gm.accepted_answer_id AS acceptedAnswerId,
                  gm.sticker_id AS stickerId, COALESCE(gm.sticker_url, stickers.image_url) AS stickerUrl,
                  reply_user.username AS replySenderName,
                  CASE WHEN reply_message.is_deleted THEN 'This message was deleted' ELSE reply_message.content END AS replyContent,
                  gm.is_deleted AS isDeleted,
                  gm.created_at AS timestamp
           FROM group_messages gm JOIN users u ON u.id = gm.sender_id
           LEFT JOIN group_channels channel ON channel.id = gm.channel_id
           LEFT JOIN group_messages reply_message ON reply_message.id = gm.reply_to_id
           LEFT JOIN users reply_user ON reply_user.id = reply_message.sender_id
           LEFT JOIN stickers ON stickers.id = gm.sticker_id
           WHERE gm.id = ?`,
          [result.insertId]
        );
        const [createdMessage] = await loadCommunityEngagement(rows, socket.userId, pool.execute.bind(pool));
        notifyGroupMessage(io, createdMessage).catch((error) => {
          console.error("Group message system notification error:", error.message);
        });
        const roomName = channelId ? `group:${id}:channel:${channelId}` : `group:${id}`;
        io.to(roomName).emit("group-message", createdMessage);
        socket.emit("group-message", createdMessage);
      } catch (error) {
        console.error("Group message DB error:", error.message);
        socket.emit("message-error", { message: "Group message could not be saved." });
      }
    });

    for (const eventName of ["offer", "answer", "ice-candidate", "hangup"]) {
      socket.on(eventName, (payload = {}) => {
        const recipientId = String(payload.to || "");
        if (!connectedUsers.has(recipientId)) return;
        const roomId = typeof payload.roomId === "string" ? payload.roomId : null;
        if (eventName === "offer" && roomId) {
          let room = activeCallRooms.get(roomId);
          if (!room) {
            room = {
              hostId: socket.userId,
              participants: new Set([socket.userId]),
              acceptedParticipants: new Set([socket.userId]),
              sfuReadyParticipants: new Set(),
              callType: payload.callType,
              mode: "mesh",
              sfuCommitted: false,
            };
            activeCallRooms.set(roomId, room);
          }
          if (room.mode === "sfu" && String(room.hostId) === String(socket.userId)) {
            const invitePermission = canInviteToCallRoom(room, socket.userId, recipientId);
            if (!invitePermission.allowed && invitePermission.reason === "full") {
              return socket.emit("call-room-error", { message: "Calls are limited to eight people." });
            }
            if (!invitePermission.allowed) return;
            room.participants.add(recipientId);
            for (const targetSocket of connectedUsers.get(recipientId) || []) {
              io.to(targetSocket).emit("sfu-call-invite", {
                from: socket.userId,
                fromName: socket.userName,
                roomId,
                callType: room.callType,
              });
            }
            return;
          }
          const offerPermission = canNegotiateCallRoomOffer(room, socket.userId, recipientId);
          if (!offerPermission.allowed && offerPermission.reason === "full") {
            return socket.emit("call-room-error", { message: "Calls are limited to eight people." });
          }
          if (!offerPermission.allowed) {
            return socket.emit("call-room-error", { message: "Only call participants can connect to each other." });
          }
          if (offerPermission.reason !== "mesh") {
            room.participants.add(recipientId);
          }
        } else if (roomId) {
          const room = activeCallRooms.get(roomId);
          if (!room || !room.participants.has(socket.userId) || !room.participants.has(recipientId)) return;
          if (eventName === "hangup") {
            if (socket.userId === room.hostId) {
              for (const participantId of room.participants) {
                if (participantId === socket.userId) continue;
                for (const targetSocket of connectedUsers.get(participantId) || []) {
                  io.to(targetSocket).emit("hangup", { from: socket.userId, roomId, roomEnded: true });
                }
              }
              activeCallRooms.delete(roomId);
              return;
            }
            room.participants.delete(socket.userId);
            room.acceptedParticipants.delete(String(socket.userId));
            room.sfuReadyParticipants.delete(String(socket.userId));
            commitSfuUpgrade(roomId, room);
            for (const participantId of room.participants) {
              for (const targetSocket of connectedUsers.get(participantId) || []) {
                io.to(targetSocket).emit("hangup", { from: socket.userId, roomId });
              }
            }
            return;
          }
          if (eventName === "answer") {
            room.acceptedParticipants.add(String(socket.userId));
            if (shouldUpgradeCallRoomToSfu(room)) {
              if (process.env.LIVEKIT_PUBLIC_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
                room.mode = "sfu";
                for (const participantId of room.acceptedParticipants) {
                  for (const targetSocket of connectedUsers.get(participantId) || []) {
                    io.to(targetSocket).emit("call-sfu-upgrade", { roomId, callType: room.callType });
                  }
                }
              } else if (!room.sfuUnavailableNotified) {
                room.sfuUnavailableNotified = true;
                for (const targetSocket of connectedUsers.get(String(room.hostId)) || []) {
                  io.to(targetSocket).emit("call-room-error", {
                    message: "More than four participants requires LiveKit server configuration.",
                  });
                }
              }
            } else if (room.mode === "mesh") {
              for (const participantId of room.acceptedParticipants) {
                if (participantId === String(socket.userId) || participantId === String(room.hostId)) continue;
                for (const targetSocket of connectedUsers.get(participantId) || []) {
                  io.to(targetSocket).emit("call-participant-joined", {
                    participantId: socket.userId,
                    participantName: socket.userName,
                    roomId,
                    callType: room.callType,
                  });
                }
              }
            }
          }
        }
        const { to, ...signalData } = payload;
        for (const targetSocket of connectedUsers.get(recipientId)) {
          io.to(targetSocket).emit(eventName, { ...signalData, from: socket.userId, fromName: socket.userName });
        }
      });
    }

    socket.on("sfu-invite-participant", ({ roomId, participantId } = {}) => {
      const room = activeCallRooms.get(String(roomId || ""));
      const recipientId = String(participantId || "");
      if (!room || room.mode !== "sfu" || String(room.hostId) !== String(socket.userId)) {
        return socket.emit("call-room-error", { message: "Only the call organizer can invite participants." });
      }
      const permission = canInviteToCallRoom(room, socket.userId, recipientId);
      if (!permission.allowed && permission.reason === "full") {
        return socket.emit("call-room-error", { message: "Calls are limited to eight people." });
      }
      if (!permission.allowed || !connectedUsers.has(recipientId)) return;
      room.participants.add(recipientId);
      for (const targetSocket of connectedUsers.get(recipientId) || []) {
        io.to(targetSocket).emit("sfu-call-invite", {
          from: socket.userId,
          fromName: socket.userName,
          roomId: String(roomId),
          callType: room.callType,
        });
      }
    });

    socket.on("call-sfu-ready", ({ roomId } = {}) => {
      const room = activeCallRooms.get(String(roomId || ""));
      const participantId = String(socket.userId);
      if (!room || room.mode !== "sfu" || !room.acceptedParticipants.has(participantId)) return;
      room.sfuReadyParticipants.add(participantId);
      if (room.sfuCommitted) {
        for (const targetSocket of connectedUsers.get(participantId) || []) {
          io.to(targetSocket).emit("call-sfu-commit", { roomId: String(roomId) });
        }
      } else {
        commitSfuUpgrade(String(roomId), room);
      }
    });

    // Step 4: Handle disconnect
    socket.on("disconnect", () => {
      console.log(`❌ Socket disconnected: ${socket.id}`);
      clearTimeout(socket.authExpirationTimer);

      if (socket.userId) {
        for (const [roomId, room] of activeCallRooms) {
          if (!room.participants.has(socket.userId)) continue;
          if (room.hostId === socket.userId) {
            for (const participantId of room.participants) {
              if (participantId === socket.userId) continue;
              for (const targetSocket of connectedUsers.get(participantId) || []) {
                io.to(targetSocket).emit("hangup", { from: socket.userId, roomId, roomEnded: true });
              }
            }
            activeCallRooms.delete(roomId);
          } else {
            room.participants.delete(socket.userId);
            room.acceptedParticipants.delete(String(socket.userId));
            room.sfuReadyParticipants.delete(String(socket.userId));
            commitSfuUpgrade(roomId, room);
            for (const participantId of room.participants) {
              for (const targetSocket of connectedUsers.get(participantId) || []) {
                io.to(targetSocket).emit("hangup", { from: socket.userId, roomId });
              }
            }
          }
        }
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
