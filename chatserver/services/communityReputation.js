const REPUTATION_EVENTS = new Set(["post", "helpful_reaction", "accepted_answer"]);

const recordReputationEvent = async (execute, groupId, userId, eventType, sourceId, points) => {
  if (!REPUTATION_EVENTS.has(eventType) || !Number.isSafeInteger(points)) {
    throw new Error("Invalid community reputation event.");
  }
  await execute(
    `INSERT INTO community_reputation_events
     (group_id, user_id, event_type, source_id, points)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE points = VALUES(points), updated_at = UTC_TIMESTAMP()`,
    [groupId, userId, eventType, sourceId, points]
  );
};

const badgesForPoints = (points) => [
  ...(points >= 10 ? ["Contributor"] : []),
  ...(points >= 50 ? ["Regular"] : []),
  ...(points >= 100 ? ["Expert"] : []),
];

module.exports = { badgesForPoints, recordReputationEvent };
