const { randomUUID } = require("node:crypto");
const { pool } = require("../config/db");
const { canManageGroup } = require("../services/groupAccess");
const { authorizeChannel, authorizeSession, SESSION_TYPES } = require("../services/communityCollabSessions");

const sessionRoomForChannel = (groupId, channelId) => `group:${groupId}:channel:${channelId}`;
const toSession = (row) => ({
  ...row,
  creatorId: row.creatorId == null ? null : Number(row.creatorId),
  groupId: Number(row.groupId),
  channelId: Number(row.channelId),
  closedAt: row.closedAt || null,
});
const canManageSession = (session, group, user) => {
  if (session.creatorId != null && Number(session.creatorId) === Number(user.id)) return true;
  const creatorUnavailable = session.creatorId == null
    || session.creatorIsMember === 0
    || session.creatorIsMember === false;
  return creatorUnavailable && canManageGroup(group, "manageChannels", user.role);
};

const listCommunitySessions = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const channelId = Number(req.params.channelId);
  if (!Number.isSafeInteger(groupId) || groupId < 1 || !Number.isSafeInteger(channelId) || channelId < 1) {
    return res.status(400).json({ message: "Choose a valid community channel." });
  }
  try {
    const authorized = await authorizeChannel(groupId, channelId, req.user);
    if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
    const [rows] = await pool.execute(
            `SELECT session.id, session.group_id AS groupId, session.channel_id AS channelId,
              channel.name AS channelName,
              session.creator_id AS creatorId, COALESCE(creator.username, 'Former member') AS creatorName,
              session.session_type AS sessionType, session.name, session.summary,
              session.status, session.created_at AS createdAt,
              session.updated_at AS updatedAt, session.closed_at AS closedAt
       FROM community_collab_sessions session
      LEFT JOIN users creator ON creator.id = session.creator_id
      JOIN group_channels channel ON channel.id = session.channel_id
       WHERE session.group_id = ? AND session.channel_id = ?
       ORDER BY session.created_at ASC, session.id ASC`,
      [groupId, channelId]
    );
    return res.json({ sessions: rows.map(toSession) });
  } catch (error) {
    console.error("List collaborative sessions error:", error);
    return res.status(500).json({ message: "Could not load collaborative sessions." });
  }
};

