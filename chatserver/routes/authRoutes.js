const express = require("express");
const router = express.Router();

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
const { upload, avatarUpload, uploadDirectory, stickerUpload } = require("../utils/uploads");
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
const canManageGroup = async (groupId, user) =>
	user.role === "admin" || await getGroupRole(groupId, user.id) === "admin";
const requireGroupAvatarAdmin = async (req, res, next) => {
	const groupId = Number(req.params.groupId);
	if (!validId(groupId)) return res.status(400).json({ message: "Invalid group id." });
	try {
		if (!await canManageGroup(groupId, req.user)) {
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
router.get("/notifications", protect, async (req, res) => {
	try {
		const [[{ unreadCount }]] = await pool.execute(
			"SELECT COUNT(*) AS unreadCount FROM notifications WHERE user_id = ? AND is_read = FALSE",
			[req.user.id]
		);
		const [notifications] = await pool.execute(
			`SELECT n.id AS _id, n.title, n.body, n.is_read AS isRead,
			        n.created_at AS timestamp, u.username AS senderName
			 FROM notifications n
			 LEFT JOIN users u ON u.id = n.sender_id
			 WHERE n.user_id = ?
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
				        n.is_read AS isRead, n.created_at AS timestamp,
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
			const [memberships] = await pool.execute(
				"SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1",
				[groupId, req.user.id]
			);
			if (!memberships.length && req.user.role !== "admin") {
				await removeUploadedFiles(files);
				return res.status(403).json({ message: "You are not a member of this group." });
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
							CASE WHEN reply_message.is_deleted THEN 'This message was deleted' ELSE reply_message.content END AS replyContent,
							messages.created_at AS timestamp
			 FROM messages
			 LEFT JOIN messages reply_message ON reply_message.id = messages.reply_to_id
			 LEFT JOIN users reply_user ON reply_user.id = reply_message.sender_id
			 LEFT JOIN stickers ON stickers.id = messages.sticker_id
			 WHERE ((messages.sender_id = ? AND messages.receiver_id = ?) OR (messages.sender_id = ? AND messages.receiver_id = ?))
			   AND (? IS NULL OR messages.id < ?)
			 ORDER BY messages.id DESC LIMIT ?`,
			[req.user.id, otherId, otherId, req.user.id, beforeId, beforeId, limit + 1]
		);
		const hasMore = rows.length > limit;
		const messages = rows.slice(0, limit).reverse();
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
		const [result] = await pool.execute(
			`UPDATE messages SET is_deleted = TRUE, content = 'This message was deleted', attachments = NULL
			 WHERE id = ? AND sender_id = ? AND is_deleted = FALSE`,
			[messageId, req.user.id]
		);
		if (!result.affectedRows) {
			const [messages] = await pool.execute("SELECT id FROM messages WHERE id = ?", [messageId]);
			return res.status(messages.length ? 403 : 404).json({
				message: messages.length ? "You can only delete your own messages." : "Message not found.",
			});
		}
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
router.get("/groups", protect, async (req, res) => {
	try {
		const [groups] = req.user.role === "admin"
			? await pool.execute(
				`SELECT g.id AS _id, g.name, g.avatar_url AS avatarUrl,
				        'admin' AS role, COUNT(m.user_id) AS members
				 FROM chat_groups g LEFT JOIN group_members m ON m.group_id = g.id
				 GROUP BY g.id, g.name, g.avatar_url ORDER BY g.name`
			)
			: await pool.execute(
				`SELECT g.id AS _id, g.name, g.avatar_url AS avatarUrl,
				        mine.role, COUNT(m.user_id) AS members
				 FROM chat_groups g
				 JOIN group_members mine ON mine.group_id = g.id AND mine.user_id = ?
				 JOIN group_members m ON m.group_id = g.id
				 GROUP BY g.id, g.name, g.avatar_url, mine.role
				 ORDER BY g.name`,
				[req.user.id]
			);
		res.json(groups);
	} catch (err) {
		console.error("Fetch groups error:", err);
		res.status(500).json({ message: "Failed to get groups" });
	}
});
router.post("/groups", protect, async (req, res) => {
	const name = req.body.name?.trim();
	if (!name || name.length > 100) {
		return res.status(400).json({ message: "Group name must be between 1 and 100 characters." });
	}
	const connection = await pool.getConnection();
	try {
		await connection.beginTransaction();
		const [result] = await connection.execute(
			"INSERT INTO chat_groups (name, created_by) VALUES (?, ?)",
			[name, req.user.id]
		);
		await connection.execute(
			"INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'admin')",
			[result.insertId, req.user.id]
		);
		await connection.commit();
		res.status(201).json({ _id: result.insertId, name, avatarUrl: null, members: 1, role: "admin" });
	} catch (err) {
		await connection.rollback();
		console.error("Create group error:", err);
		res.status(500).json({ message: "Failed to create group" });
	} finally {
		connection.release();
	}
});

router.get("/groups/:groupId/members", protect, async (req, res) => {
	const groupId = Number(req.params.groupId);
	if (!validId(groupId)) return res.status(400).json({ message: "Invalid group id" });
	try {
		if (req.user.role !== "admin" && !await getGroupRole(groupId, req.user.id)) {
			return res.status(403).json({ message: "You are not a member of this group." });
		}
		const [members] = await pool.execute(
			`SELECT u.id AS _id, u.username, u.email,
			        u.profile_picture AS profilePicture, u.google_picture AS googlePicture, gm.role
			 FROM group_members gm JOIN users u ON u.id = gm.user_id
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
	const { role } = req.body;
	if (!validId(groupId) || !validId(userId) || !["admin", "member"].includes(role)) {
		return res.status(400).json({ message: "Invalid group member role update." });
	}
	try {
		if (!await canManageGroup(groupId, req.user)) {
			return res.status(403).json({ message: "Only group admins can edit roles." });
		}
		const [target] = await pool.execute(
			"SELECT role FROM group_members WHERE group_id = ? AND user_id = ?",
			[groupId, userId]
		);
		if (!target.length) return res.status(404).json({ message: "Group member not found." });
		if (target[0].role === "admin" && role === "member") {
			const [[{ admins }]] = await pool.execute(
				"SELECT COUNT(*) AS admins FROM group_members WHERE group_id = ? AND role = 'admin'",
				[groupId]
			);
			if (admins <= 1) return res.status(409).json({ message: "A group must keep at least one admin." });
		}
		await pool.execute("UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?", [role, groupId, userId]);
		const io = req.app.get("io");
		io?.in(`user:${userId}`).emit("group-role-updated", { groupId, userId, role });
		io?.to(`group:${groupId}`).emit("group-role-updated", { groupId, userId, role });
		res.json({ userId, role });
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
			io.in(`user:${userId}`).emit("group-member-removed", { groupId });
			io.in(`user:${userId}`).socketsLeave(`group:${groupId}`);
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
	const beforeId = req.query.before === undefined ? null : String(req.query.before);
	if (beforeId !== null && !/^\d+$/.test(beforeId)) {
		return res.status(400).json({ message: "Invalid message cursor." });
	}
	const parsedLimit = Number(req.query.limit || 50);
	const limit = Number.isSafeInteger(parsedLimit) ? Math.min(50, Math.max(1, parsedLimit)) : 50;
	try {
		if (req.user.role !== "admin" && !await getGroupRole(groupId, req.user.id)) {
			return res.status(403).json({ message: "You are not a member of this group." });
		}
		const [rows] = await pool.execute(
			`SELECT gm.id AS _id, gm.group_id AS groupId, gm.sender_id AS sender,
					u.username AS senderName,
					CASE WHEN gm.is_deleted THEN 'This message was deleted' ELSE gm.content END AS content,
					CASE WHEN gm.is_deleted THEN NULL ELSE gm.attachments END AS attachments,
					gm.is_deleted AS isDeleted, gm.reply_to_id AS replyToId,
					gm.sticker_id AS stickerId, COALESCE(gm.sticker_url, stickers.image_url) AS stickerUrl,
					reply_user.username AS replySenderName,
					CASE WHEN reply_message.is_deleted THEN 'This message was deleted' ELSE reply_message.content END AS replyContent,
					gm.created_at AS timestamp
			 FROM group_messages gm JOIN users u ON u.id = gm.sender_id
			 LEFT JOIN group_messages reply_message ON reply_message.id = gm.reply_to_id
			 LEFT JOIN users reply_user ON reply_user.id = reply_message.sender_id
			 LEFT JOIN stickers ON stickers.id = gm.sticker_id
			 WHERE gm.group_id = ? AND (? IS NULL OR gm.id < ?)
			 ORDER BY gm.id DESC LIMIT ?`,
			[groupId, beforeId, beforeId, limit + 1]
		);
		const hasMore = rows.length > limit;
		const messages = rows.slice(0, limit).reverse();
		res.json({ messages, hasMore });
	} catch (err) {
		console.error("Fetch group messages error:", err);
		res.status(500).json({ message: "Failed to get group messages" });
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
			"SELECT sender_id AS sender FROM group_messages WHERE id = ? AND group_id = ?",
			[messageId, groupId]
		);
		const message = messages[0];
		if (!message) return res.status(404).json({ message: "Message not found." });
		const isGroupAdmin = await canManageGroup(groupId, req.user);
		if (Number(message.sender) !== Number(req.user.id) && !isGroupAdmin) {
			return res.status(403).json({ message: "You can only delete your own messages." });
		}
		await pool.execute(
			"UPDATE group_messages SET is_deleted = TRUE, content = 'This message was deleted', attachments = NULL WHERE id = ? AND is_deleted = FALSE",
			[messageId]
		);
		const [rows] = await pool.execute(
			`SELECT gm.id AS _id, gm.group_id AS groupId, gm.sender_id AS sender,
			        u.username AS senderName, gm.content, NULL AS attachments, gm.is_deleted AS isDeleted,
			        gm.created_at AS timestamp
			 FROM group_messages gm JOIN users u ON u.id = gm.sender_id WHERE gm.id = ?`,
			[messageId]
		);
		req.app.get("io")?.to(`group:${groupId}`).emit("group-message-updated", rows[0]);
		res.json(rows[0]);
	} catch (err) {
		console.error("Delete group message error:", err);
		res.status(500).json({ message: "Failed to delete message" });
	}
});

module.exports = router;
