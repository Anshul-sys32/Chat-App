const express = require("express");
const router = express.Router();
const { AccessToken } = require("livekit-server-sdk");

const path = require("node:path");
const {
	register,
	verifySignup,
	resendSignupOtp,
	requestPasswordReset,
	resetPassword,
	login,
	googleLogin,
	updateOwnProfile,
	updateAdminProfile,
	user,
} = require("../controllers/authController");
const protect = require("../middleware/authMiddleware");
const requireAdmin = require("../middleware/requireAdmin");
const User = require("../models/User");
const { pool } = require("../config/db");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { activeCallRooms } = require("../services/callRoomRegistry");
const { canJoinSfuCallRoom, matchesCallRoomScope } = require("../services/callRoomPolicy");
const { searchMessages } = require("../controllers/messageSearchController");
const { listMediaGallery } = require("../controllers/mediaGalleryController");
const {
	createCustomBot,
	installBuiltinBot,
	listCommunityBots,
	uninstallCommunityBot,
	updateCommunityBot,
} = require("../controllers/communityBotsController");
const {
	createIntegration,
	deleteIntegration,
	listIntegrationLogs,
	listIntegrations,
	receiveWebhook,
	updateIntegration,
} = require("../controllers/communityIntegrationsController");
const { getCommunityReputation } = require("../controllers/communityReputationController");
const {
	closeCommunitySession,
	createCommunitySession,
	getCommunitySession,
	listCommunitySessions,
	updateCommunitySession,
} = require("../controllers/communityCollabSessionsController");
const {
	createCommunityTask,
	deleteCommunityTask,
	listCommunityTasks,
	updateCommunityTask,
} = require("../controllers/communityTasksController");
const {
	createWhiteboardItem,
	createSessionWhiteboardItem,
	deleteWhiteboardItem,
	deleteSessionWhiteboardItem,
	listSessionWhiteboardItems,
	listWhiteboardItems,
	updateSessionWhiteboardItem,
	updateWhiteboardItem,
} = require("../controllers/communityWhiteboardController");
const {
	cancelScheduledMessage,
	createScheduledMessage,
	listScheduledMessages,
	updateScheduledMessage,
} = require("../controllers/scheduledMessagesController");
const { parseFile } = require("music-metadata");
const {
	getNotificationPreferences,
	updateNotificationPreferences,
} = require("../controllers/notificationPreferencesController");
const {
	getConversationNotificationPreferences,
	updateConversationNotificationPreferences,
} = require("../controllers/conversationNotificationPreferencesController");
const {
	listChannels,
	createChannel,
	updateChannel,
	archiveChannel,
	listChannelRolePermissions,
	updateChannelRolePermission,
} = require("../controllers/groupChannelController");
const {
	createGroupRole,
	deleteGroupRole,
	listGroupRoles,
	updateGroupRole,
} = require("../controllers/groupRoleController");
const { isGroupType } = require("../services/groupCapabilities");
const { ensureDefaultCommunityChannels } = require("../services/communityDefaults");
const { ensureBuiltInGroupRoles } = require("../services/groupRoles");
const { isSupportedReaction, loadCommunityEngagement, parseStructuredData } = require("../services/communityPosts");
const { loadDirectMessageReactions, toggleReactionState } = require("../services/messageReactions");
const { notifyMessageReaction } = require("../services/messageReactionNotifications");
const { recordReputationEvent } = require("../services/communityReputation");
const {
	getGroupAccess,
	getActiveChannel,
	canAccessGroup,
	canPostInChannel,
	canManageGroup: hasGroupPermission,
	validateGroupMessageTarget,
} = require("../services/groupAccess");
const {
	upload,
	avatarUpload,
	uploadDirectory,
	stickerUpload,
	voiceUpload,
	voiceDirectory,
	allowedVoiceTypes,
	maxVoiceDurationSeconds,
} = require("../utils/uploads");
const { optimizeSticker, storeSticker, removeStickerFile } = require("../utils/stickers");

const removeUploadedFiles = async (files) => Promise.all((files || []).map((file) =>
	fs.unlink(file.path).catch((error) => {
		if (error.code !== "ENOENT") console.error("Uploaded file cleanup error:", error);
	})
));

const removeStoredAvatar = async (url) => {
	if (typeof url !== "string" || !url.startsWith("/uploads/")) return;
	const filename = path.basename(url);
	if (!/^\d+-avatar-[a-f0-9-]{36}\.(jpg|png|gif|webp|avif)$/i.test(filename)) return;
	await fs.unlink(path.join(uploadDirectory, filename)).catch((error) => {
		if (error.code !== "ENOENT") console.error("Profile image cleanup error:", error);
	});
};

const receiveAvatar = (req, res, next) => {
	avatarUpload.single("avatar")(req, res, async (error) => {
		if (!error) return next();
		await removeUploadedFiles(req.file ? [req.file] : []);
		const message = error.code === "LIMIT_FILE_SIZE"
			? "Profile images must be 5 MB or smaller."
			: error.message;
		return res.status(400).json({ message });
	});
};

const updateUserAvatar = async (req, res, userId) => {
	if (!req.file) return res.status(400).json({ message: "Choose a profile image to upload." });
	try {
		const target = await User.findById(userId);
		if (!target) {
			await removeUploadedFiles([req.file]);
			return res.status(404).json({ message: "User not found." });
		}
		const profilePicture = `/uploads/${req.file.filename}`;
		await User.updateProfilePicture(userId, profilePicture);
		await removeStoredAvatar(target.profilePicture);
		req.app.get("io")?.emit("profile-picture-updated", { userId, profilePicture });
		return res.json({
			user: { _id: userId, profilePicture, googlePicture: target.googlePicture || null },
		});
	} catch (error) {
		await removeUploadedFiles([req.file]);
		console.error("Update profile image error:", error);
		return res.status(500).json({ message: "Could not update the profile image." });
	}
};

const getGroupRole = async (groupId, userId) => {
	const [rows] = await pool.execute(
		"SELECT role FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1",
		[groupId, userId]
	);
	return rows[0]?.role || null;
};

const validId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;

const bumpStickerCatalogRevision = async (req) => {
	await pool.execute("UPDATE sticker_catalog_state SET revision = revision + 1 WHERE id = 1");
	const [[catalog]] = await pool.execute("SELECT revision FROM sticker_catalog_state WHERE id = 1");
	req.app.get("io")?.emit("sticker-catalog-updated", { revision: Number(catalog.revision) });
};

const createSticker = async (req, res, ownerId) => {
	if (!req.file) return res.status(400).json({ message: "Choose a sticker image or GIF to upload." });
	const name = String(req.body.name || "").trim();
	const categoryName = String(req.body.category || "General").trim() || "General";
	if (!name || name.length > 100) return res.status(400).json({ message: "Provide a sticker name (up to 100 characters)." });
	if (categoryName.length > 60) return res.status(400).json({ message: "Sticker categories must be 60 characters or shorter." });
	let optimized;
	try {
		optimized = await optimizeSticker(req.file.buffer);
	} catch (error) {
		return res.status(400).json({ message: error.message || "Could not process sticker image." });
	}
	let stored;
	try {
		const [categories] = await pool.execute("SELECT id FROM sticker_categories WHERE name = ? LIMIT 1", [categoryName]);
		if (!categories.length) return res.status(400).json({ message: "Create this sticker category before uploading." });
		stored = await storeSticker(optimized.buffer);
		const [result] = await pool.execute(
			"INSERT INTO stickers (owner_id, category_id, name, image_url, media_type) VALUES (?, ?, ?, ?, 'image/webp')",
			[ownerId, categories[0].id, name, stored.url]
		);
		await bumpStickerCatalogRevision(req);
		return res.status(201).json({ _id: result.insertId, ownerId, name, category: categoryName, imageUrl: stored.url, mediaType: "image/webp", animated: optimized.animated });
	} catch (error) {
		if (stored) await removeStickerFile(stored.url).catch(() => {});
		console.error("Create sticker error:", error);
		return res.status(500).json({ message: "Could not save sticker." });
	}
};

const stickerUploadHandler = (req, res, next) => {
	stickerUpload.single("sticker")(req, res, (error) => {
		if (error) return res.status(400).json({ message: error.message || "Could not upload sticker." });
		return next();
	});
};

router.get("/media-gallery", protect, listMediaGallery);
router.get("/groups/:groupId/bots", protect, listCommunityBots);
router.put("/groups/:groupId/bots/built-in/:botKey", protect, installBuiltinBot);
router.post("/groups/:groupId/bots", protect, createCustomBot);
router.patch("/groups/:groupId/bots/:botId", protect, updateCommunityBot);
router.delete("/groups/:groupId/bots/:botId", protect, uninstallCommunityBot);
router.get("/groups/:groupId/integrations", protect, listIntegrations);
router.post("/groups/:groupId/integrations", protect, createIntegration);
router.patch("/groups/:groupId/integrations/:integrationId", protect, updateIntegration);
router.delete("/groups/:groupId/integrations/:integrationId", protect, deleteIntegration);
router.get("/groups/:groupId/integrations/:integrationId/logs", protect, listIntegrationLogs);
router.post("/integrations/:integrationId/webhook", receiveWebhook);

router.get("/stickers", protect, async (req, res) => {
	try {
		const [[catalog]] = await pool.execute("SELECT revision FROM sticker_catalog_state WHERE id = 1");
		const revision = Number(catalog?.revision || 1);
		const etag = `\"stickers-${revision}\"`;
		res.set("ETag", etag);
		res.set("Cache-Control", "private, no-cache");
		if (req.get("If-None-Match") === etag) return res.status(304).end();
		const [stickers] = await pool.execute(
			`SELECT s.id AS _id, s.owner_id AS ownerId, s.name, s.image_url AS imageUrl,
			        s.media_type AS mediaType, c.name AS category
			 FROM stickers s LEFT JOIN sticker_categories c ON c.id = s.category_id
			 WHERE s.image_url LIKE '/uploads/%'
			 ORDER BY c.name, s.name, s.id`
		);
		const [categories] = await pool.execute("SELECT name FROM sticker_categories ORDER BY name");
		return res.json({ revision, stickers, categories: categories.map((category) => category.name) });
	} catch (error) {
		console.error("Fetch stickers error:", error);
		return res.status(500).json({ message: "Failed to load stickers." });
	}
});

router.post("/sticker-categories", protect, async (req, res) => {
	const name = String(req.body.name || "").trim();
	if (!name || name.length > 60) return res.status(400).json({ message: "Category names must be 1 to 60 characters." });
	if (["all", "favorites", "recent"].includes(name.toLowerCase())) {
		return res.status(400).json({ message: "Choose a category name other than all, favorites, or recent." });
	}
	try {
		const [result] = await pool.execute("INSERT IGNORE INTO sticker_categories (name, created_by) VALUES (?, ?)", [name, req.user.id]);
		if (result.affectedRows) await bumpStickerCatalogRevision(req);
		const [[category]] = await pool.execute("SELECT name FROM sticker_categories WHERE name = ? LIMIT 1", [name]);
		return res.status(result.affectedRows ? 201 : 200).json({ name: category.name });
	} catch (error) {
		console.error("Create sticker category error:", error);
		return res.status(500).json({ message: "Could not create sticker category." });
	}
});

router.post("/stickers/upload", protect, stickerUploadHandler, (req, res) => createSticker(req, res, req.user.id));
router.delete("/stickers/:stickerId", protect, async (req, res) => deleteSticker(req, res, false));
router.post("/admin/stickers", protect, requireAdmin, stickerUploadHandler, (req, res) => createSticker(req, res, null));
router.delete("/admin/stickers/:stickerId", protect, requireAdmin, async (req, res) => deleteSticker(req, res, true));

async function deleteSticker(req, res, admin) {
	const stickerId = Number(req.params.stickerId);
	if (!validId(stickerId)) return res.status(400).json({ message: "Invalid sticker id." });
	try {
		const [rows] = await pool.execute("SELECT id, owner_id AS ownerId, image_url AS imageUrl FROM stickers WHERE id = ? LIMIT 1", [stickerId]);
		const sticker = rows[0];
		if (!sticker || !admin && Number(sticker.ownerId) !== Number(req.user.id)) {
			return res.status(404).json({ message: "Sticker not found." });
		}
		await pool.execute("DELETE FROM stickers WHERE id = ?", [stickerId]);
		await bumpStickerCatalogRevision(req);
		const [[{ usedByMessages }]] = await pool.execute(
			"SELECT (SELECT COUNT(*) FROM messages WHERE sticker_id = ?) + (SELECT COUNT(*) FROM group_messages WHERE sticker_id = ?) AS usedByMessages",
			[stickerId, stickerId]
		);
		if (!usedByMessages) await removeStickerFile(sticker.imageUrl);
		return res.status(204).end();
	} catch (error) {
		console.error("Delete sticker error:", error);
		return res.status(500).json({ message: "Failed to remove sticker." });
	}
}
const canManageGroup = async (groupId, user, permission = "manageMembers") => {
	const group = await getGroupAccess(groupId, user.id);
	return canAccessGroup(group, user.role) && hasGroupPermission(group, permission, user.role);
};
const requireGroupAvatarAdmin = async (req, res, next) => {
	const groupId = Number(req.params.groupId);
	if (!validId(groupId)) return res.status(400).json({ message: "Invalid group id." });
	try {
		if (!await canManageGroup(groupId, req.user, "manageChannels")) {
			return res.status(403).json({ message: "Only group admins can change the group image." });
		}
		return next();
	} catch (error) {
		console.error("Check group image permissions error:", error);
		return res.status(500).json({ message: "Could not verify group image permissions." });
	}
};

