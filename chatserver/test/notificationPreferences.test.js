const assert = require("node:assert/strict");
const { afterEach, mock, test } = require("node:test");
const { pool } = require("../config/db");
const {
  getNotificationPreferences,
  updateNotificationPreferences,
} = require("../controllers/notificationPreferencesController");
const preferencesMigration = require("../migrations/202611010001_user_notification_preferences");
const { runMigrations } = require("../utils/migrations");
const { createMessageNotifications } = require("../services/messageNotifications");
const {
  getConversationNotificationPreferences,
  updateConversationNotificationPreferences,
} = require("../controllers/conversationNotificationPreferencesController");
const conversationPreferencesMigration = require("../migrations/202611010003_conversation_notification_preferences");

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

afterEach(() => mock.restoreAll());

test("preference reads default to disabled without creating a row", async () => {
  mock.method(pool, "execute", async () => [[], []]);
  const response = createResponse();
  await getNotificationPreferences({ user: { id: 17 } }, response);
  assert.deepEqual(response.body, {
    preferences: {
      browserNotifications: false,
      notificationSounds: false,
      directMessages: true,
      groupMessages: true,
    },
  });
});

test("preference updates accept only supported boolean values for the authenticated user", async () => {
  const executed = [];
  mock.method(pool, "execute", async (sql, values) => {
    executed.push({ sql, values });
    if (sql.includes("INSERT INTO user_notification_preferences")) return [{ affectedRows: 1 }, []];
    return [[{ browserNotifications: 1, notificationSounds: 0, directMessages: 1, groupMessages: 1 }], []];
  });
  const response = createResponse();
  await updateNotificationPreferences({ user: { id: 23 }, body: { browserNotifications: true } }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(executed[0].values, [23, true, true]);
  assert.match(executed[0].sql, /browser_notifications = \?/);
  assert.deepEqual(response.body.preferences, {
    browserNotifications: true,
    notificationSounds: false,
    directMessages: true,
    groupMessages: true,
  });
});

test("preference updates reject unknown keys and non-boolean values", async () => {
  const execute = mock.method(pool, "execute", async () => {
    throw new Error("Database must not be queried for invalid preferences");
  });
  for (const body of [
    { admin: true },
    { browserNotifications: "true" },
    {},
  ]) {
    const response = createResponse();
    await updateNotificationPreferences({ user: { id: 29 }, body }, response);
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.message, "Notification preferences must use supported boolean values.");
  }
  const malformedResponse = createResponse();
  await updateNotificationPreferences({ user: { id: 29 }, body: [] }, malformedResponse);
  assert.equal(malformedResponse.statusCode, 400);
  assert.equal(malformedResponse.body.message, "Provide notification preference values.");
  assert.equal(execute.mock.callCount(), 0);
});

test("preferences migration adds a user-cascading table and defines rollback", async () => {
  const statements = [];
  const connection = { query: async (sql) => statements.push(sql) };
  await preferencesMigration.up(connection);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS user_notification_preferences/);
  assert.match(statements[0], /FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);
  await preferencesMigration.down(connection);
  assert.match(statements[1], /DROP TABLE IF EXISTS user_notification_preferences/);
});

test("migration runner serializes, records, skips applied versions, and releases its connection", async () => {
  const appliedVersions = [];
  const statements = [];
  let releaseCount = 0;
  const connection = {
    query: async (sql) => statements.push(sql),
    execute: async (sql, values) => {
      statements.push(sql);
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }], []];
      if (sql.includes("SELECT version FROM schema_migrations")) {
        return [appliedVersions.map((version) => ({ version })), []];
      }
      if (sql.includes("INSERT INTO schema_migrations")) {
        appliedVersions.push(values[0]);
        return [{ affectedRows: 1 }, []];
      }
      return [[{ released: 1 }], []];
    },
    release: () => { releaseCount += 1; },
  };
  mock.method(pool, "getConnection", async () => connection);

  await runMigrations();
  await runMigrations();

  assert.deepEqual(appliedVersions, [
    "202611010001_user_notification_preferences",
    "202611010002_message_notification_targets",
    "202611010003_conversation_notification_preferences",
  ]);
  assert.equal(statements.filter((sql) => sql.includes("CREATE TABLE IF NOT EXISTS user_notification_preferences")).length, 1);
  assert.equal(statements.filter((sql) => sql.includes("GET_LOCK")).length, 2);
  assert.equal(statements.filter((sql) => sql.includes("RELEASE_LOCK")).length, 2);
  assert.equal(releaseCount, 2);
});

