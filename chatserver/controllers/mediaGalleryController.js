const path = require("node:path");
const { pool } = require("../config/db");
const { uploadDirectory } = require("../utils/uploads");

const uploadFilenamePattern = /^\d+-[a-f0-9-]{36}\.(jpg|png|gif|webp|avif|mp4|webm|mov|mp3|ogg|wav|m4a|pdf)$/i;
const voiceFilenamePattern = /^\d+-voice-[a-f0-9-]{36}\.(webm|ogg|m4a|mp3|wav)$/i;
const mediaTypes = new Set(["image", "video", "audio", "document", "file", "link"]);
const mediaTypeSql = `CASE
  WHEN gallery_attachment.mimeType LIKE 'image/%' THEN 'image'
  WHEN gallery_attachment.mimeType LIKE 'video/%' THEN 'video'
  WHEN gallery_attachment.mimeType LIKE 'audio/%' THEN 'audio'
  WHEN gallery_attachment.mimeType = 'application/pdf' THEN 'document'
  ELSE 'file'
END`;

const dateValue = (value, endOfDay = false) => {
  const date = new Date(value);
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) date.setUTCHours(23, 59, 59, 999);
  return date;
};

const isSupportedMediaUrl = (url) => {
  if (typeof url !== "string") return false;
  if (url.startsWith("/uploads/")) return uploadFilenamePattern.test(url.slice("/uploads/".length));
  if (url.startsWith("/api/voice-media/")) return voiceFilenamePattern.test(url.slice("/api/voice-media/".length));
  return false;
};

const normalizeGalleryFilters = (query = {}) => {
  const search = typeof query.search === "string" ? query.search.trim() : "";
  const mediaType = query.mediaType || "all";
  const sort = query.sort || "newest";
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? 24 : Number(query.pageSize);
  const senderId = query.senderId === undefined || query.senderId === "" ? null : Number(query.senderId);
  const sender = typeof query.sender === "string" ? query.sender.trim() : "";
  const conversationType = query.conversationType || null;
  const conversationId = query.conversationId === undefined || query.conversationId === ""
    ? null
    : Number(query.conversationId);
  const channelId = query.channelId === undefined || query.channelId === "" ? null : Number(query.channelId);
  const from = query.from || null;
  const to = query.to || null;

  if (query.search !== undefined && typeof query.search !== "string"
    || search.length > 100 || !["all", ...mediaTypes].includes(mediaType)
    || !["newest", "oldest"].includes(sort)
    || !Number.isSafeInteger(page) || page < 1 || page > 100
    || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50
    || senderId !== null && (!Number.isSafeInteger(senderId) || senderId < 1)
    || query.sender !== undefined && typeof query.sender !== "string"
    || sender.length > 80
    || conversationType !== null && !["direct", "group"].includes(conversationType)
    || (conversationType === null) !== (conversationId === null)
    || conversationId !== null && (!Number.isSafeInteger(conversationId) || conversationId < 1)
    || channelId !== null && (!Number.isSafeInteger(channelId) || channelId < 1)
    || channelId !== null && conversationType !== "group"
    || from !== null && (!Number.isFinite(Date.parse(from)) || String(from).length > 40)
    || to !== null && (!Number.isFinite(Date.parse(to)) || String(to).length > 40)
    || from !== null && to !== null && Date.parse(from) > Date.parse(to)) {
    return null;
  }

  return { search, mediaType, sort, page, pageSize, senderId, sender, conversationType, conversationId, channelId, from, to };
};

