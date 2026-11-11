const assert = require("node:assert/strict");
const { afterEach, mock, test } = require("node:test");
const { pool } = require("../config/db");
const { notifyDirectMessage, notifyGroupMessage } = require("../services/realtimeMessageNotifications");
const {
  getNotificationPreferences,
  updateNotificationPreferences,
} = require("../controllers/notificationPreferencesController");
const preferencesMigration = require("../migrations/202611010001_user_notification_preferences");
const { runMigrations } = require("../utils/migrations");
const {
  getConversationNotificationPreferences,
  updateConversationNotificationPreferences,
} = require("../controllers/conversationNotificationPreferencesController");
const conversationPreferencesMigration = require("../migrations/202611010003_conversation_notification_preferences");
const communityMigration = require("../migrations/202611010004_group_channels");
const groupLifecycleMigration = require("../migrations/202611010005_group_lifecycle");
const groupInvitationsMigration = require("../migrations/202611010006_group_invitations");
const groupInvitationKeyMigration = require("../migrations/202611010007_group_invitation_pending_key");
const scheduledMeetingsMigration = require("../migrations/202611010008_scheduled_meetings");
const communityPostsMigration = require("../migrations/202611010009_community_posts");
const groupRolesMigration = require("../migrations/202611010010_group_roles");
const groupMessageReactionsMigration = require("../migrations/202611010011_group_message_reactions");
const scheduledCommunityPostsMigration = require("../migrations/202611010012_scheduled_community_posts");
const savedMessagesMigration = require("../migrations/202611010013_saved_messages");
const {
  canInviteToCallRoom,
  canNegotiateCallRoomOffer,
  canJoinSfuCallRoom,
  shouldUpgradeCallRoomToSfu,
  MAX_CALL_PARTICIPANTS,
} = require("../services/callRoomPolicy");
const { sendMeetingReminders } = require("../services/meetingReminders");
const { canAccessGroup, canManageGroup, validateGroupMessageTarget } = require("../services/groupAccess");
const { hasGroupPermission } = require("../services/groupRoles");
const { isSupportedReaction, loadCommunityEngagement, validateCommunityPost } = require("../services/communityPosts");
const { nextScheduledAt } = require("../services/scheduledCommunityPosts");
const { listChannels, createChannel } = require("../controllers/groupChannelController");
const authRoutes = require("../routes/authRoutes");

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
    "202611010004_group_channels",
    "202611010005_group_lifecycle",
    "202611010006_group_invitations",
    "202611010007_group_invitation_pending_key",
    "202611010008_scheduled_meetings",
    "202611010009_community_posts",
    "202611010010_group_roles",
    "202611010011_group_message_reactions",
    "202611010012_scheduled_community_posts",
    "202611010013_saved_messages",
  ]);
  assert.equal(statements.filter((sql) => sql.includes("CREATE TABLE IF NOT EXISTS user_notification_preferences")).length, 1);
  assert.equal(statements.filter((sql) => sql.includes("GET_LOCK")).length, 2);
  assert.equal(statements.filter((sql) => sql.includes("RELEASE_LOCK")).length, 2);
  assert.equal(releaseCount, 2);
});

test("group message reactions migration cascades with messages and users and rolls back", async () => {
  const statements = [];
  const connection = { query: async (sql) => statements.push(sql) };
  await groupMessageReactionsMigration.up(connection);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS group_message_reactions/);
  assert.match(statements[0], /PRIMARY KEY \(message_id, user_id, emoji\)/);
  assert.match(statements[0], /REFERENCES group_messages\(id\) ON DELETE CASCADE/);
  assert.match(statements[0], /REFERENCES users\(id\) ON DELETE CASCADE/);
  await groupMessageReactionsMigration.down(connection);
  assert.match(statements[1], /DROP TABLE IF EXISTS group_message_reactions/);
});

