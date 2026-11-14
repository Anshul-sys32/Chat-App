const { pool } = require("../config/db");
const { randomUUID } = require("node:crypto");
const { getGroupAccess, canAccessGroup, canManageGroup } = require("../services/groupAccess");
const { parseJson } = require("../services/communityBots");

const builtinBots = {
  help: {
    name: "Help",
    description: "Lists available commands in this community.",
    commands: [{ key: "help", description: "Show installed commands.", content: "Available commands: {{args}}" }],
  },
  welcome: {
    name: "Welcome",
    description: "Welcomes a community member.",
    commands: [{ key: "welcome", description: "Create a welcome message.", content: "Welcome {{args}}! We are glad you are here." }],
  },
};

const validId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const normalizeCommandKey = (value) => String(value || "").trim().toLowerCase();
const validCommandKey = (value) => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value);

const validateCommands = (commands) => {
  if (!Array.isArray(commands) || commands.length < 1 || commands.length > 20) return null;
  const seen = new Set();
  const normalized = [];
  for (const command of commands) {
    const key = normalizeCommandKey(command?.key);
    const description = typeof command?.description === "string" ? command.description.trim() : "";
    const content = typeof command?.content === "string" ? command.content.trim() : "";
    if (!validCommandKey(key) || seen.has(key) || description.length > 120 || !content || content.length > 2000) return null;
    seen.add(key);
    const buttons = command.buttons === undefined ? [] : command.buttons;
    if (!Array.isArray(buttons) || buttons.length > 5 || buttons.some((button) => {
      if (typeof button?.label !== "string" || !button.label.trim() || button.label.length > 40 || typeof button.url !== "string") return true;
      try { return !["http:", "https:"].includes(new URL(button.url).protocol); } catch { return true; }
    })) return null;
    normalized.push({ key, description, content, buttons: buttons.map((button) => ({ label: button.label.trim(), url: button.url })) });
  }
  return normalized;
};

const resolveCommunityManager = async (groupId, user) => {
  const group = await getGroupAccess(groupId, user.id);
  if (!group) return { status: 404, message: "Community not found." };
  if (group.groupType !== "community") return { status: 400, message: "Bots are available only in communities." };
  if (!canAccessGroup(group, user.role) || !canManageGroup(group, "manageBots", user.role)) {
    return { status: 403, message: "You do not have permission to manage bots in this community." };
  }
  return { group };
};

const listCommunityBots = async (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!validId(groupId)) return res.status(400).json({ message: "Invalid community id." });
  try {
    const group = await getGroupAccess(groupId, req.user.id);
    if (!group) return res.status(404).json({ message: "Community not found." });
    if (!canAccessGroup(group, req.user.role)) return res.status(403).json({ message: "You are not a member of this community." });
    const [bots] = await pool.execute(
      `SELECT bot.id, bot.bot_key AS botKey, bot.name, bot.description, bot.bot_type AS botType,
              bot.enabled, bot.config, command.command_key AS commandKey, command.description AS commandDescription,
              command.enabled AS commandEnabled
       FROM community_bots bot LEFT JOIN community_bot_commands command ON command.bot_id = bot.id
       WHERE bot.group_id = ? ORDER BY bot.name, command.command_key`,
      [groupId]
    );
    const result = new Map();
    for (const row of bots) {
      if (!result.has(row.id)) result.set(row.id, {
        id: row.id,
        botKey: row.botKey,
        name: row.name,
        description: row.description,
        botType: row.botType,
        enabled: Boolean(row.enabled),
        allowedChannelIds: parseJson(row.config).allowedChannelIds || [],
        commands: [],
      });
      if (row.commandKey) result.get(row.id).commands.push({ key: row.commandKey, description: row.commandDescription, enabled: Boolean(row.commandEnabled) });
    }
    res.set("Cache-Control", "private, no-store");
    return res.json({ bots: [...result.values()] });
  } catch (error) {
    console.error("List community bots error:", error);
    return res.status(500).json({ message: "Could not load community bots." });
  }
};