router.post("/register", register);
router.post("/register/verify", verifySignup);
router.post("/register/resend", resendSignupOtp);
router.post("/password-reset/request", requestPasswordReset);
router.post("/password-reset/confirm", resetPassword);
router.post("/call-invitees", protect, async (req, res) => {
	const identifier = typeof req.body.identifier === "string" ? req.body.identifier.trim() : "";
	if (!identifier || identifier.length > 255) return res.status(400).json({ message: "Enter a username or email." });
	try {
		const [users] = await pool.execute(
			`SELECT id AS _id, username, email FROM users
			 WHERE status = 'active' AND id <> ?
			   AND (LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)) LIMIT 1`,
			[req.user.id, identifier, identifier]
		);
		if (!users.length) return res.status(404).json({ message: "No active user matches that username or email." });
		return res.json(users[0]);
	} catch (error) {
		console.error("Call invitee lookup error:", error);
		return res.status(500).json({ message: "Could not find that person." });
	}
});
router.post("/call-rooms/:roomId/sfu-token", protect, async (req, res) => {
	const roomId = String(req.params.roomId || "");
	const room = activeCallRooms.get(roomId);
	if (!canJoinSfuCallRoom(room, req.user.id)) {
		return res.status(403).json({ message: "You are not invited to this SFU call." });
	}
	if (room.groupId) {
		try {
			const group = await getGroupAccess(room.groupId, Number(req.user.id));
			if (!canAccessGroup(group, req.user.role)) {
				return res.status(403).json({ message: "You no longer have access to this group call." });
			}
			const channel = group.groupType === "community" ? await getActiveChannel(room.groupId, room.channelId) : null;
			if (!matchesCallRoomScope(room, group, channel)) {
				return res.status(403).json({ message: "You no longer have access to this call channel." });
			}
		} catch (error) {
			console.error("Group call access check failed:", error.message);
			return res.status(500).json({ message: "Could not verify access to this group call." });
		}
	}
	const apiKey = process.env.LIVEKIT_API_KEY;
	const apiSecret = process.env.LIVEKIT_API_SECRET;
	const livekitUrl = process.env.LIVEKIT_PUBLIC_URL;
	if (!apiKey || !apiSecret || !livekitUrl) {
		return res.status(503).json({ message: "Group calls need LiveKit configured on the server." });
	}
	try {
		const livekitRoomName = `chat-${roomId}`;
		const token = new AccessToken(apiKey, apiSecret, {
			identity: String(req.user.id),
			name: req.user.username,
			ttl: "1h",
		});
		token.addGrant({
			roomJoin: true,
			room: livekitRoomName,
			canPublish: true,
			canSubscribe: true,
		});
		room.acceptedParticipants.add(String(req.user.id));
		return res.json({ url: livekitUrl, token: await token.toJwt(), roomName: livekitRoomName });
	} catch (error) {
		console.error("LiveKit token creation failed:", error.message);
		return res.status(500).json({ message: "Could not prepare the group call connection." });
	}
});
router.get("/call-history", protect, async (req, res) => {
	try {
		const [calls] = await pool.execute(
			`SELECT c.id AS _id, c.call_type AS callType, c.status,
			        c.started_at AS startedAt, c.ended_at AS endedAt,
			        CASE WHEN c.caller_id = ? THEN 'outgoing' ELSE 'incoming' END AS direction,
			        CASE WHEN c.caller_id = ? THEN receiver.id ELSE caller.id END AS peerId,
			        CASE WHEN c.caller_id = ? THEN receiver.username ELSE caller.username END AS peerName
			 FROM call_history c
			 JOIN users caller ON caller.id = c.caller_id
			 JOIN users receiver ON receiver.id = c.receiver_id
			 WHERE c.caller_id = ? OR c.receiver_id = ?
			 ORDER BY c.started_at DESC, c.id DESC
			 LIMIT 100`,
			[req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]
		);
		res.json(calls);
	} catch (error) {
		console.error("Fetch call history error:", error);
		res.status(500).json({ message: "Could not load call history." });
	}
});
router.post("/call-history", protect, async (req, res) => {
	const receiverId = Number(req.body.receiverId);
	const callType = req.body.callType === "audio" ? "audio" : req.body.callType === "video" ? "video" : null;
	if (!validId(receiverId) || receiverId === Number(req.user.id) || !callType) {
		return res.status(400).json({ message: "Invalid call details." });
	}
	try {
		const [result] = await pool.execute(
			`INSERT INTO call_history (caller_id, receiver_id, call_type, status)
			 SELECT ?, id, ?, 'initiated' FROM users WHERE id = ? AND status = 'active'`,
			[req.user.id, callType, receiverId]
		);
		if (!result.affectedRows) return res.status(404).json({ message: "That recipient is not available." });
		res.status(201).json({ _id: result.insertId });
	} catch (error) {
		console.error("Create call history error:", error);
		res.status(500).json({ message: "Could not save call history." });
	}
});
router.patch("/call-history/:callId", protect, async (req, res) => {
	const callId = Number(req.params.callId);
	const status = ["completed", "missed", "declined"].includes(req.body.status) ? req.body.status : "completed";
	if (!validId(callId)) return res.status(400).json({ message: "Invalid call id." });
	try {
		const [result] = await pool.execute(
			"UPDATE call_history SET status = ?, ended_at = NOW() WHERE id = ? AND caller_id = ?",
			[status, callId, req.user.id]
		);
		if (!result.affectedRows) return res.status(404).json({ message: "Call record not found." });
		res.status(204).end();
	} catch (error) {
		console.error("Update call history error:", error);
		res.status(500).json({ message: "Could not update call history." });
	}
});
router.delete("/call-history/:callId", protect, async (req, res) => {
	const callId = Number(req.params.callId);
	if (!validId(callId)) return res.status(400).json({ message: "Invalid call id." });
	try {
		await pool.execute(
			"DELETE FROM call_history WHERE id = ? AND (caller_id = ? OR receiver_id = ?)",
			[callId, req.user.id, req.user.id]
		);
		res.status(204).end();
	} catch (error) {
		console.error("Delete call history error:", error);
		res.status(500).json({ message: "Could not delete call record." });
	}
});
router.delete("/call-history", protect, async (req, res) => {
	try {
		await pool.execute(
			"DELETE FROM call_history WHERE caller_id = ? OR receiver_id = ?",
			[req.user.id, req.user.id]
		);
		res.status(204).end();
	} catch (error) {
		console.error("Clear call history error:", error);
		res.status(500).json({ message: "Could not clear call history." });
	}
});

router.get("/meetings", protect, async (req, res) => {
	try {
		const [meetings] = await pool.execute(
			`SELECT meeting.id AS _id, meeting.title, meeting.description,
			        DATE_FORMAT(meeting.scheduled_at, '%Y-%m-%dT%H:%i:%s.000Z') AS scheduledAt,
			        meeting.status,
			        meeting.organizer_id AS organizerId, organizer.username AS organizerName,
			        participant.status AS invitationStatus,
			        (meeting.organizer_id = ?) AS isOrganizer
			 FROM scheduled_meetings meeting
			 JOIN users organizer ON organizer.id = meeting.organizer_id
			 LEFT JOIN meeting_participants participant
			   ON participant.meeting_id = meeting.id AND participant.user_id = ?
			 WHERE meeting.organizer_id = ? OR participant.user_id = ?
			 ORDER BY meeting.scheduled_at ASC LIMIT 100`,
			[req.user.id, req.user.id, req.user.id, req.user.id]
		);
		res.json(meetings);
	} catch (error) {
		console.error("List meetings error:", error);
		res.status(500).json({ message: "Could not load meetings." });
	}
});

router.post("/meetings", protect, async (req, res) => {
	const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
	const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
	const scheduledTime = typeof req.body.scheduledAt === "string" ? Date.parse(req.body.scheduledAt) : NaN;
	const invitees = Array.isArray(req.body.invitees) ? [...new Set(req.body.invitees.map((item) => String(item).trim()).filter(Boolean))] : [];
	if (!title || title.length > 120 || description.length > 1000 || !Number.isFinite(scheduledTime)
		|| scheduledTime <= Date.now()) {
		return res.status(400).json({ message: "Enter a title and a future date." });
	}
	const connection = await pool.getConnection();
	const scheduledAtUtc = new Date(scheduledTime).toISOString().slice(0, 19).replace("T", " ");
	try {
		await connection.beginTransaction();
		const [meetingResult] = await connection.execute(
			"INSERT INTO scheduled_meetings (organizer_id, title, description, scheduled_at) VALUES (?, ?, ?, ?)",
			[req.user.id, title, description, scheduledAtUtc]
		);
		const meetingId = Number(meetingResult.insertId);
		const inviteNotifications = [];
		for (const identifier of invitees) {
			const [users] = await connection.execute(
				`SELECT id AS userId, username FROM users WHERE status = 'active'
				 AND (LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)) LIMIT 1`,
				[identifier, identifier]
			);
			const invitee = users[0];
			if (!invitee || Number(invitee.userId) === Number(req.user.id)) continue;
			await connection.execute(
				"INSERT IGNORE INTO meeting_participants (meeting_id, user_id, status) VALUES (?, ?, 'invited')",
				[meetingId, invitee.userId]
			);
			const [existing] = await connection.execute(
				"SELECT status FROM meeting_participants WHERE meeting_id = ? AND user_id = ?",
				[meetingId, invitee.userId]
			);
			if (existing[0]?.status !== "invited") continue;
			const batchId = randomUUID();
			const [notification] = await connection.execute(
				`INSERT INTO notifications
				 (batch_id, user_id, sender_id, title, body, category, target_type, target_id, target_name)
				 VALUES (?, ?, ?, ?, ?, 'meeting_invite', 'meeting_invite', ?, ?)`,
				[batchId, invitee.userId, req.user.id, `Meeting invitation: ${title}`,
					`${req.user.username} invited you to a meeting on ${new Date(scheduledTime).toISOString()}.`, meetingId, title]
			);
			inviteNotifications.push({
				userId: Number(invitee.userId),
				notification: {
					_id: notification.insertId,
					userId: Number(invitee.userId),
					title: `Meeting invitation: ${title}`,
					body: `${req.user.username} invited you to a meeting on ${new Date(scheduledTime).toISOString()}.`,
					category: "meeting_invite",
					targetType: "meeting_invite",
					targetId: meetingId,
					targetName: title,
					invitationStatus: "invited",
					isRead: 0,
					senderName: req.user.username,
				},
			});
		}
		await connection.commit();
		for (const item of inviteNotifications) req.app.get("io")?.in(`user:${item.userId}`).emit("notification", item.notification);
		return res.status(201).json({ _id: meetingId, title, description, scheduledAt: new Date(scheduledTime).toISOString(), status: "scheduled", invitees: inviteNotifications.length });
	} catch (error) {
		await connection.rollback().catch(() => {});
		console.error("Create meeting error:", error);
		return res.status(500).json({ message: "Could not schedule the meeting." });
	} finally {
		connection.release();
	}
});

router.patch("/meetings/:meetingId/invitation", protect, async (req, res) => {
	const meetingId = Number(req.params.meetingId);
	const action = req.body.action;
	if (!validId(meetingId) || !["accept", "decline"].includes(action)) {
		return res.status(400).json({ message: "Choose accept or decline." });
	}
	try {
		const [result] = await pool.execute(
			`UPDATE meeting_participants SET status = ?, responded_at = NOW()
			 WHERE meeting_id = ? AND user_id = ? AND status = 'invited'`,
			[action === "accept" ? "accepted" : "declined", meetingId, req.user.id]
		);
		if (!result.affectedRows) return res.status(404).json({ message: "This meeting invitation is no longer available." });
		const [meetings] = await pool.execute(
			"SELECT title, DATE_FORMAT(scheduled_at, '%Y-%m-%dT%H:%i:%s.000Z') AS scheduledAt FROM scheduled_meetings WHERE id = ?",
			[meetingId]
		);
		await pool.execute(
			`UPDATE notifications SET title = ?, body = ?, is_read = TRUE
			 WHERE user_id = ? AND category = 'meeting_invite' AND target_id = ?`,
			[action === "accept" ? `You accepted ${meetings[0].title}` : `You declined ${meetings[0].title}`,
				action === "accept" ? "You are on the attendee list." : "You declined this meeting invitation.", req.user.id, meetingId]
		);
		return res.json({ meetingId, status: action === "accept" ? "accepted" : "declined" });
	} catch (error) {
		console.error("Respond to meeting invitation error:", error);
		return res.status(500).json({ message: "Could not respond to the meeting invitation." });
	}
});

router.delete("/meetings/:meetingId", protect, async (req, res) => {
	const meetingId = Number(req.params.meetingId);
	if (!validId(meetingId)) return res.status(400).json({ message: "Invalid meeting id." });
	try {
		const [result] = await pool.execute(
			"UPDATE scheduled_meetings SET status = 'cancelled' WHERE id = ? AND organizer_id = ? AND status = 'scheduled'",
			[meetingId, req.user.id]
		);
		if (!result.affectedRows) return res.status(404).json({ message: "Scheduled meeting not found." });
		const [participants] = await pool.execute("SELECT user_id AS userId FROM meeting_participants WHERE meeting_id = ?", [meetingId]);
		const [[meeting]] = await pool.execute("SELECT title FROM scheduled_meetings WHERE id = ?", [meetingId]);
		for (const participant of participants) {
			const [notification] = await pool.execute(
				`INSERT INTO notifications (batch_id, user_id, sender_id, title, body, category, target_type, target_id, target_name)
				 VALUES (?, ?, ?, ?, ?, 'meeting_cancelled', 'meeting', ?, ?)`,
				[randomUUID(), participant.userId, req.user.id, "Meeting cancelled", `${meeting.title} was cancelled.`, meetingId, meeting.title]
			);
			req.app.get("io")?.in(`user:${participant.userId}`).emit("notification", {
				_id: notification.insertId, userId: participant.userId, title: "Meeting cancelled",
				body: `${meeting.title} was cancelled.`, category: "meeting_cancelled", targetType: "meeting",
				targetId: meetingId, targetName: meeting.title, isRead: 0, senderName: req.user.username,
				timestamp: new Date().toISOString(),
			});
		}
		return res.status(204).end();
	} catch (error) {
		console.error("Cancel meeting error:", error);
		return res.status(500).json({ message: "Could not cancel the meeting." });
	}
});