const buildGalleryQuery = (source, filters, userId, rowLimit) => {
  const direct = source === "direct";
  const table = direct ? "messages" : "group_messages";
  const messageAlias = "message";
  const createdColumn = `${messageAlias}.created_at`;
  const messageIdColumn = `${messageAlias}.id`;
  const where = [
    `${messageAlias}.is_deleted = FALSE`,
    "JSON_LENGTH(message.attachments) > 0",
    direct
      ? "(message.sender_id = ? OR message.receiver_id = ?)"
      : "(membership.user_id IS NOT NULL AND group_record.is_active = TRUE)",
    direct
      ? "NOT EXISTS (SELECT 1 FROM direct_message_hidden_for hidden WHERE hidden.message_id = message.id AND hidden.user_id = ?)"
      : "NOT EXISTS (SELECT 1 FROM group_message_hidden_for hidden WHERE hidden.message_id = message.id AND hidden.user_id = ?)",
  ];
  const values = direct ? [userId, userId, userId] : [userId, userId];

  if (!direct) {
    where.push("(group_record.group_type <> 'community' OR channel.id IS NOT NULL AND channel.is_archived = FALSE)");
  }
  if (filters.conversationType) {
    if (direct && filters.conversationType !== "direct" || !direct && filters.conversationType !== "group") {
      where.push("1 = 0");
    } else if (direct) {
      where.push("((message.sender_id = ? AND message.receiver_id = ?) OR (message.sender_id = ? AND message.receiver_id = ?))");
      values.push(userId, filters.conversationId, filters.conversationId, userId);
    } else {
      where.push("message.group_id = ?");
      values.push(filters.conversationId);
      if (filters.channelId !== null) {
        where.push("message.channel_id = ?");
        values.push(filters.channelId);
      }
    }
  }
  if (filters.senderId !== null) {
    where.push("message.sender_id = ?");
    values.push(filters.senderId);
  }
  if (filters.sender) {
    where.push("sender.username LIKE ? ESCAPE '!'");
    values.push(`%${filters.sender.replace(/[!%_]/g, "!$&")}%`);
  }
  if (filters.from) {
    where.push(`${createdColumn} >= ?`);
    values.push(dateValue(filters.from));
  }
  if (filters.to) {
    where.push(`${createdColumn} <= ?`);
    values.push(dateValue(filters.to, true));
  }
  if (filters.search) {
    where.push("(gallery_attachment.name LIKE ? ESCAPE '!' OR message.content LIKE ? ESCAPE '!')");
    const term = `%${filters.search.replace(/[!%_]/g, "!$&")}%`;
    values.push(term, term);
  }
  if (filters.mediaType !== "all") {
    where.push(`${mediaTypeSql} = ?`);
    values.push(filters.mediaType);
  }

  const joins = direct
    ? `JOIN users sender ON sender.id = message.sender_id
       JOIN users peer ON peer.id = CASE WHEN message.sender_id = ? THEN message.receiver_id ELSE message.sender_id END
       CROSS JOIN JSON_TABLE(message.attachments, '$[*]' COLUMNS (
         url VARCHAR(2048) PATH '$.url', name VARCHAR(255) PATH '$.name',
         mimeType VARCHAR(255) PATH '$.mimeType', size BIGINT PATH '$.size' NULL ON ERROR,
         duration INT PATH '$.duration' NULL ON ERROR
       )) gallery_attachment`
    : `JOIN users sender ON sender.id = message.sender_id
       JOIN group_members membership ON membership.group_id = message.group_id AND membership.user_id = ?
       JOIN chat_groups group_record ON group_record.id = message.group_id
       LEFT JOIN group_channels channel ON channel.id = message.channel_id
       CROSS JOIN JSON_TABLE(message.attachments, '$[*]' COLUMNS (
         url VARCHAR(2048) PATH '$.url', name VARCHAR(255) PATH '$.name',
         mimeType VARCHAR(255) PATH '$.mimeType', size BIGINT PATH '$.size' NULL ON ERROR,
         duration INT PATH '$.duration' NULL ON ERROR
       )) gallery_attachment`;
  const conversationFields = direct
    ? `CASE WHEN message.sender_id = ? THEN message.receiver_id ELSE message.sender_id END AS conversationId,
       peer.username AS conversationName, NULL AS groupId, NULL AS groupName, NULL AS channelId, NULL AS channelName`
    : `group_record.id AS conversationId, group_record.name AS conversationName,
      group_record.id AS groupId, group_record.name AS groupName, group_record.group_type AS groupType,
      message.channel_id AS channelId, channel.name AS channelName`;
  const direction = filters.sort === "oldest" ? "ASC" : "DESC";
  const queryValues = direct ? [userId, userId, ...values] : [userId, ...values];
  queryValues.push(rowLimit);

  return {
    sql: `SELECT '${direct ? "direct" : "group"}' AS messageType, message.id AS messageId,
       ${messageIdColumn} AS _id, ${createdColumn} AS timestamp, message.sender_id AS sender,
       sender.username AS senderName, message.content AS messageContent,
       ${conversationFields}, gallery_attachment.url, gallery_attachment.name,
       gallery_attachment.mimeType, gallery_attachment.size, gallery_attachment.duration,
       ${mediaTypeSql} AS mediaType
       FROM ${table} message ${joins}
       WHERE ${where.join(" AND ")}
       ORDER BY ${createdColumn} ${direction}, ${messageIdColumn} ${direction}, gallery_attachment.name
       LIMIT ?`,
    values: queryValues,
  };
};

