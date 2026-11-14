const up = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS user_notification_preferences (
      user_id INT UNSIGNED NOT NULL PRIMARY KEY,
      browser_notifications BOOLEAN NOT NULL DEFAULT FALSE,
      notification_sounds BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT notification_preferences_user_fk
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
};

const down = async (connection) => {
  await connection.query("DROP TABLE IF EXISTS user_notification_preferences");
};

module.exports = { up, down };