router.post("/login", login);
router.get("/oauth/config", (_req, res) => {
	res.set("Cache-Control", "no-store");
	res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
});
router.get("/login-quotes", async (_req, res) => {
	try {
		const [quotes] = await pool.query(
			"SELECT id AS _id, quote FROM login_quotes ORDER BY id"
		);
		res.json(quotes);
	} catch (error) {
		console.error("Fetch login quotes error:", error);
		res.status(500).json({ message: "Could not load login quotes." });
	}
});
router.post("/oauth/google", googleLogin);
router.post("/logout", (_req, res) => {
	res.clearCookie("token", {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
	});
	res.status(204).end();
});
router.get("/auth/me", protect, (req, res) => res.json({
	user: {
		_id: req.user.id,
		username: req.user.username,
		email: req.user.email,
		role: req.user.role,
		status: req.user.status,
		profilePicture: req.user.profilePicture || null,
		googlePicture: req.user.googlePicture || null,
	},
}));
router.get("/notifications/preferences", protect, getNotificationPreferences);
router.patch("/notifications/preferences", protect, updateNotificationPreferences);
router.get(
	"/conversations/:type/:id/notification-preferences",
	protect,
	getConversationNotificationPreferences
);
router.patch(
	"/conversations/:type/:id/notification-preferences",
	protect,
	updateConversationNotificationPreferences
);
router.get("/notifications", protect, async (req, res) => {
	try {
		const [[{ unreadCount }]] = await pool.execute(
			`SELECT COUNT(*) AS unreadCount FROM notifications
			 WHERE user_id = ? AND is_read = FALSE
			   AND COALESCE(category, '') NOT IN ('direct_message', 'group_message')`,
			[req.user.id]
		);
		const [notifications] = await pool.execute(
			`SELECT n.id AS _id, n.title, n.body, n.is_read AS isRead,
			        n.category, n.target_type AS targetType, n.target_id AS targetId,
			        n.target_name AS targetName, n.target_channel_id AS targetChannelId,
				                n.target_channel_name AS targetChannelName, n.created_at AS timestamp,
				        COALESCE(group_invitation.status, meeting_participant.status) AS invitationStatus,
			        u.username AS senderName
			 FROM notifications n
			 LEFT JOIN users u ON u.id = n.sender_id
				 LEFT JOIN group_invitations group_invitation ON group_invitation.notification_id = n.id
				 LEFT JOIN meeting_participants meeting_participant
				   ON meeting_participant.meeting_id = n.target_id
				  AND meeting_participant.user_id = n.user_id
				  AND n.category = 'meeting_invite'
				 WHERE n.user_id = ?
				   AND COALESCE(n.category, '') NOT IN ('direct_message', 'group_message')
			 ORDER BY n.created_at DESC, n.id DESC
			 LIMIT 50`,
			[req.user.id]
		);
		res.json({ notifications, unreadCount });
	} catch (error) {
		console.error("Fetch notifications error:", error);
		res.status(500).json({ message: "Failed to get notifications." });
	}
});

router.patch("/notifications/:notificationId/meeting-invite", protect, async (req, res) => {
	const notificationId = Number(req.params.notificationId);
	const action = req.body.action;
	if (!validId(notificationId) || !["accept", "decline"].includes(action)) {
		return res.status(400).json({ message: "Choose accept or decline." });
	}
	try {
		const [rows] = await pool.execute(
			`SELECT meeting.id AS meetingId, meeting.title, meeting.organizer_id AS organizerId,
			        organizer.username AS organizerName, meeting.scheduled_at AS scheduledAt
			 FROM notifications notification
			 JOIN scheduled_meetings meeting ON meeting.id = notification.target_id
			 JOIN users organizer ON organizer.id = meeting.organizer_id
			 JOIN meeting_participants participant
			   ON participant.meeting_id = meeting.id AND participant.user_id = notification.user_id
			 WHERE notification.id = ? AND notification.user_id = ?
			   AND notification.category = 'meeting_invite' AND participant.status = 'invited'
			   AND meeting.status = 'scheduled' LIMIT 1`,
			[notificationId, req.user.id]
		);
		const invitation = rows[0];
		if (!invitation) return res.status(404).json({ message: "This meeting invitation is no longer available." });
		const invitationStatus = action === "accept" ? "accepted" : "declined";
		const title = action === "accept" ? `You accepted ${invitation.title}` : `You declined ${invitation.title}`;
		const body = action === "accept" ? "You are on the attendee list." : "You declined this meeting invitation.";
		await pool.execute(
			"UPDATE meeting_participants SET status = ?, responded_at = NOW() WHERE meeting_id = ? AND user_id = ? AND status = 'invited'",
			[invitationStatus, invitation.meetingId, req.user.id]
		);
		await pool.execute(
			"UPDATE notifications SET title = ?, body = ?, is_read = TRUE WHERE id = ? AND user_id = ?",
			[title, body, notificationId, req.user.id]
		);
		const responseTitle = action === "accept" ? "Meeting invitation accepted" : "Meeting invitation declined";
		const responseBody = `${req.user.username} ${action === "accept" ? "accepted" : "declined"} your invitation to ${invitation.title}.`;
		const [response] = await pool.execute(
			`INSERT INTO notifications (batch_id, user_id, sender_id, title, body, category, target_type, target_id, target_name)
			 VALUES (?, ?, ?, ?, ?, 'meeting_response', 'meeting', ?, ?)`,
			[randomUUID(), invitation.organizerId, req.user.id, responseTitle, responseBody, invitation.meetingId, invitation.title]
		);
		const io = req.app.get("io");
		io?.in(`user:${req.user.id}`).emit("notification", {
			_id: notificationId, userId: req.user.id, title, body, category: "meeting_invite",
			targetType: "meeting_invite", targetId: invitation.meetingId, targetName: invitation.title,
			invitationStatus, isRead: 1, senderName: invitation.organizerName, timestamp: new Date().toISOString(),
		});
		io?.in(`user:${invitation.organizerId}`).emit("notification", {
			_id: response.insertId, userId: invitation.organizerId, title: responseTitle, body: responseBody,
			category: "meeting_response", targetType: "meeting", targetId: invitation.meetingId,
			targetName: invitation.title, isRead: 0, senderName: req.user.username, timestamp: new Date().toISOString(),
		});
		return res.json({ meetingId: invitation.meetingId, status: invitationStatus });
	} catch (error) {
		console.error("Respond to meeting invitation error:", error);
		return res.status(500).json({ message: "Could not respond to the meeting invitation." });
	}
});
router.patch("/notifications/read-all", protect, async (req, res) => {
	try {
		await pool.execute(
			"UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE",
			[req.user.id]
		);
		res.status(204).end();
	} catch (error) {
		console.error("Mark notifications read error:", error);
		res.status(500).json({ message: "Could not mark notifications as read." });
	}
});
router.patch("/notifications/:notificationId/read", protect, async (req, res) => {
	const notificationId = Number(req.params.notificationId);
	if (!validId(notificationId)) return res.status(400).json({ message: "Invalid notification id." });
	try {
		const [result] = await pool.execute(
			"UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?",
			[notificationId, req.user.id]
		);
		if (!result.affectedRows) {
			const [rows] = await pool.execute(
				"SELECT id FROM notifications WHERE id = ? AND user_id = ?",
				[notificationId, req.user.id]
			);
			if (!rows.length) return res.status(404).json({ message: "Notification not found." });
		}
		res.status(204).end();
	} catch (error) {
		console.error("Mark notification read error:", error);
		res.status(500).json({ message: "Could not mark notification as read." });
	}
});
router.post("/admin/notifications", protect, requireAdmin, async (req, res) => {
	const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
	const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
	const audience = req.body.audience;
	const recipientIds = req.body.recipientIds;
	if (!title || title.length > 120 || !body || body.length > 2000
		|| !["all", "selected"].includes(audience)) {
		return res.status(400).json({
			message: "Provide a title (up to 120 characters), message (up to 2000 characters), and a valid audience.",
		});
	}
	if (audience === "selected"
		&& (!Array.isArray(recipientIds) || recipientIds.length < 1 || recipientIds.length > 500
			|| recipientIds.some((id) => !validId(id)))) {
		return res.status(400).json({ message: "Select between 1 and 500 valid recipients." });
	}
	try {
		const [recipients] = audience === "all"
			? await pool.execute("SELECT id FROM users WHERE status = 'active' ORDER BY id")
			: await pool.query(
				`SELECT id FROM users WHERE status = 'active' AND id IN (${recipientIds.map(() => "?").join(",")}) ORDER BY id`,
				[...new Set(recipientIds.map(Number))]
			);
		if (!recipients.length) {
			return res.status(400).json({ message: "There are no active recipients for this notification." });
		}
		if (audience === "selected" && recipients.length !== new Set(recipientIds.map(Number)).size) {
			return res.status(400).json({ message: "One or more selected recipients are unavailable." });
		}

		const batchId = randomUUID();
		const connection = await pool.getConnection();
		try {
			await connection.beginTransaction();
			for (let offset = 0; offset < recipients.length; offset += 500) {
				const batch = recipients.slice(offset, offset + 500);
				const valuePlaceholders = batch.map(() => "(?, ?, ?, ?, ?)").join(", ");
				const values = batch.flatMap(({ id }) => [batchId, id, req.user.id, title, body]);
				await connection.execute(
					`INSERT INTO notifications (batch_id, user_id, sender_id, title, body)
					 VALUES ${valuePlaceholders}`,
					values
				);
			}
			await connection.commit();
		} catch (error) {
			await connection.rollback();
			throw error;
		} finally {
			connection.release();
		}

		const io = req.app.get("io");
		if (io) {
			const [savedNotifications] = await pool.execute(
				`SELECT n.id AS _id, n.user_id AS userId, n.title, n.body,
				        n.is_read AS isRead, n.category,
				        n.target_type AS targetType, n.target_id AS targetId,
				        n.target_name AS targetName, n.target_channel_id AS targetChannelId,
				        n.target_channel_name AS targetChannelName, n.created_at AS timestamp,
				        u.username AS senderName
				 FROM notifications n JOIN users u ON u.id = n.sender_id
				 WHERE n.batch_id = ? ORDER BY n.id`,
				[batchId]
			);
			for (const notification of savedNotifications) {
				io.to(`user:${notification.userId}`).emit("notification", notification);
			}
		}
		res.status(201).json({ sent: recipients.length });
	} catch (error) {
		console.error("Send notification error:", error);
		res.status(500).json({ message: "Could not send the notification." });
	}
});
router.get("/admin/login-quotes", protect, requireAdmin, async (_req, res) => {
	try {
		const [quotes] = await pool.query(
			"SELECT id AS _id, quote FROM login_quotes ORDER BY id"
		);
		res.json(quotes);
	} catch (error) {
		console.error("Fetch admin login quotes error:", error);
		res.status(500).json({ message: "Could not load login quotes." });
	}
});
router.post("/admin/login-quotes", protect, requireAdmin, async (req, res) => {
	const quote = typeof req.body.quote === "string" ? req.body.quote.trim() : "";
	if (!quote || quote.length > 500) {
		return res.status(400).json({ message: "Quotes must be between 1 and 500 characters." });
	}
	try {
		const [result] = await pool.execute("INSERT INTO login_quotes (quote) VALUES (?)", [quote]);
		res.status(201).json({ _id: result.insertId, quote });
	} catch (error) {
		console.error("Create login quote error:", error);
		res.status(500).json({ message: "Could not add login quote." });
	}
});
router.patch("/admin/login-quotes/:quoteId", protect, requireAdmin, async (req, res) => {
	const quoteId = Number(req.params.quoteId);
	const quote = typeof req.body.quote === "string" ? req.body.quote.trim() : "";
	if (!validId(quoteId) || !quote || quote.length > 500) {
		return res.status(400).json({ message: "Provide a valid quote id and quote (up to 500 characters)." });
	}
	try {
		const [result] = await pool.execute("UPDATE login_quotes SET quote = ? WHERE id = ?", [quote, quoteId]);
		if (!result.affectedRows) {
			const [rows] = await pool.execute("SELECT id FROM login_quotes WHERE id = ?", [quoteId]);
			if (!rows.length) return res.status(404).json({ message: "Quote not found." });
		}
		res.json({ _id: quoteId, quote });
	} catch (error) {
		console.error("Update login quote error:", error);
		res.status(500).json({ message: "Could not update login quote." });
	}
});
router.delete("/admin/login-quotes/:quoteId", protect, requireAdmin, async (req, res) => {
	const quoteId = Number(req.params.quoteId);
	if (!validId(quoteId)) return res.status(400).json({ message: "Invalid quote id." });
	try {
		const [result] = await pool.execute("DELETE FROM login_quotes WHERE id = ?", [quoteId]);
		if (!result.affectedRows) return res.status(404).json({ message: "Quote not found." });
		res.status(204).end();
	} catch (error) {
		console.error("Delete login quote error:", error);
		res.status(500).json({ message: "Could not delete login quote." });
	}
});
router.post("/voice-uploads", protect, (req, res, next) => {
	voiceUpload.single("file")(req, res, async (error) => {
		if (error) {
			await removeUploadedFiles(req.file ? [req.file] : []);
			const message = error.code === "LIMIT_FILE_SIZE"
				? "Voice recordings exceed the configured size limit."
				: error.message;
			return res.status(400).json({ message });
		}
		return next();
	});
}, async (req, res) => {
	const groupId = req.body.type === "group" ? Number(req.body.targetId) : null;
	const receiverId = req.body.type === "direct" ? Number(req.body.targetId) : null;
	if (!req.file || !["direct", "group"].includes(req.body.type) || !validId(req.body.targetId)) {
		await removeUploadedFiles(req.file ? [req.file] : []);
		return res.status(400).json({ message: "Choose a conversation and record a voice message." });
	}
	try {
		if (groupId) {
			const target = await validateGroupMessageTarget(groupId, req.user, req.body.channelId);
			if (target.status) {
				await removeUploadedFiles([req.file]);
				return res.status(target.status).json({ message: target.message });
			}
		} else {
			const [recipients] = await pool.execute(
				"SELECT id FROM users WHERE id = ? AND status = 'active' LIMIT 1",
				[receiverId]
			);
			if (!recipients.length || receiverId === Number(req.user.id)) {
				await removeUploadedFiles([req.file]);
				return res.status(404).json({ message: "That recipient is not available." });
			}
		}
		const metadata = await parseFile(req.file.path, { duration: true });
		const durationSeconds = Number(metadata.format.duration);
		if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > maxVoiceDurationSeconds) {
			await removeUploadedFiles([req.file]);
			return res.status(400).json({ message: `Voice recordings must be ${maxVoiceDurationSeconds} seconds or shorter.` });
		}
		return res.status(201).json({
			url: `/api/voice-media/${path.basename(req.file.filename)}`,
			name: `Voice message (${Math.ceil(durationSeconds)}s)`,
			mimeType: req.file.mimetype,
			size: req.file.size,
			duration: Math.ceil(durationSeconds),
		});
	} catch (error) {
		await removeUploadedFiles([req.file]);
		console.error("Voice upload error:", error);
		return res.status(400).json({ message: "This recording could not be validated as supported audio." });
	}
});

