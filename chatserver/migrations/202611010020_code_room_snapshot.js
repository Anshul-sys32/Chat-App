const Y = require("yjs");

const up = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS community_code_rooms (
      group_id INT UNSIGNED NOT NULL PRIMARY KEY,
      updated_by INT UNSIGNED NOT NULL,
      document_state LONGBLOB NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT community_code_room_snapshot_group_fk FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
      CONSTRAINT community_code_room_snapshot_user_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  const [legacyTable] = await connection.execute(
    `SELECT COUNT(*) AS count FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'community_code_room_updates'`
  );
  if (!Number(legacyTable[0]?.count)) return;

  const [groups] = await connection.execute(
    "SELECT DISTINCT group_id AS groupId FROM community_code_room_updates ORDER BY group_id"
  );
  for (const { groupId } of groups) {
    const [rows] = await connection.execute(
      `SELECT user_id AS userId, document_update AS documentUpdate
       FROM community_code_room_updates WHERE group_id = ? ORDER BY id`,
      [groupId]
    );
    if (!rows.length) continue;
    const documentState = Y.mergeUpdates(rows.map((row) => row.documentUpdate));
    const updatedBy = rows[rows.length - 1].userId;
    await connection.execute(
      `INSERT INTO community_code_rooms (group_id, updated_by, document_state)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE updated_by = VALUES(updated_by), document_state = VALUES(document_state)`,
      [groupId, updatedBy, documentState]
    );
  }
};

const down = async (connection) => {
  await connection.query("DROP TABLE IF EXISTS community_code_rooms");
};

module.exports = { up, down };
