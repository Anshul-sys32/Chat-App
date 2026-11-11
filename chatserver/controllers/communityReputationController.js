const { pool } = require("../config/db");
const { canAccessGroup, getGroupAccess } = require("../services/groupAccess");
const { badgesForPoints } = require("../services/communityReputation");

const getCommunityReputation = async (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!Number.isSafeInteger(groupId) || groupId < 1) return res.status(400).json({ message: "Invalid community id." });
  try {
    const group = await getGroupAccess(groupId, req.user.id);
    if (!group || !canAccessGroup(group, req.user.role)) return res.status(404).json({ message: "Community not found." });
    if (group.groupType !== "community") return res.status(400).json({ message: "Reputation is only available in communities." });
    const [rows] = await pool.execute(
      `SELECT member.user_id AS userId, member_user.username,
              COALESCE(SUM(event.points), 0) AS points,
              COALESCE(SUM(event.event_type = 'accepted_answer' AND event.points > 0), 0) AS acceptedAnswers,
              COALESCE(SUM(event.event_type = 'post' AND event.points > 0), 0) AS contributions,
              COALESCE(SUM(event.event_type = 'helpful_reaction' AND event.points > 0), 0) AS helpfulPosts
       FROM group_members member
      JOIN users member_user ON member_user.id = member.user_id AND member_user.status = 'active'
       LEFT JOIN community_reputation_events event
         ON event.group_id = member.group_id AND event.user_id = member.user_id
       WHERE member.group_id = ?
      GROUP BY member.user_id, member_user.username
      ORDER BY points DESC, acceptedAnswers DESC, member_user.username ASC LIMIT 50`,
      [groupId]
    );
    const leaderboard = rows.map((row, index) => ({
      ...row,
      points: Number(row.points),
      acceptedAnswers: Number(row.acceptedAnswers),
      contributions: Number(row.contributions),
      helpfulPosts: Number(row.helpfulPosts),
      rank: index + 1,
      badges: badgesForPoints(Number(row.points)),
    }));
    const current = leaderboard.find((entry) => Number(entry.userId) === Number(req.user.id));
    const [history] = await pool.execute(
      `SELECT event_type AS eventType, source_id AS sourceId, points, updated_at AS timestamp
       FROM community_reputation_events
       WHERE group_id = ? AND user_id = ? AND points <> 0
       ORDER BY updated_at DESC LIMIT 30`,
      [groupId, req.user.id]
    );
    return res.json({
      leaderboard,
      me: {
        points: current?.points || 0,
        rank: current?.rank || null,
        badges: current?.badges || [],
      },
      history,
    });
  } catch (error) {
    console.error("Community reputation error:", error);
    return res.status(500).json({ message: "Could not load community reputation." });
  }
};

module.exports = { getCommunityReputation };