test("scheduled community posts migration creates an indexed queue with rollback", async () => {
  const statements = [];
  const connection = { query: async (sql) => statements.push(sql) };
  await scheduledCommunityPostsMigration.up(connection);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS scheduled_community_posts/);
  assert.match(statements[0], /recurrence ENUM\('once', 'daily', 'weekly'\)/);
  assert.match(statements[0], /scheduled_community_posts_queue \(status, scheduled_at\)/);
  await scheduledCommunityPostsMigration.down(connection);
  assert.match(statements[1], /DROP TABLE IF EXISTS scheduled_community_posts/);
});

test("saved messages migration scopes bookmarks by user, type, and message", async () => {
  const statements = [];
  const connection = { query: async (sql) => statements.push(sql) };
  await savedMessagesMigration.up(connection);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS user_saved_messages/);
  assert.match(statements[0], /PRIMARY KEY \(user_id, message_type, message_id\)/);
  assert.match(statements[0], /REFERENCES users\(id\) ON DELETE CASCADE/);
  await savedMessagesMigration.down(connection);
  assert.match(statements[1], /DROP TABLE IF EXISTS user_saved_messages/);
});

test("saved-message and scheduled-announcement routes register during router initialization", () => {
  const registered = authRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => Object.entries(layer.route.methods).map(([method, enabled]) => enabled ? `${method}:${layer.route.path}` : null))
    .flat()
    .filter(Boolean);
  for (const route of [
    "get:/saved-messages",
    "put:/saved-messages/:messageType/:messageId",
    "delete:/saved-messages/:messageType/:messageId",
    "get:/groups/:groupId/channels/:channelId/scheduled-posts",
    "post:/groups/:groupId/channels/:channelId/scheduled-posts",
  ]) {
    assert.ok(registered.includes(route), `${route} should be registered`);
  }
});

test("scheduled community post recurrence advances past missed occurrences", () => {
  const now = new Date("2026-11-11T12:00:00.000Z");
  assert.equal(nextScheduledAt("2026-11-11T10:00:00.000Z", "once", now), null);
  assert.equal(nextScheduledAt("2026-11-11T10:00:00.000Z", "daily", now).toISOString(), "2026-11-12T10:00:00.000Z");
  assert.equal(nextScheduledAt("2026-11-04T10:00:00.000Z", "weekly", now).toISOString(), "2026-11-18T10:00:00.000Z");
});

test("community engagement loads reaction totals and the current user's selection", async () => {
  assert.equal(isSupportedReaction("👍"), true);
  assert.equal(isSupportedReaction("<script>"), false);
  const calls = [];
  const execute = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes("group_message_reactions")) {
      return [[{ messageId: 31, emoji: "👍", reactionCount: 3, ownCount: 1 }], []];
    }
    return [[], []];
  };
  const messages = await loadCommunityEngagement([
    { _id: 31, messageType: "message", isDeleted: 0 },
    { _id: 32, messageType: "message", isDeleted: 1 },
  ], 7, execute);
  assert.deepEqual(messages[0].reactions, [{ emoji: "👍", count: 3, reactedByMe: true }]);
  assert.deepEqual(messages[1].reactions, []);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, [7, 31]);
});

test("migration runner reports the version that failed without recording it", async () => {
  const connection = {
    query: async () => {},
    execute: async (sql) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }], []];
      if (sql.includes("SELECT version FROM schema_migrations")) return [[], []];
      return [[{ released: 1 }], []];
    },
    release() {},
  };
  mock.method(pool, "getConnection", async () => connection);
  const migration = require("../migrations/202611010001_user_notification_preferences");
  const originalUp = migration.up;
  migration.up = async () => { throw new Error("foreign-key diagnostic"); };
  try {
    await assert.rejects(runMigrations(), /202611010001_user_notification_preferences failed: foreign-key diagnostic/);
  } finally {
    migration.up = originalUp;
  }
});

