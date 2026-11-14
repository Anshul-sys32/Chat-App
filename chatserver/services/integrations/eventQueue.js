const { pool } = require("../../config/db");
const { providers } = require("./providers");
const { canAccessGroup, canPostInChannel, getActiveChannel, getGroupAccess } = require("../groupAccess");

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 10;
const MAX_BACKOFF_SECONDS = 3600;

const enqueueIntegrationEvent = async (integrationId, eventKey, eventType, payload) => {
  const [result] = await pool.execute(
    `INSERT IGNORE INTO community_integration_events (integration_id, event_key, event_type, payload)
     VALUES (?, ?, ?, ?)`,
    [integrationId, eventKey, eventType.slice(0, 80), JSON.stringify(payload)]
  );
  if (result.affectedRows) {
    await pool.execute(
      "INSERT INTO community_integration_logs (integration_id, event_id, action, status, message) VALUES (?, ?, 'event', 'queued', 'Event accepted for processing')",
      [integrationId, result.insertId]
    );
  }
  return { accepted: Boolean(result.affectedRows), eventId: result.insertId || null };
};

const parseJson = (value) => {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value || "{}"); } catch { return {}; }
};

const deliverIntegrationMessage = async (event, integration, normalized, io) => {
  const title = String(normalized.title || "Integration event").slice(0, 180);
  const body = String(normalized.body || "").slice(0, 1000);
  const url = typeof normalized.url === "string" && /^https?:\/\//i.test(normalized.url) ? normalized.url : null;
  const content = `${title}${body ? `\n${body}` : ""}${url ? `\n${url}` : ""}`.slice(0, 4000);
  const connection = await pool.getConnection();
  let committed = false;
  let deliveredMessage;
  try {
    await connection.beginTransaction();
    const [access] = await connection.execute(
      `SELECT integration.id, integration.group_id AS groupId, integration.channel_id AS channelId,
              integration.created_by AS createdBy, integration.enabled, channel.is_archived AS channelArchived,
              channel.channel_type AS channelType, group_record.is_active AS groupActive,
              group_record.group_type AS groupType, creator.role AS groupRole,
              creator_role.permissions AS rolePermissions, creator_user.role AS creatorPlatformRole
       FROM community_integrations integration
       JOIN chat_groups group_record ON group_record.id = integration.group_id
       JOIN group_channels channel ON channel.id = integration.channel_id
            JOIN users creator_user ON creator_user.id = integration.created_by AND creator_user.status = 'active'
            LEFT JOIN group_members creator ON creator.group_id = integration.group_id AND creator.user_id = integration.created_by
            LEFT JOIN group_roles creator_role ON creator_role.group_id = integration.group_id AND creator_role.role_key = creator.role
       WHERE integration.id = ? FOR UPDATE`,
      [integration.id]
    );
    const target = access[0];
    if (!target || !target.enabled || !target.groupActive || target.channelArchived || target.channelType !== "text"
      || target.groupType !== "community" || !target.groupRole && target.creatorPlatformRole !== "admin"
      || target.creatorPlatformRole !== "admin" && String(target.groupRole) !== "admin"
        && !parseJson(target.rolePermissions).manageIntegrations) {
      throw new Error("Integration or destination channel is no longer active.");
    }
    const group = await getGroupAccess(target.groupId, integration.createdBy);
    const channel = await getActiveChannel(target.groupId, target.channelId);
    if (!canAccessGroup(group, target.creatorPlatformRole)
      || !await canPostInChannel(group, channel, target.creatorPlatformRole)) {
      throw new Error("Integration creator no longer has permission to post in this channel.");
    }
    const [insert] = await connection.execute(
      `INSERT INTO group_messages (group_id, channel_id, sender_id, integration_id, content, attachments, message_type)
       VALUES (?, ?, ?, ?, ?, JSON_ARRAY(), 'integration')`,
      [target.groupId, target.channelId, target.createdBy, integration.id, content]
    );
    await connection.execute(
      `UPDATE community_integration_events SET status = 'succeeded', completed_at = CURRENT_TIMESTAMP,
              locked_at = NULL, last_error = NULL WHERE id = ?`,
      [event.id]
    );
    await connection.execute(
      "INSERT INTO community_integration_logs (integration_id, event_id, action, status, message) VALUES (?, ?, 'deliver', 'succeeded', 'Message posted to configured channel')",
      [integration.id, event.id]
    );
    const [rows] = await connection.execute(
      `SELECT message.id AS _id, message.group_id AS groupId, message.channel_id AS channelId,
              message.sender_id AS sender, message.integration_id AS integrationId,
              COALESCE(integration.name, author.username) AS senderName, message.content,
              message.attachments, message.message_type AS messageType, message.created_at AS timestamp,
              channel.name AS channelName
       FROM group_messages message JOIN users author ON author.id = message.sender_id
       LEFT JOIN community_integrations integration ON integration.id = message.integration_id
       LEFT JOIN group_channels channel ON channel.id = message.channel_id
       WHERE message.id = ? LIMIT 1`,
      [insert.insertId]
    );
    deliveredMessage = rows[0];
    await connection.commit();
    committed = true;
    io?.to(`group:${target.groupId}:channel:${target.channelId}`).emit("group-message", deliveredMessage);
    return deliveredMessage;
  } catch (error) {
    if (committed) {
      console.error("Integration message broadcast failed after commit:", error.message);
      return deliveredMessage;
    }
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const claimEvents = async () => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE community_integration_events SET status = 'queued', locked_at = NULL
       WHERE status = 'processing' AND locked_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE)`
    );
    const [events] = await connection.execute(
      `SELECT event.id, event.integration_id AS integrationId, event.event_type AS eventType,
              event.payload, integration.provider, integration.config, integration.enabled,
              integration.group_id AS groupId, integration.channel_id AS channelId,
              integration.created_by AS createdBy
       FROM community_integration_events event
       JOIN community_integrations integration ON integration.id = event.integration_id
       WHERE event.status = 'queued' AND event.available_at <= CURRENT_TIMESTAMP AND integration.enabled = TRUE
       ORDER BY event.id LIMIT ${BATCH_SIZE} FOR UPDATE SKIP LOCKED`
    );
    if (events.length) {
      const ids = events.map((event) => event.id);
      await connection.query(
        `UPDATE community_integration_events SET status = 'processing', locked_at = CURRENT_TIMESTAMP,
                attempts = attempts + 1 WHERE id IN (${ids.map(() => "?").join(",")})`,
        ids
      );
    }
    await connection.commit();
    return events;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const processIntegrationEvents = async (io) => {
  const events = await claimEvents();
  for (const event of events) {
    const integration = { ...event, config: parseJson(event.config) };
    try {
      const provider = providers.get(event.provider);
      const payload = parseJson(event.payload);
      const normalized = provider?.normalize(event.eventType, payload);
      if (!normalized) throw new Error("Unsupported or invalid provider event.");
      await deliverIntegrationMessage(event, integration, normalized, io);
    } catch (error) {
      const attempts = Number(event.attempts) + 1;
      const terminal = attempts >= MAX_ATTEMPTS;
      const delaySeconds = Math.min(MAX_BACKOFF_SECONDS, 2 ** attempts * 15);
      await pool.execute(
        `UPDATE community_integration_events
         SET status = ?, available_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND),
             locked_at = NULL, last_error = ? WHERE id = ?`,
        [terminal ? "failed" : "queued", delaySeconds, String(error.message || "Integration delivery failed").slice(0, 500), event.id]
      );
      await pool.execute(
        "INSERT INTO community_integration_logs (integration_id, event_id, action, status, message) VALUES (?, ?, 'deliver', ?, ?)",
        [event.integrationId, event.id, terminal ? "failed" : "retry", String(error.message || "Integration delivery failed").slice(0, 500)]
      );
    }
  }
  return events.length;
};

module.exports = { BATCH_SIZE, MAX_ATTEMPTS, claimEvents, deliverIntegrationMessage, enqueueIntegrationEvent, processIntegrationEvents };