const ensureColumn = async (connection, table, column, definition) => {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  if (!Number(rows[0]?.count)) await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};

const ensureIndex = async (connection, table, index, definition) => {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
    [table, index]
  );
  if (!Number(rows[0]?.count)) await connection.query(`ALTER TABLE ${table} ADD ${definition}`);
};

const ensureForeignKey = async (connection, table, constraint, definition) => {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count FROM information_schema.table_constraints
     WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_name = ?`,
    [table, constraint]
  );
  if (!Number(rows[0]?.count)) await connection.query(`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} ${definition}`);
};

const up = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS community_collab_sessions (
      id CHAR(36) NOT NULL PRIMARY KEY,
      group_id INT UNSIGNED NOT NULL,
      channel_id INT UNSIGNED NOT NULL,
      creator_id INT UNSIGNED NOT NULL,
      session_type ENUM('code_room', 'whiteboard') NOT NULL,
      name VARCHAR(120) NOT NULL,
      summary VARCHAR(500) NOT NULL,
      status ENUM('active', 'closed') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      closed_at TIMESTAMP NULL DEFAULT NULL,
      INDEX community_collab_channel_sessions (group_id, channel_id, created_at),
      INDEX community_collab_creator_sessions (creator_id, status),
      CONSTRAINT community_collab_group_fk FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
      CONSTRAINT community_collab_channel_fk FOREIGN KEY (channel_id) REFERENCES group_channels(id) ON DELETE CASCADE,
      CONSTRAINT community_collab_creator_fk FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS community_collab_code_states (
      session_id CHAR(36) NOT NULL PRIMARY KEY,
      updated_by INT UNSIGNED NOT NULL,
      document_state LONGBLOB NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT community_collab_code_session_fk FOREIGN KEY (session_id) REFERENCES community_collab_sessions(id) ON DELETE CASCADE,
      CONSTRAINT community_collab_code_user_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
  await ensureColumn(connection, "community_whiteboard_items", "session_id", "CHAR(36) NULL");
  await ensureIndex(connection, "community_whiteboard_items", "community_whiteboard_session_items", "INDEX community_whiteboard_session_items (session_id, id)");
  await ensureForeignKey(connection, "community_whiteboard_items", "community_whiteboard_session_fk", "FOREIGN KEY (session_id) REFERENCES community_collab_sessions(id) ON DELETE CASCADE");
};

const down = async (connection) => {
  await connection.query("ALTER TABLE community_whiteboard_items DROP FOREIGN KEY community_whiteboard_session_fk, DROP INDEX community_whiteboard_session_items, DROP COLUMN session_id");
  await connection.query("DROP TABLE IF EXISTS community_collab_code_states");
  await connection.query("DROP TABLE IF EXISTS community_collab_sessions");
};

module.exports = { up, down };
