const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { afterEach, mock, test } = require("node:test");
const { pool } = require("../config/db");
const { createIntegration, receiveWebhook } = require("../controllers/communityIntegrationsController");
const integrationMigration = require("../migrations/202611010023_community_integrations");
const { GROUP_PERMISSION_KEYS, normalizeGroupPermissions } = require("../services/groupRoles");
const { deliverIntegrationMessage, enqueueIntegrationEvent, processIntegrationEvents, MAX_ATTEMPTS, BATCH_SIZE } = require("../services/integrations/eventQueue");
const { githubProvider, googleCalendarProvider, rssProvider } = require("../services/integrations/providers");
const { decryptSecret, encryptSecret, signWebhookBody, verifyWebhookSignature } = require("../services/integrationSecrets");
const { consumeWebhookRateLimit, MAX_WEBHOOKS_PER_MINUTE } = require("../services/integrations/webhookRateLimit");
const authRoutes = require("../routes/authRoutes");

process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("base64");

afterEach(() => mock.restoreAll());

const response = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  set(key, value) { this.headers[key] = value; return this; },
});

const mockRateLimitConnection = (readCount = () => 0) => mock.method(pool, "getConnection", async () => ({
  beginTransaction: async () => {},
  commit: async () => {},
  rollback: async () => {},
  release: () => {},
  execute: async (sql) => sql.includes("SELECT request_count AS requestCount")
    ? [[{ requestCount: readCount() }], []]
    : [{ affectedRows: 1 }, []],
}));

test("integration secrets use authenticated encryption and webhook signatures are constant-shape validated", () => {
  const encrypted = encryptSecret("provider-token");
  const record = {
    secret_ciphertext: encrypted.ciphertext,
    secret_iv: encrypted.iv,
    secret_tag: encrypted.tag,
  };
  assert.equal(decryptSecret(record), "provider-token");
  assert.throws(() => decryptSecret({ ...record, secret_tag: Buffer.alloc(16).toString("base64") }));
  const body = Buffer.from('{"action":"opened"}');
  const signature = signWebhookBody("shared", body);
  assert.equal(verifyWebhookSignature("shared", body, signature), true);
  assert.equal(verifyWebhookSignature("wrong", body, signature), false);
  assert.equal(verifyWebhookSignature("shared", body, "sha256=bad"), false);
});

test("GitHub provider normalizes supported events and ignores unrelated events", () => {
  const commit = githubProvider.normalize("push", {
    repository: { full_name: "acme/chat" },
    ref: "refs/heads/main",
    commits: [{ id: "abcdef123", message: "Fix unread badge", url: "https://github.test/commit/abcdef" }],
  });
  assert.equal(commit.title, "New commit in acme/chat");
  assert.match(commit.body, /Fix unread badge/);
  assert.equal(githubProvider.normalize("workflow_run", {}), null);
  assert.equal(googleCalendarProvider.credentialsReady({ calendarId: "team" }), false);
  assert.equal(googleCalendarProvider.credentialsReady({ calendarId: "team", accessToken: "" }), false);
  assert.equal(typeof rssProvider.parse, "function");
});

test("RSS and Atom parsing extracts bounded entries, links, and stable dedupe keys", () => {
  const rss = rssProvider.parse(`<?xml version="1.0"?><rss><channel><item><title>Build &amp; deploy</title><description><![CDATA[All checks passed]]></description><link>https://example.test/a</link><guid>article-a</guid></item></channel></rss>`);
  assert.deepEqual(rss, [{
    title: "Build & deploy",
    body: "All checks passed",
    url: "https://example.test/a",
    eventKey: "article-a",
  }]);
  const atom = rssProvider.parse(`<feed><entry><title>Release</title><id>tag:example.test,2026:r1</id><link href="https://example.test/r1"/></entry></feed>`);
  assert.equal(atom[0].url, "https://example.test/r1");
  assert.throws(() => rssProvider.parse("<!DOCTYPE feed [<!ENTITY x 'boom'>]><feed/>"));
  assert.throws(() => rssProvider.parse("<document/>"));
});

test("webhook ingress verifies raw bytes, queues once, and never returns secrets", async () => {
  const secret = "shared-webhook-secret";
  const body = Buffer.from('{"title":"Build passed"}');
  const signature = signWebhookBody(secret, body);
  let insertCount = 0;
  mockRateLimitConnection();
  mock.method(pool, "execute", async (sql) => {
    if (sql.includes("FROM community_integrations WHERE id")) {
      const encrypted = encryptSecret(secret);
      return [[{
        id: 9,
        provider: "webhook",
        enabled: 1,
        secretCiphertext: encrypted.ciphertext,
        secretIv: encrypted.iv,
        secretTag: encrypted.tag,
      }], []];
    }
    if (sql.includes("INSERT IGNORE INTO community_integration_events")) {
      insertCount += 1;
      return [{ affectedRows: insertCount === 1 ? 1 : 0, insertId: insertCount === 1 ? 44 : 0 }, []];
    }
    return [{ affectedRows: 1 }, []];
  });
  const req = {
    params: { integrationId: "9" },
    rawBody: body,
    get(name) {
      return {
        "X-Integration-Signature": signature,
        "X-Integration-Event-Id": "evt-44",
        "X-Integration-Event": "build",
      }[name];
    },
  };
  const first = response();
  await receiveWebhook(req, first);
  assert.equal(first.statusCode, 202);
  assert.deepEqual(first.body, { accepted: true, duplicate: false });
  assert.equal(JSON.stringify(first.body).includes(secret), false);
  const duplicate = response();
  await receiveWebhook(req, duplicate);
  assert.equal(duplicate.statusCode, 200);
  assert.deepEqual(duplicate.body, { accepted: false, duplicate: true });
});

