const up = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      sender_id INT UNSIGNED NOT NULL,
      recipient_id INT UNSIGNED NULL,
      group_id INT UNSIGNED NULL,
      channel_id INT UNSIGNED NULL,
      content TEXT NOT NULL,
      scheduled_at DATETIME NOT NULL,
      status ENUM('scheduled', 'sent', 'cancelled') NOT NULL DEFAULT 'scheduled',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX scheduled_messages_queue (status, scheduled_at),
      INDEX scheduled_messages_sender (sender_id, status, scheduled_at),
      CONSTRAINT scheduled_messages_sender_fk FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT scheduled_messages_recipient_fk FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT scheduled_messages_group_fk FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
      CONSTRAINT scheduled_messages_channel_fk FOREIGN KEY (channel_id) REFERENCES group_channels(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
};

const down = async (connection) => {
  await connection.query("DROP TABLE IF EXISTS scheduled_messages");
};

module.exports = { up, down };