router.get("/voice-media/:filename", protect, async (req, res) => {
	const filename = path.basename(req.params.filename || "");
	if (!/^\d+-voice-[a-f0-9-]{36}\.(webm|ogg|m4a|mp3|wav)$/i.test(filename)) {
		return res.status(404).json({ message: "Voice recording not found." });
	}
	const mediaUrl = `/api/voice-media/${filename}`;
	try {
		const [[directMessage]] = await pool.execute(
			`SELECT 1 FROM messages
			 WHERE is_deleted = FALSE AND JSON_SEARCH(attachments, 'one', ?) IS NOT NULL
			   AND (sender_id = ? OR receiver_id = ?)
			   AND NOT EXISTS (
				 SELECT 1 FROM direct_message_hidden_for hidden
				 WHERE hidden.message_id = messages.id AND hidden.user_id = ?
			   ) LIMIT 1`,
			[mediaUrl, req.user.id, req.user.id, req.user.id]
		);
		let authorized = Boolean(directMessage);
		if (!authorized) {
			const [[groupMessage]] = await pool.execute(
				`SELECT 1 FROM group_messages gm
				 LEFT JOIN group_members gmbr ON gmbr.group_id = gm.group_id AND gmbr.user_id = ?
				 WHERE gm.is_deleted = FALSE AND JSON_SEARCH(gm.attachments, 'one', ?) IS NOT NULL
				   AND (gmbr.user_id IS NOT NULL OR ? = 'admin')
				 LIMIT 1`,
				[req.user.id, mediaUrl, req.user.role]
			);
			authorized = Boolean(groupMessage);
		}
		if (!authorized) return res.status(404).json({ message: "Voice recording not found." });
		const filePath = path.join(voiceDirectory, filename);
		const mimeType = [...allowedVoiceTypes.entries()].find(([, extension]) => filename.endsWith(extension))?.[0];
		return res.sendFile(filePath, {
			headers: {
				"Cache-Control": "private, no-store",
				"X-Content-Type-Options": "nosniff",
				"Content-Type": mimeType || "application/octet-stream",
			},
		}, (error) => {
			if (error && !res.headersSent) res.status(error.statusCode || 404).end();
		});
	} catch (error) {
		console.error("Voice media authorization error:", error);
		return res.status(500).json({ message: "Could not load this voice recording." });
	}
});

router.post("/uploads", protect, (req, res, next) => {
	upload.array("files", 5)(req, res, async (error) => {
		if (error) {
			await removeUploadedFiles(req.files);
			const message = error.code === "LIMIT_FILE_SIZE"
				? "Each file must be 50 MB or smaller."
				: error.code === "LIMIT_FILE_COUNT"
					? "You can send up to 5 files per message."
					: error.message;
			return res.status(400).json({ message });
		}
		return next();
	});
}, async (req, res) => {
	const groupId = req.body.type === "group" ? Number(req.body.targetId) : null;
	const receiverId = req.body.type === "direct" ? Number(req.body.targetId) : null;
	const files = req.files || [];
	if (!files.length || !["direct", "group"].includes(req.body.type)
		|| !validId(req.body.targetId)) {
		await removeUploadedFiles(files);
		return res.status(400).json({ message: "Choose a conversation and at least one file." });
	}
	try {
		if (groupId) {
			const target = await validateGroupMessageTarget(groupId, req.user, req.body.channelId);
			if (target.status) {
				await removeUploadedFiles(files);
				return res.status(target.status).json({ message: target.message });
			}
		} else {
			const [recipients] = await pool.execute(
				"SELECT id FROM users WHERE id = ? AND status = 'active' LIMIT 1",
				[receiverId]
			);
			if (!recipients.length || receiverId === Number(req.user.id)) {
				await removeUploadedFiles(files);
				return res.status(404).json({ message: "That recipient is not available." });
			}
		}
		return res.status(201).json(files.map((file) => ({
			url: `/uploads/${file.filename}`,
			name: file.originalname.split(/[\\/]/).pop().slice(0, 255),
			mimeType: file.mimetype,
			size: file.size,
		})));
	} catch (error) {
		console.error("File upload error:", error);
		await removeUploadedFiles(files);
		return res.status(500).json({ message: "Files could not be uploaded." });
	}
});
router.patch("/users/me/profile", protect, updateOwnProfile);
router.post("/users/me/profile-picture", protect, receiveAvatar, async (req, res) =>
	updateUserAvatar(req, res, Number(req.user.id)));
router.get("/users", protect, user);
router.patch("/admin/users/:userId/profile", protect, requireAdmin, updateAdminProfile);
router.post("/admin/users/:userId/profile-picture", protect, requireAdmin, receiveAvatar, async (req, res) => {
	const userId = Number(req.params.userId);
	if (!validId(userId)) {
		await removeUploadedFiles(req.file ? [req.file] : []);
		return res.status(400).json({ message: "Invalid user id." });
	}
	return updateUserAvatar(req, res, userId);
});
router.get("/admin/users", protect, requireAdmin, async (req, res) => {
	try {
		const names = typeof req.query.names === "string"
			? [...new Set(req.query.names.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean))]
			: [];
		if (names.length > 100) {
			return res.status(400).json({ message: "Search for up to 100 usernames at a time." });
		}
		res.json(await User.listAdmin(names));
	} catch (err) {
		console.error("Fetch admin users error:", err);
		res.status(500).json({ message: "Failed to get users" });
	}
});
router.patch("/admin/users/:userId", protect, requireAdmin, async (req, res) => {
	const userId = Number(req.params.userId);
	const { role, status } = req.body;
	if (!validId(userId) || !["user", "moderator", "admin", "guest"].includes(role)
		|| !["active", "pending", "suspended"].includes(status)) {
		return res.status(400).json({ message: "Invalid user role or status." });
	}
	try {
		const [targets] = await pool.execute(
			"SELECT id, role, status FROM users WHERE id = ? LIMIT 1",
			[userId]
		);
		const target = targets[0];
		if (!target) return res.status(404).json({ message: "User not found." });
		if (userId === Number(req.user.id) && (role !== "admin" || status !== "active")) {
			return res.status(409).json({ message: "You cannot remove your own administrator access." });
		}
		if (target.role === "admin" && target.status === "active"
			&& (role !== "admin" || status !== "active")) {
			const [[{ admins }]] = await pool.execute(
				"SELECT COUNT(*) AS admins FROM users WHERE role = 'admin' AND status = 'active' AND id <> ?",
				[userId]
			);
			if (admins < 1) {
				return res.status(409).json({ message: "At least one active administrator must remain." });
			}
		}
		await pool.execute("UPDATE users SET role = ?, status = ? WHERE id = ?", [role, status, userId]);
		if (status !== "active" || role !== target.role) {
			const io = req.app.get("io");
			io?.in(`user:${userId}`).emit("account-status-updated", { status });
			io?.in(`user:${userId}`).disconnectSockets(true);
		}
		res.json({ _id: userId, role, status });
	} catch (err) {
		console.error("Update user error:", err);
		res.status(500).json({ message: "Failed to update user" });
	}
});
router.delete("/admin/users/:userId", protect, requireAdmin, async (req, res) => {
	const userId = Number(req.params.userId);
	if (!validId(userId)) return res.status(400).json({ message: "Invalid user id." });
	if (userId === Number(req.user.id)) {
		return res.status(409).json({ message: "You cannot delete your own administrator account." });
	}
	try {
		const [targets] = await pool.execute(
			"SELECT id, role, status FROM users WHERE id = ? LIMIT 1",
			[userId]
		);
		const target = targets[0];
		if (!target) return res.status(404).json({ message: "User not found." });
		if (target.role === "admin" && target.status === "active") {
			const [[{ admins }]] = await pool.execute(
				"SELECT COUNT(*) AS admins FROM users WHERE role = 'admin' AND status = 'active' AND id <> ?",
				[userId]
			);
			if (admins < 1) {
				return res.status(409).json({ message: "At least one active administrator must remain." });
			}
		}
		await pool.execute("DELETE FROM users WHERE id = ?", [userId]);
		req.app.get("io")?.in(`user:${userId}`).disconnectSockets(true);
		res.status(204).end();
	} catch (err) {
		console.error("Delete user error:", err);
		res.status(500).json({ message: "Failed to delete user" });
	}
});
router.get("/messages/:userId", protect, async (req, res) => {
	const otherId = Number(req.params.userId);
	if (!Number.isSafeInteger(otherId) || otherId < 1) {
		return res.status(400).json({ message: "Invalid user id" });
	}
	const beforeId = req.query.before === undefined ? null : String(req.query.before);
	if (beforeId !== null && !/^\d+$/.test(beforeId)) {
		return res.status(400).json({ message: "Invalid message cursor." });
	}
	const parsedLimit = Number(req.query.limit || 50);
	const limit = Number.isSafeInteger(parsedLimit) ? Math.min(50, Math.max(1, parsedLimit)) : 50;
	try {
		const [rows] = await pool.execute(
			`SELECT messages.id AS _id, messages.sender_id AS sender, messages.receiver_id AS receiver,
							CASE WHEN messages.is_deleted THEN 'This message was deleted' ELSE messages.content END AS content,
							CASE WHEN messages.is_deleted THEN NULL ELSE messages.attachments END AS attachments,
							messages.is_deleted AS isDeleted, messages.reply_to_id AS replyToId,
							messages.sticker_id AS stickerId, COALESCE(messages.sticker_url, stickers.image_url) AS stickerUrl,
							reply_user.username AS replySenderName,
							CASE WHEN reply_hidden.message_id IS NOT NULL THEN 'Message unavailable'
							     WHEN reply_message.is_deleted THEN 'This message was deleted' ELSE reply_message.content END AS replyContent,
							messages.created_at AS timestamp
			 FROM messages
			 LEFT JOIN messages reply_message ON reply_message.id = messages.reply_to_id
			 LEFT JOIN users reply_user ON reply_user.id = reply_message.sender_id
				 LEFT JOIN direct_message_hidden_for reply_hidden ON reply_hidden.message_id = reply_message.id AND reply_hidden.user_id = ?
			 LEFT JOIN stickers ON stickers.id = messages.sticker_id
			 WHERE ((messages.sender_id = ? AND messages.receiver_id = ?) OR (messages.sender_id = ? AND messages.receiver_id = ?))
				   AND NOT EXISTS (SELECT 1 FROM direct_message_hidden_for hidden WHERE hidden.message_id = messages.id AND hidden.user_id = ?)
			   AND (? IS NULL OR messages.id < ?)
			 ORDER BY messages.id DESC LIMIT ?`,
			[req.user.id, req.user.id, otherId, otherId, req.user.id, req.user.id, beforeId, beforeId, limit + 1]
		);
		const hasMore = rows.length > limit;
		const messages = await loadDirectMessageReactions(rows.slice(0, limit).reverse(), req.user.id, pool.execute.bind(pool));
		res.json({ messages, hasMore });
	} catch (err) {
		console.error("Fetch messages error:", err);
		res.status(500).json({ message: "Failed to get messages" });
	}
});
router.post("/messages/:userId/read", protect, async (req, res) => {
	const otherId = Number(req.params.userId);
	if (!validId(otherId) || otherId === Number(req.user.id)) {
		return res.status(400).json({ message: "Invalid conversation user." });
	}
	try {
		const [[latest]] = await pool.execute(
			`SELECT COALESCE(MAX(id), 0) AS lastReadMessageId
			 FROM messages
			 WHERE sender_id = ? AND receiver_id = ?`,
			[otherId, req.user.id]
		);
		await pool.execute(
			`INSERT INTO direct_message_reads (user_id, other_user_id, last_read_message_id)
			 VALUES (?, ?, ?)
			 ON DUPLICATE KEY UPDATE last_read_message_id = GREATEST(last_read_message_id, VALUES(last_read_message_id))`,
			[req.user.id, otherId, latest.lastReadMessageId]
		);
		res.status(204).end();
	} catch (error) {
		console.error("Mark direct messages read error:", error);
		res.status(500).json({ message: "Could not mark messages as read." });
	}
});
router.delete("/messages/:messageId", protect, async (req, res) => {
	const messageId = Number(req.params.messageId);
	if (!validId(messageId)) return res.status(400).json({ message: "Invalid message id." });
	try {
		const [found] = await pool.execute(
			"SELECT id, sender_id AS sender, receiver_id AS receiver, is_deleted AS isDeleted FROM messages WHERE id = ? LIMIT 1",
			[messageId]
		);
		const original = found[0];
		if (!original) return res.status(404).json({ message: "Message not found." });
		if (Number(original.sender) !== Number(req.user.id) && Number(original.receiver) !== Number(req.user.id)) {
			return res.status(403).json({ message: "You are not part of this conversation." });
		}
		if (Number(original.sender) !== Number(req.user.id) || original.isDeleted) {
			await pool.execute("INSERT IGNORE INTO direct_message_hidden_for (message_id, user_id) VALUES (?, ?)", [messageId, req.user.id]);
			const hidden = { _id: messageId, receiver: Number(original.receiver), hiddenForMe: true };
			req.app.get("io")?.to(`user:${req.user.id}`).emit("message-hidden-for-user", hidden);
			return res.json(hidden);
		}
		await pool.execute(
			`UPDATE messages SET is_deleted = TRUE, content = 'This message was deleted', attachments = NULL
			 WHERE id = ? AND is_deleted = FALSE`,
			[messageId]
		);
		const [rows] = await pool.execute(
			`SELECT id AS _id, sender_id AS sender, receiver_id AS receiver,
			        content, NULL AS attachments, is_deleted AS isDeleted, reply_to_id AS replyToId, created_at AS timestamp
			 FROM messages WHERE id = ?`,
			[messageId]
		);
		const message = rows[0];
		req.app.get("io")?.to(`user:${message.sender}`).to(`user:${message.receiver}`)
			.emit("message-updated", message);
		res.json(message);
	} catch (err) {
		console.error("Delete message error:", err);
		res.status(500).json({ message: "Failed to delete message" });
	}
});

