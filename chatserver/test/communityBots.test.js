const assert = require("node:assert/strict");
const { afterEach, mock, test } = require("node:test");
const { pool } = require("../config/db");
const communityBotsMigration = require("../migrations/202611010022_community_bots");
const { createCustomBot, validateCommands } = require("../controllers/communityBotsController");
const { executeBotCommand, parseBotCommand } = require("../services/communityBots");
const { GROUP_PERMISSION_KEYS, normalizeGroupPermissions } = require("../services/groupRoles");
const authRoutes = require("../routes/authRoutes");

afterEach(() => mock.restoreAll());

test("slash command parsing bounds command names and argument length", () => {
  assert.deepEqual(parseBotCommand("/Help welcome home"), { commandKey: "help", args: "welcome home" });
  assert.equal(parseBotCommand("ordinary message"), null);
  assert.equal(parseBotCommand("/invalid?").error, "Use a valid slash command.");
  assert.equal(parseBotCommand(`/${"a".repeat(33)}`).error, "Use a valid slash command.");
});

test("command execution reloads the enabled installation and applies channel scope", async () => {
  const statements = [];
  mock.method(pool, "execute", async (sql, values) => {
    statements.push({ sql, values });
    return [[{
      botId: 7,
      botName: "Release helper",
      config: { allowedChannelIds: [4] },
      commandKey: "release",
      responseContent: "Release {{args}} is ready.",
      responseData: { buttons: [{ label: "Open", url: "https://example.test/release" }] },
    }], []];
  });

  const reply = await executeBotCommand(12, 4, "/release v2");
  assert.deepEqual(reply, {
    botId: 7,
    botName: "Release helper",
    content: "Release v2 is ready.",
    structuredData: { buttons: [{ label: "Open", url: "https://example.test/release" }] },
    messageType: "bot",
  });
  assert.match(statements[0].sql, /bot\.group_id = \? AND bot\.enabled = TRUE/);
  assert.match(statements[0].sql, /command\.enabled = TRUE/);
  assert.deepEqual(statements[0].values, [12, "release"]);
  assert.match((await executeBotCommand(12, 9, "/release v2")).error, /not enabled in the current channel/);
});

test("the built-in Help command lists enabled community commands", async () => {
  mock.method(pool, "execute", async (sql) => {
    if (sql.includes("SELECT command_key AS commandKey")) {
      return [[{ commandKey: "help", description: "Show commands" }, { commandKey: "welcome", description: "Welcome someone" }], []];
    }
    return [[{
      botId: 7,
      botName: "Help",
      botType: "builtin",
      config: {},
      commandKey: "help",
      responseContent: "Unused template",
      responseData: { buttons: [] },
    }], []];
  });

  const reply = await executeBotCommand(12, 4, "/help");
  assert.equal(reply.content, "Available commands: /help (Show commands), /welcome (Welcome someone)");
  assert.equal(reply.messageType, "bot");
});

test("custom bot commands reject duplicate keys, unsafe links, and oversized definitions", () => {
  const valid = [{ key: "status", description: "Current status", content: "Online", buttons: [{ label: "Status", url: "https://status.example.test" }] }];
  assert.deepEqual(validateCommands(valid)[0].buttons, valid[0].buttons);
  assert.equal(validateCommands([{ ...valid[0], buttons: [{ label: "Bad", url: "javascript:alert(1)" }] }]), null);
  assert.equal(validateCommands([valid[0], valid[0]]), null);
  assert.equal(validateCommands([{ ...valid[0], content: "" }]), null);
});

test("ordinary community members cannot create bot installations", async () => {
  const execute = mock.method(pool, "execute", async () => [[{
    id: 8,
    name: "Community",
    isActive: 1,
    groupType: "community",
    groupRole: "member",
    rolePermissions: { manageBots: false },
  }], []]);
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const request = {
    params: { groupId: "8" },
    user: { id: 21, role: "user" },
    body: { name: "Helper", commands: [{ key: "help", content: "Help" }] },
  };

  await createCustomBot(request, response);

  assert.equal(response.statusCode, 403);
  assert.match(response.body.message, /permission to manage bots/);
  assert.equal(execute.mock.callCount(), 1);
});

test("bot management permission is explicit and defaults off for ordinary roles", () => {
  assert.ok(GROUP_PERMISSION_KEYS.includes("manageBots"));
  assert.equal(normalizeGroupPermissions({ postMessages: true }).manageBots, false);
});

test("bot migration creates community installations, commands, message identity, and rollback", async () => {
  const statements = [];
  let columnCheckCount = 0;
  const connection = {
    query: async (sql) => statements.push(sql),
    execute: async (sql) => {
      statements.push(sql);
      if (sql.includes("information_schema.columns")) {
        columnCheckCount += 1;
        return [columnCheckCount === 1 ? [] : [{ name: "bot_id" }], []];
      }
      return [{ affectedRows: 1 }, []];
    },
  };
  await communityBotsMigration.up(connection);
  assert.ok(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS community_bots")));
  assert.ok(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS community_bot_commands")));
  assert.ok(statements.some((sql) => sql.includes("ADD COLUMN bot_id")));
  assert.ok(statements.some((sql) => sql.includes("JSON_SET(permissions")));
  await communityBotsMigration.down(connection);
  assert.ok(statements.some((sql) => sql.includes("DROP COLUMN bot_id")));
  assert.ok(statements.some((sql) => sql.includes("DROP TABLE IF EXISTS community_bot_commands")));
});

test("authenticated bot installation and command management routes are registered", () => {
  const routes = authRoutes.stack.filter((layer) => layer.route)
    .flatMap((layer) => Object.entries(layer.route.methods)
      .filter(([, enabled]) => enabled)
      .map(([method]) => `${method}:${layer.route.path}`));
  for (const route of [
    "get:/groups/:groupId/bots",
    "put:/groups/:groupId/bots/built-in/:botKey",
    "post:/groups/:groupId/bots",
    "patch:/groups/:groupId/bots/:botId",
    "delete:/groups/:groupId/bots/:botId",
  ]) assert.ok(routes.includes(route), `${route} is registered`);
});