const buildLinkQuery = (source, filters, userId, rowLimit) => {
  const direct = source === "direct";
  const values = direct ? [userId, userId, userId] : [userId, userId];
  const where = [
    "message.is_deleted = FALSE",
    "message.content REGEXP 'https?://'",
    direct
      ? "(message.sender_id = ? OR message.receiver_id = ?)"
      : "membership.user_id IS NOT NULL AND group_record.is_active = TRUE",
    direct
      ? "NOT EXISTS (SELECT 1 FROM direct_message_hidden_for hidden WHERE hidden.message_id = message.id AND hidden.user_id = ?)"
      : "NOT EXISTS (SELECT 1 FROM group_message_hidden_for hidden WHERE hidden.message_id = message.id AND hidden.user_id = ?)",
  ];
  if (!direct) where.push("(group_record.group_type <> 'community' OR channel.id IS NOT NULL AND channel.is_archived = FALSE)");
  if (filters.conversationType) {
    if (direct && filters.conversationType !== "direct" || !direct && filters.conversationType !== "group") {
      where.push("1 = 0");
    } else if (direct) {
      where.push("((message.sender_id = ? AND message.receiver_id = ?) OR (message.sender_id = ? AND message.receiver_id = ?))");
      values.push(userId, filters.conversationId, filters.conversationId, userId);
    } else {
      where.push("message.group_id = ?");
      values.push(filters.conversationId);
      if (filters.channelId !== null) {
        where.push("message.channel_id = ?");
        values.push(filters.channelId);
      }
    }
  }
  if (filters.senderId !== null) {
    where.push("message.sender_id = ?");
    values.push(filters.senderId);
  }
  if (filters.sender) {
    where.push("sender.username LIKE ? ESCAPE '!'");
    values.push(`%${filters.sender.replace(/[!%_]/g, "!$&")}%`);
  }
  if (filters.from) {
    where.push("message.created_at >= ?");
    values.push(dateValue(filters.from));
  }
  if (filters.to) {
    where.push("message.created_at <= ?");
    values.push(dateValue(filters.to, true));
  }
  if (filters.search) {
    where.push("message.content LIKE ? ESCAPE '!'");
    values.push(`%${filters.search.replace(/[!%_]/g, "!$&")}%`);
  }

  const conversationFields = direct
    ? `CASE WHEN message.sender_id = ? THEN message.receiver_id ELSE message.sender_id END AS conversationId,
       peer.username AS conversationName, NULL AS groupId, NULL AS groupName, NULL AS groupType, NULL AS channelId, NULL AS channelName`
    : `group_record.id AS conversationId, group_record.name AS conversationName,
       group_record.id AS groupId, group_record.name AS groupName, group_record.group_type AS groupType,
       message.channel_id AS channelId, channel.name AS channelName`;
  const joins = direct
    ? `JOIN users sender ON sender.id = message.sender_id
       JOIN users peer ON peer.id = CASE WHEN message.sender_id = ? THEN message.receiver_id ELSE message.sender_id END`
    : `JOIN users sender ON sender.id = message.sender_id
       JOIN group_members membership ON membership.group_id = message.group_id AND membership.user_id = ?
       JOIN chat_groups group_record ON group_record.id = message.group_id
       LEFT JOIN group_channels channel ON channel.id = message.channel_id`;
  const direction = filters.sort === "oldest" ? "ASC" : "DESC";
  const queryValues = direct ? [userId, userId, ...values] : [userId, ...values];
  queryValues.push(rowLimit);
  return {
    sql: `SELECT '${direct ? "direct" : "group"}' AS messageType, message.id AS messageId,
       message.id AS _id, message.created_at AS timestamp, message.sender_id AS sender,
       sender.username AS senderName, message.content AS messageContent,
       ${conversationFields}, REGEXP_SUBSTR(message.content, 'https?://[^[:space:]<>]+') AS url,
       'Link' AS name, 'text/uri-list' AS mimeType, NULL AS size, NULL AS duration, 'link' AS mediaType
       FROM ${direct ? "messages" : "group_messages"} message ${joins}
       WHERE ${where.join(" AND ")}
       ORDER BY message.created_at ${direction}, message.id ${direction}
       LIMIT ?`,
    values: queryValues,
  };
};