router.get("/saved-messages", protect, async (req, res) => {
	try {
		const [directMessages] = await pool.execute(
			`SELECT saved.message_id AS _id, 'direct' AS messageType,
			        CASE WHEN message.sender_id = ? THEN message.receiver_id ELSE message.sender_id END AS conversationId,
			        conversation_user.username AS conversationName,
			        message.sender_id AS sender, sender.username AS senderName,
			        message.content, message.created_at AS timestamp, saved.saved_at AS savedAt
			 FROM user_saved_messages saved
			 JOIN messages message ON message.id = saved.message_id
			 JOIN users sender ON sender.id = message.sender_id
			 JOIN users conversation_user ON conversation_user.id = CASE
			   WHEN message.sender_id = ? THEN message.receiver_id ELSE message.sender_id END
			 WHERE saved.user_id = ? AND saved.message_type = 'direct'
			   AND message.is_deleted = FALSE
			   AND (message.sender_id = ? OR message.receiver_id = ?)
			   AND NOT EXISTS (SELECT 1 FROM direct_message_hidden_for hidden
			                   WHERE hidden.message_id = message.id AND hidden.user_id = ?)
			 ORDER BY saved.saved_at DESC LIMIT 100`,
			[req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]
		);
		const [groupMessages] = await pool.execute(
			`SELECT saved.message_id AS _id, 'group' AS messageType,
			        group_record.id AS groupId, group_record.name AS groupName,
			        group_record.group_type AS groupType, message.channel_id AS channelId,
			        channel.name AS channelName, message.sender_id AS sender, sender.username AS senderName,
			        message.content, message.created_at AS timestamp, saved.saved_at AS savedAt
			 FROM user_saved_messages saved
			 JOIN group_messages message ON message.id = saved.message_id
			 JOIN group_members membership ON membership.group_id = message.group_id AND membership.user_id = saved.user_id
			 JOIN chat_groups group_record ON group_record.id = message.group_id AND group_record.is_active = TRUE
			 JOIN users sender ON sender.id = message.sender_id
			 LEFT JOIN group_channels channel ON channel.id = message.channel_id
			 WHERE saved.user_id = ? AND saved.message_type = 'group' AND message.is_deleted = FALSE
			   AND NOT EXISTS (SELECT 1 FROM group_message_hidden_for hidden
			                   WHERE hidden.message_id = message.id AND hidden.user_id = saved.user_id)
			   AND (group_record.group_type <> 'community'
			        OR channel.id IS NOT NULL AND channel.is_archived = FALSE)
			 ORDER BY saved.saved_at DESC LIMIT 100`,
			[req.user.id]
		);
		const messages = [...directMessages, ...groupMessages]
			.sort((left, right) => new Date(right.savedAt) - new Date(left.savedAt))
			.slice(0, 100);
		return res.json({ messages });
	} catch (error) {
		console.error("List saved messages error:", error);
		return res.status(500).json({ message: "Could not load saved messages." });
	}
});

router.put("/saved-messages/:messageType/:messageId", protect, async (req, res) => {
	const { messageType } = req.params;
	const messageId = Number(req.params.messageId);
	if (!validId(messageId) || !["direct", "group"].includes(messageType)) {
		return res.status(400).json({ message: "Choose a valid message to save." });
	}
	try {
		if (messageType === "direct") {
			const [messages] = await pool.execute(
				`SELECT id FROM messages
				 WHERE id = ? AND is_deleted = FALSE AND (sender_id = ? OR receiver_id = ?)
				   AND NOT EXISTS (SELECT 1 FROM direct_message_hidden_for hidden
				                   WHERE hidden.message_id = messages.id AND hidden.user_id = ?)
				 LIMIT 1`,
				[messageId, req.user.id, req.user.id, req.user.id]
			);
			if (!messages.length) return res.status(404).json({ message: "Message not found." });
		} else {
			const [messages] = await pool.execute(
				`SELECT id, group_id AS groupId, channel_id AS channelId
				 FROM group_messages
				 WHERE id = ? AND is_deleted = FALSE
				   AND NOT EXISTS (SELECT 1 FROM group_message_hidden_for hidden
				                   WHERE hidden.message_id = group_messages.id AND hidden.user_id = ?)
				 LIMIT 1`,
				[messageId, req.user.id]
			);
			const message = messages[0];
			if (!message) return res.status(404).json({ message: "Message not found." });
			const group = await getGroupAccess(message.groupId, req.user.id);
			if (!canAccessGroup(group, req.user.role)) return res.status(404).json({ message: "Message not found." });
			if (group.groupType === "community") {
				if (!message.channelId || !await getActiveChannel(message.groupId, Number(message.channelId))) {
					return res.status(404).json({ message: "Message not found." });
				}
			} else if (message.channelId !== null) {
				return res.status(404).json({ message: "Message not found." });
			}
		}
		await pool.execute(
			"INSERT IGNORE INTO user_saved_messages (user_id, message_type, message_id) VALUES (?, ?, ?)",
			[req.user.id, messageType, messageId]
		);
		return res.status(204).end();
	} catch (error) {
		console.error("Save message error:", error);
		return res.status(500).json({ message: "Could not save this message." });
	}
});

router.delete("/saved-messages/:messageType/:messageId", protect, async (req, res) => {
	const { messageType } = req.params;
	const messageId = Number(req.params.messageId);
	if (!validId(messageId) || !["direct", "group"].includes(messageType)) {
		return res.status(400).json({ message: "Choose a valid saved message." });
	}
	try {
		await pool.execute(
			"DELETE FROM user_saved_messages WHERE user_id = ? AND message_type = ? AND message_id = ?",
			[req.user.id, messageType, messageId]
		);
		return res.status(204).end();
	} catch (error) {
		console.error("Remove saved message error:", error);
		return res.status(500).json({ message: "Could not remove this saved message." });
	}
});

router.get("/search", protect, searchMessages);
router.get("/groups/:groupId/reputation", protect, getCommunityReputation);
router.get("/groups/:groupId/tasks", protect, listCommunityTasks);
router.post("/groups/:groupId/tasks", protect, createCommunityTask);
router.patch("/groups/:groupId/tasks/:taskId", protect, updateCommunityTask);
router.delete("/groups/:groupId/tasks/:taskId", protect, deleteCommunityTask);
router.get("/groups/:groupId/whiteboard", protect, listWhiteboardItems);
router.post("/groups/:groupId/whiteboard", protect, createWhiteboardItem);
router.patch("/groups/:groupId/whiteboard/:itemId", protect, updateWhiteboardItem);
router.delete("/groups/:groupId/whiteboard/:itemId", protect, deleteWhiteboardItem);
router.get("/groups/:groupId/channels/:channelId/collab-sessions", protect, listCommunitySessions);
router.post("/groups/:groupId/channels/:channelId/collab-sessions", protect, createCommunitySession);
router.get("/collab-sessions/:sessionId", protect, getCommunitySession);
router.patch("/collab-sessions/:sessionId", protect, updateCommunitySession);
router.post("/collab-sessions/:sessionId/close", protect, closeCommunitySession);
router.get("/collab-sessions/:sessionId/whiteboard", protect, listSessionWhiteboardItems);
router.post("/collab-sessions/:sessionId/whiteboard", protect, createSessionWhiteboardItem);
router.patch("/collab-sessions/:sessionId/whiteboard/:itemId", protect, updateSessionWhiteboardItem);
router.delete("/collab-sessions/:sessionId/whiteboard/:itemId", protect, deleteSessionWhiteboardItem);
router.get("/scheduled-messages", protect, listScheduledMessages);
router.post("/scheduled-messages", protect, createScheduledMessage);
router.put("/scheduled-messages/:messageId", protect, updateScheduledMessage);
router.delete("/scheduled-messages/:messageId", protect, cancelScheduledMessage);

router.get("/groups", protect, async (req, res) => {
	try {
		const [groups] = await pool.execute(
			`SELECT g.id AS _id, g.name, g.avatar_url AS avatarUrl,
			        g.group_type AS groupType, g.is_active AS isActive,
			        mine.role, mine_role.permissions AS rolePermissions, COUNT(m.user_id) AS members
			 FROM chat_groups g
			 JOIN group_members mine ON mine.group_id = g.id AND mine.user_id = ?
			 LEFT JOIN group_roles mine_role ON mine_role.group_id = g.id AND mine_role.role_key = mine.role
			 JOIN group_members m ON m.group_id = g.id
			 WHERE g.is_active = TRUE
			 GROUP BY g.id, g.name, g.avatar_url, g.group_type, g.is_active, mine.role
			 ORDER BY g.name`,
			[req.user.id]
		);
		res.json(groups);
	} catch (err) {
		console.error("Fetch groups error:", err);
		res.status(500).json({ message: "Failed to get groups" });
	}
});

router.get("/admin/groups", protect, requireAdmin, async (_req, res) => {
	try {
		const [groups] = await pool.execute(
			`SELECT g.id AS _id, g.name, g.avatar_url AS avatarUrl,
			        g.group_type AS groupType, g.is_active AS isActive,
			        'admin' AS role, COUNT(m.user_id) AS members
			 FROM chat_groups g LEFT JOIN group_members m ON m.group_id = g.id
			 GROUP BY g.id, g.name, g.avatar_url, g.group_type, g.is_active
			 ORDER BY g.is_active DESC, g.name`
		);
		res.json(groups);
	} catch (error) {
		console.error("Fetch admin groups error:", error);
		res.status(500).json({ message: "Failed to get groups" });
	}
});
router.post("/groups", protect, async (req, res) => {
	const name = req.body.name?.trim();
	const groupType = req.body.groupType || "standard";
	if (!name || name.length > 100) {
		return res.status(400).json({ message: "Group name must be between 1 and 100 characters." });
	}
	if (!isGroupType(groupType)) {
		return res.status(400).json({ message: "Group type must be standard or community." });
	}
	const connection = await pool.getConnection();
	try {
		await connection.beginTransaction();
		const [result] = await connection.execute(
				"INSERT INTO chat_groups (name, created_by, group_type, is_active) VALUES (?, ?, ?, TRUE)",
			[name, req.user.id, groupType]
		);
		await connection.execute(
			"INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')",
			[result.insertId, req.user.id]
		);
		await ensureBuiltInGroupRoles(connection, result.insertId);
		if (groupType === "community") {
			await ensureDefaultCommunityChannels(connection, result.insertId, req.user.id);
		}
		await connection.commit();
		res.status(201).json({ _id: result.insertId, name, groupType, isActive: 1, avatarUrl: null, members: 1, role: "admin" });
	} catch (err) {
		await connection.rollback();
		console.error("Create group error:", err);
		res.status(500).json({ message: "Failed to create group" });
	} finally {
		connection.release();
	}
});

router.patch("/groups/:groupId", protect, async (req, res) => {
	const groupId = Number(req.params.groupId);
	const groupType = req.body.groupType;
	const name = typeof req.body.name === "string" ? req.body.name.trim() : undefined;
	const isActive = req.body.isActive;
	if (!validId(groupId) || name !== undefined && (!name || name.length > 100)
		|| groupType !== undefined && !isGroupType(groupType)
		|| isActive !== undefined && ![true, false, 0, 1].includes(isActive)) {
		return res.status(400).json({ message: "Invalid group update." });
	}
	try {
		if (!await canManageGroup(groupId, req.user, "manageChannels")) {
			return res.status(403).json({ message: "Only group admins can edit this group." });
		}
		const [groups] = await pool.execute(
			"SELECT id AS _id, name, avatar_url AS avatarUrl, group_type AS groupType, is_active AS isActive FROM chat_groups WHERE id = ? LIMIT 1",
			[groupId]
		);
		if (!groups.length) return res.status(404).json({ message: "Group not found." });
		if (isActive !== undefined && req.user.role !== "admin") {
			return res.status(403).json({ message: "Only a platform administrator can change group activation." });
		}
		const nextType = groupType ?? groups[0].groupType;
		const nextName = name ?? groups[0].name;
		const nextActive = isActive === undefined ? Boolean(groups[0].isActive) : Boolean(isActive);
		const wasInactive = Number(groups[0].isActive) === 0;
		await pool.execute(
			"UPDATE chat_groups SET name = ?, group_type = ?, is_active = ? WHERE id = ?",
			[nextName, nextType, nextActive, groupId]
		);
		if (nextType === "community") {
			await ensureDefaultCommunityChannels(pool, groupId, req.user.id);
		}
		const updated = { ...groups[0], name: nextName, groupType: nextType, isActive: nextActive ? 1 : 0 };
		const io = req.app.get("io");
		io?.to(`group:${groupId}`).emit("group-updated", updated);
		const [members] = await pool.execute("SELECT user_id AS userId FROM group_members WHERE group_id = ?", [groupId]);
		for (const member of members) {
			io?.in(`user:${member.userId}`).emit(wasInactive && nextActive ? "group-reactivated" : "group-updated", updated);
		}
		return res.json(updated);
	} catch (error) {
		console.error("Update group error:", error);
		return res.status(500).json({ message: "Could not update the group." });
	}
});

router.delete("/groups/:groupId", protect, async (req, res) => {
	const groupId = Number(req.params.groupId);
	if (!validId(groupId)) return res.status(400).json({ message: "Invalid group id." });
	try {
		if (!await canManageGroup(groupId, req.user, "manageChannels")) {
			return res.status(403).json({ message: "Only group leaders can deactivate this group." });
		}
		const [groups] = await pool.execute("SELECT id AS _id, name FROM chat_groups WHERE id = ? LIMIT 1", [groupId]);
		if (!groups.length) return res.status(404).json({ message: "Group not found." });
		await pool.execute("UPDATE chat_groups SET is_active = FALSE WHERE id = ?", [groupId]);
		const [members] = await pool.execute("SELECT user_id AS userId FROM group_members WHERE group_id = ?", [groupId]);
		const io = req.app.get("io");
		io?.to(`group:${groupId}`).emit("group-deactivated", { groupId });
		for (const member of members) io?.in(`user:${member.userId}`).emit("group-deactivated", { groupId });
		io?.in(`group:${groupId}`).socketsLeave(`group:${groupId}`);
		io?.in(`code-room:${groupId}`).socketsLeave(`code-room:${groupId}`);
		const [channels] = await pool.execute("SELECT id FROM group_channels WHERE group_id = ?", [groupId]);
		for (const channel of channels) io?.in(`group:${groupId}:channel:${channel.id}`).socketsLeave(`group:${groupId}:channel:${channel.id}`);
		const [sessions] = await pool.execute("SELECT id FROM community_collab_sessions WHERE group_id = ?", [groupId]);
		for (const session of sessions) {
			io?.to(`collab-session:${session.id}`).emit("collab-session-error", { sessionId: session.id, message: "This community is no longer active." });
			io?.in(`collab-session:${session.id}`).socketsLeave(`collab-session:${session.id}`);
		}
		return res.status(204).end();
	} catch (error) {
		console.error("Deactivate group error:", error);
		return res.status(500).json({ message: "Could not deactivate the group." });
	}
});