test("group lifecycle migration adds an active flag and defines rollback", async () => {
  const statements = [];
  const connection = {
    execute: async () => [[{ count: 0 }], []],
    query: async (sql) => statements.push(sql),
  };
  await groupLifecycleMigration.up(connection);
  assert.match(statements[0], /ALTER TABLE chat_groups ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE/);
  await groupLifecycleMigration.down(connection);
  assert.match(statements[1], /ALTER TABLE chat_groups DROP COLUMN is_active/);
});

test("group invitations migration defines pending invite storage and rollback", async () => {
  const statements = [];
  const connection = { query: async (sql) => statements.push(sql) };
  await groupInvitationsMigration.up(connection);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS group_invitations/);
  assert.match(statements[0], /status ENUM\('pending', 'accepted', 'rejected'\)/);
  assert.match(statements[0], /pending_slot TINYINT UNSIGNED NULL DEFAULT 1/);
  assert.match(statements[0], /UNIQUE KEY group_invitations_pending_unique \(group_id, invitee_id, pending_slot\)/);
  await groupInvitationsMigration.down(connection);
  assert.match(statements[1], /DROP TABLE IF EXISTS group_invitations/);
});

test("group invitation key migration allows repeated historical responses but keeps pending unique", async () => {
  const statements = [];
  const executions = [];
  const connection = {
    execute: async (sql) => {
      executions.push(sql);
      if (sql.includes("duplicatePendingPairs")) return [[{ duplicatePendingPairs: 0 }], []];
      const exists = sql.includes("group_invitations_group'") || sql.includes("group_invitations_state'") ? 1 : 0;
      return [[{ count: exists }], []];
    },
    query: async (sql) => statements.push(sql),
  };
  await groupInvitationKeyMigration.up(connection);
  assert.match(statements[0], /DROP INDEX group_invitations_state/);
  assert.match(statements[1], /ADD COLUMN pending_slot TINYINT UNSIGNED NULL/);
  assert.ok(executions.some((sql) => sql.includes("pending_slot = CASE WHEN status = 'pending' THEN 1 ELSE NULL END")));
  assert.match(statements[2], /MODIFY pending_slot TINYINT UNSIGNED NULL DEFAULT 1/);
  assert.match(statements[3], /group_invitations_pending_unique \(group_id, invitee_id, pending_slot\)/);
  await groupInvitationKeyMigration.down(connection);
  assert.match(statements[4], /DROP INDEX group_invitations_pending_unique/);
  assert.match(statements[6], /group_invitations_state/);
});

test("scheduled meetings migration creates meetings, participants, and reminder state", async () => {
  const statements = [];
  const connection = { query: async (sql) => statements.push(sql) };
  await scheduledMeetingsMigration.up(connection);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS scheduled_meetings/);
  assert.match(statements[0], /reminder_sent_at DATETIME NULL/);
  assert.match(statements[1], /CREATE TABLE IF NOT EXISTS meeting_participants/);
  await scheduledMeetingsMigration.down(connection);
  assert.match(statements[2], /DROP TABLE IF EXISTS meeting_participants/);
});

test("call room invitations are host-only and capped at eight participants", () => {
  const room = { hostId: "10", participants: new Set(["10", "11", "12", "13", "14", "15", "16"]) };
  assert.deepEqual(canInviteToCallRoom(room, "10", "17"), { allowed: true, reason: null });
  assert.deepEqual(canInviteToCallRoom(room, "11", "17"), { allowed: false, reason: "not-host" });
  room.participants.add("17");
  assert.equal(room.participants.size, MAX_CALL_PARTICIPANTS);
  assert.deepEqual(canInviteToCallRoom(room, "10", "18"), { allowed: false, reason: "full" });
});

