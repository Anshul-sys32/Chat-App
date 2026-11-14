const assert = require("node:assert/strict");
const { afterEach, mock, test } = require("node:test");
const { pool } = require("../config/db");
const migration = require("../migrations/202611010024_community_collab_sessions");
const retentionMigration = require("../migrations/202611140001_collaboration_retention");
const {
  closeCommunitySession,
  createCommunitySession,
} = require("../controllers/communityCollabSessionsController");
const { createSessionWhiteboardItem } = require("../controllers/communityWhiteboardController");
const { authorizeSession, sessionRoom } = require("../services/communityCollabSessions");
const authRoutes = require("../routes/authRoutes");

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  end() { this.ended = true; return this; },
});

const communityRows = {
  group: { id: 8, name: "Engineers", isActive: 1, groupType: "community", groupRole: "admin", rolePermissions: null },
  channel: { id: 21, groupId: 8, name: "general", channelType: "text", postingMode: "members" },
};

const mockCommunityAccess = (execute) => mock.method(pool, "execute", async (sql, values) => {
  if (sql.includes("FROM chat_groups group_record")) return [[communityRows.group], []];
  if (sql.includes("FROM group_channels WHERE id = ?")) return [[communityRows.channel], []];
  return execute(sql, values);
});

afterEach(() => mock.restoreAll());

test("collaborative session APIs register authenticated lifecycle and scoped document routes", () => {
  const registered = authRoutes.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.entries(layer.route.methods)
      .filter(([, enabled]) => enabled)
      .map(([method]) => `${method}:${layer.route.path}`));
  for (const route of [
    "get:/groups/:groupId/channels/:channelId/collab-sessions",
    "post:/groups/:groupId/channels/:channelId/collab-sessions",
    "get:/collab-sessions/:sessionId",
    "patch:/collab-sessions/:sessionId",
    "post:/collab-sessions/:sessionId/close",
    "get:/collab-sessions/:sessionId/whiteboard",
    "post:/collab-sessions/:sessionId/whiteboard",
    "patch:/collab-sessions/:sessionId/whiteboard/:itemId",
    "delete:/collab-sessions/:sessionId/whiteboard/:itemId",
  ]) assert.ok(registered.includes(route), `${route} should be registered`);
});

test("collaborative session migration adds independent session snapshots and whiteboard scope", async () => {
  const statements = [];
  const connection = {
    query: async (sql) => statements.push(sql),
    execute: async () => [[{ count: 0 }], []],
  };
  await migration.up(connection);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS community_collab_sessions/);
  assert.match(statements[0], /session_type ENUM\('code_room', 'whiteboard'\)/);
  assert.match(statements[0], /creator_id INT UNSIGNED NOT NULL/);
  assert.ok(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS community_collab_code_states")));
    assert.ok(statements.some((sql) => sql.includes("ADD COLUMN session_id CHAR(36) NULL")));
  assert.ok(statements.some((sql) => sql.includes("community_whiteboard_session_fk")));
  await migration.down(connection);
  assert.match(statements.at(-1), /DROP TABLE IF EXISTS community_collab_sessions/);
});

