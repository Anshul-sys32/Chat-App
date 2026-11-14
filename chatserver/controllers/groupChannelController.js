const { pool } = require("../config/db");
const { getGroupCapabilities } = require("../services/groupCapabilities");
const { canManageGroup, canPostInChannel } = require("../services/groupAccess");

const validId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const makeSlug = (value) => value.normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "")
  .slice(0, 80);

const resolveCommunityGroup = async (groupId, user, requiredPermission = null) => {
  const [rows] = await pool.execute(
    `SELECT group_record.id, group_record.name, group_record.group_type AS groupType,
            membership.role AS groupRole, role_definition.permissions AS rolePermissions
     FROM chat_groups group_record
     LEFT JOIN group_members membership
       ON membership.group_id = group_record.id AND membership.user_id = ?
     LEFT JOIN group_roles role_definition
       ON role_definition.group_id = group_record.id AND role_definition.role_key = membership.role
     WHERE group_record.id = ? LIMIT 1`,
    [user.id, groupId]
  );
  const group = rows[0];
  if (!group || !getGroupCapabilities(group.groupType).channels) return { error: "not-found" };
  if (!group.groupRole && user.role !== "admin") return { error: "forbidden" };
  if (requiredPermission && !canManageGroup(group, requiredPermission, user.role)) return { error: "forbidden" };
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
              channel_type AS channelType, posting_mode AS postingMode, sort_order AS sortOrder
       FROM group_channels WHERE group_id = ? AND is_archived = FALSE
       ORDER BY sort_order, id`,
      [groupId]
    );
    const channelsWithAccess = await Promise.all(channels.map(async (channel) => ({
      ...channel,
      channelType: channel.channelType || "text",
      canPost: await canPostInChannel(group, { ...channel, id: channel._id }, req.user.role),
    })));
    return res.json({ groupType: group.groupType, channels: channelsWithAccess });
  } catch (error) {
    console.error("List community channels error:", error);
    return res.status(500).json({ message: "Could not load community channels." });
  }
};

const createChannel = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
  const channelType = req.body.channelType || "text";
  const postingMode = req.body.postingMode || "members";
  if (!validId(groupId) || !name || name.length > 60 || description.length > 500
    || !["text", "audio", "video"].includes(channelType)
    || !["members", "admins"].includes(postingMode) || !makeSlug(name)) {
    return res.status(400).json({ message: "Provide a channel name, type, description, and posting mode." });
  }
  try {
    const { error } = await resolveCommunityGroup(groupId, req.user, "manageChannels");
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
      `INSERT INTO group_channels (group_id, name, slug, description, channel_type, posting_mode, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [groupId, name, makeSlug(name), description, channelType, postingMode, nextOrder, req.user.id]
    );
    const channel = {
      _id: result.insertId,
      groupId,
      name,
      slug: makeSlug(name),
      description,
      channelType,
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
  if (Object.keys(updates).some((key) => !["name", "description", "channelType", "postingMode", "sortOrder"].includes(key))) {
    return res.status(400).json({ message: "Unsupported channel fields were provided." });
  }
  const name = updates.name === undefined ? undefined : String(updates.name).trim();
  const description = updates.description === undefined ? undefined : String(updates.description).trim();
  const channelType = updates.channelType;
  const postingMode = updates.postingMode;
  const sortOrder = updates.sortOrder;
  if (name !== undefined && (!name || name.length > 60 || !makeSlug(name))) return res.status(400).json({ message: "Channel names must be 1 to 60 characters." });
  if (description !== undefined && description.length > 500) return res.status(400).json({ message: "Channel descriptions must be 500 characters or shorter." });
  if (channelType !== undefined && !["text", "audio", "video"].includes(channelType)) return res.status(400).json({ message: "Invalid channel type." });
  if (postingMode !== undefined && !["members", "admins"].includes(postingMode)) return res.status(400).json({ message: "Invalid channel posting mode." });
  if (sortOrder !== undefined && (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000)) return res.status(400).json({ message: "Invalid channel order." });
  if (name === undefined && description === undefined && channelType === undefined && postingMode === undefined && sortOrder === undefined) {
    return res.status(400).json({ message: "Provide at least one channel field to update." });
  }
  try {
    const { error } = await resolveCommunityGroup(groupId, req.user, "manageChannels");
    if (error) return sendAccessError(res, error);
    const [channels] = await pool.execute(
      "SELECT id, slug FROM group_channels WHERE id = ? AND group_id = ? AND is_archived = FALSE LIMIT 1",
      [channelId, groupId]
    );
    if (!channels.length) return res.status(404).json({ message: "Channel not found." });
    if (channels[0].slug === "general" && name !== undefined && makeSlug(name) !== "general") {
      return res.status(409).json({ message: "The general channel name is protected." });
    }
    const nextName = name === undefined ? null : name;
    await pool.execute(
      `UPDATE group_channels SET
         name = COALESCE(?, name), slug = COALESCE(?, slug),
         description = COALESCE(?, description), channel_type = COALESCE(?, channel_type),
         posting_mode = COALESCE(?, posting_mode),
         sort_order = COALESCE(?, sort_order)
       WHERE id = ? AND group_id = ? AND is_archived = FALSE`,
      [nextName, name === undefined ? null : makeSlug(name), description ?? null, channelType ?? null, postingMode ?? null, sortOrder ?? null, channelId, groupId]
    );
    const [[updated]] = await pool.execute(
      `SELECT id AS _id, group_id AS groupId, name, slug, description,
              channel_type AS channelType, posting_mode AS postingMode, sort_order AS sortOrder
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

const reorderChannels = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const channelIds = req.body?.channelIds;
  if (!validId(groupId) || !Array.isArray(channelIds) || channelIds.length > 100
    || channelIds.some((id) => !validId(id))
    || new Set(channelIds.map(Number)).size !== channelIds.length) {
    return res.status(400).json({ message: "Provide a valid ordered list of channel ids." });
  }
  let connection;
  let transactionStarted = false;
  try {
    const { error } = await resolveCommunityGroup(groupId, req.user, "manageChannels");
    if (error) return sendAccessError(res, error);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const [activeChannels] = await connection.execute(
      "SELECT id FROM group_channels WHERE group_id = ? AND is_archived = FALSE FOR UPDATE",
      [groupId]
    );
    const activeIds = activeChannels.map((channel) => Number(channel.id));
    const requestedIds = channelIds.map(Number);
    if (activeIds.length !== requestedIds.length
      || activeIds.some((id) => !requestedIds.includes(id))) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ message: "The channel list changed. Refresh and try again." });
    }
    if (requestedIds.length) {
      const cases = requestedIds.map(() => "WHEN ? THEN ?").join(" ");
      const values = requestedIds.flatMap((id, sortOrder) => [id, sortOrder]);
      await connection.execute(
        `UPDATE group_channels SET sort_order = CASE id ${cases} END
         WHERE group_id = ? AND is_archived = FALSE`,
        [...values, groupId]
      );
    }
    const [channels] = await connection.execute(
      `SELECT id AS _id, group_id AS groupId, name, slug, description,
              channel_type AS channelType, posting_mode AS postingMode, sort_order AS sortOrder
       FROM group_channels WHERE group_id = ? AND is_archived = FALSE
       ORDER BY sort_order, id`,
      [groupId]
    );
    await connection.commit();
    transactionStarted = false;
    req.app.get("io")?.to(`group:${groupId}`).emit("group-channel-order-updated", { groupId, channels });
    return res.json({ channels });
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    console.error("Reorder community channels error:", error);
    return res.status(500).json({ message: "Could not reorder channels." });
  } finally {
    connection?.release();
  }
};

const archiveChannel = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const channelId = Number(req.params.channelId);
  if (!validId(groupId) || !validId(channelId)) return res.status(400).json({ message: "Invalid group or channel id." });
  try {
    const { error } = await resolveCommunityGroup(groupId, req.user, "manageChannels");
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
      const [sessions] = await pool.execute(
        "SELECT id FROM community_collab_sessions WHERE group_id = ? AND channel_id = ?",
        [groupId, channelId]
      );
      for (const session of sessions) {
        io.to(`collab-session:${session.id}`).emit("collab-session-error", { sessionId: session.id, message: "This session channel is no longer available." });
        io.in(`collab-session:${session.id}`).socketsLeave(`collab-session:${session.id}`);
      }
    }
    return res.status(204).end();
  } catch (error) {
    console.error("Archive community channel error:", error);
    return res.status(500).json({ message: "Could not archive this channel." });
  }
};

const listArchivedChannels = async (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!validId(groupId)) return res.status(400).json({ message: "Invalid group id." });
  try {
    const { error } = await resolveCommunityGroup(groupId, req.user, "manageChannels");
    if (error) return sendAccessError(res, error);
    const [channels] = await pool.execute(
      `SELECT id AS _id, group_id AS groupId, name, slug, description,
              channel_type AS channelType, posting_mode AS postingMode, sort_order AS sortOrder
       FROM group_channels WHERE group_id = ? AND is_archived = TRUE
       ORDER BY sort_order, id`,
      [groupId]
    );
    return res.json({ channels });
  } catch (error) {
    console.error("List archived community channels error:", error);
    return res.status(500).json({ message: "Could not load archived channels." });
  }
};

const restoreChannel = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const channelId = Number(req.params.channelId);
  if (!validId(groupId) || !validId(channelId)) return res.status(400).json({ message: "Invalid group or channel id." });
  try {
    const { error } = await resolveCommunityGroup(groupId, req.user, "manageChannels");
    if (error) return sendAccessError(res, error);
    const [channels] = await pool.execute(
      `SELECT id AS _id, group_id AS groupId, name, slug, description,
              channel_type AS channelType, posting_mode AS postingMode, sort_order AS sortOrder
       FROM group_channels WHERE id = ? AND group_id = ? AND is_archived = TRUE LIMIT 1`,
      [channelId, groupId]
    );
    if (!channels.length) return res.status(404).json({ message: "Archived channel not found." });
    const [[{ channelCount }]] = await pool.execute(
      "SELECT COUNT(*) AS channelCount FROM group_channels WHERE group_id = ? AND is_archived = FALSE",
      [groupId]
    );
    if (Number(channelCount) >= 100) return res.status(409).json({ message: "Communities are limited to 100 active channels." });
    await pool.execute(
      "UPDATE group_channels SET is_archived = FALSE WHERE id = ? AND group_id = ? AND is_archived = TRUE",
      [channelId, groupId]
    );
    const channel = { ...channels[0], isArchived: false };
    req.app.get("io")?.to(`group:${groupId}`).emit("group-channel-restored", channel);
    return res.json(channel);
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "An active channel with that name already exists." });
    console.error("Restore community channel error:", error);
    return res.status(500).json({ message: "Could not restore this channel." });
  }
};

const permanentlyDeleteChannel = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const channelId = Number(req.params.channelId);
  if (!validId(groupId) || !validId(channelId)) return res.status(400).json({ message: "Invalid group or channel id." });
  try {
    const { error } = await resolveCommunityGroup(groupId, req.user, "manageChannels");
    if (error) return sendAccessError(res, error);
    const [channels] = await pool.execute(
      "SELECT id, slug FROM group_channels WHERE id = ? AND group_id = ? AND is_archived = TRUE LIMIT 1",
      [channelId, groupId]
    );
    if (!channels.length) return res.status(404).json({ message: "Archived channel not found." });
    if (channels[0].slug === "general") return res.status(409).json({ message: "The general channel cannot be permanently deleted." });
    const [[{ sessionCount }]] = await pool.execute(
      "SELECT COUNT(*) AS sessionCount FROM community_collab_sessions WHERE group_id = ? AND channel_id = ?",
      [groupId, channelId]
    );
    if (Number(sessionCount) > 0) {
      return res.status(409).json({ message: "This channel has collaborative session history and cannot be permanently deleted." });
    }
    await pool.execute(
      "DELETE FROM group_channels WHERE id = ? AND group_id = ? AND is_archived = TRUE",
      [channelId, groupId]
    );
    req.app.get("io")?.to(`group:${groupId}`).emit("group-channel-removed", { groupId, channelId });
    return res.status(204).end();
  } catch (error) {
    if (error.code === "ER_ROW_IS_REFERENCED_2") {
      return res.status(409).json({ message: "This channel still contains retained history and cannot be permanently deleted." });
    }
    console.error("Permanently delete community channel error:", error);
    return res.status(500).json({ message: "Could not permanently delete this channel." });
  }
};

const listChannelRolePermissions = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const channelId = Number(req.params.channelId);
  if (!validId(groupId) || !validId(channelId)) return res.status(400).json({ message: "Invalid group or channel id." });
  try {
    const { error } = await resolveCommunityGroup(groupId, req.user, "manageChannels");
    if (error) return sendAccessError(res, error);
    const [channels] = await pool.execute(
      "SELECT id, posting_mode AS postingMode FROM group_channels WHERE id = ? AND group_id = ? AND is_archived = FALSE LIMIT 1",
      [channelId, groupId]
    );
    if (!channels.length) return res.status(404).json({ message: "Channel not found." });
    const [roles] = await pool.execute(
      `SELECT role.role_key AS roleKey, role.name, role.permissions,
              permission.can_post AS canPost
       FROM group_roles role
       LEFT JOIN community_channel_role_permissions permission
         ON permission.channel_id = ? AND permission.role_key = role.role_key
       WHERE role.group_id = ? ORDER BY role.is_system DESC, role.name`,
      [channelId, groupId]
    );
    return res.json({ postingMode: channels[0].postingMode, roles });
  } catch (error) {
    console.error("List channel role permissions error:", error);
    return res.status(500).json({ message: "Could not load channel permissions." });
  }
};

const updateChannelRolePermission = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const channelId = Number(req.params.channelId);
  const roleKey = typeof req.body?.roleKey === "string" ? req.body.roleKey : "";
  const canPost = req.body?.canPost;
  if (!validId(groupId) || !validId(channelId) || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(roleKey) || typeof canPost !== "boolean") {
    return res.status(400).json({ message: "Provide a role and boolean posting permission." });
  }
  if (roleKey === "admin") return res.status(400).json({ message: "Admin posting permission is always enabled." });
  try {
    const { error } = await resolveCommunityGroup(groupId, req.user, "manageChannels");
    if (error) return sendAccessError(res, error);
    const [[channel]] = await pool.execute(
      "SELECT id FROM group_channels WHERE id = ? AND group_id = ? AND is_archived = FALSE LIMIT 1",
      [channelId, groupId]
    );
    if (!channel) return res.status(404).json({ message: "Channel not found." });
    const [[role]] = await pool.execute(
      "SELECT role_key AS roleKey, name FROM group_roles WHERE group_id = ? AND role_key = ? LIMIT 1",
      [groupId, roleKey]
    );
    if (!role) return res.status(404).json({ message: "Group role not found." });
    await pool.execute(
      `INSERT INTO community_channel_role_permissions (channel_id, role_key, can_post) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE can_post = VALUES(can_post)`,
      [channelId, roleKey, canPost]
    );
    const permission = { groupId, channelId, roleKey, roleName: role.name, canPost };
    req.app.get("io")?.to(`group:${groupId}`).emit("group-channel-permission-updated", permission);
    return res.json(permission);
  } catch (error) {
    console.error("Update channel role permission error:", error);
    return res.status(500).json({ message: "Could not update channel permissions." });
  }
};

module.exports = {
  listChannels,
  createChannel,
  updateChannel,
  reorderChannels,
  archiveChannel,
  listArchivedChannels,
  restoreChannel,
  permanentlyDeleteChannel,
  listChannelRolePermissions,
  updateChannelRolePermission,
};