test("direct message system notifications emit only to the recipient without persistence", async () => {
  const statements = [];
  mock.method(pool, "execute", async (sql) => {
    statements.push(sql);
    return [[{ userId: 9, senderName: "Ari" }], []];
  });
  const emitted = [];
  const io = { to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) };

  const count = await notifyDirectMessage(io, {
    _id: 701, sender: 4, receiver: 9, content: "Hello",
  });

  assert.equal(count, 1);
  assert.equal(statements.length, 1);
  assert.deepEqual(emitted.map(({ room, event }) => ({ room, event })), [
    { room: "user:9", event: "direct-message-notification" },
  ]);
  assert.equal(emitted[0].payload.title, "New message from Ari");
  assert.equal(emitted[0].payload.body, "Hello");
});

test("group message system notifications emit to unmuted members only", async () => {
  const statements = [];
  mock.method(pool, "execute", async (sql) => {
    statements.push(sql);
    return [[
      { userId: 11, senderName: "Ari", groupName: "Study Room", channelName: "General" },
      { userId: 12, senderName: "Ari", groupName: "Study Room", channelName: "General" },
    ], []];
  });
  const emitted = [];
  const io = { to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) };

  const count = await notifyGroupMessage(io, {
    _id: 801, sender: 7, groupId: 22, channelId: 3, content: "Question",
  });

  assert.equal(count, 2);
  assert.match(statements[0], /conversation_preferences\.muted/);
  assert.deepEqual(emitted.map(({ room, event }) => ({ room, event })), [
    { room: "user:11", event: "group-message-notification" },
    { room: "user:12", event: "group-message-notification" },
  ]);
  assert.equal(emitted[0].payload.title, "New message in Study Room #General");
});

test("call room guests can negotiate only with existing participants", () => {
  const room = { hostId: "10", participants: new Set(["10", "11", "12"]) };
  assert.deepEqual(canNegotiateCallRoomOffer(room, "11", "12"), { allowed: true, reason: "mesh" });
  assert.deepEqual(canNegotiateCallRoomOffer(room, "11", "13"), { allowed: false, reason: "not-participant" });
  assert.deepEqual(canNegotiateCallRoomOffer(room, "13", "11"), { allowed: false, reason: "not-participant" });
});

test("call room upgrades to SFU only after the fifth participant accepts", () => {
  const room = {
    mode: "mesh",
    acceptedParticipants: new Set(["10", "11", "12", "13"]),
  };
  assert.equal(shouldUpgradeCallRoomToSfu(room), false);
  room.acceptedParticipants.add("14");
  assert.equal(shouldUpgradeCallRoomToSfu(room), true);
  room.mode = "sfu";
  assert.equal(shouldUpgradeCallRoomToSfu(room), false);
});

test("SFU rooms reject new peer-to-peer negotiation", () => {
  const room = { mode: "sfu", hostId: "10", participants: new Set(["10", "11", "12"]) };
  assert.deepEqual(canNegotiateCallRoomOffer(room, "11", "12"), { allowed: false, reason: "mesh-disabled" });
});

test("SFU tokens are limited to invited room participants", () => {
  const room = { mode: "sfu", participants: new Set(["10", "11", "12"]) };
  assert.equal(canJoinSfuCallRoom(room, "11"), true);
  assert.equal(canJoinSfuCallRoom(room, "13"), false);
  room.mode = "mesh";
  assert.equal(canJoinSfuCallRoom(room, "11"), false);
});

