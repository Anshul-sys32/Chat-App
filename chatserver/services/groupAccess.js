const { pool } = require("../config/db");

const getGroupAccess = async (groupId, userId) => {
  const [rows] = await pool.execute(
        `SELECT group_record.id, group_record.name, group_record.is_active AS isActive,
          group_record.group_type AS groupType,
            membership.role AS groupRole
     FROM chat_groups group_record
     LEFT JOIN group_members membership
       ON membership.group_id = group_record.id AND membership.user_id = ?
     WHERE group_record.id = ? LIMIT 1`,
    [userId, groupId]
  );
  return rows[0] || null;
};

const getActiveChannel = async (groupId, channelId) => {
  const [rows] = await pool.execute(
    `SELECT id, group_id AS groupId, name, slug, posting_mode AS postingMode
     FROM group_channels WHERE id = ? AND group_id = ? AND is_archived = FALSE LIMIT 1`,
    [channelId, groupId]
  );
  return rows[0] || null;
};

const canAccessGroup = (group, userRole) => Boolean(group)
  && (group.isActive !== 0 || userRole === "admin")
    && (Boolean(group?.groupRole) || userRole === "admin");

const canPostInChannel = (group, channel, userRole) =>
  channel?.postingMode === "members" || group?.groupRole === "admin" || userRole === "admin";

const validateGroupMessageTarget = async (groupId, user, requestedChannelId) => {
  const group = await getGroupAccess(groupId, Number(user.id));
  if (!group) return { status: 404, message: "Group not found." };
  if (!canAccessGroup(group, user.role)) return { status: 403, message: "You are not a member of this group." };
  const hasChannelId = requestedChannelId !== undefined && requestedChannelId !== null && requestedChannelId !== "";
  if (group.groupType !== "community") {
    return hasChannelId
      ? { status: 400, message: "Standard groups do not have channels." }
      : { group, channel: null, channelId: null };
  }
  const channelId = Number(requestedChannelId);
  if (!Number.isSafeInteger(channelId) || channelId < 1) {
    return { status: 400, message: "Choose a community channel." };
  }
  const channel = await getActiveChannel(groupId, channelId);
  if (!channel) return { status: 404, message: "Channel not found." };
  if (!canPostInChannel(group, channel, user.role)) {
    return { status: 403, message: "Only community leaders can post in this channel." };
  }
  return { group, channel, channelId: channel.id };
};

module.exports = {
  getGroupAccess,
  getActiveChannel,
  canAccessGroup,
  canPostInChannel,
  validateGroupMessageTarget,
};