const listMediaGallery = async (req, res) => {
  const filters = normalizeGalleryFilters(req.query);
  if (!filters) return res.status(400).json({ message: "Invalid media gallery filters." });
  try {
    const offsetLimit = filters.page * filters.pageSize;
    const sources = filters.conversationType === "direct"
      ? ["direct"]
      : filters.conversationType === "group"
        ? ["group"]
        : ["direct", "group"];
    const includeAttachments = filters.mediaType !== "link";
    const includeLinks = filters.mediaType === "link" || filters.mediaType === "all";
    const queries = sources.flatMap((source) => [
      ...(includeAttachments ? [buildGalleryQuery(source, filters, req.user.id, offsetLimit)] : []),
      ...(includeLinks ? [buildLinkQuery(source, filters, req.user.id, offsetLimit)] : []),
    ]);
    const rowsBySource = await Promise.all(queries.map(async ({ sql, values }) => {
      const [rows] = await pool.execute(sql, values);
      return rows;
    }));
    const items = rowsBySource.flat()
      .filter((item) => item.mediaType === "link" || isSupportedMediaUrl(item.url))
      .sort((left, right) => {
        const timeOrder = new Date(right.timestamp) - new Date(left.timestamp);
        if (timeOrder) return filters.sort === "oldest" ? -timeOrder : timeOrder;
        return filters.sort === "oldest" ? Number(left.messageId) - Number(right.messageId) : Number(right.messageId) - Number(left.messageId);
      })
      .slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize);
    res.set("Cache-Control", "private, no-store");
    return res.json({ items, page: filters.page, pageSize: filters.pageSize, hasMore: filters.page < 100 && rowsBySource.some((rows) => rows.length === offsetLimit) });
  } catch (error) {
    console.error("List media gallery error:", error);
    return res.status(500).json({ message: "Could not load media gallery." });
  }
};

const findAccessibleUpload = async (user, mediaUrl) => {
  const [[direct]] = await pool.execute(
    `SELECT 1 FROM messages message
     WHERE message.is_deleted = FALSE AND JSON_SEARCH(message.attachments, 'one', ?) IS NOT NULL
       AND (message.sender_id = ? OR message.receiver_id = ?)
       AND NOT EXISTS (SELECT 1 FROM direct_message_hidden_for hidden
                       WHERE hidden.message_id = message.id AND hidden.user_id = ?) LIMIT 1`,
    [mediaUrl, user.id, user.id, user.id]
  );
  if (direct) return true;
  const [[group]] = await pool.execute(
    `SELECT 1 FROM group_messages message
     JOIN group_members membership ON membership.group_id = message.group_id AND membership.user_id = ?
     JOIN chat_groups group_record ON group_record.id = message.group_id AND group_record.is_active = TRUE
     LEFT JOIN group_channels channel ON channel.id = message.channel_id
     WHERE message.is_deleted = FALSE AND JSON_SEARCH(message.attachments, 'one', ?) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM group_message_hidden_for hidden
                       WHERE hidden.message_id = message.id AND hidden.user_id = ?)
       AND (group_record.group_type <> 'community' OR channel.id IS NOT NULL AND channel.is_archived = FALSE)
     LIMIT 1`,
    [user.id, mediaUrl, user.id]
  );
  return Boolean(group);
};

const deliverUpload = async (req, res) => {
  const filename = path.basename(req.params.filename || "");
  if (filename !== req.params.filename || !uploadFilenamePattern.test(filename)) {
    return res.status(404).json({ message: "Media not found." });
  }
  const mediaUrl = `/uploads/${filename}`;
  try {
    if (!await findAccessibleUpload(req.user, mediaUrl)) {
      return res.status(404).json({ message: "Media not found." });
    }
    const [attachmentRows] = await pool.execute(
      `SELECT JSON_UNQUOTE(JSON_EXTRACT(attachment.value, '$.mimeType')) AS mimeType
       FROM messages message
       CROSS JOIN JSON_TABLE(message.attachments, '$[*]' COLUMNS (value JSON PATH '$')) attachment
       WHERE message.is_deleted = FALSE AND JSON_UNQUOTE(JSON_EXTRACT(attachment.value, '$.url')) = ?
       UNION ALL
       SELECT JSON_UNQUOTE(JSON_EXTRACT(attachment.value, '$.mimeType')) AS mimeType
       FROM group_messages message
       CROSS JOIN JSON_TABLE(message.attachments, '$[*]' COLUMNS (value JSON PATH '$')) attachment
       WHERE message.is_deleted = FALSE AND JSON_UNQUOTE(JSON_EXTRACT(attachment.value, '$.url')) = ?
       LIMIT 1`,
      [mediaUrl, mediaUrl]
    );
    const mimeType = attachmentRows[0]?.mimeType;
    if (!mimeType) return res.status(404).json({ message: "Media not found." });
    res.set({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Type": mimeType,
    });
    if (req.query.download === "1") {
      res.set("Content-Disposition", `attachment; filename="${filename}"`);
    }
    return res.sendFile(path.join(uploadDirectory, filename), (error) => {
      if (error && !res.headersSent) res.status(error.statusCode || 404).end();
    });
  } catch (error) {
    console.error("Deliver protected upload error:", error);
    return res.status(500).json({ message: "Could not load media." });
  }
};

module.exports = { listMediaGallery, deliverUpload, normalizeGalleryFilters, buildGalleryQuery, buildLinkQuery, findAccessibleUpload, isSupportedMediaUrl, uploadFilenamePattern };