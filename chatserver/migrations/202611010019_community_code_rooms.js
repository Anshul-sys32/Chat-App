const up = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS community_code_rooms (
      group_id INT UNSIGNED NOT NULL PRIMARY KEY,
      updated_by INT UNSIGNED NOT NULL,
      document_state LONGBLOB NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT community_code_room_group_fk FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
      CONSTRAINT community_code_room_user_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
};

const down = async (connection) => {
  await connection.query("DROP TABLE IF EXISTS community_code_rooms");
};

module.exports = { up, down };
