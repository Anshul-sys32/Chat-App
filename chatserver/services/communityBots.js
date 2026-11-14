const { pool } = require("../config/db");

const parseBotCommand = (content) => {
  if (typeof content !== "string" || !content.startsWith("/")) return null;
  const match = content.match(/^\/([a-z0-9][a-z0-9_-]{0,31})(?:\s+([\s\S]{1,500}))?$/i);
  return match ? { commandKey: match[1].toLowerCase(), args: (match[2] || "").trim() } : { error: "Use a valid slash command." };
};

const parseJson = (value, fallback = {}) => {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

const executeBotCommand = async (groupId, channelId, content) => {
  const parsed = parseBotCommand(content);
  if (!parsed) return null;
  if (parsed.error) return { error: parsed.error };
  const [rows] = await pool.execute(
    `SELECT bot.id AS botId, bot.name AS botName, bot.bot_type AS botType, bot.config,
            command.command_key AS commandKey, command.response_content AS responseContent,
            command.response_data AS responseData
     FROM community_bots bot
     JOIN community_bot_commands command ON command.bot_id = bot.id AND command.enabled = TRUE
     WHERE bot.group_id = ? AND bot.enabled = TRUE AND command.command_key = ?
     LIMIT 1`,
    [groupId, parsed.commandKey]
  );
  const command = rows[0];
  if (!command) return { error: `No enabled bot command named /${parsed.commandKey} is installed.` };
  const config = parseJson(command.config);
  if (Array.isArray(config.allowedChannelIds) && config.allowedChannelIds.length
    && !config.allowedChannelIds.map(Number).includes(Number(channelId))) {
    return { error: "This bot command is not enabled in the current channel." };
  }
  const responseData = parseJson(command.responseData, {});
  const buttons = Array.isArray(responseData.buttons) ? responseData.buttons : [];
  let responseContent = String(command.responseContent);
  if (command.botType === "builtin" && parsed.commandKey === "help") {
    const [commands] = await pool.execute(
      `SELECT command.command_key AS commandKey, command.description
       FROM community_bot_commands command
       JOIN community_bots bot ON bot.id = command.bot_id AND bot.enabled = TRUE
       WHERE command.group_id = ? AND command.enabled = TRUE
         AND (JSON_LENGTH(JSON_EXTRACT(bot.config, '$.allowedChannelIds')) IS NULL
              OR JSON_LENGTH(JSON_EXTRACT(bot.config, '$.allowedChannelIds')) = 0
              OR JSON_CONTAINS(JSON_EXTRACT(bot.config, '$.allowedChannelIds'), CAST(? AS JSON)))
       ORDER BY command.command_key LIMIT 50`,
      [groupId, JSON.stringify(channelId)]
    );
    responseContent = `Available commands: ${commands.map((item) => `/${item.commandKey}${item.description ? ` (${item.description})` : ""}`).join(", ")}`;
  }
  return {
    botId: command.botId,
    botName: command.botName,
    content: responseContent.replaceAll("{{args}}", parsed.args).slice(0, 2000),
    structuredData: { buttons },
    messageType: "bot",
  };
};

module.exports = { executeBotCommand, parseBotCommand, parseJson };