require("dotenv").config();
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");
const { corsOrigin } = require("../utils/cors");
const { notifyDirectMessage, notifyGroupMessage } = require("../services/realtimeMessageNotifications");
const { MAX_CALL_PARTICIPANTS, canNegotiateCallRoomOffer, canInviteToCallRoom, shouldUpgradeCallRoomToSfu, matchesCallRoomScope } = require("../services/callRoomPolicy");
const { activeCallRooms } = require("../services/callRoomRegistry");
const { getGroupAccess, getActiveChannel, canAccessGroup, canPostInChannel } = require("../services/groupAccess");
const { loadCommunityEngagement, validateCommunityPost } = require("../services/communityPosts");
const { executeBotCommand } = require("../services/communityBots");
const { recordReputationEvent } = require("../services/communityReputation");
const { validateWhiteboardStroke } = require("../services/whiteboardStrokePolicy");
const { authorizeSession, sessionRoom } = require("../services/communityCollabSessions");
const Y = require("yjs");
const { MAX_CODE_SYNC_BYTES, validateAwarenessUpdate, validateCodeUpdate } = require("../services/codeRoomPolicy");
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

  const canAccessCallRoomScope = async (room, userId, userRole) => {
    if (!room?.groupId) return true;
    const group = await getGroupAccess(room.groupId, Number(userId));
    if (!canAccessGroup(group, userRole)) return false;
    const channel = group.groupType === "community" ? await getActiveChannel(room.groupId, room.channelId) : null;
    return matchesCallRoomScope(room, group, channel);
  };

  const activateSfuIfNeeded = (roomId, room) => {
    if (!shouldUpgradeCallRoomToSfu(room)) return;
    if (process.env.LIVEKIT_PUBLIC_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
      room.mode = "sfu";
      for (const participantId of room.acceptedParticipants) {
        for (const targetSocket of connectedUsers.get(participantId) || []) {
          io.to(targetSocket).emit("call-sfu-upgrade", { roomId, callType: room.callType });
        }
      }
    } else if (!room.sfuUnavailableNotified) {
      room.sfuUnavailableNotified = true;
      for (const participantId of room.acceptedParticipants) {
        for (const targetSocket of connectedUsers.get(participantId) || []) {
          io.to(targetSocket).emit("call-room-error", {
            message: "More than four participants requires LiveKit server configuration.",
          });
        }
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
        let post = validateCommunityPost(messagePayload, group.groupType === "community");
        if (post.error) return socket.emit("message-error", { message: post.error });
        let channelId = null;
        let channel = null;
        if (group.groupType === "community") {
          if (!Number.isSafeInteger(requestedChannelId) || requestedChannelId < 1) {
            return socket.emit("message-error", { message: "Choose a community channel." });
          }
          channel = await getActiveChannel(id, requestedChannelId);
          if (!channel) return socket.emit("message-error", { message: "Channel not found." });
          if (channel.channelType !== "text") return socket.emit("message-error", { message: "Audio and video channels do not support messages." });
          if (!await canPostInChannel(group, channel, socket.userRole)) {
            return socket.emit("message-error", { message: "Only community leaders can post in this channel." });
          }
          channelId = channel.id;
        } else if (requestedChannelId !== null) {
          return socket.emit("message-error", { message: "Standard groups do not have channels." });
        }
        let botId = null;
        if (group.groupType === "community" && typeof content === "string" && content.startsWith("/")) {
          if (attachments.length || messagePayload.replyToId !== undefined || messagePayload.stickerId !== undefined) {
            return socket.emit("message-error", { message: "Bot commands cannot include attachments, replies, or stickers." });
          }
          const botReply = await executeBotCommand(id, channelId, content);
          if (!botReply || botReply.error) {
            return socket.emit("message-error", { message: botReply?.error || "This command is not available." });
          }
          botId = botReply.botId;
          post = botReply;
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
          "INSERT INTO group_messages (group_id, channel_id, sender_id, bot_id, content, attachments, reply_to_id, sticker_id, sticker_url, message_type, structured_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [id, channelId, Number(socket.userId), botId, post.content, JSON.stringify(attachments), replyToId || null, stickerId || null, botId ? null : sticker[0]?.imageUrl || null, post.messageType, post.structuredData ? JSON.stringify(post.structuredData) : null]
        );
        const [rows] = await pool.execute(
          `SELECT gm.id AS _id, gm.group_id AS groupId, gm.channel_id AS channelId,
                  channel.name AS channelName, gm.sender_id AS sender, gm.bot_id AS botId,
                  COALESCE(integration.name, bot.name, u.username) AS senderName, gm.content, gm.attachments, gm.reply_to_id AS replyToId,
                  gm.message_type AS messageType, gm.structured_data AS structuredData,
                  gm.accepted_answer_id AS acceptedAnswerId,
                  gm.sticker_id AS stickerId, COALESCE(gm.sticker_url, stickers.image_url) AS stickerUrl,
                  reply_user.username AS replySenderName,
                  CASE WHEN reply_message.is_deleted THEN 'This message was deleted' ELSE reply_message.content END AS replyContent,
                  gm.is_deleted AS isDeleted,
                  gm.created_at AS timestamp
           FROM group_messages gm JOIN users u ON u.id = gm.sender_id
           LEFT JOIN community_bots bot ON bot.id = gm.bot_id
           LEFT JOIN community_integrations integration ON integration.id = gm.integration_id
           LEFT JOIN group_channels channel ON channel.id = gm.channel_id
           LEFT JOIN group_messages reply_message ON reply_message.id = gm.reply_to_id
           LEFT JOIN users reply_user ON reply_user.id = reply_message.sender_id
           LEFT JOIN stickers ON stickers.id = gm.sticker_id
           WHERE gm.id = ?`,
          [result.insertId]
        );
        const [createdMessage] = await loadCommunityEngagement(rows, socket.userId, pool.execute.bind(pool));
        if (group.groupType === "community" && !botId) {
          await recordReputationEvent(pool.execute.bind(pool), id, Number(socket.userId), "post", createdMessage._id, 1);
        }
        if (!botId) {
          notifyGroupMessage(io, createdMessage).catch((error) => {
            console.error("Group message system notification error:", error.message);
          });
        }
        const roomName = channelId ? `group:${id}:channel:${channelId}` : `group:${id}`;
        io.to(roomName).emit("group-message", createdMessage);
        socket.emit("group-message", createdMessage);
      } catch (error) {
        console.error("Group message DB error:", error.message);
        socket.emit("message-error", { message: "Group message could not be saved." });
      }
    });

    socket.on("collab-session-join", async (payload = {}) => {
      const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
      try {
        let authorized = await authorizeSession(sessionId, { id: socket.userId, role: socket.userRole }, { write: true });
        let readOnly = false;
        if (authorized.status === 410) {
          authorized = await authorizeSession(sessionId, { id: socket.userId, role: socket.userRole });
          readOnly = authorized.session?.status === "closed";
          if (!authorized.status && !readOnly) {
            authorized = { status: 410, message: "This session is closed and read-only." };
          }
        }
        if (authorized.status) {
          return socket.emit("collab-session-error", { sessionId, message: authorized.message || "You do not have permission to join this session." });
        }
        const room = sessionRoom(sessionId);
        const alreadyJoined = socket.rooms.has(room);
        socket.join(room);
        if (authorized.session.sessionType === "code_room") {
          socket.to(room).emit("collab-code-awareness-request", { sessionId });
          const [rows] = await pool.execute(
            "SELECT document_state AS documentState FROM community_collab_code_states WHERE session_id = ? LIMIT 1",
            [sessionId]
          );
          const update = rows[0]?.documentState || new Uint8Array();
          if (update.byteLength > MAX_CODE_SYNC_BYTES) {
            socket.emit("collab-session-error", { sessionId, message: "This Code Room has exceeded its sync limit." });
            socket.leave(room);
            return;
          }
          socket.emit("collab-code-sync", { sessionId, update });
        }
        const roomSockets = await io.in(room).fetchSockets();
        const participants = [...new Map(roomSockets.map((participant) => [String(participant.userId), {
          userId: Number(participant.userId),
          userName: participant.userName || "Community member",
        }])).values()];
        socket.emit("collab-session-participants", { sessionId, participants });
        if (!alreadyJoined) {
          socket.to(room).emit("collab-session-participant-joined", {
            sessionId,
            userId: Number(socket.userId),
            userName: socket.userName || "Community member",
          });
        }
        socket.emit("collab-session-joined", { sessionId, sessionType: authorized.session.sessionType, status: authorized.session.status, readOnly });
      } catch (error) {
        console.error("Collaborative session join error:", error.message);
        socket.emit("collab-session-error", { sessionId, message: "Could not join this session." });
      }
    });

    socket.on("collab-session-leave", (payload = {}) => {
      const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
      if (!/^[a-f\d]{8}-([a-f\d]{4}-){3}[a-f\d]{12}$/i.test(sessionId)) return;
      const room = sessionRoom(sessionId);
      if (!socket.rooms.has(room)) return;
      socket.leave(room);
      socket.to(room).emit("collab-session-participant-left", { sessionId, userId: Number(socket.userId) });
    });

    socket.on("collab-code-update", async (payload = {}) => {
      const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
      const update = validateCodeUpdate(payload.update);
      const room = sessionRoom(sessionId);
      if (!update || !socket.rooms.has(room)) return;
      try {
        const authorized = await authorizeSession(sessionId, { id: socket.userId, role: socket.userRole }, { write: true });
        if (authorized.status || authorized.session.sessionType !== "code_room") {
          socket.leave(room);
          return socket.emit("collab-session-error", { sessionId, message: authorized.message || "This session is not a Code Room." });
        }
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          await connection.execute(
            "INSERT IGNORE INTO community_collab_code_states (session_id, updated_by, document_state) VALUES (?, ?, ?)",
            [sessionId, Number(socket.userId), update]
          );
          const [rows] = await connection.execute(
            "SELECT document_state AS documentState FROM community_collab_code_states WHERE session_id = ? FOR UPDATE",
            [sessionId]
          );
          const merged = Y.mergeUpdates([rows[0].documentState, update]);
          if (merged.byteLength > MAX_CODE_SYNC_BYTES) {
            await connection.rollback();
            return socket.emit("collab-session-error", { sessionId, message: "This Code Room has exceeded its sync limit." });
          }
          await connection.execute(
            "UPDATE community_collab_code_states SET updated_by = ?, document_state = ? WHERE session_id = ?",
            [Number(socket.userId), merged, sessionId]
          );
          await connection.commit();
        } catch (error) {
          await connection.rollback().catch(() => {});
          throw error;
        } finally {
          connection.release();
        }
        socket.to(room).emit("collab-code-update", { sessionId, update });
      } catch (error) {
        console.error("Collaborative Code Room update error:", error.message);
        socket.emit("collab-session-error", { sessionId, message: "Could not save this Code Room update." });
      }
    });

    socket.on("collab-code-awareness", async (payload = {}) => {
      const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
      const update = validateAwarenessUpdate(payload.update);
      const room = sessionRoom(sessionId);
      if (!update || !socket.rooms.has(room)) return;
      try {
        const authorized = await authorizeSession(sessionId, { id: socket.userId, role: socket.userRole }, { write: true });
        if (authorized.status || authorized.session.sessionType !== "code_room") {
          socket.leave(room);
          return;
        }
        socket.to(room).emit("collab-code-awareness", { sessionId, update });
      } catch (error) {
        console.error("Collaborative Code Room awareness error:", error.message);
      }
    });

    socket.on("collab-whiteboard-stroke", async (payload = {}) => {
      const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
      const room = sessionRoom(sessionId);
      if (!validateWhiteboardStroke(payload) || !socket.rooms.has(room)) return;
      try {
        const authorized = await authorizeSession(sessionId, { id: socket.userId, role: socket.userRole }, { write: true });
        if (authorized.status || authorized.session.sessionType !== "whiteboard") {
          socket.leave(room);
          return;
        }
        socket.to(room).emit("collab-whiteboard-stroke", {
          sessionId,
          userId: Number(socket.userId),
          socketId: socket.id,
          points: payload.points,
          color: payload.color,
          width: payload.width,
          finished: payload.finished === true,
        });
      } catch (error) {
        console.error("Collaborative Whiteboard stroke relay error:", error.message);
      }
    });

    socket.on("whiteboard-stroke", async (payload = {}) => {
      const groupId = Number(payload.groupId);
      const points = payload.points;
      if (!validateWhiteboardStroke(payload)) return;
      try {
        const group = await getGroupAccess(groupId, Number(socket.userId));
        if (group?.groupType !== "community" || !canAccessGroup(group, socket.userRole)) return;
        socket.to(`group:${groupId}`).emit("whiteboard-stroke", {
          groupId,
          userId: Number(socket.userId),
          socketId: socket.id,
          points,
          color: payload.color,
          width: payload.width,
          finished: payload.finished === true,
        });
      } catch (error) {
        console.error("Whiteboard stroke relay error:", error.message);
      }
    });

    socket.on("code-room-join", async (payload = {}) => {
      const groupId = Number(payload.groupId);
      if (!Number.isSafeInteger(groupId) || groupId < 1) return;
      try {
        const group = await getGroupAccess(groupId, Number(socket.userId));
        if (group?.groupType !== "community" || !canAccessGroup(group, socket.userRole)) {
          return socket.emit("code-room-error", { groupId, message: "You cannot access this community code room." });
        }
        const room = `code-room:${groupId}`;
        socket.join(room);
        socket.to(room).emit("code-room-awareness-request", { groupId });
        const [rows] = await pool.execute(
          "SELECT document_state AS documentState FROM community_code_rooms WHERE group_id = ? LIMIT 1",
          [groupId]
        );
        const update = rows[0]?.documentState || new Uint8Array();
        if (update.byteLength > MAX_CODE_SYNC_BYTES) {
          socket.emit("code-room-error", { groupId, message: "This code room has exceeded its sync limit." });
          socket.leave(room);
          return;
        }
        socket.emit("code-room-sync", { groupId, update });
        socket.emit("code-room-joined", { groupId });
      } catch (error) {
        console.error("Code room join error:", error.message);
        socket.emit("code-room-error", { groupId, message: "Could not join this code room." });
      }
    });

    socket.on("code-room-leave", (payload = {}) => {
      const groupId = Number(payload.groupId);
      if (Number.isSafeInteger(groupId) && groupId > 0) socket.leave(`code-room:${groupId}`);
    });

    socket.on("code-room-update", async (payload = {}) => {
      const groupId = Number(payload.groupId);
      const update = validateCodeUpdate(payload.update);
      const room = `code-room:${groupId}`;
      if (!Number.isSafeInteger(groupId) || groupId < 1 || !update || !socket.rooms.has(room)) return;
      try {
        const group = await getGroupAccess(groupId, Number(socket.userId));
        if (group?.groupType !== "community" || !canAccessGroup(group, socket.userRole)) {
          socket.leave(room);
          return;
        }
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          await connection.execute(
            "INSERT IGNORE INTO community_code_rooms (group_id, updated_by, document_state) VALUES (?, ?, ?)",
            [groupId, socket.userId, update]
          );
          const [rows] = await connection.execute(
            "SELECT document_state AS documentState FROM community_code_rooms WHERE group_id = ? FOR UPDATE",
            [groupId]
          );
          const merged = Y.mergeUpdates([rows[0].documentState, update]);
          if (merged.byteLength > MAX_CODE_SYNC_BYTES) {
            await connection.rollback();
            return socket.emit("code-room-error", { groupId, message: "This code room has exceeded its sync limit." });
          }
          await connection.execute(
            "UPDATE community_code_rooms SET updated_by = ?, document_state = ? WHERE group_id = ?",
            [socket.userId, merged, groupId]
          );
          await connection.commit();
        } catch (error) {
          await connection.rollback().catch(() => {});
          throw error;
        } finally {
          connection.release();
        }
        socket.to(room).emit("code-room-update", { groupId, update });
      } catch (error) {
        console.error("Code room update error:", error.message);
        socket.emit("code-room-error", { groupId, message: "Could not save this code-room update." });
      }
    });

    socket.on("code-room-awareness", async (payload = {}) => {
      const groupId = Number(payload.groupId);
      const update = validateAwarenessUpdate(payload.update);
      const room = `code-room:${groupId}`;
      if (!Number.isSafeInteger(groupId) || groupId < 1 || !update || !socket.rooms.has(room)) return;
      try {
        const group = await getGroupAccess(groupId, Number(socket.userId));
        if (group?.groupType !== "community" || !canAccessGroup(group, socket.userRole)) {
          socket.leave(room);
          return;
        }
        socket.to(room).emit("code-room-awareness", { groupId, update });
      } catch (error) {
        console.error("Code room awareness relay error:", error.message);
      }
    });

    socket.on("start-group-call", async (payload = {}) => {
      const groupId = Number(payload.groupId);
      const channelId = payload.channelId == null ? null : Number(payload.channelId);
      const roomId = typeof payload.roomId === "string" ? payload.roomId : "";
      const callType = payload.callType === "audio" ? "audio" : payload.callType === "video" ? "video" : null;
      if (!Number.isSafeInteger(groupId) || groupId < 1 || !callType
        || !/^[a-f\d]{8}-([a-f\d]{4}-){3}[a-f\d]{12}$/i.test(roomId)
        || activeCallRooms.has(roomId)) {
        return socket.emit("call-room-error", { message: "Could not start this group call." });
      }
      try {
        const group = await getGroupAccess(groupId, Number(socket.userId));
        if (!canAccessGroup(group, socket.userRole)) {
          return socket.emit("call-room-error", { message: "You are not a member of this group." });
        }
        let channel = null;
        if (group.groupType === "standard") {
          if (channelId !== null) return socket.emit("call-room-error", { message: "Standard groups do not have call channels." });
        } else {
          channel = await getActiveChannel(groupId, channelId);
          if (!channel || channel.channelType !== callType) {
            return socket.emit("call-room-error", { message: "Choose a matching audio or video channel." });
          }
        }
        const room = {
          groupId,
          groupType: group.groupType,
          channelId: channel?.id ?? null,
          hostId: String(socket.userId),
          participants: new Set([String(socket.userId)]),
          acceptedParticipants: new Set([String(socket.userId)]),
          sfuReadyParticipants: new Set(),
          callType,
          mode: "mesh",
          sfuCommitted: false,
        };
        activeCallRooms.set(roomId, room);
        socket.emit("group-call-started", { roomId, callType });
        const callAudience = channel ? `group:${groupId}:channel:${channel.id}` : `group:${groupId}`;
        socket.to(callAudience).emit("group-call-invite", {
          roomId,
          groupId,
          channelId: channel?.id ?? null,
          callType,
          from: socket.userId,
          fromName: socket.userName,
        });
      } catch (error) {
        console.error("Start group call error:", error.message);
        socket.emit("call-room-error", { message: "Could not start this group call." });
      }
    });

    socket.on("join-group-call", async ({ roomId } = {}) => {
      const room = activeCallRooms.get(String(roomId || ""));
      if (!room?.groupId || room.groupType !== "standard" || room.channelId !== null) {
        return socket.emit("call-room-error", { message: "This group call is no longer available." });
      }
      try {
        if (!await canAccessCallRoomScope(room, socket.userId, socket.userRole)) {
          return socket.emit("call-room-error", { message: "You are not a member of this group." });
        }
        const participantId = String(socket.userId);
        if (!room.participants.has(participantId) && room.participants.size >= MAX_CALL_PARTICIPANTS) {
          return socket.emit("call-room-error", { message: "Calls are limited to eight people." });
        }
        const existingParticipants = [...room.acceptedParticipants].filter((id) => id !== participantId);
        room.participants.add(participantId);
        room.acceptedParticipants.add(participantId);
        socket.emit("group-call-joined", {
          roomId: String(roomId),
          callType: room.callType,
          hostId: room.hostId,
          mode: room.mode,
          participants: existingParticipants,
        });
        const wasSfu = room.mode === "sfu";
        activateSfuIfNeeded(String(roomId), room);
        if (room.mode === "mesh") {
          for (const existingId of existingParticipants) {
            for (const targetSocket of connectedUsers.get(existingId) || []) {
              io.to(targetSocket).emit("call-participant-joined", {
                participantId,
                participantName: socket.userName,
                roomId: String(roomId),
                callType: room.callType,
              });
            }
          }
        } else if (wasSfu) socket.emit("call-sfu-upgrade", { roomId: String(roomId), callType: room.callType });
      } catch (error) {
        console.error("Join group call error:", error.message);
        socket.emit("call-room-error", { message: "Could not join this group call." });
      }
    });

    socket.on("join-call-channel", async ({ groupId: rawGroupId, channelId: rawChannelId } = {}) => {
      const groupId = Number(rawGroupId);
      const channelId = Number(rawChannelId);
      if (!Number.isSafeInteger(groupId) || groupId < 1 || !Number.isSafeInteger(channelId) || channelId < 1) {
        return socket.emit("call-room-error", { message: "Choose a valid audio or video channel." });
      }
      const roomId = `community-call:${groupId}:${channelId}`;
      try {
        const group = await getGroupAccess(groupId, Number(socket.userId));
        if (group?.groupType !== "community" || !canAccessGroup(group, socket.userRole)) {
          return socket.emit("call-room-error", { message: "You are not a member of this community." });
        }
        const channel = await getActiveChannel(groupId, channelId);
        if (!channel || !["audio", "video"].includes(channel.channelType)) {
          return socket.emit("call-room-error", { message: "This is not an active audio or video channel." });
        }
        let room = activeCallRooms.get(roomId);
        if (!room) {
          room = {
            groupId,
            groupType: "community",
            channelId,
            hostId: String(socket.userId),
            participants: new Set(),
            acceptedParticipants: new Set(),
            sfuReadyParticipants: new Set(),
            callType: channel.channelType,
            mode: "mesh",
            sfuCommitted: false,
          };
          activeCallRooms.set(roomId, room);
        }
        if (room.callType !== channel.channelType) return socket.emit("call-room-error", { message: "The channel call type changed. Rejoin the channel." });
        const participantId = String(socket.userId);
        if (!room.participants.has(participantId) && room.participants.size >= MAX_CALL_PARTICIPANTS) {
          return socket.emit("call-room-error", { message: "Calls are limited to eight people." });
        }
        const existingParticipants = [...room.acceptedParticipants].filter((id) => id !== participantId);
        room.participants.add(participantId);
        room.acceptedParticipants.add(participantId);
        if (!existingParticipants.length) room.hostId = participantId;
        socket.emit("group-call-joined", {
          roomId,
          callType: room.callType,
          hostId: room.hostId,
          mode: room.mode,
          participants: existingParticipants,
        });
        const wasSfu = room.mode === "sfu";
        activateSfuIfNeeded(roomId, room);
        if (room.mode === "mesh") {
          for (const existingId of existingParticipants) {
            for (const targetSocket of connectedUsers.get(existingId) || []) {
              io.to(targetSocket).emit("call-participant-joined", {
                participantId,
                participantName: socket.userName,
                roomId,
                callType: room.callType,
              });
            }
          }
        } else if (wasSfu) socket.emit("call-sfu-upgrade", { roomId, callType: room.callType });
      } catch (error) {
        console.error("Join community call channel error:", error.message);
        socket.emit("call-room-error", { message: "Could not join this call channel." });
      }
    });

    socket.on("leave-group-call", ({ roomId } = {}) => {
      const id = String(roomId || "");
      const room = activeCallRooms.get(id);
      const participantId = String(socket.userId);
      if (!room?.groupId || !room.participants.has(participantId)) return;
      if (room.groupType === "standard" && room.hostId === participantId) {
        for (const otherId of room.participants) {
          if (otherId === participantId) continue;
          for (const targetSocket of connectedUsers.get(otherId) || []) {
            io.to(targetSocket).emit("hangup", { from: participantId, roomId: id, roomEnded: true });
          }
        }
        activeCallRooms.delete(id);
        return;
      }
      room.participants.delete(participantId);
      room.acceptedParticipants.delete(participantId);
      room.sfuReadyParticipants.delete(participantId);
      if (room.groupType === "community" && room.channelId !== null && room.hostId === participantId) {
        room.hostId = [...room.acceptedParticipants][0] || null;
      }
      if (!room.participants.size) {
        activeCallRooms.delete(id);
        return;
      }
      commitSfuUpgrade(id, room);
      for (const otherId of room.participants) {
        for (const targetSocket of connectedUsers.get(otherId) || []) {
          io.to(targetSocket).emit("hangup", { from: participantId, roomId: id });
        }
      }
    });

    for (const eventName of ["offer", "answer", "ice-candidate", "hangup"]) {
      socket.on(eventName, async (payload = {}) => {
        const recipientId = String(payload.to || "");
        if (!connectedUsers.has(recipientId)) return;
        const roomId = typeof payload.roomId === "string" ? payload.roomId : null;
        const callRoom = roomId ? activeCallRooms.get(roomId) : null;
        if (callRoom?.groupId) {
          try {
            if (!await canAccessCallRoomScope(callRoom, socket.userId, socket.userRole)
              || !await canAccessCallRoomScope(callRoom, recipientId, "member")) {
              return socket.emit("call-room-error", { message: "Call access is no longer available." });
            }
          } catch (error) {
            console.error("Group call signaling authorization error:", error.message);
            return socket.emit("call-room-error", { message: "Could not verify access to this call." });
          }
        }
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
          if (room.groupId && (!room.participants.has(String(socket.userId)) || !room.participants.has(recipientId))) {
            return socket.emit("call-room-error", { message: "Only joined group call participants can connect." });
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
          if (eventName === "hangup" && room.groupType === "community" && room.channelId !== null) {
            room.participants.delete(String(socket.userId));
            room.acceptedParticipants.delete(String(socket.userId));
            room.sfuReadyParticipants.delete(String(socket.userId));
            if (room.hostId === String(socket.userId)) room.hostId = [...room.acceptedParticipants][0] || null;
            if (!room.participants.size) activeCallRooms.delete(roomId);
            else {
              commitSfuUpgrade(roomId, room);
              for (const participantId of room.participants) {
                for (const targetSocket of connectedUsers.get(participantId) || []) {
                  io.to(targetSocket).emit("hangup", { from: socket.userId, roomId });
                }
              }
            }
            return;
          }
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
            activateSfuIfNeeded(roomId, room);
            if (room.mode === "mesh") {
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
      if (!room || room.groupId || room.mode !== "sfu" || String(room.hostId) !== String(socket.userId)) {
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

    socket.on("disconnecting", () => {
      for (const room of socket.rooms) {
        if (!room.startsWith("collab-session:")) continue;
        socket.to(room).emit("collab-session-participant-left", {
          sessionId: room.slice("collab-session:".length),
          userId: Number(socket.userId),
        });
      }
    });

    // Step 4: Handle disconnect
    socket.on("disconnect", () => {
      console.log(`❌ Socket disconnected: ${socket.id}`);
      clearTimeout(socket.authExpirationTimer);

      if (socket.userId) {
        for (const [roomId, room] of activeCallRooms) {
          if (!room.participants.has(socket.userId)) continue;
          if (room.hostId === socket.userId && room.groupType !== "community") {
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
            if (room.groupType === "community" && room.channelId !== null && room.hostId === socket.userId) {
              room.hostId = [...room.acceptedParticipants][0] || null;
            }
            if (!room.participants.size) activeCallRooms.delete(roomId);
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
