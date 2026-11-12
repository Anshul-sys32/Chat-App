const { pool } = require("../config/db");
const { canAccessGroup, canManageGroup, getGroupAccess } = require("../services/groupAccess");
const { authorizeSession, sessionRoom } = require("../services/communityCollabSessions");

const ITEM_TYPES = new Set(["stroke", "sticky", "rectangle", "ellipse", "arrow"]);
const validCoordinate = (value, max) => Number.isFinite(value) && value >= 0 && value <= max;
const validColor = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

const validateWhiteboardItem = (type, data) => {
  if (!ITEM_TYPES.has(type) || !data || typeof data !== "object" || Array.isArray(data)) return "Choose a supported whiteboard item.";
  if (type === "stroke") {
    if (!Array.isArray(data.points) || data.points.length < 2 || data.points.length > 1500
      || data.points.some((point) => !point || !validCoordinate(point.x, 1000) || !validCoordinate(point.y, 600))
      || !validColor(data.color) || !Number.isFinite(data.width) || data.width < 1 || data.width > 18) {
      return "Provide a valid drawing stroke.";
    }
  } else if (type === "sticky") {
    if (!validCoordinate(data.x, 1000) || !validCoordinate(data.y, 600)
      || typeof data.text !== "string" || !data.text.trim() || data.text.length > 2000
      || !["yellow", "mint", "pink", "blue"].includes(data.color)) {
      return "Sticky notes need text and a valid position and color.";
    }
  } else if (type === "arrow") {
    if (![data.x1, data.x2].every((value) => validCoordinate(value, 1000))
      || ![data.y1, data.y2].every((value) => validCoordinate(value, 600))
      || !validColor(data.color) || !Number.isFinite(data.width) || data.width < 1 || data.width > 18) {
      return "Provide a valid arrow.";
    }
  } else if (!validCoordinate(data.x, 1000) || !validCoordinate(data.y, 600)
    || !Number.isFinite(data.width) || data.width <= 0 || data.width > 1000
    || !Number.isFinite(data.height) || data.height <= 0 || data.height > 600
    || !validColor(data.color) || !Number.isFinite(data.strokeWidth) || data.strokeWidth < 1 || data.strokeWidth > 18) {
    return "Provide a valid shape.";
  }
  if (JSON.stringify(data).length > 50000) return "Whiteboard items must be 50 KB or smaller.";
  return null;
};

const resolveCommunity = async (groupId, user) => {
  const group = await getGroupAccess(groupId, user.id);
  if (!group || !canAccessGroup(group, user.role)) return { status: 404, message: "Community not found." };
  if (group.groupType !== "community") return { status: 400, message: "Whiteboards are only available in communities." };
  return { group };
};

const listWhiteboardItems = async (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!Number.isSafeInteger(groupId) || groupId < 1) return res.status(400).json({ message: "Invalid community id." });
  try {
    const authorized = await resolveCommunity(groupId, req.user);
    if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
    const [items] = await pool.execute(
      `SELECT item.id, item.item_type AS itemType, item.data,
              item.created_by AS createdBy, creator.username AS creatorName,
              item.updated_at AS updatedAt
       FROM community_whiteboard_items item JOIN users creator ON creator.id = item.created_by
      WHERE item.group_id = ? AND item.session_id IS NULL ORDER BY item.id LIMIT 2000`,
      [groupId]
    );
    return res.json({ items: items.map((item) => ({
      ...item,
      data: typeof item.data === "string" ? JSON.parse(item.data) : item.data,
    })) });
  } catch (error) {
    console.error("List community whiteboard error:", error);
    return res.status(500).json({ message: "Could not load the whiteboard." });
  }
};

