const up = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS user_saved_messages (
      user_id INT UNSIGNED NOT NULL,
      message_type ENUM('direct', 'group') NOT NULL,
      message_id BIGINT UNSIGNED NOT NULL,
      saved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, message_type, message_id),
      INDEX user_saved_messages_order (user_id, saved_at),
      CONSTRAINT user_saved_messages_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
};

const down = async (connection) => {
  await connection.query("DROP TABLE IF EXISTS user_saved_messages");
};

module.exports = { up, down };