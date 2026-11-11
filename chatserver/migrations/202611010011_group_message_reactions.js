const up = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS group_message_reactions (
      message_id BIGINT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      emoji VARCHAR(16) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (message_id, user_id, emoji),
      INDEX group_message_reactions_active (message_id, is_active, emoji),
      CONSTRAINT group_message_reaction_message_fk FOREIGN KEY (message_id) REFERENCES group_messages(id) ON DELETE CASCADE,
      CONSTRAINT group_message_reaction_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
};

const down = async (connection) => {
  await connection.query("DROP TABLE IF EXISTS group_message_reactions");
};

module.exports = { up, down };