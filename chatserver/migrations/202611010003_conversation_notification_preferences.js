const up = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS conversation_notification_preferences (
      user_id INT UNSIGNED NOT NULL,
      conversation_type ENUM('direct', 'group') NOT NULL,
      conversation_id INT UNSIGNED NOT NULL,
      muted BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, conversation_type, conversation_id),
      INDEX conversation_notification_muted (conversation_type, conversation_id, muted),
      CONSTRAINT conversation_notification_user_fk
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
};

const down = async (connection) => {
  await connection.query("DROP TABLE IF EXISTS conversation_notification_preferences");
};

module.exports = { up, down };
