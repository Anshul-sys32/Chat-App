const up = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS community_reputation_events (
      group_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      event_type ENUM('post', 'helpful_reaction', 'accepted_answer') NOT NULL,
      source_id BIGINT UNSIGNED NOT NULL,
      points SMALLINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, user_id, event_type, source_id),
      INDEX community_reputation_leaderboard (group_id, user_id, points),
      INDEX community_reputation_history (group_id, user_id, updated_at),
      CONSTRAINT community_reputation_group_fk FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
      CONSTRAINT community_reputation_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
};

const down = async (connection) => {
  await connection.query("DROP TABLE IF EXISTS community_reputation_events");
};

module.exports = { up, down };
