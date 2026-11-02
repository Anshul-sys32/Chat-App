const { pool } = require("../config/db");
const { getGroupCapabilities } = require("../services/groupCapabilities");

const validId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const makeSlug = (value) => value.normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "")
  .slice(0, 80);

const resolveCommunityGroup = async (groupId, user, requireLeader = false) => {
  const [rows] = await pool.execute(
    `SELECT group_record.id, group_record.name, group_record.group_type AS groupType,
            membership.role AS groupRole
     FROM chat_groups group_record
     LEFT JOIN group_members membership
       ON membership.group_id = group_record.id AND membership.user_id = ?
     WHERE group_record.id = ? LIMIT 1`,
    [user.id, groupId]
  );
  const group = rows[0];
  if (!group || !getGroupCapabilities(group.groupType).channels) return { error: "not-found" };
  if (!group.groupRole && user.role !== "admin") return { error: "forbidden" };
  if (requireLeader && group.groupRole !== "admin" && user.role !== "admin") return { error: "forbidden" };
  return { group };
};

const sendAccessError = (res, reason) => {
  if (reason === "forbidden") return res.status(403).json({ message: "You do not have permission to manage this community." });
  return res.status(404).json({ message: "Community not found." });
};

const listChannels = async (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!validId(groupId)) return res.status(400).json({ message: "Invalid group id." });
  try {
    const { group, error } = await resolveCommunityGroup(groupId, req.user);
    if (!group) return sendAccessError(res, error);
    const [channels] = await pool.execute(
      `SELECT id AS _id, group_id AS groupId, name, slug, description,
              posting_mode AS postingMode, sort_order AS sortOrder
       FROM group_channels WHERE group_id = ? AND is_archived = FALSE
       ORDER BY sort_order, id`,
      [groupId]
    );
    return res.json({ groupType: group.groupType, channels });
  } catch (error) {
    console.error("List community channels error:", error);
    return res.status(500).json({ message: "Could not load community channels." });
  }
};

