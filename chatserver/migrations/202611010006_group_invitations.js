const up = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS group_invitations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      group_id INT UNSIGNED NOT NULL,
      invitee_id INT UNSIGNED NOT NULL,
      invited_by INT UNSIGNED NOT NULL,
      notification_id BIGINT UNSIGNED NULL,
      status ENUM('pending', 'accepted', 'rejected') NOT NULL DEFAULT 'pending',
      pending_slot TINYINT UNSIGNED NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      responded_at TIMESTAMP NULL,
      INDEX group_invitations_group (group_id, invitee_id),
      UNIQUE KEY group_invitations_pending_unique (group_id, invitee_id, pending_slot),
      INDEX group_invitations_invitee (invitee_id, status, created_at),
      CONSTRAINT group_invitations_group_fk FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
      CONSTRAINT group_invitations_invitee_fk FOREIGN KEY (invitee_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT group_invitations_inviter_fk FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT group_invitations_notification_fk FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE SET NULL
    ) ENGINE=InnoDB
  `);
};

const down = async (connection) => {
  await connection.query("DROP TABLE IF EXISTS group_invitations");
};

module.exports = { up, down };