test("meeting reminders notify the organizer and accepted attendees only once", async () => {
  let claimed = false;
  const connection = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    execute: async (sql) => {
      if (sql.includes("UPDATE scheduled_meetings")) {
        if (claimed) return [{ affectedRows: 0 }, []];
        claimed = true;
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes("FROM meeting_participants")) return [[{ userId: 12 }], []];
      if (sql.includes("INSERT INTO notifications")) return [{ affectedRows: 2 }, []];
      if (sql.includes("FROM notifications WHERE batch_id")) {
        return [[
          { _id: 44, userId: 10, title: "Meeting reminder", body: "Planning begins soon." },
          { _id: 45, userId: 12, title: "Meeting reminder", body: "Planning begins soon." },
        ], []];
      }
      return [{ affectedRows: 1 }, []];
    },
  };
  mock.method(pool, "execute", async (sql) => {
    if (sql.includes("FROM scheduled_meetings")) {
      return [[{ id: 33, organizerId: 10, title: "Planning", scheduledAt: new Date("2026-11-02T13:00:00Z") }], []];
    }
    return [[], []];
  });
  mock.method(pool, "getConnection", async () => connection);
  const events = [];
  const io = { in: (room) => ({ emit: (event, payload) => events.push({ room, event, payload }) }) };
  const sent = await sendMeetingReminders(io, new Date("2026-11-02T12:50:00Z"));
  assert.equal(sent, 2);
  assert.deepEqual(events.map((event) => event.room), ["user:10", "user:12"]);
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

test("community migration adds types, channels, nullable message scope, and rollback", async () => {
  const statements = [];
  const connection = {
    execute: async () => [[{ count: 0 }], []],
    query: async (sql) => statements.push(sql),
  };
  await communityMigration.up(connection);
  assert.ok(statements.some((sql) => sql.includes("group_type")));
  assert.ok(statements.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS group_channels")));
  assert.ok(statements.some((sql) => sql.includes("FOREIGN KEY (channel_id)")));
  await communityMigration.down(connection);
  assert.ok(statements.some((sql) => sql.includes("DROP TABLE IF EXISTS group_channels")));
});

test("community posts migration adds structured posts, engagement tables, and four channel defaults", async () => {
  const statements = [];
  const connection = {
    query: async (sql) => statements.push(sql),
    execute: async (sql, values) => {
      statements.push({ sql, values });
      return [[{ name: "id" }], []];
    },
  };
  await communityPostsMigration.up(connection);
  assert.ok(statements.some((sql) => typeof sql === "string" && sql.includes("community_poll_votes")));
  assert.ok(statements.some((sql) => typeof sql === "string" && sql.includes("community_event_rsvps")));
  const seeds = statements.filter((entry) => entry && typeof entry === "object" && entry.sql.includes("INSERT IGNORE INTO group_channels"));
  assert.deepEqual(seeds.map(({ values }) => values[0]), ["general", "announcements", "development", "help"]);
  await communityPostsMigration.down(connection);
  assert.ok(statements.some((sql) => typeof sql === "string" && sql.includes("DROP TABLE IF EXISTS community_event_rsvps")));
});

test("community post validation accepts bounded polls and rejects malformed options", () => {
  const poll = validateCommunityPost({
    messageType: "poll",
    structuredData: { question: "Preferred runtime?", options: ["Node", "Deno"], multipleChoice: false },
  }, true);
  assert.equal(poll.messageType, "poll");
  assert.deepEqual(poll.structuredData.options, ["Node", "Deno"]);
  assert.match(validateCommunityPost({
    messageType: "poll",
    structuredData: { question: "Pick", options: ["same", "same"] },
  }, true).error, /distinct options/);
  assert.match(validateCommunityPost({ messageType: "event", structuredData: {} }, true).error, /valid start date/);
  assert.match(validateCommunityPost({ messageType: "question", content: "Help" }, false).error, /only available in communities/);
  const question = validateCommunityPost({
    messageType: "question",
    content: "Why does this query time out?",
    structuredData: { category: "Development", tags: ["MySQL", "performance", "mysql"] },
  }, true);
  assert.deepEqual(question.structuredData, { category: "Development", tags: ["mysql", "performance"] });
  assert.match(validateCommunityPost({
    messageType: "question",
    content: "Help",
    structuredData: { category: "General", tags: Array.from({ length: 6 }, (_, index) => `tag${index}`) },
  }, true).error, /up to 5 tags/);
  assert.match(validateCommunityPost({
    messageType: "question",
    content: "Help",
    structuredData: { category: "x".repeat(41), tags: [] },
  }, true).error, /category and up to 5 tags/);
});

test("group roles migration expands membership roles and seeds built-in capabilities", async () => {
  const statements = [];
  const connection = {
    query: async (sql) => statements.push(sql),
    execute: async (sql, values) => {
      statements.push({ sql, values });
      if (sql.includes("information_schema.columns")) return [[{ type: "enum('admin','member')" }], []];
      if (sql.includes("SELECT id FROM chat_groups")) return [[{ id: 12 }], []];
      return [{ affectedRows: 1 }, []];
    },
  };
  await groupRolesMigration.up(connection);
  assert.ok(statements.some((sql) => typeof sql === "string" && sql.includes("MODIFY role VARCHAR(40)")));
  assert.ok(statements.some((sql) => typeof sql === "string" && sql.includes("community_channel_role_permissions")));
  const seededRoles = statements.filter((entry) => entry && typeof entry === "object" && entry.sql.includes("INSERT IGNORE INTO group_roles"));
  assert.ok(seededRoles.some(({ values }) => values[1] === "moderator"));
  assert.ok(seededRoles.some(({ values }) => values[1] === "developer"));
  await groupRolesMigration.down(connection);
  assert.ok(statements.some((sql) => typeof sql === "string" && sql.includes("role NOT IN ('admin', 'member')")));
});

test("custom group capabilities gate group and channel actions", () => {
  const group = {
    groupRole: "mentor",
    rolePermissions: { manageRoles: false, manageMembers: false, manageChannels: false, manageMessages: false, postMessages: true },
  };
  assert.equal(canAccessGroup({ isActive: 1, ...group }, "user"), true);
  assert.equal(hasGroupPermission(group, "postMessages", "user"), true);
  assert.equal(canManageGroup(group, "manageChannels", "user"), false);
  assert.equal(canManageGroup(group, "postMessages", "user"), true);
  assert.equal(canManageGroup(group, "manageRoles", "admin"), true);
});

test("admins cannot access a missing group record", () => {
  assert.equal(canAccessGroup(null, "admin"), false);
});

test("channel posting mode is enforced by the shared group policy", async () => {
  let groupRole = "member";
  mock.method(pool, "execute", async (sql) => {
    if (sql.includes("FROM chat_groups group_record")) {
      return [[{ id: 8, groupType: "community", groupRole }], []];
    }
    return [[{ id: 14, groupId: 8, postingMode: "admins" }], []];
  });
  const denied = await validateGroupMessageTarget(8, { id: 5, role: "user" }, 14);
  assert.equal(denied.status, 403);
  groupRole = "admin";
  const allowed = await validateGroupMessageTarget(8, { id: 5, role: "user" }, 14);
  assert.equal(allowed.channelId, 14);
});

test("community members can list channels but cannot create them without leader role", async () => {
  mock.method(pool, "execute", async (sql) => {
    if (sql.includes("FROM chat_groups group_record")) {
      return [[{ id: 8, groupType: "community", groupRole: "member" }], []];
    }
    if (sql.includes("FROM group_channels")) return [[{ _id: 14, id: 14, name: "announcements", slug: "announcements", postingMode: "admins" }], []];
    if (sql.includes("community_channel_role_permissions")) return [[{ canPost: 1 }], []];
    return [{ affectedRows: 1 }, []];
  });
  const listResponse = createResponse();
  await listChannels({ user: { id: 5, role: "user" }, params: { groupId: "8" } }, listResponse);
  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.body.channels[0].slug, "announcements");
  assert.equal(listResponse.body.channels[0].canPost, true);

  const createResponseValue = createResponse();
  await createChannel({
    user: { id: 5, role: "user" },
    params: { groupId: "8" },
    body: { name: "help" },
  }, createResponseValue);
  assert.equal(createResponseValue.statusCode, 403);
});
