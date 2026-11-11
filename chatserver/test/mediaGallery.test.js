const assert = require("node:assert/strict");
const { afterEach, mock, test } = require("node:test");
const { pool } = require("../config/db");
const {
  buildGalleryQuery,
  buildLinkQuery,
  deliverUpload,
  findAccessibleUpload,
  normalizeGalleryFilters,
  uploadFilenamePattern,
  isSupportedMediaUrl,
} = require("../controllers/mediaGalleryController");

afterEach(() => mock.restoreAll());

test("gallery filters enforce bounded pages and valid scope, dates, and media types", () => {
  assert.deepEqual(normalizeGalleryFilters({ page: "2", pageSize: "12", mediaType: "image" }), {
    search: "",
    mediaType: "image",
    sort: "newest",
    page: 2,
    pageSize: 12,
    senderId: null,
    conversationType: null,
    conversationId: null,
    channelId: null,
    from: null,
    to: null,
  });
  for (const query of [
    { page: "101" },
    { pageSize: "51" },
    { mediaType: "executable" },
    { conversationType: "direct" },
    { conversationType: "group", conversationId: "4", channelId: "0" },
    { from: "2026-03-02", to: "2026-03-01" },
    { search: ["unexpected"] },
  ]) {
    assert.equal(normalizeGalleryFilters(query), null, JSON.stringify(query));
  }
});

test("gallery SQL applies ownership, hidden/deleted, channel, and filter predicates", () => {
  const filters = normalizeGalleryFilters({
    conversationType: "group",
    conversationId: "8",
    channelId: "3",
    senderId: "12",
    mediaType: "image",
    search: "report_%",
    from: "2026-01-01",
    sort: "oldest",
  });
  const { sql, values } = buildGalleryQuery("group", filters, 21, 48);

  assert.match(sql, /group_members membership/);
  assert.match(sql, /group_message_hidden_for/);
  assert.match(sql, /message\.is_deleted = FALSE/);
  assert.match(sql, /channel\.is_archived = FALSE/);
  assert.match(sql, /message\.group_id = \?/);
  assert.match(sql, /message\.channel_id = \?/);
  assert.match(sql, /message\.sender_id = \?/);
  assert.match(sql, /ESCAPE '!'/);
  assert.match(sql, /ORDER BY message\.created_at ASC/);
  assert.equal(values[0], 21);
  assert.equal(values.at(-1), 48);
  assert.ok(values.includes("%report!_!%%"));
});

test("direct gallery SQL scopes both conversation participants and hidden messages", () => {
  const filters = normalizeGalleryFilters({ conversationType: "direct", conversationId: "34" });
  const { sql, values } = buildGalleryQuery("direct", filters, 21, 24);

  assert.match(sql, /direct_message_hidden_for/);
  assert.match(sql, /message\.sender_id = \? OR message\.receiver_id = \?/);
  assert.match(sql, /message\.receiver_id = \?\) OR \(message\.sender_id = \? AND message\.receiver_id = \?/);
  assert.deepEqual(values, [21, 21, 21, 21, 21, 21, 34, 34, 21, 24]);
});

test("link gallery queries preserve conversation visibility and extract a URL", () => {
  const filters = normalizeGalleryFilters({ mediaType: "link", conversationType: "group", conversationId: "8" });
  const { sql, values } = buildLinkQuery("group", filters, 21, 24);

  assert.match(sql, /REGEXP_SUBSTR\(message\.content/);
  assert.match(sql, /group_members membership/);
  assert.match(sql, /group_message_hidden_for/);
  assert.match(sql, /message\.is_deleted = FALSE/);
  assert.match(sql, /channel\.is_archived = FALSE/);
  assert.deepEqual(values, [21, 21, 21, 8, 24]);
});

test("gallery responses permit only media URLs supported by protected routes", () => {
  assert.equal(isSupportedMediaUrl("/uploads/21-123e4567-e89b-12d3-a456-426614174000.jpg"), true);
  assert.equal(isSupportedMediaUrl("/api/voice-media/21-voice-123e4567-e89b-12d3-a456-426614174000.webm"), true);
  assert.equal(isSupportedMediaUrl("https://example.test/secret.jpg"), false);
  assert.equal(isSupportedMediaUrl("/uploads/21-private.txt"), false);
});

test("upload delivery rejects malformed paths before querying storage", async () => {
  const execute = mock.method(pool, "execute", async () => {
    throw new Error("Invalid filenames must not query the database");
  });
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  await deliverUpload({ params: { filename: "../private.txt" }, user: { id: 21 }, query: {} }, response);

  assert.equal(response.statusCode, 404);
  assert.equal(execute.mock.callCount(), 0);
  assert.equal(uploadFilenamePattern.test("21-123e4567-e89b-12d3-a456-426614174000.jpg"), true);
  assert.equal(uploadFilenamePattern.test("21-avatar-123e4567-e89b-12d3-a456-426614174000.jpg"), false);
});

test("protected upload authorization excludes hidden/deleted and inaccessible messages", async () => {
  const queries = [];
  mock.method(pool, "execute", async (sql, values) => {
    queries.push({ sql, values });
    return [[], []];
  });

  assert.equal(await findAccessibleUpload({ id: 21 }, "/uploads/21-123e4567-e89b-12d3-a456-426614174000.jpg"), false);
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /is_deleted = FALSE/);
  assert.match(queries[0].sql, /direct_message_hidden_for/);
  assert.match(queries[1].sql, /group_members membership/);
  assert.match(queries[1].sql, /group_message_hidden_for/);
  assert.match(queries[1].sql, /channel\.is_archived = FALSE/);
});