const createWhiteboardItem = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const itemType = req.body?.itemType;
  const data = req.body?.data;
  if (!Number.isSafeInteger(groupId) || groupId < 1) return res.status(400).json({ message: "Invalid community id." });
  const validationError = validateWhiteboardItem(itemType, data);
  if (validationError) return res.status(400).json({ message: validationError });
  try {
    const authorized = await resolveCommunity(groupId, req.user);
    if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
    const [result] = await pool.execute(
      "INSERT INTO community_whiteboard_items (group_id, created_by, updated_by, item_type, data) VALUES (?, ?, ?, ?, ?)",
      [groupId, req.user.id, req.user.id, itemType, JSON.stringify(data)]
    );
    const [rows] = await pool.execute(
      `SELECT item.id, item.item_type AS itemType, item.data,
              item.created_by AS createdBy, creator.username AS creatorName,
              item.updated_at AS updatedAt
       FROM community_whiteboard_items item JOIN users creator ON creator.id = item.created_by
       WHERE item.id = ?`,
      [result.insertId]
    );
    const item = { ...rows[0], data: typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data };
    req.app.get("io")?.to(`group:${groupId}`).emit("whiteboard-item-created", { groupId, item });
    return res.status(201).json({ item });
  } catch (error) {
    console.error("Create whiteboard item error:", error);
    return res.status(500).json({ message: "Could not save this whiteboard item." });
  }
};

const updateWhiteboardItem = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const itemId = Number(req.params.itemId);
  const itemType = req.body?.itemType;
  const data = req.body?.data;
  if (!Number.isSafeInteger(groupId) || groupId < 1 || !Number.isSafeInteger(itemId) || itemId < 1) {
    return res.status(400).json({ message: "Invalid whiteboard item." });
  }
  const validationError = validateWhiteboardItem(itemType, data);
  if (validationError) return res.status(400).json({ message: validationError });
  try {
    const authorized = await resolveCommunity(groupId, req.user);
    if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
    const [items] = await pool.execute(
      "SELECT created_by AS createdBy FROM community_whiteboard_items WHERE id = ? AND group_id = ? AND session_id IS NULL LIMIT 1",
      [itemId, groupId]
    );
    if (!items.length) return res.status(404).json({ message: "Whiteboard item not found." });
    if (Number(items[0].createdBy) !== Number(req.user.id)
      && !canManageGroup(authorized.group, "manageMessages", req.user.role)) {
      return res.status(403).json({ message: "Only the item creator or a community manager can edit this item." });
    }
    await pool.execute(
      "UPDATE community_whiteboard_items SET updated_by = ?, item_type = ?, data = ? WHERE id = ? AND group_id = ? AND session_id IS NULL",
      [req.user.id, itemType, JSON.stringify(data), itemId, groupId]
    );
    const [rows] = await pool.execute(
      `SELECT item.id, item.item_type AS itemType, item.data,
              item.created_by AS createdBy, creator.username AS creatorName,
              item.updated_at AS updatedAt
       FROM community_whiteboard_items item JOIN users creator ON creator.id = item.created_by
       WHERE item.id = ?`,
      [itemId]
    );
    const item = { ...rows[0], data: typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data };
    req.app.get("io")?.to(`group:${groupId}`).emit("whiteboard-item-updated", { groupId, item });
    return res.json({ item });
  } catch (error) {
    console.error("Update whiteboard item error:", error);
    return res.status(500).json({ message: "Could not update this whiteboard item." });
  }
};