const createCommunitySession = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const channelId = Number(req.params.channelId);
  const sessionType = req.body?.sessionType;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const summary = typeof req.body?.summary === "string" ? req.body.summary.trim() : "";
  if (!Number.isSafeInteger(groupId) || groupId < 1 || !Number.isSafeInteger(channelId) || channelId < 1) {
    return res.status(400).json({ message: "Choose a valid community channel." });
  }
  if (!SESSION_TYPES.has(sessionType) || !name || name.length > 120 || !summary || summary.length > 500) {
    return res.status(400).json({ message: "Provide a session type, name, and summary within the allowed lengths." });
  }
  try {
    const authorized = await authorizeChannel(groupId, channelId, req.user, { write: true });
    if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
    const id = randomUUID();
    await pool.execute(
      `INSERT INTO community_collab_sessions
       (id, group_id, channel_id, creator_id, session_type, name, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, groupId, channelId, Number(req.user.id), sessionType, name, summary]
    );
    const session = {
      id,
      groupId,
      channelId,
      channelName: authorized.channel.name,
      creatorId: Number(req.user.id),
      creatorName: req.user.username || "Community member",
      sessionType,
      name,
      summary,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      closedAt: null,
    };
    req.app.get("io")?.to(sessionRoomForChannel(groupId, channelId)).emit("community-session-created", session);
    return res.status(201).json({ session });
  } catch (error) {
    console.error("Create collaborative session error:", error);
    return res.status(500).json({ message: "Could not create this session." });
  }
};

const getCommunitySession = async (req, res) => {
  try {
    const authorized = await authorizeSession(req.params.sessionId, req.user);
    if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
    return res.json({ session: authorized.session });
  } catch (error) {
    console.error("Get collaborative session error:", error);
    return res.status(500).json({ message: "Could not load this session." });
  }
};

const updateCommunitySession = async (req, res) => {
  const name = req.body?.name;
  const summary = req.body?.summary;
  if (name !== undefined && (typeof name !== "string" || !name.trim() || name.trim().length > 120)) {
    return res.status(400).json({ message: "Session names must be 1 to 120 characters." });
  }
  if (summary !== undefined && (typeof summary !== "string" || !summary.trim() || summary.trim().length > 500)) {
    return res.status(400).json({ message: "Session summaries must be 1 to 500 characters." });
  }
  if (name === undefined && summary === undefined) return res.status(400).json({ message: "Provide session metadata to update." });
  try {
    const authorized = await authorizeSession(req.params.sessionId, req.user, { write: true });
    if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
    if (!canManageSession(authorized.session, authorized.group, req.user)) {
      return res.status(403).json({ message: "Only the session creator can update its details." });
    }
    await pool.execute(
      "UPDATE community_collab_sessions SET name = COALESCE(?, name), summary = COALESCE(?, summary) WHERE id = ? AND status = 'active'",
      [name === undefined ? null : name.trim(), summary === undefined ? null : summary.trim(), authorized.session.id]
    );
    const [rows] = await pool.execute(
            `SELECT session.id, session.group_id AS groupId, session.channel_id AS channelId,
              channel.name AS channelName,
              session.creator_id AS creatorId, COALESCE(creator.username, 'Former member') AS creatorName,
              session.session_type AS sessionType, session.name, session.summary,
              session.status, session.created_at AS createdAt,
              session.updated_at AS updatedAt, session.closed_at AS closedAt
      FROM community_collab_sessions session LEFT JOIN users creator ON creator.id = session.creator_id
      JOIN group_channels channel ON channel.id = session.channel_id
       WHERE session.id = ? LIMIT 1`,
      [authorized.session.id]
    );
    const session = toSession(rows[0]);
    req.app.get("io")?.to(sessionRoomForChannel(session.groupId, session.channelId)).emit("community-session-updated", session);
    return res.json({ session });
  } catch (error) {
    console.error("Update collaborative session error:", error);
    return res.status(500).json({ message: "Could not update this session." });
  }
};

const closeCommunitySession = async (req, res) => {
  try {
    const authorized = await authorizeSession(req.params.sessionId, req.user);
    if (authorized.status) return res.status(authorized.status).json({ message: authorized.message });
    if (!canManageSession(authorized.session, authorized.group, req.user)) {
      return res.status(403).json({ message: "Only the user who started this session can close it." });
    }
    let newlyClosed = false;
    if (authorized.session.status === "active") {
      const [result] = await pool.execute(
        "UPDATE community_collab_sessions SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'",
        [authorized.session.id]
      );
      newlyClosed = Number(result.affectedRows) > 0;
    }
    const [rows] = await pool.execute(
            `SELECT session.id, session.group_id AS groupId, session.channel_id AS channelId,
              channel.name AS channelName,
              session.creator_id AS creatorId, COALESCE(creator.username, 'Former member') AS creatorName,
              session.session_type AS sessionType, session.name, session.summary,
              session.status, session.created_at AS createdAt,
              session.updated_at AS updatedAt, session.closed_at AS closedAt
      FROM community_collab_sessions session LEFT JOIN users creator ON creator.id = session.creator_id
      JOIN group_channels channel ON channel.id = session.channel_id
       WHERE session.id = ? LIMIT 1`,
      [authorized.session.id]
    );
    const session = toSession(rows[0]);
    const io = req.app.get("io");
    if (newlyClosed) {
      io?.to(sessionRoomForChannel(session.groupId, session.channelId)).emit("community-session-closed", session);
      io?.to(`collab-session:${session.id}`).emit("collab-session-closed", session);
    }
    io?.in(`collab-session:${session.id}`).socketsLeave(`collab-session:${session.id}`);
    return res.json({ session });
  } catch (error) {
    console.error("Close collaborative session error:", error);
    return res.status(500).json({ message: "Could not close this session." });
  }
};

module.exports = {
  closeCommunitySession,
  createCommunitySession,
  getCommunitySession,
  listCommunitySessions,
  updateCommunitySession,
};
