const express = require("express");
const router = express.Router();
const { register, login, user } = require("../controllers/authController");
const protect = require("../middleware/authMiddleware");
const { pool } = require("../config/db");

const getGroupRole = async (groupId, userId) => {
	const [rows] = await pool.execute(
		"SELECT role FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1",
		[groupId, userId]
	);
	return rows[0]?.role || null;
};

const validId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;

router.post("/register", register);
router.post("/login", login);
router.get("/users", protect, user);
router.get("/messages/:userId", protect, async (req, res) => {
	const otherId = Number(req.params.userId);
	if (!Number.isSafeInteger(otherId) || otherId < 1) {
		return res.status(400).json({ message: "Invalid user id" });
	}
	try {
		const [messages] = await pool.execute(
			`SELECT id AS _id, sender_id AS sender, receiver_id AS receiver, content,
							created_at AS timestamp
			 FROM messages
			 WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
			 ORDER BY created_at ASC, id ASC`,
			[req.user.id, otherId, otherId, req.user.id]
		);
		res.json(messages);
	} catch (err) {
		console.error("Fetch messages error:", err);
		res.status(500).json({ message: "Failed to get messages" });
	}
});
router.get("/groups", protect, async (req, res) => {
	try {
		const [groups] = await pool.execute(
			`SELECT g.id AS _id, g.name, mine.role,
					COUNT(m.user_id) AS members
			 FROM chat_groups g
			 JOIN group_members mine ON mine.group_id = g.id AND mine.user_id = ?
			 JOIN group_members m ON m.group_id = g.id
			 GROUP BY g.id, g.name, mine.role
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
		res.status(201).json({ _id: result.insertId, name, members: 1, role: "admin" });
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
		if (!await getGroupRole(groupId, req.user.id)) {
			return res.status(403).json({ message: "You are not a member of this group." });
		}
		const [members] = await pool.execute(
			`SELECT u.id AS _id, u.username, u.email, gm.role
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

router.post("/groups/:groupId/members", protect, async (req, res) => {
	const groupId = Number(req.params.groupId);
	const userId = Number(req.body.userId);
	if (!validId(groupId) || !validId(userId)) {
		return res.status(400).json({ message: "Invalid group or user id" });
	}
	try {
		if (await getGroupRole(groupId, req.user.id) !== "admin") {
			return res.status(403).json({ message: "Only group admins can add members." });
		}
		const [result] = await pool.execute(
			"INSERT IGNORE INTO group_members (group_id, user_id, role) SELECT ?, id, 'member' FROM users WHERE id = ?",
			[groupId, userId]
		);
		if (!result.affectedRows) {
			const [existing] = await pool.execute("SELECT id FROM users WHERE id = ?", [userId]);
			return res.status(existing.length ? 409 : 404).json({
				message: existing.length ? "That person is already in this group." : "User not found.",
			});
		}
		const [rows] = await pool.execute(
			"SELECT id AS _id, username, email, 'member' AS role FROM users WHERE id = ?",
			[userId]
		);
		const [groupRows] = await pool.execute(
			`SELECT name, (SELECT COUNT(*) FROM group_members WHERE group_id = ?) AS members
			 FROM chat_groups WHERE id = ?`,
			[groupId, groupId]
		);
		const io = req.app.get("io");
		const event = {
			groupId,
			member: rows[0],
			groupName: groupRows[0].name,
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
		if (await getGroupRole(groupId, req.user.id) !== "admin") {
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
		if (await getGroupRole(groupId, req.user.id) !== "admin") {
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
	try {
		if (!await getGroupRole(groupId, req.user.id)) {
			return res.status(403).json({ message: "You are not a member of this group." });
		}
		const [messages] = await pool.execute(
			`SELECT gm.id AS _id, gm.group_id AS groupId, gm.sender_id AS sender,
					u.username AS senderName, gm.content, gm.created_at AS timestamp
			 FROM group_messages gm JOIN users u ON u.id = gm.sender_id
			 WHERE gm.group_id = ? ORDER BY gm.created_at, gm.id`,
			[groupId]
		);
		res.json(messages);
	} catch (err) {
		console.error("Fetch group messages error:", err);
		res.status(500).json({ message: "Failed to get group messages" });
	}
});

module.exports = router;