test("invalid webhook signatures are denied before queue insertion", async () => {
  const encrypted = encryptSecret("correct");
  const calls = [];
  mock.method(pool, "execute", async (sql) => {
    calls.push(sql);
    return [[{
      id: 5,
      provider: "webhook",
      enabled: 1,
      secretCiphertext: encrypted.ciphertext,
      secretIv: encrypted.iv,
      secretTag: encrypted.tag,
    }], []];
  });
  const res = response();
  await receiveWebhook({
    params: { integrationId: "5" },
    rawBody: Buffer.from("{}"),
    get(name) { return ({ "X-Integration-Signature": "00", "X-Integration-Event-Id": "event-1" })[name]; },
  }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(calls.length, 1);
});

test("webhook subscriptions ignore event types that were not configured", async () => {
  const encrypted = encryptSecret("subscribed-secret");
  const calls = [];
  mockRateLimitConnection();
  mock.method(pool, "execute", async (sql) => {
    calls.push(sql);
    if (sql.includes("FROM community_integrations WHERE id")) return [[{
      id: 5,
      provider: "github",
      enabled: 1,
      config: { events: ["push"] },
      secretCiphertext: encrypted.ciphertext,
      secretIv: encrypted.iv,
      secretTag: encrypted.tag,
    }], []];
    return [{ affectedRows: 1 }, []];
  });
  const body = Buffer.from("{}");
  const res = response();
  await receiveWebhook({
    params: { integrationId: "5" },
    rawBody: body,
    get(name) { return ({
      "X-Hub-Signature-256": `sha256=${signWebhookBody("subscribed-secret", body)}`,
      "X-GitHub-Delivery": "delivery-1",
      "X-GitHub-Event": "release",
    })[name]; },
  }, res);
  assert.equal(res.statusCode, 202);
  assert.deepEqual(res.body, { accepted: false, ignored: true });
  assert.equal(calls.length, 1);
});

test("webhook rate limiting is database-backed and caps an integration at 120 per minute", async () => {
  let count = 0;
  mock.method(pool, "getConnection", async () => ({
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    execute: async (sql) => {
      if (sql.includes("SELECT request_count AS requestCount")) return [[{ requestCount: count }], []];
      if (sql.includes("UPDATE community_integration_webhook_limits")) count += 1;
      return [{ affectedRows: 1 }, []];
    },
  }));
  for (let request = 0; request < MAX_WEBHOOKS_PER_MINUTE; request += 1) {
    assert.equal(await consumeWebhookRateLimit(5), true);
  }
  assert.equal(await consumeWebhookRateLimit(5), false);
  assert.equal(count, MAX_WEBHOOKS_PER_MINUTE);
});

test("integration event insertion is idempotent and queue bounds are fixed", async () => {
  const calls = [];
  mock.method(pool, "execute", async (sql) => {
    calls.push(sql);
    return sql.includes("INSERT IGNORE") ? [{ affectedRows: 0, insertId: 0 }, []] : [{ affectedRows: 1 }, []];
  });
  assert.deepEqual(await enqueueIntegrationEvent(3, "delivery-1", "push", { safe: true }), { accepted: false, eventId: null });
  assert.equal(calls.length, 1);
  assert.equal(MAX_ATTEMPTS, 5);
  assert.equal(BATCH_SIZE, 10);
});

test("worker retries failed events with backoff and marks the final attempt failed", async () => {
  const updates = [];
  let eventAttempts = 0;
  const connection = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    execute: async (sql) => {
      if (sql.includes("SELECT event.id")) return [[{
        id: 33,
        integrationId: 6,
        eventType: "unknown",
        payload: "{}",
        provider: "missing-provider",
        config: "{}",
        attempts: eventAttempts,
      }], []];
      return [{ affectedRows: 1 }, []];
    },
    query: async () => [{ affectedRows: 1 }, []],
  };
  mock.method(pool, "getConnection", async () => connection);
  mock.method(pool, "execute", async (sql, values) => {
    updates.push({ sql, values });
    return [{ affectedRows: 1 }, []];
  });

  assert.equal(await processIntegrationEvents(), 1);
  assert.deepEqual(updates[0].values, ["queued", 30, "Unsupported or invalid provider event.", 33]);
  eventAttempts = MAX_ATTEMPTS - 1;
  updates.length = 0;
  assert.equal(await processIntegrationEvents(), 1);
  assert.deepEqual(updates[0].values, ["failed", 480, "Unsupported or invalid provider event.", 33]);
  assert.equal(updates[1].values[2], "failed");
});