test("collaboration retention migration protects session history from channel and user deletion", async () => {
  const statements = [];
  const foreignKeys = [
    { table: "community_collab_sessions", column: "channel_id", constraintName: "community_collab_channel_retention_fk", deleteRule: "RESTRICT" },
    { table: "community_collab_sessions", column: "creator_id", constraintName: "community_collab_creator_retention_fk", deleteRule: "SET NULL" },
    { table: "community_collab_code_states", column: "updated_by", constraintName: "community_collab_code_user_retention_fk", deleteRule: "SET NULL" },
    { table: "community_code_rooms", column: "updated_by", constraintName: "community_code_room_snapshot_user_fk", deleteRule: "CASCADE" },
    { table: "community_whiteboard_items", column: "created_by", constraintName: "community_whiteboard_creator_fk", deleteRule: "CASCADE" },
    { table: "community_whiteboard_items", column: "updated_by", constraintName: "community_whiteboard_updater_fk", deleteRule: "CASCADE" },
  ];
  const nullableColumns = new Set([
    "community_collab_sessions:creator_id",
    "community_collab_code_states:updated_by",
  ]);
  const connection = {
    execute: async (sql, values) => {
      if (sql.includes("information_schema.columns")) {
        return [[{ isNullable: nullableColumns.has(`${values[0]}:${values[1]}`) ? "YES" : "NO" }], []];
      }
      return [foreignKeys.filter((foreignKey) => foreignKey.table === values[0]
        && foreignKey.column === values[1]), []];
    },
    query: async (sql) => {
      statements.push(sql);
      const table = sql.match(/ALTER TABLE `([^`]+)`/)?.[1];
      const dropName = sql.match(/DROP FOREIGN KEY `([^`]+)`/)?.[1];
      if (dropName) {
        const index = foreignKeys.findIndex((foreignKey) => foreignKey.table === table
          && foreignKey.constraintName === dropName);
        if (index >= 0) foreignKeys.splice(index, 1);
      }
      const nullableColumn = sql.match(/MODIFY `([^`]+)` INT UNSIGNED NULL/)?.[1];
      if (nullableColumn) nullableColumns.add(`${table}:${nullableColumn}`);
      const addedForeignKey = sql.match(/ADD CONSTRAINT `([^`]+)`\s+FOREIGN KEY \(`([^`]+)`\).*?ON DELETE (RESTRICT|SET NULL|CASCADE)/s);
      if (addedForeignKey) foreignKeys.push({
        table,
        column: addedForeignKey[2],
        constraintName: addedForeignKey[1],
        deleteRule: addedForeignKey[3],
      });
    },
  };
  await retentionMigration.up(connection);
  assert.ok(foreignKeys.some((foreignKey) => foreignKey.constraintName === "community_collab_channel_retention_fk"
    && foreignKey.deleteRule === "RESTRICT"));
  assert.ok(foreignKeys.some((foreignKey) => foreignKey.constraintName === "community_code_room_user_retention_fk"
    && foreignKey.deleteRule === "SET NULL"));
  assert.ok(nullableColumns.has("community_whiteboard_items:created_by"));
  await retentionMigration.down(connection);
  assert.ok(foreignKeys.some((foreignKey) => foreignKey.constraintName === "community_collab_channel_fk"
    && foreignKey.deleteRule === "CASCADE"));
  assert.ok(statements.some((sql) => sql.includes("community_code_room_snapshot_user_fk")));
});

test("members can create multiple simultaneous sessions of the same or different type", async () => {
  const inserted = [];
  const emitted = [];
  mockCommunityAccess(async (sql, values) => {
    if (sql.includes("INSERT INTO community_collab_sessions")) {
      inserted.push(values);
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const req = {
    params: { groupId: "8", channelId: "21" },
    user: { id: 3, role: "member", username: "Ada" },
    app: { get: () => ({ to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) }) },
  };
  const sessions = [];
  for (const [sessionType, name] of [["code_room", "API review"], ["code_room", "API review 2"], ["whiteboard", "Schema plan"]]) {
    const response = createResponse();
    await createCommunitySession({ ...req, body: { sessionType, name, summary: "Working session notes" } }, response);
    assert.equal(response.statusCode, 201);
    sessions.push(response.body.session);
  }
  assert.equal(new Set(sessions.map((session) => session.id)).size, 3);
  assert.deepEqual(inserted.map((values) => values[4]), ["code_room", "code_room", "whiteboard"]);
  assert.equal(emitted.length, 3);
  assert.equal(emitted[0].room, "group:8:channel:21");
  assert.ok(emitted.every(({ event }) => event === "community-session-created"));
});

test("session creation rejects invalid metadata before querying storage", async () => {
  const execute = mock.method(pool, "execute", async () => { throw new Error("must not query"); });
  const response = createResponse();
  await createCommunitySession({
    params: { groupId: "8", channelId: "21" },
    user: { id: 3, role: "member" },
    body: { sessionType: "whiteboard", name: " ", summary: "summary" },
    app: { get: () => null },
  }, response);
  assert.equal(response.statusCode, 400);
  assert.equal(execute.mock.callCount(), 0);
});

test("non-creators cannot close sessions, even when they are community managers", async () => {
  const statements = [];
  mockCommunityAccess(async (sql, values) => {
    statements.push({ sql, values });
    if (sql.includes("FROM community_collab_sessions session")) return [[{
      id: "f15b2fcf-f8fa-4f20-a9df-123456789abc",
      groupId: 8,
      channelId: 21,
      creatorId: 5,
      sessionType: "code_room",
      name: "API review",
      summary: "Plan API",
      status: "active",
    }], []];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const response = createResponse();
  await closeCommunitySession({
    params: { sessionId: "f15b2fcf-f8fa-4f20-a9df-123456789abc" },
    user: { id: 3, role: "admin" },
    app: { get: () => null },
  }, response);
  assert.equal(response.statusCode, 403);
  assert.equal(statements.some(({ sql }) => sql.includes("UPDATE community_collab_sessions")), false);
});

test("community managers can close active sessions after the creator account is removed", async () => {
  const statements = [];
  mockCommunityAccess(async (sql, values) => {
    statements.push({ sql, values });
    if (sql.includes("FROM community_collab_sessions session")) return [[{
      id: "f15b2fcf-f8fa-4f20-a9df-123456789abc",
      groupId: 8,
      channelId: 21,
      creatorId: null,
      creatorName: "Former member",
      sessionType: "code_room",
      name: "API review",
      summary: "Plan API",
      status: "active",
    }], []];
    if (sql.startsWith("UPDATE community_collab_sessions")) return [{ affectedRows: 1 }, []];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const response = createResponse();
  await closeCommunitySession({
    params: { sessionId: "f15b2fcf-f8fa-4f20-a9df-123456789abc" },
    user: { id: 8, role: "admin" },
    app: { get: () => ({ to: () => ({ emit: () => {} }), in: () => ({ socketsLeave: () => {} }) }) },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.session.creatorId, null);
  assert.equal(response.body.session.creatorName, "Former member");
  assert.ok(statements.some(({ sql }) => sql.startsWith("UPDATE community_collab_sessions")));
});

test("community managers can close active sessions after the creator leaves the community", async () => {
  const statements = [];
  mockCommunityAccess(async (sql, values) => {
    statements.push({ sql, values });
    if (sql.includes("FROM community_collab_sessions session")) return [[{
      id: "f15b2fcf-f8fa-4f20-a9df-123456789abc",
      groupId: 8,
      channelId: 21,
      creatorId: 5,
      creatorIsMember: 0,
      creatorName: "Ada",
      sessionType: "code_room",
      name: "API review",
      summary: "Plan API",
      status: "active",
    }], []];
    if (sql.startsWith("UPDATE community_collab_sessions")) return [{ affectedRows: 1 }, []];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const response = createResponse();
  await closeCommunitySession({
    params: { sessionId: "f15b2fcf-f8fa-4f20-a9df-123456789abc" },
    user: { id: 8, role: "admin" },
    app: { get: () => ({ to: () => ({ emit: () => {} }), in: () => ({ socketsLeave: () => {} }) }) },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.session.creatorId, 5);
  assert.ok(statements.some(({ sql }) => sql.startsWith("UPDATE community_collab_sessions")));
});

test("closed sessions allow authorized reads but reject collaborative writes", async () => {
  mockCommunityAccess(async (sql) => {
    if (sql.includes("FROM community_collab_sessions session")) return [[{
      id: "f15b2fcf-f8fa-4f20-a9df-123456789abc",
      groupId: 8,
      channelId: 21,
      creatorId: 3,
      sessionType: "whiteboard",
      status: "closed",
    }], []];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const user = { id: 3, role: "member" };
  const readable = await authorizeSession("f15b2fcf-f8fa-4f20-a9df-123456789abc", user);
  const writable = await authorizeSession("f15b2fcf-f8fa-4f20-a9df-123456789abc", user, { write: true });
  assert.equal(readable.session.status, "closed");
  assert.equal(writable.status, 410);
  assert.equal(sessionRoom(readable.session.id), `collab-session:${readable.session.id}`);
});

test("active session collaboration requires the channel posting permission", async () => {
  mock.method(pool, "execute", async (sql) => {
    if (sql.includes("FROM community_collab_sessions session")) return [[{
      id: "f15b2fcf-f8fa-4f20-a9df-123456789abc",
      groupId: 8,
      channelId: 21,
      creatorId: 5,
      sessionType: "code_room",
      status: "active",
    }], []];
    if (sql.includes("FROM chat_groups group_record")) return [[{
      ...communityRows.group,
      groupRole: "member",
    }], []];
    if (sql.includes("FROM group_channels WHERE id = ?")) return [[{
      ...communityRows.channel,
      postingMode: "admins",
    }], []];
    if (sql.includes("community_channel_role_permissions")) return [[], []];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const authorized = await authorizeSession("f15b2fcf-f8fa-4f20-a9df-123456789abc", { id: 11, role: "member" }, { write: true });
  assert.equal(authorized.status, 403);
  assert.match(authorized.message, /permission to collaborate/);
});

test("session whiteboard writes persist the session ID and broadcast only within its room", async () => {
  const statements = [];
  const emitted = [];
  mockCommunityAccess(async (sql, values) => {
    statements.push({ sql, values });
    if (sql.includes("FROM community_collab_sessions session")) return [[{
      id: "f15b2fcf-f8fa-4f20-a9df-123456789abc",
      groupId: 8,
      channelId: 21,
      creatorId: 3,
      sessionType: "whiteboard",
      status: "active",
    }], []];
    if (sql.includes("INSERT INTO community_whiteboard_items")) return [{ insertId: 92 }, []];
    if (sql.includes("FROM community_whiteboard_items item")) return [[{
      id: 92,
      itemType: "sticky",
      data: JSON.stringify({ x: 10, y: 12, text: "Plan", color: "mint" }),
      createdBy: 3,
      creatorName: "Ada",
    }], []];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const response = createResponse();
  await createSessionWhiteboardItem({
    params: { sessionId: "f15b2fcf-f8fa-4f20-a9df-123456789abc" },
    user: { id: 3, role: "member" },
    body: { itemType: "sticky", data: { x: 10, y: 12, text: "Plan", color: "mint" } },
    app: { get: () => ({ to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) }) },
  }, response);
  const insert = statements.find(({ sql }) => sql.includes("INSERT INTO community_whiteboard_items"));
  assert.equal(insert.values[1], "f15b2fcf-f8fa-4f20-a9df-123456789abc");
  assert.equal(response.statusCode, 201);
  assert.equal(emitted[0].room, "collab-session:f15b2fcf-f8fa-4f20-a9df-123456789abc");
  assert.equal(emitted[0].payload.sessionId, "f15b2fcf-f8fa-4f20-a9df-123456789abc");
});