router.get("/groups/:groupId/channels", protect, listChannels);
router.post("/groups/:groupId/channels", protect, createChannel);
router.patch("/groups/:groupId/channels/:channelId", protect, updateChannel);
router.delete("/groups/:groupId/channels/:channelId", protect, archiveChannel);
router.get("/groups/:groupId/channels/:channelId/role-permissions", protect, listChannelRolePermissions);
router.put("/groups/:groupId/channels/:channelId/role-permissions", protect, updateChannelRolePermission);
router.get("/groups/:groupId/roles", protect, listGroupRoles);
router.post("/groups/:groupId/roles", protect, createGroupRole);
router.patch("/groups/:groupId/roles/:roleKey", protect, updateGroupRole);
router.delete("/groups/:groupId/roles/:roleKey", protect, deleteGroupRole);

router.get("/groups/:groupId/members", protect, async (req, res) => {
	const groupId = Number(req.params.groupId);
	if (!validId(groupId)) return res.status(400).json({ message: "Invalid group id" });
	try {
		if (req.user.role !== "admin" && !await getGroupRole(groupId, req.user.id)) {
			return res.status(403).json({ message: "You are not a member of this group." });
		}
		const [members] = await pool.execute(
			`SELECT u.id AS _id, u.username, u.email,
			        u.profile_picture AS profilePicture, u.google_picture AS googlePicture, gm.role,
			        COALESCE(group_role.name, gm.role) AS roleName
			 FROM group_members gm JOIN users u ON u.id = gm.user_id
			 LEFT JOIN group_roles group_role ON group_role.group_id = gm.group_id AND group_role.role_key = gm.role
			 WHERE gm.group_id = ? ORDER BY gm.role, u.username`,
			[groupId]
		);
		res.json(members);
	} catch (err) {
		console.error("Fetch group members error:", err);
		res.status(500).json({ message: "Failed to get group members" });
	}
});

router.post("/groups/:groupId/avatar", protect, requireGroupAvatarAdmin, receiveAvatar, async (req, res) => {
	const groupId = Number(req.params.groupId);
	if (!validId(groupId)) {
		await removeUploadedFiles(req.file ? [req.file] : []);
		return res.status(400).json({ message: "Invalid group id." });
	}
	if (!req.file) return res.status(400).json({ message: "Choose a group image to upload." });
	try {
		if (!await canManageGroup(groupId, req.user)) {
			await removeUploadedFiles([req.file]);
			return res.status(403).json({ message: "Only group admins can change the group image." });
		}
		const [groups] = await pool.execute(
			"SELECT avatar_url AS avatarUrl FROM chat_groups WHERE id = ? LIMIT 1",
			[groupId]
		);
		if (!groups.length) {
			await removeUploadedFiles([req.file]);
			return res.status(404).json({ message: "Group not found." });
		}
		const avatarUrl = `/uploads/${req.file.filename}`;
		await pool.execute("UPDATE chat_groups SET avatar_url = ? WHERE id = ?", [avatarUrl, groupId]);
		await removeStoredAvatar(groups[0].avatarUrl);
		req.app.get("io")?.emit("group-picture-updated", { groupId, avatarUrl });
		return res.json({ groupId, avatarUrl });
	} catch (error) {
		await removeUploadedFiles([req.file]);
		console.error("Update group image error:", error);
		return res.status(500).json({ message: "Could not update the group image." });
	}
});

router.post("/groups/:groupId/invitations", protect, async (req, res) => {
	const groupId = Number(req.params.groupId);
	const identifier = typeof req.body.identifier === "string" ? req.body.identifier.trim() : "";
	if (!validId(groupId) || !identifier || identifier.length > 255) {
		return res.status(400).json({ message: "Enter a username or email address." });
	}
	try {
		if (!await canManageGroup(groupId, req.user)) {
			return res.status(403).json({ message: "Only group leaders can invite members." });
		}
		const [groups] = await pool.execute(
			"SELECT id AS groupId, name, avatar_url AS avatarUrl, is_active AS isActive FROM chat_groups WHERE id = ? LIMIT 1",
			[groupId]
		);
		if (!groups.length) return res.status(404).json({ message: "Group not found." });
		if (!groups[0].isActive && req.user.role !== "admin") {
			return res.status(409).json({ message: "Inactive groups cannot receive invitations." });
		}
		const [users] = await pool.execute(
			`SELECT id AS userId, username, email FROM users
			 WHERE status = 'active' AND (LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)) LIMIT 1`,
			[identifier, identifier]
		);
		const invitee = users[0];
		if (!invitee) return res.status(404).json({ message: "No active user matches that username or email." });
		const [members] = await pool.execute(
			"SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1",
			[groupId, invitee.userId]
		);
		if (members.length) return res.status(409).json({ message: "That user is already a group member." });
		const [pending] = await pool.execute(
			"SELECT id FROM group_invitations WHERE group_id = ? AND invitee_id = ? AND status = 'pending' LIMIT 1",
			[groupId, invitee.userId]
		);
		if (pending.length) return res.status(409).json({ message: "An invitation is already waiting for that user." });

		const connection = await pool.getConnection();
		try {
			await connection.beginTransaction();
			const [invitation] = await connection.execute(
				"INSERT INTO group_invitations (group_id, invitee_id, invited_by) VALUES (?, ?, ?)",
				[groupId, invitee.userId, req.user.id]
			);
			const batchId = randomUUID();
			const [notification] = await connection.execute(
				`INSERT INTO notifications
				 (batch_id, user_id, sender_id, title, body, category, target_type, target_id, target_name)
				 VALUES (?, ?, ?, ?, ?, 'group_invite', 'group_invite', ?, ?)`,
				[batchId, invitee.userId, req.user.id, `Invitation to join ${groups[0].name}`,
					`${req.user.username || "A group leader"} invited you to join this group.`, groupId, groups[0].name]
			);
			await connection.execute(
				"UPDATE group_invitations SET notification_id = ? WHERE id = ?",
				[notification.insertId, invitation.insertId]
			);
			await connection.commit();
			const payload = {
				_id: notification.insertId,
				userId: invitee.userId,
				title: `Invitation to join ${groups[0].name}`,
				body: `${req.user.username || "A group leader"} invited you to join this group.`,
				category: "group_invite",
				targetType: "group_invite",
				targetId: groupId,
				targetName: groups[0].name,
				isRead: 0,
				invitationStatus: "pending",
				senderName: req.user.username || "A group leader",
			};
			req.app.get("io")?.in(`user:${invitee.userId}`).emit("notification", payload);
			return res.status(201).json({ invitationId: invitation.insertId, invitee: { username: invitee.username, email: invitee.email } });
		} catch (error) {
			await connection.rollback();
			throw error;
		} finally {
			connection.release();
		}
	} catch (error) {
		console.error("Create group invitation error:", error);
		return res.status(500).json({ message: "Could not send the group invitation." });
	}
});

router.patch("/notifications/:notificationId/group-invite", protect, async (req, res) => {
	const notificationId = Number(req.params.notificationId);
	const action = req.body.action;
	if (!validId(notificationId) || !["accept", "reject"].includes(action)) {
		return res.status(400).json({ message: "Choose accept or reject." });
	}
	const connection = await pool.getConnection();
	let committed = false;
	try {
		await connection.beginTransaction();
		const [rows] = await connection.execute(
			 `SELECT invitation.id, invitation.group_id AS groupId, invitation.invitee_id AS inviteeId,
			        invitation.invited_by AS invitedBy, inviter.username AS inviterName,
			        group_record.name, group_record.avatar_url AS avatarUrl, group_record.group_type AS groupType,
			        group_record.is_active AS isActive
			 FROM group_invitations invitation
			 JOIN notifications notification ON notification.id = invitation.notification_id
			 JOIN chat_groups group_record ON group_record.id = invitation.group_id
			 JOIN users inviter ON inviter.id = invitation.invited_by
			 WHERE invitation.notification_id = ? AND notification.user_id = ?
			   AND invitation.status = 'pending' LIMIT 1`,
			[notificationId, req.user.id]
		);
		const invitation = rows[0];
		if (!invitation) {
			await connection.rollback();
			return res.status(404).json({ message: "This invitation is no longer available." });
		}
		if (action === "accept" && !invitation.isActive) {
			await connection.rollback();
			return res.status(409).json({ message: "This group is no longer active." });
		}
		const status = action === "accept" ? "accepted" : "rejected";
		await connection.execute(
			"UPDATE group_invitations SET status = ?, pending_slot = NULL, responded_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
			[status, invitation.id]
		);
		const inviteTitle = action === "accept"
			? `You are now a member of ${invitation.name}`
			: `You rejected the invitation to ${invitation.name}`;
		const inviteBody = action === "accept"
			? `You accepted ${invitation.inviterName}'s invitation.`
			: `You rejected ${invitation.inviterName}'s invitation.`;
		await connection.execute(
			"UPDATE notifications SET title = ?, body = ?, is_read = TRUE WHERE id = ? AND user_id = ?",
			[inviteTitle, inviteBody, notificationId, req.user.id]
		);
		const responseTitle = action === "accept" ? "Group invitation accepted" : "Group invitation rejected";
		const responseBody = `${req.user.username} ${action === "accept" ? "accepted" : "rejected"} your invitation to ${invitation.name}.`;
		const responseBatchId = randomUUID();
		const [responseNotification] = await connection.execute(
			`INSERT INTO notifications
			 (batch_id, user_id, sender_id, title, body, category, target_type, target_id, target_name)
			 VALUES (?, ?, ?, ?, ?, 'group_invite_response', 'group', ?, ?)`,
			[responseBatchId, invitation.invitedBy, req.user.id, responseTitle, responseBody, invitation.groupId, invitation.name]
		);
		if (action === "accept") {
			await connection.execute(
				"INSERT IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')",
				[invitation.groupId, req.user.id]
			);
		}
		await connection.commit();
		committed = true;
		const notificationUpdate = {
			_id: notificationId,
			userId: req.user.id,
			title: inviteTitle,
			body: inviteBody,
			category: "group_invite",
			targetType: "group_invite",
			targetId: invitation.groupId,
			targetName: invitation.name,
			isRead: 1,
			invitationStatus: status,
			senderName: invitation.inviterName,
			timestamp: new Date().toISOString(),
		};
		const responseNotificationPayload = {
			_id: responseNotification.insertId,
			userId: invitation.invitedBy,
			title: responseTitle,
			body: responseBody,
			category: "group_invite_response",
			targetType: "group",
			targetId: invitation.groupId,
			targetName: invitation.name,
			isRead: 0,
			senderName: req.user.username,
			timestamp: new Date().toISOString(),
		};
		const io = req.app.get("io");
		io?.in(`user:${req.user.id}`).emit("notification", notificationUpdate);
		io?.in(`user:${invitation.invitedBy}`).emit("notification", responseNotificationPayload);
		if (action === "accept") {
			const [[{ members }]] = await pool.execute("SELECT COUNT(*) AS members FROM group_members WHERE group_id = ?", [invitation.groupId]);
			const member = { _id: req.user.id, username: req.user.username, email: req.user.email, role: "member" };
			const event = { groupId: invitation.groupId, member, groupName: invitation.name, avatarUrl: invitation.avatarUrl, groupType: invitation.groupType, members };
			io?.to(`group:${invitation.groupId}`).emit("group-member-added", event);
			io?.in(`user:${req.user.id}`).emit("group-member-added", event);
		}
		return res.json({ notificationId, status, group: action === "accept" ? { _id: invitation.groupId, name: invitation.name, avatarUrl: invitation.avatarUrl, groupType: invitation.groupType, members: 1, role: "member" } : null });
	} catch (error) {
		if (!committed) await connection.rollback();
		console.error("Respond to group invitation error:", error);
		return res.status(500).json({ message: "Could not respond to the group invitation." });
	} finally {
		connection.release();
	}
});

router.post("/groups/:groupId/members", protect, async (req, res) => {
	const groupId = Number(req.params.groupId);
	const userId = Number(req.body.userId);
	if (!validId(groupId) || !validId(userId)) {
		return res.status(400).json({ message: "Invalid group or user id" });
	}
	try {
		if (!await canManageGroup(groupId, req.user)) {
			return res.status(403).json({ message: "Only group admins can add members." });
		}
		const [result] = await pool.execute(
			"INSERT IGNORE INTO group_members (group_id, user_id, role) SELECT ?, id, 'member' FROM users WHERE id = ? AND status = 'active'",
			[groupId, userId]
		);
		if (!result.affectedRows) {
			const [existing] = await pool.execute("SELECT id, status FROM users WHERE id = ?", [userId]);
			return res.status(existing.length ? 409 : 404).json({
				message: !existing.length
					? "User not found."
					: existing[0].status !== "active"
						? "Only active users can be added to a group."
						: "That person is already in this group.",
			});
		}
		const [rows] = await pool.execute(
			`SELECT id AS _id, username, email, profile_picture AS profilePicture,
			        google_picture AS googlePicture, 'member' AS role FROM users WHERE id = ?`,
			[userId]
		);
		const [groupRows] = await pool.execute(
			`SELECT name, avatar_url AS avatarUrl,
			        (SELECT COUNT(*) FROM group_members WHERE group_id = ?) AS members
			 FROM chat_groups WHERE id = ?`,
			[groupId, groupId]
		);
		const io = req.app.get("io");
		const event = {
			groupId,
			member: rows[0],
			groupName: groupRows[0].name,
			avatarUrl: groupRows[0].avatarUrl,
			members: groupRows[0].members,
		};
		io?.to(`group:${groupId}`).emit("group-member-added", event);
		io?.in(`user:${userId}`).emit("group-member-added", event);
		res.status(201).json(rows[0]);
	} catch (err) {
		console.error("Add group member error:", err);
		res.status(500).json({ message: "Failed to add member" });
	}
});