test("a post-commit broadcast failure does not turn a delivered integration message into a retry", async () => {
  let commits = 0;
  let rollbacks = 0;
  const message = { _id: 71, groupId: 10, channelId: 5, content: "Release published" };
  const connection = {
    beginTransaction: async () => {},
    commit: async () => { commits += 1; },
    rollback: async () => { rollbacks += 1; },
    release: () => {},
    execute: async (sql) => {
      if (sql.includes("SELECT integration.id")) return [[{
        id: 8,
        groupId: 10,
        channelId: 5,
        createdBy: 21,
        enabled: 1,
        channelArchived: 0,
        channelType: "text",
        groupActive: 1,
        groupType: "community",
        groupRole: "admin",
        rolePermissions: { manageIntegrations: true },
        creatorPlatformRole: "user",
      }], []];
      if (sql.includes("INSERT INTO group_messages")) return [{ insertId: 71 }, []];
      if (sql.includes("SELECT message.id AS _id")) return [[message], []];
      return [{ affectedRows: 1 }, []];
    },
  };
  mock.method(pool, "getConnection", async () => connection);
  mock.method(pool, "execute", async (sql) => {
    if (sql.includes("SELECT group_record.id")) return [[{
      id: 10,
      groupType: "community",
      isActive: 1,
      groupRole: "admin",
      rolePermissions: { manageIntegrations: true },
    }], []];
    if (sql.includes("FROM group_channels")) return [[{ id: 5, groupId: 10, channelType: "text", postingMode: "admins" }], []];
    return [[], []];
  });

  const result = await deliverIntegrationMessage({ id: 33 }, { id: 8, createdBy: 21 }, { title: "Release published" }, {
    to() { return { emit() { throw new Error("socket unavailable"); } }; },
  });

  assert.equal(result, message);
  assert.equal(commits, 1);
  assert.equal(rollbacks, 0);
});

test("integration management requires an explicit community capability", async () => {
  mock.method(pool, "execute", async () => [[{
    id: 8,
    name: "Community",
    isActive: 1,
    groupType: "community",
    groupRole: "member",
    rolePermissions: { manageIntegrations: false },
  }], []]);
  const res = response();
  await createIntegration({
    params: { groupId: "8" },
    user: { id: 21, role: "user" },
    body: { provider: "webhook", name: "Builds", channelId: 3, secret: "shared" },
  }, res);
  assert.equal(res.statusCode, 403);
  assert.ok(GROUP_PERMISSION_KEYS.includes("manageIntegrations"));
  assert.equal(normalizeGroupPermissions({ postMessages: true }).manageIntegrations, false);
});

test("integration migration creates registry, queue, logs, identity, and permissions with rollback", async () => {
  const statements = [];
  let columnChecks = 0;
  const connection = {
    query: async (sql) => statements.push(sql),
    execute: async (sql) => {
      statements.push(sql);
      if (sql.includes("information_schema.columns")) {
        columnChecks += 1;
        return [columnChecks === 1 ? [] : [{ name: "integration_id" }], []];
      }
      return [{ affectedRows: 1 }, []];
    },
  };
  await integrationMigration.up(connection);
  for (const table of ["community_integrations", "community_integration_events", "community_integration_logs", "community_integration_webhook_limits"]) {
    assert.ok(statements.some((sql) => sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`)));
  }
  assert.ok(statements.some((sql) => sql.includes("UNIQUE KEY community_integration_event_unique")));
  assert.ok(statements.some((sql) => sql.includes("ADD COLUMN integration_id")));
  assert.ok(statements.some((sql) => sql.includes("$.manageIntegrations")));
  await integrationMigration.down(connection);
  assert.ok(statements.some((sql) => sql.includes("DROP COLUMN integration_id")));
  assert.ok(statements.some((sql) => sql.includes("DROP TABLE IF EXISTS community_integration_events")));
});

test("integration APIs include authenticated configuration/history and public signed webhook routes", () => {
  const routes = authRoutes.stack.filter((layer) => layer.route)
    .flatMap((layer) => Object.entries(layer.route.methods)
      .filter(([, enabled]) => enabled)
      .map(([method]) => `${method}:${layer.route.path}`));
  for (const route of [
    "get:/groups/:groupId/integrations",
    "post:/groups/:groupId/integrations",
    "patch:/groups/:groupId/integrations/:integrationId",
    "delete:/groups/:groupId/integrations/:integrationId",
    "get:/groups/:groupId/integrations/:integrationId/logs",
    "post:/integrations/:integrationId/webhook",
  ]) assert.ok(routes.includes(route), `${route} is registered`);
});
