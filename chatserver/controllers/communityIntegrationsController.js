const { pool } = require("../config/db");
const { getGroupAccess, canAccessGroup, canManageGroup } = require("../services/groupAccess");
const { encryptSecret, decryptSecret, verifyWebhookSignature } = require("../services/integrationSecrets");
const { enqueueIntegrationEvent } = require("../services/integrations/eventQueue");
const { consumeWebhookRateLimit } = require("../services/integrations/webhookRateLimit");
const { providers } = require("../services/integrations/providers");

const validId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const jsonValue = (value, fallback = {}) => {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value || "{}"); } catch { return fallback; }
};

const sanitizeConfig = (value, depth = 0) => {
  if (depth > 5) return null;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeConfig(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(secret|token|password|credential|api[_-]?key)/i.test(key))
    .slice(0, 100)
    .map(([key, item]) => [key, sanitizeConfig(item, depth + 1)]));
};

const resolveIntegrationManager = async (groupId, user) => {
  const group = await getGroupAccess(groupId, user.id);
  if (!group) return { status: 404, message: "Community not found." };
  if (group.groupType !== "community") return { status: 400, message: "Integrations are available only in communities." };
  if (!canAccessGroup(group, user.role) || !canManageGroup(group, "manageIntegrations", user.role)) {
    return { status: 403, message: "You do not have permission to manage integrations in this community." };
  }
  return { group };
};

const listIntegrations = async (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!validId(groupId)) return res.status(400).json({ message: "Invalid community id." });
  try {
    const group = await getGroupAccess(groupId, req.user.id);
    if (!group) return res.status(404).json({ message: "Community not found." });
    if (!canAccessGroup(group, req.user.role) || !canManageGroup(group, "manageIntegrations", req.user.role)) {
      return res.status(403).json({ message: "You do not have permission to manage integrations in this community." });
    }
    const [rows] = await pool.execute(
      `SELECT integration.id, integration.provider, integration.name, integration.enabled,
              integration.config, integration.channel_id AS channelId, channel.name AS channelName,
              integration.created_at AS createdAt, integration.updated_at AS updatedAt,
              (integration.secret_ciphertext IS NOT NULL) AS hasSecret,
              (SELECT COUNT(*) FROM community_integration_events event WHERE event.integration_id = integration.id AND event.status IN ('queued', 'processing')) AS pendingEvents,
              (SELECT MAX(log.created_at) FROM community_integration_logs log WHERE log.integration_id = integration.id) AS lastActivity,
              (SELECT log.status FROM community_integration_logs log WHERE log.integration_id = integration.id ORDER BY log.id DESC LIMIT 1) AS lastStatus
       FROM community_integrations integration JOIN group_channels channel ON channel.id = integration.channel_id
       WHERE integration.group_id = ? ORDER BY integration.provider, integration.name`,
      [groupId]
    );
    res.set("Cache-Control", "private, no-store");
    return res.json({ integrations: rows.map((row) => ({
      ...row,
      enabled: Boolean(row.enabled),
      hasSecret: Boolean(row.hasSecret),
      pendingEvents: Number(row.pendingEvents),
      config: sanitizeConfig(jsonValue(row.config)),
      operational: row.provider === "google_calendar"
        ? false
        : row.provider === "rss" ? false : Boolean(row.enabled) && row.lastStatus === "succeeded",
    })) });
  } catch (error) {
    console.error("List community integrations error:", error);
    return res.status(500).json({ message: "Could not load integrations." });
  }
};