const installBuiltinBot = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const botKey = String(req.params.botKey || "").toLowerCase();
  const definition = builtinBots[botKey];
  if (!validId(groupId) || !definition) return res.status(400).json({ message: "Choose a supported built-in bot." });
  try {
    const access = await resolveCommunityManager(groupId, req.user);
    if (access.status) return res.status(access.status).json({ message: access.message });
    const commandKeys = definition.commands.map((command) => command.key);
    const [conflicts] = await pool.execute(
      `SELECT command_key FROM community_bot_commands WHERE group_id = ? AND command_key IN (${commandKeys.map(() => "?").join(",")}) LIMIT 1`,
      [groupId, ...commandKeys]
    );
    if (conflicts.length) return res.status(409).json({ message: "A bot command with that name is already installed." });
    const [result] = await pool.execute(
      `INSERT IGNORE INTO community_bots (group_id, bot_key, name, description, bot_type, created_by)
       VALUES (?, ?, ?, ?, 'builtin', ?)`,
      [groupId, botKey, definition.name, definition.description, req.user.id]
    );
    const [[bot]] = await pool.execute("SELECT id FROM community_bots WHERE group_id = ? AND bot_key = ? LIMIT 1", [groupId, botKey]);
    for (const command of definition.commands) {
      await pool.execute(
        `INSERT IGNORE INTO community_bot_commands (bot_id, group_id, command_key, description, response_content, response_data)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [bot.id, groupId, command.key, command.description, command.content, JSON.stringify({ buttons: [] })]
      );
    }
    req.app.get("io")?.to(`group:${groupId}`).emit("community-bots-updated", { groupId });
    return res.status(result.affectedRows ? 201 : 200).json({ id: bot.id, botKey });
  } catch (error) {
    console.error("Install built-in bot error:", error);
    return res.status(500).json({ message: "Could not install this bot." });
  }
};

const createCustomBot = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
  const commands = validateCommands(req.body?.commands);
  if (!validId(groupId) || !name || name.length > 80 || description.length > 240 || !commands) {
    return res.status(400).json({ message: "Provide a bot name and 1 to 20 valid commands." });
  }
  try {
    const access = await resolveCommunityManager(groupId, req.user);
    if (access.status) return res.status(access.status).json({ message: access.message });
    const commandKeys = commands.map((command) => command.key);
    const [conflicts] = await pool.execute(
      `SELECT command_key FROM community_bot_commands WHERE group_id = ? AND command_key IN (${commandKeys.map(() => "?").join(",")}) LIMIT 1`,
      [groupId, ...commandKeys]
    );
    if (conflicts.length) return res.status(409).json({ message: "A bot command with that name is already installed." });
    const botKey = `custom-${randomUUID()}`;
    const [result] = await pool.execute(
      "INSERT INTO community_bots (group_id, bot_key, name, description, bot_type, created_by) VALUES (?, ?, ?, ?, 'custom', ?)",
      [groupId, botKey, name, description, req.user.id]
    );
    for (const command of commands) {
      await pool.execute(
        "INSERT INTO community_bot_commands (bot_id, group_id, command_key, description, response_content, response_data) VALUES (?, ?, ?, ?, ?, ?)",
        [result.insertId, groupId, command.key, command.description, command.content, JSON.stringify({ buttons: command.buttons })]
      );
    }
    req.app.get("io")?.to(`group:${groupId}`).emit("community-bots-updated", { groupId });
    return res.status(201).json({ id: result.insertId, botKey, name, description, commands: commands.map(({ key, description: commandDescription }) => ({ key, description: commandDescription })) });
  } catch (error) {
    console.error("Create custom bot error:", error);
    return res.status(500).json({ message: "Could not create this bot." });
  }
};

const updateCommunityBot = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const botId = Number(req.params.botId);
  const { enabled, allowedChannelIds } = req.body || {};
  if (!validId(groupId) || !validId(botId)
    || enabled !== undefined && typeof enabled !== "boolean"
    || allowedChannelIds !== undefined && (!Array.isArray(allowedChannelIds) || allowedChannelIds.length > 100
      || allowedChannelIds.some((id) => !validId(id)))) {
    return res.status(400).json({ message: "Provide valid bot settings." });
  }
  if (enabled === undefined && allowedChannelIds === undefined) return res.status(400).json({ message: "Provide bot settings to update." });
  try {
    const access = await resolveCommunityManager(groupId, req.user);
    if (access.status) return res.status(access.status).json({ message: access.message });
    const [rows] = await pool.execute("SELECT config, enabled FROM community_bots WHERE id = ? AND group_id = ? LIMIT 1", [botId, groupId]);
    if (!rows.length) return res.status(404).json({ message: "Bot not found." });
    if (allowedChannelIds?.length) {
      const placeholders = allowedChannelIds.map(() => "?").join(",");
      const [validChannels] = await pool.execute(
        `SELECT id FROM group_channels WHERE group_id = ? AND is_archived = FALSE AND channel_type = 'text' AND id IN (${placeholders})`,
        [groupId, ...allowedChannelIds]
      );
      if (validChannels.length !== new Set(allowedChannelIds.map(Number)).size) {
        return res.status(400).json({ message: "Choose active text channels from this community." });
      }
    }
    const config = parseJson(rows[0].config);
    const nextConfig = allowedChannelIds === undefined ? config : { ...config, allowedChannelIds: [...new Set(allowedChannelIds.map(Number))] };
    await pool.execute(
      "UPDATE community_bots SET enabled = COALESCE(?, enabled), config = ? WHERE id = ? AND group_id = ?",
      [enabled ?? null, JSON.stringify(nextConfig), botId, groupId]
    );
    req.app.get("io")?.to(`group:${groupId}`).emit("community-bots-updated", { groupId });
    return res.json({ id: botId, enabled: enabled ?? Boolean(rows[0].enabled), allowedChannelIds: nextConfig.allowedChannelIds || [] });
  } catch (error) {
    console.error("Update community bot error:", error);
    return res.status(500).json({ message: "Could not update this bot." });
  }
};

const uninstallCommunityBot = async (req, res) => {
  const groupId = Number(req.params.groupId);
  const botId = Number(req.params.botId);
  if (!validId(groupId) || !validId(botId)) return res.status(400).json({ message: "Invalid community or bot id." });
  try {
    const access = await resolveCommunityManager(groupId, req.user);
    if (access.status) return res.status(access.status).json({ message: access.message });
    const [result] = await pool.execute("DELETE FROM community_bots WHERE id = ? AND group_id = ?", [botId, groupId]);
    if (!result.affectedRows) return res.status(404).json({ message: "Bot not found." });
    req.app.get("io")?.to(`group:${groupId}`).emit("community-bots-updated", { groupId });
    return res.status(204).end();
  } catch (error) {
    console.error("Uninstall community bot error:", error);
    return res.status(500).json({ message: "Could not uninstall this bot." });
  }
};

module.exports = { createCustomBot, installBuiltinBot, listCommunityBots, uninstallCommunityBot, updateCommunityBot, validateCommands };