router.patch("/groups/:groupId/members/:userId", protect, async (req, res) => {
	const groupId = Number(req.params.groupId);
	const userId = Number(req.params.userId);
	const role = typeof req.body?.role === "string" ? req.body.role.trim() : "";
	if (!validId(groupId) || !validId(userId) || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(role)) {
		return res.status(400).json({ message: "Invalid group member role update." });
	}
	try {
		if (!await canManageGroup(groupId, req.user)) {
			return res.status(403).json({ message: "You do not have permission to edit group roles." });
		}
		const [roleDefinitions] = await pool.execute(
			"SELECT name FROM group_roles WHERE group_id = ? AND role_key = ? LIMIT 1",
			[groupId, role]
		);
		if (!roleDefinitions.length) return res.status(400).json({ message: "Choose a role defined for this group." });
		if (role === "admin" && !await canManageGroup(groupId, req.user, "manageRoles")) {
			return res.status(403).json({ message: "Only a group role manager can assign Admin." });
		}
		const [target] = await pool.execute(
			"SELECT role FROM group_members WHERE group_id = ? AND user_id = ?",
			[groupId, userId]
		);
		if (!target.length) return res.status(404).json({ message: "Group member not found." });
		if (target[0].role === "admin" && role !== "admin") {
			const [[{ admins }]] = await pool.execute(
				"SELECT COUNT(*) AS admins FROM group_members WHERE group_id = ? AND role = 'admin'",
				[groupId]
			);
			if (admins <= 1) return res.status(409).json({ message: "A group must keep at least one admin." });
		}
		await pool.execute("UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?", [role, groupId, userId]);
		const io = req.app.get("io");
		const roleName = roleDefinitions[0].name;
		io?.in(`user:${userId}`).emit("group-role-updated", { groupId, userId, role, roleName });
		io?.to(`group:${groupId}`).emit("group-role-updated", { groupId, userId, role, roleName });
		res.json({ userId, role, roleName });
	} catch (err) {
		console.error("Update group role error:", err);
		res.status(500).json({ message: "Failed to update member role" });
	}
});

router.delete("/groups/:groupId/members/:userId", protect, async (req, res) => {
	const groupId = Number(req.params.groupId);
	const userId = Number(req.params.userId);
	if (!validId(groupId) || !validId(userId)) {
		return res.status(400).json({ message: "Invalid group or user id" });
	}
	try {
		if (!await canManageGroup(groupId, req.user)) {
			return res.status(403).json({ message: "Only group admins can remove members." });
		}
		const [target] = await pool.execute(
			"SELECT role FROM group_members WHERE group_id = ? AND user_id = ?",
			[groupId, userId]
		);
		if (!target.length) return res.status(404).json({ message: "Group member not found." });
		if (target[0].role === "admin") {
			const [[{ admins }]] = await pool.execute(
				"SELECT COUNT(*) AS admins FROM group_members WHERE group_id = ? AND role = 'admin'",
				[groupId]
			);
			if (admins <= 1) return res.status(409).json({ message: "Promote another admin before removing this one." });
		}
		await pool.execute("DELETE FROM group_members WHERE group_id = ? AND user_id = ?", [groupId, userId]);
		const io = req.app.get("io");
		if (io) {
			const [channels] = await pool.execute(
				"SELECT id FROM group_channels WHERE group_id = ?",
				[groupId]
			);
			io.in(`user:${userId}`).emit("group-member-removed", { groupId });
			io.in(`user:${userId}`).socketsLeave(`group:${groupId}`);
			io.in(`user:${userId}`).socketsLeave(`code-room:${groupId}`);
			for (const channel of channels) {
				io.in(`user:${userId}`).socketsLeave(`group:${groupId}:channel:${channel.id}`);
			}
			const [sessions] = await pool.execute("SELECT id FROM community_collab_sessions WHERE group_id = ?", [groupId]);
			for (const session of sessions) {
				io.to(`collab-session:${session.id}`).emit("collab-session-participant-left", { sessionId: session.id, userId });
				io.in(`user:${userId}`).socketsLeave(`collab-session:${session.id}`);
			}
			io.to(`group:${groupId}`).emit("group-member-changed", { groupId, userId });
		}
		res.status(204).end();
	} catch (err) {
		console.error("Remove group member error:", err);
		res.status(500).json({ message: "Failed to remove member" });
	}
});

router.get("/groups/:groupId/messages", protect, async (req, res) => {
	const groupId = Number(req.params.groupId);
	if (!validId(groupId)) return res.status(400).json({ message: "Invalid group id" });
	let channelId = null;
	if (req.query.channelId !== undefined) {
		if (!validId(req.query.channelId)) return res.status(400).json({ message: "Invalid channel id." });
		channelId = Number(req.query.channelId);
	}
	const beforeId = req.query.before === undefined ? null : String(req.query.before);
	if (beforeId !== null && !/^\d+$/.test(beforeId)) {
		return res.status(400).json({ message: "Invalid message cursor." });
	}
	const parsedLimit = Number(req.query.limit || 50);
	const limit = Number.isSafeInteger(parsedLimit) ? Math.min(50, Math.max(1, parsedLimit)) : 50;
	try {
		const group = await getGroupAccess(groupId, req.user.id);
		if (!group) return res.status(404).json({ message: "Group not found." });
		if (!canAccessGroup(group, req.user.role)) {
			return res.status(403).json({ message: "You are not a member of this group." });
		}
		if (group.groupType === "community") {
			if (!channelId) return res.status(400).json({ message: "Choose a community channel." });
			const channel = await getActiveChannel(groupId, channelId);
			if (!channel) return res.status(404).json({ message: "Channel not found." });
		} else if (channelId !== null) {
			return res.status(400).json({ message: "Standard groups do not have channels." });
		}
		const [rows] = await pool.execute(
			`SELECT gm.id AS _id, gm.group_id AS groupId, gm.sender_id AS sender, gm.bot_id AS botId,
					gm.channel_id AS channelId,
					COALESCE(integration.name, bot.name, u.username) AS senderName,
					CASE WHEN gm.is_deleted THEN 'This message was deleted' ELSE gm.content END AS content,
					CASE WHEN gm.is_deleted THEN NULL ELSE gm.attachments END AS attachments,
					gm.is_deleted AS isDeleted, gm.reply_to_id AS replyToId,
					gm.message_type AS messageType, gm.structured_data AS structuredData,
					gm.accepted_answer_id AS acceptedAnswerId,
					gm.sticker_id AS stickerId, COALESCE(gm.sticker_url, stickers.image_url) AS stickerUrl,
					reply_user.username AS replySenderName,
					CASE WHEN reply_hidden.message_id IS NOT NULL THEN 'Message unavailable'
					     WHEN reply_message.is_deleted THEN 'This message was deleted' ELSE reply_message.content END AS replyContent,
					gm.created_at AS timestamp
			 FROM group_messages gm JOIN users u ON u.id = gm.sender_id
			 LEFT JOIN community_bots bot ON bot.id = gm.bot_id
			 LEFT JOIN community_integrations integration ON integration.id = gm.integration_id
			 LEFT JOIN group_messages reply_message ON reply_message.id = gm.reply_to_id
			 LEFT JOIN users reply_user ON reply_user.id = reply_message.sender_id
				 LEFT JOIN group_message_hidden_for reply_hidden ON reply_hidden.message_id = reply_message.id AND reply_hidden.user_id = ?
			 LEFT JOIN stickers ON stickers.id = gm.sticker_id
				 WHERE gm.group_id = ? AND gm.channel_id <=> ?
				   AND NOT EXISTS (SELECT 1 FROM group_message_hidden_for hidden WHERE hidden.message_id = gm.id AND hidden.user_id = ?)
				   AND (? IS NULL OR gm.id < ?)
			 ORDER BY gm.id DESC LIMIT ?`,
			[req.user.id, groupId, channelId, req.user.id, beforeId, beforeId, limit + 1]
		);
		const hasMore = rows.length > limit;
		const messages = await loadCommunityEngagement(rows.slice(0, limit).reverse(), req.user.id, pool.execute.bind(pool));
		res.json({ messages, hasMore });
	} catch (err) {
		console.error("Fetch group messages error:", err);
		res.status(500).json({ message: "Failed to get group messages" });
	}
});

const authorizeScheduledAnnouncementChannel = async (groupId, channelId, user) => {
	const group = await getGroupAccess(groupId, user.id);
	if (!group) return { status: 404, message: "Community not found." };
	if (!canAccessGroup(group, user.role)) return { status: 403, message: "You are not a member of this community." };
	if (group.groupType !== "community") return { status: 400, message: "Scheduled announcements are only available in communities." };
	const channel = await getActiveChannel(groupId, channelId);
	if (!channel || channel.slug !== "announcements") return { status: 404, message: "Announcements channel not found." };
	return { group, channel };
};

router.get("/groups/:groupId/channels/:channelId/scheduled-posts", protect, async (req, res) => {
	const groupId = Number(req.params.groupId);
	const channelId = Number(req.params.channelId);
	if (!validId(groupId) || !validId(channelId)) return res.status(400).json({ message: "Invalid community channel." });
	try {
		const authorized = await authorizeScheduledAnnouncementChannel(groupId, channelId, req.user);
		if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
		const [posts] = await pool.execute(
			`SELECT id, content, recurrence,
			        DATE_FORMAT(scheduled_at, '%Y-%m-%dT%H:%i:%s.000Z') AS scheduledAt
			 FROM scheduled_community_posts
			 WHERE group_id = ? AND channel_id = ? AND status = 'scheduled'
			 ORDER BY scheduled_at, id LIMIT 100`,
			[groupId, channelId]
		);
		return res.json({ posts });
	} catch (error) {
		console.error("List scheduled community posts error:", error);
		return res.status(500).json({ message: "Could not load scheduled announcements." });
	}
});