test("direct-message notifications persist and emit a conversation target to the recipient room", async () => {
  const statements = [];
  mock.method(pool, "execute", async (sql, values) => {
    statements.push({ sql, values });
    if (sql.includes("FROM users recipient")) {
      return [[{ userId: 9, senderName: "Ari", targetName: "Ari", notificationsEnabled: 1 }], []];
    }
    if (sql.includes("INSERT IGNORE INTO notifications")) return [{ affectedRows: 1 }, []];
    return [[{
      _id: 501,
      userId: 9,
      category: "direct_message",
      targetType: "direct",
      targetId: 4,
      targetName: "Ari",
      title: "New message from Ari",
      body: "Hello",
    }], []];
  });
  const emitted = [];
  const io = { to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) };

  const count = await createMessageNotifications({
    type: "direct",
    message: { _id: 701, sender: 4, receiver: 9, content: "Hello" },
    io,
  });

  assert.equal(count, 1);
  assert.match(statements[0].sql, /COALESCE\(preferences\.direct_messages, TRUE\) = TRUE/);
  assert.match(statements[0].sql, /COALESCE\(conversation_preferences\.muted, FALSE\) = FALSE/);
  assert.ok(statements[1].sql.includes("source_message_id"));
  assert.ok(statements[1].values.includes("direct_message"));
  assert.ok(statements[1].values.includes(701));
  assert.deepEqual(emitted.map(({ room, event }) => ({ room, event })), [
    { room: "user:9", event: "notification" },
  ]);
  assert.equal(emitted[0].payload.targetId, 4);
});

test("group-message notifications use member recipients and the group navigation target", async () => {
  const statements = [];
  mock.method(pool, "execute", async (sql, values) => {
    statements.push({ sql, values });
    if (sql.includes("FROM group_members member")) {
      return [[
        { userId: 11, senderName: "Ari", targetName: "Study Room", notificationsEnabled: 1 },
        { userId: 12, senderName: "Ari", targetName: "Study Room", notificationsEnabled: 1 },
      ], []];
    }
    if (sql.includes("INSERT IGNORE INTO notifications")) return [{ affectedRows: 2 }, []];
    return [[
      { _id: 601, userId: 11, category: "group_message", targetType: "group", targetId: 22, targetName: "Study Room" },
      { _id: 602, userId: 12, category: "group_message", targetType: "group", targetId: 22, targetName: "Study Room" },
    ], []];
  });
  const emittedRooms = [];
  const io = { to: (room) => ({ emit: () => emittedRooms.push(room) }) };

  const count = await createMessageNotifications({
    type: "group",
    message: { _id: 801, sender: 7, groupId: 22, content: "Question" },
    io,
  });

  assert.equal(count, 2);
  assert.match(statements[0].sql, /member\.user_id <> \?/);
  assert.match(statements[0].sql, /COALESCE\(preferences\.group_messages, TRUE\) = TRUE/);
  assert.match(statements[0].sql, /COALESCE\(conversation_preferences\.muted, FALSE\) = FALSE/);
  assert.deepEqual(emittedRooms, ["user:11", "user:12"]);
  assert.ok(statements[1].values.includes("Study Room"));
});

test("conversation mute settings require membership and persist the authenticated user's value", async () => {
  const statements = [];
  mock.method(pool, "execute", async (sql, values) => {
    statements.push({ sql, values });
    if (sql.includes("FROM group_members")) return [[{ member: 1 }], []];
    if (sql.includes("INSERT INTO conversation_notification_preferences")) return [{ affectedRows: 1 }, []];
    return [[{ muted: 1 }], []];
  });
  const response = createResponse();
  await updateConversationNotificationPreferences({
    user: { id: 33 },
    params: { type: "group", id: "22" },
    body: { muted: true },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { muted: true });
  assert.deepEqual(statements[1].values, [33, "group", 22, true, true]);
});

test("conversation mute settings reject invalid targets and inaccessible conversations", async () => {
  const execute = mock.method(pool, "execute", async () => [[], []]);
  const invalidResponse = createResponse();
  await getConversationNotificationPreferences({
    user: { id: 33 },
    params: { type: "other", id: "22" },
  }, invalidResponse);
  assert.equal(invalidResponse.statusCode, 400);

  const deniedResponse = createResponse();
  await getConversationNotificationPreferences({
    user: { id: 33 },
    params: { type: "group", id: "22" },
  }, deniedResponse);
  assert.equal(deniedResponse.statusCode, 404);
  assert.equal(execute.mock.callCount(), 1);
});

test("conversation mute migration defines a user-scoped composite key and rollback", async () => {
  const statements = [];
  const connection = { query: async (sql) => statements.push(sql) };
  await conversationPreferencesMigration.up(connection);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS conversation_notification_preferences/);
  assert.match(statements[0], /PRIMARY KEY \(user_id, conversation_type, conversation_id\)/);
  await conversationPreferencesMigration.down(connection);
  assert.match(statements[1], /DROP TABLE IF EXISTS conversation_notification_preferences/);
});