const deleteWhiteboardItem = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const itemId = Number(req.params.itemId);
  if (!Number.isSafeInteger(groupId) || groupId < 1 || !Number.isSafeInteger(itemId) || itemId < 1) {
    return res.status(400).json({ message: "Invalid whiteboard item." });
  }
  try {
    const authorized = await resolveCommunity(groupId, req.user);
    if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
    const [items] = await pool.execute(
      "SELECT created_by AS createdBy FROM community_whiteboard_items WHERE id = ? AND group_id = ? AND session_id IS NULL LIMIT 1",
      [itemId, groupId]
    );
    if (!items.length) return res.status(404).json({ message: "Whiteboard item not found." });
    if (Number(items[0].createdBy) !== Number(req.user.id)
      && !canManageGroup(authorized.group, "manageMessages", req.user.role)) {
      return res.status(403).json({ message: "Only the item creator or a community manager can remove this item." });
    }
    await pool.execute("DELETE FROM community_whiteboard_items WHERE id = ? AND group_id = ? AND session_id IS NULL", [itemId, groupId]);
    req.app.get("io")?.to(`group:${groupId}`).emit("whiteboard-item-deleted", { groupId, itemId });
    return res.status(204).end();
  } catch (error) {
    console.error("Delete whiteboard item error:", error);
    return res.status(500).json({ message: "Could not remove this whiteboard item." });
  }
};

const resolveWhiteboardSession = async (req, res, write = false) => {
  const authorized = await authorizeSession(req.params.sessionId, req.user, { write });
  if (authorized.status) {
    res.status(authorized.status).json({ message: authorized.message });
    return null;
  }
  if (authorized.session.sessionType !== "whiteboard") {
    res.status(400).json({ message: "This collaborative session is not a whiteboard." });
    return null;
  }
  return authorized;
};

const listSessionWhiteboardItems = async (req, res) => {
  try {
    const authorized = await resolveWhiteboardSession(req, res);
    if (!authorized) return;
    const [items] = await pool.execute(
      `SELECT item.id, item.item_type AS itemType, item.data,
              item.created_by AS createdBy, creator.username AS creatorName,
              item.updated_at AS updatedAt
       FROM community_whiteboard_items item JOIN users creator ON creator.id = item.created_by
       WHERE item.group_id = ? AND item.session_id = ? ORDER BY item.id LIMIT 2000`,
      [authorized.session.groupId, authorized.session.id]
    );
    return res.json({ items: items.map((item) => ({
      ...item,
      data: typeof item.data === "string" ? JSON.parse(item.data) : item.data,
    })) });
  } catch (error) {
    console.error("List session whiteboard items error:", error);
    return res.status(500).json({ message: "Could not load this whiteboard." });
  }
};