router.post("/groups/:groupId/channels/:channelId/scheduled-posts", protect, async (req, res) => {
	const groupId = Number(req.params.groupId);
	const channelId = Number(req.params.channelId);
	const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
	const recurrence = req.body?.recurrence || "once";
	const scheduledTime = Date.parse(req.body?.scheduledAt);
	if (!validId(groupId) || !validId(channelId) || !content || content.length > 10000
		|| !["once", "daily", "weekly"].includes(recurrence)
		|| !Number.isFinite(scheduledTime) || scheduledTime <= Date.now()
		|| scheduledTime > Date.now() + 366 * 24 * 60 * 60 * 1000) {
		return res.status(400).json({ message: "Provide announcement text, a future time within one year, and a valid recurrence." });
	}
	try {
		const authorized = await authorizeScheduledAnnouncementChannel(groupId, channelId, req.user);
		if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
		if (!await canPostInChannel(authorized.group, authorized.channel, req.user.role)) {
			return res.status(403).json({ message: "You do not have permission to schedule announcements." });
		}
		const scheduledAt = new Date(scheduledTime).toISOString().slice(0, 19).replace("T", " ");
		const [result] = await pool.execute(
			`INSERT INTO scheduled_community_posts
			 (group_id, channel_id, sender_id, content, recurrence, scheduled_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			[groupId, channelId, req.user.id, content, recurrence, scheduledAt]
		);
		return res.status(201).json({
			post: { id: result.insertId, content, recurrence, scheduledAt: new Date(scheduledTime).toISOString() },
		});
	} catch (error) {
		console.error("Schedule community post error:", error);
		return res.status(500).json({ message: "Could not schedule this announcement." });
	}
});

router.delete("/groups/:groupId/channels/:channelId/scheduled-posts/:postId", protect, async (req, res) => {
	const groupId = Number(req.params.groupId);
	const channelId = Number(req.params.channelId);
	const postId = Number(req.params.postId);
	if (!validId(groupId) || !validId(channelId) || !validId(postId)) {
		return res.status(400).json({ message: "Invalid scheduled announcement." });
	}
	try {
		const authorized = await authorizeScheduledAnnouncementChannel(groupId, channelId, req.user);
		if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
		const canManage = hasGroupPermission(authorized.group, "manageChannels", req.user.role);
		const [result] = await pool.execute(
			`UPDATE scheduled_community_posts SET status = 'cancelled'
			 WHERE id = ? AND group_id = ? AND channel_id = ? AND status = 'scheduled'
			   AND (sender_id = ? OR ? = TRUE)`,
			[postId, groupId, channelId, req.user.id, canManage]
		);
		if (!result.affectedRows) return res.status(404).json({ message: "Scheduled announcement not found or no longer cancellable." });
		return res.status(204).end();
	} catch (error) {
		console.error("Cancel scheduled community post error:", error);
		return res.status(500).json({ message: "Could not cancel this announcement." });
	}
});

const authorizeCommunityMessageAction = async (groupId, messageId, user) => {
	const group = await getGroupAccess(groupId, user.id);
	if (!group) return { status: 404, message: "Community not found." };
	if (!canAccessGroup(group, user.role)) return { status: 403, message: "You are not a member of this community." };
	if (group.groupType !== "community") return { status: 400, message: "This action is only available in communities." };
	const [rows] = await pool.execute(
		`SELECT id AS _id, group_id AS groupId, channel_id AS channelId,
		        sender_id AS sender, message_type AS messageType, structured_data AS structuredData,
		        reply_to_id AS replyToId, accepted_answer_id AS acceptedAnswerId,
		        is_deleted AS isDeleted
		 FROM group_messages WHERE id = ? AND group_id = ? LIMIT 1`,
		[messageId, groupId]
	);
	const message = rows[0];
	if (!message || !message.channelId || !await getActiveChannel(groupId, Number(message.channelId))) {
		return { status: 404, message: "Community post not found." };
	}
	return { message };
};

const authorizeGroupMessageReaction = async (groupId, messageId, user) => {
	const group = await getGroupAccess(groupId, user.id);
	if (!group) return { status: 404, message: "Group not found." };
	if (!canAccessGroup(group, user.role)) return { status: 403, message: "You are not a member of this group." };
	const [rows] = await pool.execute(
		`SELECT id AS _id, group_id AS groupId, channel_id AS channelId,
		        sender_id AS sender, message_type AS messageType, structured_data AS structuredData,
		        reply_to_id AS replyToId, is_deleted AS isDeleted
		 FROM group_messages
		 WHERE id = ? AND group_id = ? AND is_deleted = FALSE
		   AND NOT EXISTS (SELECT 1 FROM group_message_hidden_for hidden WHERE hidden.message_id = group_messages.id AND hidden.user_id = ?)
		 LIMIT 1`,
		[messageId, groupId, user.id]
	);
	const message = rows[0];
	if (!message) return { status: 404, message: "Message not found." };
	if (group.groupType === "community") {
		if (!message.channelId || !await getActiveChannel(groupId, Number(message.channelId))) {
			return { status: 404, message: "Message not found." };
		}
	} else if (message.channelId !== null) {
		return { status: 404, message: "Message not found." };
	}
	return { message, group };
};

router.post("/groups/:groupId/messages/:messageId/reactions", protect, async (req, res) => {
	const groupId = Number(req.params.groupId);
	const messageId = Number(req.params.messageId);
	const emoji = req.body?.emoji;
	if (!validId(groupId) || !validId(messageId) || !isSupportedReaction(emoji)) {
		return res.status(400).json({ message: "Choose a supported reaction." });
	}
	try {
		const authorized = await authorizeGroupMessageReaction(groupId, messageId, req.user);
		if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
		const { message, group } = authorized;
		const reacted = await toggleReactionState(pool, messageId, req.user.id, emoji, "group_message_reactions");
		if (group.groupType === "community" && emoji === "👍") {
			const [[{ helpfulCount }]] = await pool.execute(
				`SELECT COUNT(*) AS helpfulCount FROM group_message_reactions
				 WHERE message_id = ? AND emoji = '👍' AND is_active = TRUE AND user_id <> ?`,
				[messageId, message.sender]
			);
			await recordReputationEvent(pool.execute.bind(pool), groupId, message.sender, "helpful_reaction", messageId, Number(helpfulCount) > 0 ? 1 : 0);
		}
		const [updated] = await loadCommunityEngagement([message], req.user.id, pool.execute.bind(pool));
		const io = req.app.get("io");
		const room = message.channelId
			? `group:${groupId}:channel:${message.channelId}`
			: `group:${groupId}`;
		io?.to(room).emit("group-message-engagement", {
			_id: messageId,
			groupId,
			channelId: message.channelId,
			reactions: updated.reactions,
		});
		if (reacted && Number(message.sender) !== Number(req.user.id)) {
			const [[reactor]] = await pool.execute("SELECT username FROM users WHERE id = ? LIMIT 1", [req.user.id]);
			await notifyMessageReaction(io, {
				recipientId: message.sender,
				reactorId: req.user.id,
				reactorName: reactor?.username || "A community member",
				messageId,
				emoji,
				targetType: "group",
				targetId: groupId,
				targetName: group.name,
				channelId: message.channelId,
				channelName: message.channelId ? (await getActiveChannel(groupId, message.channelId))?.name : null,
			}).catch((error) => console.error("Group reaction notification error:", error.message));
		}
		return res.json({ reactions: updated.reactions });
	} catch (error) {
		console.error("Group message reaction error:", error);
		return res.status(500).json({ message: "Could not update this reaction." });
	}
});

router.post("/messages/:messageId/reactions", protect, async (req, res) => {
	const messageId = Number(req.params.messageId);
	const emoji = req.body?.emoji;
	if (!validId(messageId) || !isSupportedReaction(emoji)) {
		return res.status(400).json({ message: "Choose a supported reaction." });
	}
	try {
		const [rows] = await pool.execute(
			`SELECT message.id AS _id, message.sender_id AS sender, message.receiver_id AS receiver,
			        message.is_deleted AS isDeleted
			 FROM messages message
			 WHERE message.id = ? AND message.is_deleted = FALSE
			   AND (message.sender_id = ? OR message.receiver_id = ?)
			   AND NOT EXISTS (SELECT 1 FROM direct_message_hidden_for hidden
			                   WHERE hidden.message_id = message.id AND hidden.user_id = ?)
			 LIMIT 1`,
			[messageId, req.user.id, req.user.id, req.user.id]
		);
		const message = rows[0];
		if (!message) return res.status(404).json({ message: "Message not found." });
		const reacted = await toggleReactionState(pool, messageId, req.user.id, emoji, "direct_message_reactions");
		const [updated] = await loadDirectMessageReactions([message], req.user.id, pool.execute.bind(pool));
		const io = req.app.get("io");
		io?.to(`user:${message.sender}`).to(`user:${message.receiver}`).emit("direct-message-engagement", {
			_id: messageId,
			sender: message.sender,
			receiver: message.receiver,
			reactions: updated.reactions,
		});
		if (reacted && Number(message.sender) !== Number(req.user.id)) {
			const [[reactor]] = await pool.execute("SELECT username FROM users WHERE id = ? LIMIT 1", [req.user.id]);
			await notifyMessageReaction(io, {
				recipientId: message.sender,
				reactorId: req.user.id,
				reactorName: reactor?.username || "Someone",
				messageId,
				emoji,
				targetType: "direct",
				targetId: req.user.id,
				targetName: reactor?.username || "Conversation",
			}).catch((error) => console.error("Direct reaction notification error:", error.message));
		}
		return res.json({ reactions: updated.reactions });
	} catch (error) {
		console.error("Direct message reaction error:", error);
		return res.status(500).json({ message: "Could not update this reaction." });
	}
});

router.post("/groups/:groupId/messages/:messageId/poll-votes", protect, async (req, res) => {
	const groupId = Number(req.params.groupId);
	const messageId = Number(req.params.messageId);
	const optionIndexes = req.body?.optionIndexes;
	if (!validId(groupId) || !validId(messageId) || !Array.isArray(optionIndexes)
		|| optionIndexes.length < 1 || optionIndexes.length > 8
		|| optionIndexes.some((index) => !Number.isSafeInteger(index) || index < 0)
		|| new Set(optionIndexes).size !== optionIndexes.length) {
		return res.status(400).json({ message: "Choose one or more valid poll options." });
	}
	try {
		const authorized = await authorizeCommunityMessageAction(groupId, messageId, req.user);
		if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
		const { message } = authorized;
		const data = parseStructuredData(message.structuredData);
		if (message.messageType !== "poll" || message.isDeleted || !data?.options
			|| optionIndexes.some((index) => index >= data.options.length)
			|| (!data.multipleChoice && optionIndexes.length !== 1)) {
			return res.status(400).json({ message: "These poll options are not valid." });
		}
		if (data.endsAt && Date.parse(data.endsAt) <= Date.now()) {
			return res.status(409).json({ message: "This poll has closed." });
		}
		const connection = await pool.getConnection();
		try {
			await connection.beginTransaction();
			await connection.execute("DELETE FROM community_poll_votes WHERE message_id = ? AND user_id = ?", [messageId, req.user.id]);
			for (const optionIndex of optionIndexes) {
				await connection.execute(
					"INSERT INTO community_poll_votes (message_id, user_id, option_index) VALUES (?, ?, ?)",
					[messageId, req.user.id, optionIndex]
				);
			}
			await connection.commit();
		} catch (error) {
			await connection.rollback();
			throw error;
		} finally {
			connection.release();
		}
		const [post] = await loadCommunityEngagement([{ ...message, structuredData: data }], req.user.id, pool.execute.bind(pool));
		const io = req.app.get("io");
		io?.to(`group:${groupId}:channel:${message.channelId}`).emit("group-message-engagement", {
			_id: messageId, groupId, channelId: message.channelId, pollResults: post.pollResults,
		});
		return res.json({ pollResults: post.pollResults });
	} catch (error) {
		console.error("Community poll vote error:", error);
		return res.status(500).json({ message: "Could not save your vote." });
	}
});

router.put("/groups/:groupId/messages/:messageId/event-rsvp", protect, async (req, res) => {
	const groupId = Number(req.params.groupId);
	const messageId = Number(req.params.messageId);
	const response = req.body?.response;
	if (!validId(groupId) || !validId(messageId) || !["going", "maybe", "not_going"].includes(response)) {
		return res.status(400).json({ message: "Choose a valid event response." });
	}
	try {
		const authorized = await authorizeCommunityMessageAction(groupId, messageId, req.user);
		if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
		const { message } = authorized;
		if (message.messageType !== "event" || message.isDeleted) return res.status(400).json({ message: "This post is not an active event." });
		await pool.execute(
			`INSERT INTO community_event_rsvps (message_id, user_id, response) VALUES (?, ?, ?)
			 ON DUPLICATE KEY UPDATE response = VALUES(response)`,
			[messageId, req.user.id, response]
		);
		const [post] = await loadCommunityEngagement([{ ...message, structuredData: parseStructuredData(message.structuredData) }], req.user.id, pool.execute.bind(pool));
		const io = req.app.get("io");
		io?.to(`group:${groupId}:channel:${message.channelId}`).emit("group-message-engagement", {
			_id: messageId, groupId, channelId: message.channelId, eventResults: post.eventResults,
		});
		return res.json({ eventResults: post.eventResults });
	} catch (error) {
		console.error("Community event RSVP error:", error);
		return res.status(500).json({ message: "Could not update your event response." });
	}
});

router.patch("/groups/:groupId/messages/:messageId/accepted-answer", protect, async (req, res) => {
	const groupId = Number(req.params.groupId);
	const messageId = Number(req.params.messageId);
	const answerId = req.body?.answerId === null ? null : Number(req.body?.answerId);
	if (!validId(groupId) || !validId(messageId) || answerId !== null && !validId(answerId)) {
		return res.status(400).json({ message: "Invalid question or answer." });
	}
	try {
		const authorized = await authorizeCommunityMessageAction(groupId, messageId, req.user);
		if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
		const { message } = authorized;
		const group = await getGroupAccess(groupId, req.user.id);
		if (message.messageType !== "question" || message.isDeleted) return res.status(400).json({ message: "This post is not an active question." });
		if (Number(message.sender) !== Number(req.user.id) && group.groupRole !== "admin" && req.user.role !== "admin") {
			return res.status(403).json({ message: "Only the question author or a community leader can accept an answer." });
		}
		if (answerId !== null) {
			const [answers] = await pool.execute(
				`SELECT id FROM group_messages WHERE id = ? AND group_id = ? AND channel_id = ?
				 AND reply_to_id = ? AND is_deleted = FALSE LIMIT 1`,
				[answerId, groupId, message.channelId, messageId]
			);
			if (!answers.length) return res.status(400).json({ message: "Choose an answer from this question's thread." });
		}
		const previousAnswerId = message.acceptedAnswerId === null ? null : Number(message.acceptedAnswerId);
		const connection = await pool.getConnection();
		try {
			await connection.beginTransaction();
			await connection.execute("UPDATE group_messages SET accepted_answer_id = ? WHERE id = ?", [answerId, messageId]);
			if (previousAnswerId !== null && previousAnswerId !== answerId) {
				const [previousAwards] = await connection.execute(
					`SELECT user_id AS userId FROM community_reputation_events
					 WHERE group_id = ? AND event_type = 'accepted_answer' AND source_id = ? AND points > 0`,
					[groupId, previousAnswerId]
				);
				for (const award of previousAwards) {
					await recordReputationEvent(connection.execute.bind(connection), groupId, award.userId, "accepted_answer", previousAnswerId, 0);
				}
			}
			if (answerId !== null && answerId !== previousAnswerId) {
				const [[answer]] = await connection.execute(
					"SELECT sender_id AS senderId FROM group_messages WHERE id = ? AND group_id = ?",
					[answerId, groupId]
				);
				if (answer) await recordReputationEvent(connection.execute.bind(connection), groupId, answer.senderId, "accepted_answer", answerId, 15);
			}
			await connection.commit();
		} catch (error) {
			await connection.rollback();
			throw error;
		} finally {
			connection.release();
		}
		const update = { _id: messageId, groupId, channelId: message.channelId, acceptedAnswerId: answerId };
		req.app.get("io")?.to(`group:${groupId}:channel:${message.channelId}`).emit("group-message-updated", update);
		return res.json({ acceptedAnswerId: answerId });
	} catch (error) {
		console.error("Accept community answer error:", error);
		return res.status(500).json({ message: "Could not update the accepted answer." });
	}
});

router.delete("/groups/:groupId/messages/:messageId", protect, async (req, res) => {
	const groupId = Number(req.params.groupId);
	const messageId = Number(req.params.messageId);
	if (!validId(groupId) || !validId(messageId)) {
		return res.status(400).json({ message: "Invalid group or message id." });
	}
	try {
		const [messages] = await pool.execute(
			"SELECT sender_id AS sender, is_deleted AS isDeleted FROM group_messages WHERE id = ? AND group_id = ?",
			[messageId, groupId]
		);
		const message = messages[0];
		if (!message) return res.status(404).json({ message: "Message not found." });
		const isMember = req.user.role === "admin" || Boolean(await getGroupRole(groupId, req.user.id));
		if (Number(message.sender) !== Number(req.user.id) || message.isDeleted) {
			if (!isMember) return res.status(403).json({ message: "You are not a member of this group." });
			await pool.execute("INSERT IGNORE INTO group_message_hidden_for (message_id, user_id) VALUES (?, ?)", [messageId, req.user.id]);
			const hidden = { _id: messageId, groupId, hiddenForMe: true };
			req.app.get("io")?.to(`user:${req.user.id}`).emit("message-hidden-for-user", hidden);
			return res.json(hidden);
		}
		await pool.execute(
			"UPDATE group_messages SET is_deleted = TRUE, content = 'This message was deleted', attachments = NULL WHERE id = ? AND is_deleted = FALSE",
			[messageId]
		);
		const [rows] = await pool.execute(
			`SELECT gm.id AS _id, gm.group_id AS groupId, gm.channel_id AS channelId,
			        gm.sender_id AS sender,
			        u.username AS senderName, gm.content, NULL AS attachments, gm.is_deleted AS isDeleted,
			        gm.created_at AS timestamp
			 FROM group_messages gm JOIN users u ON u.id = gm.sender_id WHERE gm.id = ?`,
			[messageId]
		);
		const messageRoom = rows[0].channelId
			? `group:${groupId}:channel:${rows[0].channelId}`
			: `group:${groupId}`;
		req.app.get("io")?.to(messageRoom).emit("group-message-updated", rows[0]);
		res.json(rows[0]);
	} catch (err) {
		console.error("Delete group message error:", err);
		res.status(500).json({ message: "Failed to delete message" });
	}
});

module.exports = router;
