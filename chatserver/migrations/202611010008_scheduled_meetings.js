const up = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS scheduled_meetings (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      organizer_id INT UNSIGNED NOT NULL,
      title VARCHAR(120) NOT NULL,
      description VARCHAR(1000) NOT NULL DEFAULT '',
      scheduled_at DATETIME NOT NULL,
      status ENUM('scheduled', 'cancelled') NOT NULL DEFAULT 'scheduled',
      reminder_sent_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX meetings_organizer_schedule (organizer_id, scheduled_at),
      INDEX meetings_reminder_queue (status, reminder_sent_at, scheduled_at),
      CONSTRAINT scheduled_meetings_organizer_fk FOREIGN KEY (organizer_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS meeting_participants (
      meeting_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NOT NULL,
      status ENUM('invited', 'accepted', 'declined') NOT NULL DEFAULT 'invited',
      invited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      responded_at DATETIME NULL,
      PRIMARY KEY (meeting_id, user_id),
      INDEX meeting_participants_user (user_id, status, meeting_id),
      CONSTRAINT meeting_participants_meeting_fk FOREIGN KEY (meeting_id) REFERENCES scheduled_meetings(id) ON DELETE CASCADE,
      CONSTRAINT meeting_participants_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
};

const down = async (connection) => {
  await connection.query("DROP TABLE IF EXISTS meeting_participants");
  await connection.query("DROP TABLE IF EXISTS scheduled_meetings");
};

module.exports = { up, down };
