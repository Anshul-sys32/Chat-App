const up = async (connection) => {
  const [columns] = await connection.execute(
    `SELECT column_name AS name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'group_messages'`
  );
  const existing = new Set(columns.map((column) => column.name));
  if (!existing.has("message_type")) {
    await connection.query("ALTER TABLE group_messages ADD COLUMN message_type VARCHAR(20) NOT NULL DEFAULT 'message'");
  }
  if (!existing.has("structured_data")) {
    await connection.query("ALTER TABLE group_messages ADD COLUMN structured_data JSON NULL");
  }
  if (!existing.has("accepted_answer_id")) {
    await connection.query("ALTER TABLE group_messages ADD COLUMN accepted_answer_id BIGINT UNSIGNED NULL");
  }
  await connection.query(`
    CREATE TABLE IF NOT EXISTS community_poll_votes (
      message_id BIGINT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      option_index TINYINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (message_id, user_id, option_index),
      INDEX community_poll_votes_message (message_id, option_index),
      CONSTRAINT community_poll_vote_message_fk FOREIGN KEY (message_id) REFERENCES group_messages(id) ON DELETE CASCADE,
      CONSTRAINT community_poll_vote_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS community_event_rsvps (
      message_id BIGINT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      response ENUM('going', 'maybe', 'not_going') NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (message_id, user_id),
      INDEX community_event_rsvps_message (message_id, response),
      CONSTRAINT community_event_rsvp_message_fk FOREIGN KEY (message_id) REFERENCES group_messages(id) ON DELETE CASCADE,
      CONSTRAINT community_event_rsvp_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
  for (const [name, description, postingMode, sortOrder] of [
    ["general", "General discussion", "members", 0],
    ["announcements", "Updates from community leaders", "admins", 1],
    ["development", "Technical work and project updates", "members", 2],
    ["help", "Questions and troubleshooting", "members", 3],
  ]) {
    await connection.execute(
      `INSERT IGNORE INTO group_channels
       (group_id, name, slug, description, posting_mode, sort_order, created_by)
       SELECT id, ?, ?, ?, ?, ?, created_by FROM chat_groups WHERE group_type = 'community'`,
      [name, name, description, postingMode, sortOrder]
    );
  }
};

const down = async (connection) => {
  await connection.query("DROP TABLE IF EXISTS community_event_rsvps");
  await connection.query("DROP TABLE IF EXISTS community_poll_votes");
  await connection.query("ALTER TABLE group_messages DROP COLUMN accepted_answer_id, DROP COLUMN structured_data, DROP COLUMN message_type");
};

module.exports = { up, down };