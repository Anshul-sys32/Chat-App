const { pool } = require("../config/db");

const SEARCH_FILTERS = new Set(["all", "messages", "files", "links", "people", "direct", "group"]);
const isValidDate = (value) => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const normalizeSearchRequest = (query = {}) => {
  const text = typeof query.q === "string" ? query.q.trim() : "";
  const filter = typeof query.filter === "string" ? query.filter : "all";
  const from = query.from || null;
  const to = query.to || null;
  if (text.length < 2 || text.length > 120 || !SEARCH_FILTERS.has(filter)) {
    return { error: "Enter 2 to 120 search characters and choose a supported filter." };
  }
  if (from && !isValidDate(from) || to && !isValidDate(to) || from && to && from > to) {
    return { error: "Choose a valid date range." };
  }
  return { text, filter, from, to };
};

const messageMatch = (filter, contentColumn, attachmentColumn, pattern) => {
  if (filter === "files") return { sql: `CAST(COALESCE(${attachmentColumn}, JSON_ARRAY()) AS CHAR) LIKE ?`, values: [pattern] };
  if (filter === "links") return { sql: `${contentColumn} LIKE ? AND ${contentColumn} REGEXP 'https?://'`, values: [pattern] };
  if (filter === "all") {
    return {
      sql: `(${contentColumn} LIKE ? OR CAST(COALESCE(${attachmentColumn}, JSON_ARRAY()) AS CHAR) LIKE ?)`,
      values: [pattern, pattern],
    };
  }
  return { sql: `${contentColumn} LIKE ?`, values: [pattern] };
};

const searchMessages = async (req, res) => {
  const normalized = normalizeSearchRequest(req.query);
  if (normalized.error) return res.status(400).json({ message: normalized.error });
  const { text, filter, from, to } = normalized;
  const pattern = `%${text}%`;
  try {
    if (filter === "people") {
      const [people] = await pool.execute(
        `SELECT id AS _id, username, profile_picture AS profilePicture, google_picture AS googlePicture
         FROM users WHERE status = 'active' AND id <> ? AND username LIKE ?
         ORDER BY username LIMIT 50`,
        [req.user.id, pattern]
      );
      return res.json({ results: people.map((person) => ({ ...person, resultType: "person" })) });
    }

    const sourceFilter = filter === "direct" || filter === "group" ? filter : "all";
    const effectiveFilter = sourceFilter === "all" ? filter : "all";
    const dateClauses = [];
    const dateValues = [];
    if (from) {
      dateClauses.push("DATE(message.created_at) >= ?");
      dateValues.push(from);
    }
    if (to) {
      dateClauses.push("DATE(message.created_at) <= ?");
      dateValues.push(to);
    }
    const dates = dateClauses.length ? ` AND ${dateClauses.join(" AND ")}` : "";
    const directMatch = messageMatch(effectiveFilter, "message.content", "message.attachments", pattern);
    const groupMatch = messageMatch(effectiveFilter, "message.content", "message.attachments", pattern);
    const results = [];

    if (sourceFilter !== "group") {
      const [directMessages] = await pool.execute(
        `SELECT message.id AS _id, 'direct' AS messageType,
                CASE WHEN message.sender_id = ? THEN message.receiver_id ELSE message.sender_id END AS conversationId,
                conversation_user.username AS conversationName, message.sender_id AS sender,
                sender.username AS senderName, message.content, message.attachments,
                message.created_at AS timestamp
         FROM messages message
         JOIN users sender ON sender.id = message.sender_id
         JOIN users conversation_user ON conversation_user.id = CASE
           WHEN message.sender_id = ? THEN message.receiver_id ELSE message.sender_id END
         WHERE message.is_deleted = FALSE AND (message.sender_id = ? OR message.receiver_id = ?)
           AND NOT EXISTS (SELECT 1 FROM direct_message_hidden_for hidden
                           WHERE hidden.message_id = message.id AND hidden.user_id = ?)
           AND ${directMatch.sql}${dates}
         ORDER BY message.created_at DESC, message.id DESC LIMIT 50`,
        [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, ...directMatch.values, ...dateValues]
      );
      results.push(...directMessages.map((message) => ({ ...message, resultType: "message" })));
    }

    if (sourceFilter !== "direct") {
      const [groupMessages] = await pool.execute(
        `SELECT message.id AS _id, 'group' AS messageType,
                group_record.id AS groupId, group_record.name AS groupName,
                group_record.group_type AS groupType, message.channel_id AS channelId,
                channel.name AS channelName, message.sender_id AS sender, message.bot_id AS botId,
                COALESCE(integration.name, bot.name, sender.username) AS senderName, message.content, message.attachments,
                message.message_type AS postType, message.created_at AS timestamp
         FROM group_messages message
         JOIN group_members membership ON membership.group_id = message.group_id AND membership.user_id = ?
         JOIN chat_groups group_record ON group_record.id = message.group_id AND group_record.is_active = TRUE
         JOIN users sender ON sender.id = message.sender_id
         LEFT JOIN community_bots bot ON bot.id = message.bot_id
         LEFT JOIN community_integrations integration ON integration.id = message.integration_id
         LEFT JOIN group_channels channel ON channel.id = message.channel_id
         WHERE message.is_deleted = FALSE
           AND NOT EXISTS (SELECT 1 FROM group_message_hidden_for hidden
                           WHERE hidden.message_id = message.id AND hidden.user_id = ?)
           AND (group_record.group_type <> 'community'
                OR channel.id IS NOT NULL AND channel.is_archived = FALSE)
           AND ${groupMatch.sql}${dates}
         ORDER BY message.created_at DESC, message.id DESC LIMIT 50`,
        [req.user.id, req.user.id, ...groupMatch.values, ...dateValues]
      );
      results.push(...groupMessages.map((message) => ({ ...message, resultType: "message" })));
    }

    results.sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
    return res.json({ results: results.slice(0, 50) });
  } catch (error) {
    console.error("Global message search error:", error);
    return res.status(500).json({ message: "Could not search messages." });
  }
};

module.exports = { normalizeSearchRequest, searchMessages };