const createSessionWhiteboardItem = async (req, res) => {
  const itemType = req.body?.itemType;
  const data = req.body?.data;
  const validationError = validateWhiteboardItem(itemType, data);
  if (validationError) return res.status(400).json({ message: validationError });
  try {
    const authorized = await resolveWhiteboardSession(req, res, true);
    if (!authorized) return;
    const [result] = await pool.execute(
      `INSERT INTO community_whiteboard_items
       (group_id, session_id, created_by, updated_by, item_type, data)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [authorized.session.groupId, authorized.session.id, req.user.id, req.user.id, itemType, JSON.stringify(data)]
    );
    const [rows] = await pool.execute(
      `SELECT item.id, item.item_type AS itemType, item.data,
              item.created_by AS createdBy, creator.username AS creatorName,
              item.updated_at AS updatedAt
       FROM community_whiteboard_items item JOIN users creator ON creator.id = item.created_by
       WHERE item.id = ? AND item.session_id = ? LIMIT 1`,
      [result.insertId, authorized.session.id]
    );
    const item = { ...rows[0], data: typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data };
    req.app.get("io")?.to(sessionRoom(authorized.session.id)).emit("whiteboard-item-created", {
      groupId: authorized.session.groupId,
      sessionId: authorized.session.id,
      item,
    });
    return res.status(201).json({ item });
  } catch (error) {
    console.error("Create session whiteboard item error:", error);
    return res.status(500).json({ message: "Could not save this whiteboard item." });
  }
};

const updateSessionWhiteboardItem = async (req, res) => {
  const itemId = Number(req.params.itemId);
  const itemType = req.body?.itemType;
  const data = req.body?.data;
  if (!Number.isSafeInteger(itemId) || itemId < 1) return res.status(400).json({ message: "Invalid whiteboard item." });
  const validationError = validateWhiteboardItem(itemType, data);
  if (validationError) return res.status(400).json({ message: validationError });
  try {
    const authorized = await resolveWhiteboardSession(req, res, true);
    if (!authorized) return;
    const [items] = await pool.execute(
      "SELECT created_by AS createdBy FROM community_whiteboard_items WHERE id = ? AND group_id = ? AND session_id = ? LIMIT 1",
      [itemId, authorized.session.groupId, authorized.session.id]
    );
    if (!items.length) return res.status(404).json({ message: "Whiteboard item not found." });
    if (Number(items[0].createdBy) !== Number(req.user.id)
      && !canManageGroup(authorized.group, "manageMessages", req.user.role)) {
      return res.status(403).json({ message: "Only the item creator or a community manager can edit this item." });
    }
    await pool.execute(
      "UPDATE community_whiteboard_items SET updated_by = ?, item_type = ?, data = ? WHERE id = ? AND group_id = ? AND session_id = ?",
      [req.user.id, itemType, JSON.stringify(data), itemId, authorized.session.groupId, authorized.session.id]
    );
    const [rows] = await pool.execute(
      `SELECT item.id, item.item_type AS itemType, item.data,
              item.created_by AS createdBy, creator.username AS creatorName,
              item.updated_at AS updatedAt
       FROM community_whiteboard_items item JOIN users creator ON creator.id = item.created_by
       WHERE item.id = ? AND item.session_id = ? LIMIT 1`,
      [itemId, authorized.session.id]
    );
    const item = { ...rows[0], data: typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data };
    req.app.get("io")?.to(sessionRoom(authorized.session.id)).emit("whiteboard-item-updated", {
      groupId: authorized.session.groupId,
      sessionId: authorized.session.id,
      item,
    });
    return res.json({ item });
  } catch (error) {
    console.error("Update session whiteboard item error:", error);
    return res.status(500).json({ message: "Could not update this whiteboard item." });
  }
};

const deleteSessionWhiteboardItem = async (req, res) => {
  const itemId = Number(req.params.itemId);
  if (!Number.isSafeInteger(itemId) || itemId < 1) return res.status(400).json({ message: "Invalid whiteboard item." });
  try {
    const authorized = await resolveWhiteboardSession(req, res, true);
    if (!authorized) return;
    const [items] = await pool.execute(
      "SELECT created_by AS createdBy FROM community_whiteboard_items WHERE id = ? AND group_id = ? AND session_id = ? LIMIT 1",
      [itemId, authorized.session.groupId, authorized.session.id]
    );
    if (!items.length) return res.status(404).json({ message: "Whiteboard item not found." });
    if (Number(items[0].createdBy) !== Number(req.user.id)
      && !canManageGroup(authorized.group, "manageMessages", req.user.role)) {
      return res.status(403).json({ message: "Only the item creator or a community manager can remove this item." });
    }
    await pool.execute(
      "DELETE FROM community_whiteboard_items WHERE id = ? AND group_id = ? AND session_id = ?",
      [itemId, authorized.session.groupId, authorized.session.id]
    );
    req.app.get("io")?.to(sessionRoom(authorized.session.id)).emit("whiteboard-item-deleted", {
      groupId: authorized.session.groupId,
      sessionId: authorized.session.id,
      itemId,
    });
    return res.status(204).end();
  } catch (error) {
    console.error("Delete session whiteboard item error:", error);
    return res.status(500).json({ message: "Could not remove this whiteboard item." });
  }
};

module.exports = {
  createSessionWhiteboardItem,
  createWhiteboardItem,
  deleteSessionWhiteboardItem,
  deleteWhiteboardItem,
  listSessionWhiteboardItems,
  listWhiteboardItems,
  updateSessionWhiteboardItem,
  updateWhiteboardItem,
  validateWhiteboardItem,
};
