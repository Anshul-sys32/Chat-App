const up = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS community_whiteboard_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      group_id INT UNSIGNED NOT NULL,
      created_by INT UNSIGNED NOT NULL,
      updated_by INT UNSIGNED NOT NULL,
      item_type ENUM('stroke', 'sticky', 'rectangle', 'ellipse', 'arrow') NOT NULL,
      data JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX community_whiteboard_group_items (group_id, id),
      CONSTRAINT community_whiteboard_group_fk FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
      CONSTRAINT community_whiteboard_creator_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT community_whiteboard_updater_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
};

const down = async (connection) => {
  await connection.query("DROP TABLE IF EXISTS community_whiteboard_items");
};

module.exports = { up, down };
