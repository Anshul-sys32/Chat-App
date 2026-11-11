const loadDirectMessageReactions = async (messages, userId, execute) => {
  const reactable = messages.filter((message) => !message.isDeleted);
  const reactionData = new Map();
  if (reactable.length) {
    const ids = reactable.map((message) => message._id);
    const placeholders = ids.map(() => "?").join(", ");
    const [rows] = await execute(
      `SELECT message_id AS messageId, emoji, COUNT(*) AS reactionCount,
              SUM(user_id = ?) AS ownCount
       FROM direct_message_reactions WHERE is_active = TRUE AND message_id IN (${placeholders})
       GROUP BY message_id, emoji`,
      [userId, ...ids]
    );
    for (const row of rows) {
      const current = reactionData.get(String(row.messageId)) || [];
      current.push({ emoji: row.emoji, count: Number(row.reactionCount), reactedByMe: Number(row.ownCount) > 0 });
      reactionData.set(String(row.messageId), current);
    }
  }
  return messages.map((message) => ({
    ...message,
    reactions: reactionData.get(String(message._id)) || [],
  }));
};

const toggleReactionState = async (executor, messageId, userId, emoji, tableName) => {
  if (!new Set(["direct_message_reactions", "group_message_reactions"]).has(tableName)) {
    throw new Error("Unsupported reaction table.");
  }
  await executor.execute(
    `INSERT INTO ${tableName} (message_id, user_id, emoji, is_active)
     VALUES (?, ?, ?, TRUE) ON DUPLICATE KEY UPDATE is_active = NOT is_active`,
    [messageId, userId, emoji]
  );
  const [rows] = await executor.execute(
    `SELECT is_active AS isActive FROM ${tableName}
     WHERE message_id = ? AND user_id = ? AND emoji = ? LIMIT 1`,
    [messageId, userId, emoji]
  );
  return Boolean(rows[0]?.isActive);
};

module.exports = { loadDirectMessageReactions, toggleReactionState };