const createIntegration = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const provider = String(req.body?.provider || "");
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const channelId = Number(req.body?.channelId);
  const config = req.body?.config === undefined ? {} : req.body.config;
  const secret = req.body?.secret;
  const providerDefinition = providers.get(provider);
  if (!validId(groupId) || !providerDefinition || !name || name.length > 80 || !validId(channelId)
    || !config || typeof config !== "object" || Array.isArray(config)
    || Object.keys(config).length > 20 || secret !== undefined && (typeof secret !== "string" || secret.length > 4096)) {
    return res.status(400).json({ message: "Provide a supported provider, name, text channel, and valid configuration." });
  }
  if (req.body.enabled !== undefined && typeof req.body.enabled !== "boolean") {
    return res.status(400).json({ message: "Integration enabled must be a boolean." });
  }
  if (config.events !== undefined && (!Array.isArray(config.events) || config.events.length > 20
    || config.events.some((event) => typeof event !== "string" || !/^[\w.-]{1,80}$/.test(event)))) {
    return res.status(400).json({ message: "Choose up to 20 valid event types." });
  }
  if (provider === "rss") {
    try {
      const feedUrl = new URL(config.feedUrl);
      if (feedUrl.protocol !== "https:" || feedUrl.username || feedUrl.password) throw new Error("unsupported feed URL");
    } catch {
      return res.status(400).json({ message: "RSS feed URLs must be valid HTTPS URLs." });
    }
  }
  if (provider === "google_calendar") {
    return res.status(400).json({ message: "Google Calendar cannot be enabled until the OAuth authorization flow is configured." });
  }
  let encrypted;
  try {
    if (secret) encrypted = encryptSecret(secret);
    else if (["webhook", "github"].includes(provider)) {
      return res.status(400).json({ message: "Provide the webhook signing secret; it is encrypted and will not be returned." });
    }
  } catch {
    return res.status(503).json({ message: "Integration secret encryption is not configured." });
  }
  try {
    const access = await resolveIntegrationManager(groupId, req.user);
    if (access.status) return res.status(access.status).json({ message: access.message });
    const [[channel]] = await pool.execute(
      `SELECT id FROM group_channels WHERE id = ? AND group_id = ? AND is_archived = FALSE AND channel_type = 'text' LIMIT 1`,
      [channelId, groupId]
    );
    if (!channel) return res.status(400).json({ message: "Choose an active text channel in this community." });
    const [result] = await pool.execute(
      `INSERT INTO community_integrations
       (group_id, channel_id, provider, name, enabled, config, secret_ciphertext, secret_iv, secret_tag, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [groupId, channelId, provider, name, req.body.enabled !== false,
        JSON.stringify(sanitizeConfig(config)),
        encrypted?.ciphertext || null, encrypted?.iv || null, encrypted?.tag || null, req.user.id]
    );
    const response = {
      id: result.insertId,
      provider,
      name,
      channelId,
      enabled: req.body.enabled !== false,
      operational: false,
    };
    req.app.get("io")?.to(`group:${groupId}`).emit("community-integrations-updated", { groupId });
    return res.status(201).json(response);
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "An integration with this name already exists." });
    console.error("Create integration error:", error);
    return res.status(500).json({ message: "Could not create this integration." });
  }
};

const updateIntegration = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const integrationId = Number(req.params.integrationId);
  const { enabled, channelId, config, secret } = req.body || {};
  if (!validId(groupId) || !validId(integrationId)
    || enabled !== undefined && typeof enabled !== "boolean"
    || channelId !== undefined && !validId(channelId)
    || config !== undefined && (!config || typeof config !== "object" || Array.isArray(config) || Object.keys(config).length > 20)
    || secret !== undefined && (typeof secret !== "string" || secret.length > 4096)) {
    return res.status(400).json({ message: "Provide valid integration settings." });
  }
  if (enabled === undefined && channelId === undefined && config === undefined && secret === undefined) {
    return res.status(400).json({ message: "Provide integration settings to update." });
  }
  try {
    const access = await resolveIntegrationManager(groupId, req.user);
    if (access.status) return res.status(access.status).json({ message: access.message });
    const [[integration]] = await pool.execute(
      "SELECT provider, config FROM community_integrations WHERE id = ? AND group_id = ? LIMIT 1",
      [integrationId, groupId]
    );
    if (!integration) return res.status(404).json({ message: "Integration not found." });
    const updates = [];
    const values = [];
    if (channelId !== undefined) {
      const [[channel]] = await pool.execute(
        "SELECT id FROM group_channels WHERE id = ? AND group_id = ? AND is_archived = FALSE AND channel_type = 'text' LIMIT 1",
        [channelId, groupId]
      );
      if (!channel) return res.status(400).json({ message: "Choose an active text channel in this community." });
      updates.push("channel_id = ?");
      values.push(channelId);
    }
    if (config !== undefined) {
      const sanitized = sanitizeConfig(config);
      updates.push("config = ?");
      values.push(JSON.stringify({ ...jsonValue(integration.config), ...sanitized }));
    }
    let encrypted;
    if (secret !== undefined) {
      try { encrypted = secret ? encryptSecret(secret) : null; }
      catch { return res.status(503).json({ message: "Integration secret encryption is not configured." }); }
      updates.push("secret_ciphertext = ?", "secret_iv = ?", "secret_tag = ?");
      values.push(encrypted?.ciphertext || null, encrypted?.iv || null, encrypted?.tag || null);
    }
    if (enabled !== undefined) { updates.push("enabled = ?"); values.push(enabled); }
    values.push(integrationId, groupId);
    await pool.execute(`UPDATE community_integrations SET ${updates.join(", ")} WHERE id = ? AND group_id = ?`, values);
    req.app.get("io")?.to(`group:${groupId}`).emit("community-integrations-updated", { groupId });
    return res.json({ id: integrationId, enabled: enabled ?? undefined, secretUpdated: secret !== undefined });
  } catch (error) {
    console.error("Update integration error:", error);
    return res.status(500).json({ message: "Could not update integration settings." });
  }
};

const deleteIntegration = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const integrationId = Number(req.params.integrationId);
  if (!validId(groupId) || !validId(integrationId)) return res.status(400).json({ message: "Invalid community or integration id." });
  try {
    const access = await resolveIntegrationManager(groupId, req.user);
    if (access.status) return res.status(access.status).json({ message: access.message });
    const [result] = await pool.execute("DELETE FROM community_integrations WHERE id = ? AND group_id = ?", [integrationId, groupId]);
    if (!result.affectedRows) return res.status(404).json({ message: "Integration not found." });
    req.app.get("io")?.to(`group:${groupId}`).emit("community-integrations-updated", { groupId });
    return res.status(204).end();
  } catch (error) {
    console.error("Delete integration error:", error);
    return res.status(500).json({ message: "Could not delete this integration." });
  }
};

const listIntegrationLogs = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const integrationId = Number(req.params.integrationId);
  const limitInput = Number(req.query.limit || 50);
  if (!validId(groupId) || !validId(integrationId) || !Number.isSafeInteger(limitInput) || limitInput < 1 || limitInput > 100) {
    return res.status(400).json({ message: "Invalid integration history request." });
  }
  try {
    const group = await getGroupAccess(groupId, req.user.id);
    if (!group) return res.status(404).json({ message: "Community not found." });
    if (!canAccessGroup(group, req.user.role) || !canManageGroup(group, "manageIntegrations", req.user.role)) {
      return res.status(403).json({ message: "You do not have permission to view integration history." });
    }
    const [logs] = await pool.execute(
      `SELECT log.id, log.event_id AS eventId, log.action, log.status, log.message, log.created_at AS createdAt
       FROM community_integration_logs log JOIN community_integrations integration ON integration.id = log.integration_id
       WHERE log.integration_id = ? AND integration.group_id = ? ORDER BY log.id DESC LIMIT ?`,
      [integrationId, groupId, limitInput]
    );
    return res.json({ logs });
  } catch (error) {
    console.error("List integration logs error:", error);
    return res.status(500).json({ message: "Could not load integration history." });
  }
};

const receiveWebhook = async (req, res) => {
  const integrationId = Number(req.params.integrationId);
  const signature = req.get("X-Integration-Signature") || req.get("X-Hub-Signature-256") || "";
  const eventKey = req.get("X-Integration-Event-Id") || req.get("X-GitHub-Delivery") || "";
  const eventType = req.get("X-Integration-Event") || req.get("X-GitHub-Event") || "webhook";
  if (!validId(integrationId) || !/^[\w.:-]{1,191}$/.test(eventKey) || !/^[\w.-]{1,80}$/.test(eventType)) {
    return res.status(400).json({ message: "A valid event id and type are required." });
  }
  const rawBody = req.rawBody;
  if (!Buffer.isBuffer(rawBody) || rawBody.length > 1024 * 1024) return res.status(400).json({ message: "Webhook body is missing or too large." });
  try {
    const [[integration]] = await pool.execute(
      `SELECT id, provider, enabled, config, secret_ciphertext AS secretCiphertext,
              secret_iv AS secretIv, secret_tag AS secretTag
       FROM community_integrations WHERE id = ? LIMIT 1`,
      [integrationId]
    );
    if (!integration || !integration.enabled || !["webhook", "github"].includes(integration.provider)) {
      return res.status(404).json({ message: "Webhook endpoint not found." });
    }
    let secret;
    try {
      secret = decryptSecret({
        secret_ciphertext: integration.secretCiphertext,
        secret_iv: integration.secretIv,
        secret_tag: integration.secretTag,
      });
    } catch {
      return res.status(503).json({ message: "Webhook signature verification is unavailable." });
    }
    const prefix = integration.provider === "github" ? "sha256=" : "";
    if (!secret || !verifyWebhookSignature(secret, rawBody, signature, prefix)) {
      return res.status(401).json({ message: "Invalid webhook signature." });
    }
    if (!await consumeWebhookRateLimit(integration.id)) {
      res.set("Retry-After", "60");
      return res.status(429).json({ message: "Webhook rate limit exceeded." });
    }
    let payload;
    try { payload = JSON.parse(rawBody.toString("utf8")); }
    catch { return res.status(400).json({ message: "Webhook payload must be valid JSON." }); }
    const provider = providers.get(integration.provider);
    if (provider.supportedEvents && !provider.supportedEvents.includes(eventType)) {
      return res.status(202).json({ accepted: false, ignored: true });
    }
    const config = jsonValue(integration.config);
    if (Array.isArray(config.events) && config.events.length && !config.events.includes(eventType)) {
      return res.status(202).json({ accepted: false, ignored: true });
    }
    const result = await enqueueIntegrationEvent(integration.id, eventKey, eventType, payload);
    return res.status(result.accepted ? 202 : 200).json({ accepted: result.accepted, duplicate: !result.accepted });
  } catch (error) {
    console.error("Receive integration webhook error:", error);
    return res.status(500).json({ message: "Could not accept this webhook." });
  }
};

module.exports = { createIntegration, deleteIntegration, listIntegrationLogs, listIntegrations, receiveWebhook, updateIntegration };