const up = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS scheduled_community_posts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      group_id INT UNSIGNED NOT NULL,
      channel_id INT UNSIGNED NOT NULL,
      sender_id INT UNSIGNED NOT NULL,
      content TEXT NOT NULL,
      recurrence ENUM('once', 'daily', 'weekly') NOT NULL DEFAULT 'once',
      scheduled_at DATETIME NOT NULL,
      status ENUM('scheduled', 'published', 'cancelled') NOT NULL DEFAULT 'scheduled',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX scheduled_community_posts_queue (status, scheduled_at),
      INDEX scheduled_community_posts_owner (sender_id, status, scheduled_at),
      CONSTRAINT scheduled_community_posts_group_fk FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
      CONSTRAINT scheduled_community_posts_channel_fk FOREIGN KEY (channel_id) REFERENCES group_channels(id) ON DELETE CASCADE,
      CONSTRAINT scheduled_community_posts_sender_fk FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
};

const down = async (connection) => {
  await connection.query("DROP TABLE IF EXISTS scheduled_community_posts");
};

module.exports = { up, down };