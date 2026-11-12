const { pool } = require("../config/db");
const { canAccessGroup, canPostInChannel, getActiveChannel, getGroupAccess } = require("./groupAccess");

const SESSION_TYPES = new Set(["code_room", "whiteboard"]);
const SESSION_ID_PATTERN = /^[a-f\d]{8}-([a-f\d]{4}-){3}[a-f\d]{12}$/i;
const sessionRoom = (sessionId) => `collab-session:${sessionId}`;

const getSession = async (sessionId) => {
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) return null;
  const [rows] = await pool.execute(
        `SELECT session.id, session.group_id AS groupId, session.channel_id AS channelId,
          channel.name AS channelName,
            session.creator_id AS creatorId, creator.username AS creatorName,
            session.session_type AS sessionType, session.name, session.summary,
            session.status, session.created_at AS createdAt,
            session.updated_at AS updatedAt, session.closed_at AS closedAt
     FROM community_collab_sessions session
    JOIN users creator ON creator.id = session.creator_id
    JOIN group_channels channel ON channel.id = session.channel_id
     WHERE session.id = ? LIMIT 1`,
    [sessionId]
  );
  return rows[0] || null;
};

const authorizeSession = async (sessionId, user, { write = false } = {}) => {
  const session = await getSession(sessionId);
  if (!session) return { status: 404, message: "Session not found." };
  const group = await getGroupAccess(session.groupId, Number(user.id));
  if (!group || !canAccessGroup(group, user.role) || group.groupType !== "community") {
    return { status: 404, message: "Session not found." };
  }
  const channel = await getActiveChannel(session.groupId, session.channelId);
  if (!channel || channel.channelType !== "text") return { status: 404, message: "Session channel is unavailable." };
  if (write) {
    if (session.status !== "active") return { status: 410, message: "This session is closed and read-only." };
    if (!await canPostInChannel(group, channel, user.role)) {
      return { status: 403, message: "You do not have permission to collaborate in this channel." };
    }
  }
  return { session, group, channel };
};

const authorizeChannel = async (groupId, channelId, user, { write = false } = {}) => {
  const group = await getGroupAccess(groupId, Number(user.id));
  if (!group || !canAccessGroup(group, user.role)) return { status: 404, message: "Community not found." };
  if (group.groupType !== "community") return { status: 400, message: "Collaborative sessions are only available in communities." };
  const channel = await getActiveChannel(groupId, channelId);
  if (!channel || channel.channelType !== "text") return { status: 404, message: "Text channel not found." };
  if (write && !await canPostInChannel(group, channel, user.role)) {
    return { status: 403, message: "You do not have permission to start or join sessions in this channel." };
  }
  return { group, channel };
};

module.exports = { SESSION_ID_PATTERN, SESSION_TYPES, authorizeChannel, authorizeSession, getSession, sessionRoom };