const createChannel = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
  const postingMode = req.body.postingMode || "members";
  if (!validId(groupId) || !name || name.length > 60 || description.length > 500
    || !["members", "admins"].includes(postingMode) || !makeSlug(name)) {
    return res.status(400).json({ message: "Provide a channel name, valid description, and posting mode." });
  }
  try {
    const { error } = await resolveCommunityGroup(groupId, req.user, true);
    if (error) return sendAccessError(res, error);
    const [[{ channelCount }]] = await pool.execute(
      "SELECT COUNT(*) AS channelCount FROM group_channels WHERE group_id = ? AND is_archived = FALSE",
      [groupId]
    );
    if (Number(channelCount) >= 100) return res.status(409).json({ message: "Communities are limited to 100 active channels." });
    const [[{ nextOrder }]] = await pool.execute(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextOrder FROM group_channels WHERE group_id = ?",
      [groupId]
    );
    const [result] = await pool.execute(
      `INSERT INTO group_channels (group_id, name, slug, description, posting_mode, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [groupId, name, makeSlug(name), description, postingMode, nextOrder, req.user.id]
    );
    const channel = {
      _id: result.insertId,
      groupId,
      name,
      slug: makeSlug(name),
      description,
      postingMode,
      sortOrder: Number(nextOrder),
    };
    req.app.get("io")?.to(`group:${groupId}`).emit("group-channel-created", channel);
    return res.status(201).json(channel);
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "A channel with that name already exists." });
    console.error("Create community channel error:", error);
    return res.status(500).json({ message: "Could not create this channel." });
  }
};

const updateChannel = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const channelId = Number(req.params.channelId);
  if (!validId(groupId) || !validId(channelId)) return res.status(400).json({ message: "Invalid group or channel id." });
  const updates = req.body || {};
  if (Object.keys(updates).some((key) => !["name", "description", "postingMode", "sortOrder"].includes(key))) {
    return res.status(400).json({ message: "Unsupported channel fields were provided." });
  }
  const name = updates.name === undefined ? undefined : String(updates.name).trim();
  const description = updates.description === undefined ? undefined : String(updates.description).trim();
  const postingMode = updates.postingMode;
  const sortOrder = updates.sortOrder;
  if (name !== undefined && (!name || name.length > 60 || !makeSlug(name))) return res.status(400).json({ message: "Channel names must be 1 to 60 characters." });
  if (description !== undefined && description.length > 500) return res.status(400).json({ message: "Channel descriptions must be 500 characters or shorter." });
  if (postingMode !== undefined && !["members", "admins"].includes(postingMode)) return res.status(400).json({ message: "Invalid channel posting mode." });
  if (sortOrder !== undefined && (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000)) return res.status(400).json({ message: "Invalid channel order." });
  if (name === undefined && description === undefined && postingMode === undefined && sortOrder === undefined) {
    return res.status(400).json({ message: "Provide at least one channel field to update." });
  }
  try {
    const { error } = await resolveCommunityGroup(groupId, req.user, true);
    if (error) return sendAccessError(res, error);
    const [channels] = await pool.execute(
      "SELECT id, slug FROM group_channels WHERE id = ? AND group_id = ? AND is_archived = FALSE LIMIT 1",
      [channelId, groupId]
    );
    if (!channels.length) return res.status(404).json({ message: "Channel not found." });
    const nextName = name === undefined ? null : name;
    await pool.execute(
      `UPDATE group_channels SET
         name = COALESCE(?, name), slug = COALESCE(?, slug),
         description = COALESCE(?, description), posting_mode = COALESCE(?, posting_mode),
         sort_order = COALESCE(?, sort_order)
       WHERE id = ? AND group_id = ? AND is_archived = FALSE`,
      [nextName, name === undefined ? null : makeSlug(name), description ?? null, postingMode ?? null, sortOrder ?? null, channelId, groupId]
    );
    const [[updated]] = await pool.execute(
      `SELECT id AS _id, group_id AS groupId, name, slug, description,
              posting_mode AS postingMode, sort_order AS sortOrder
       FROM group_channels WHERE id = ? LIMIT 1`,
      [channelId]
    );
    req.app.get("io")?.to(`group:${groupId}`).emit("group-channel-updated", updated);
    return res.json(updated);
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "A channel with that name already exists." });
    console.error("Update community channel error:", error);
    return res.status(500).json({ message: "Could not update this channel." });
  }
};

const archiveChannel = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const channelId = Number(req.params.channelId);
  if (!validId(groupId) || !validId(channelId)) return res.status(400).json({ message: "Invalid group or channel id." });
  try {
    const { error } = await resolveCommunityGroup(groupId, req.user, true);
    if (error) return sendAccessError(res, error);
    const [channels] = await pool.execute(
      "SELECT id, slug FROM group_channels WHERE id = ? AND group_id = ? AND is_archived = FALSE LIMIT 1",
      [channelId, groupId]
    );
    if (!channels.length) return res.status(404).json({ message: "Channel not found." });
    if (channels[0].slug === "general") return res.status(409).json({ message: "The general channel cannot be archived." });
    const [[{ channelCount }]] = await pool.execute(
      "SELECT COUNT(*) AS channelCount FROM group_channels WHERE group_id = ? AND is_archived = FALSE",
      [groupId]
    );
    if (Number(channelCount) <= 1) return res.status(409).json({ message: "A community must retain at least one active channel." });
    await pool.execute(
      "UPDATE group_channels SET is_archived = TRUE WHERE id = ? AND group_id = ?",
      [channelId, groupId]
    );
    const io = req.app.get("io");
    if (io) {
      io.to(`group:${groupId}`).emit("group-channel-archived", { groupId, channelId });
      io.in(`group:${groupId}:channel:${channelId}`).socketsLeave(`group:${groupId}:channel:${channelId}`);
    }
    return res.status(204).end();
  } catch (error) {
    console.error("Archive community channel error:", error);
    return res.status(500).json({ message: "Could not archive this channel." });
  }
};

module.exports = { listChannels, createChannel, updateChannel, archiveChannel };
