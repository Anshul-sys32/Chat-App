const ensureColumn = async (connection, table, column, definition) => {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  if (!rows[0].count) await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};

const ensureIndex = async (connection, table, index, definition) => {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
    [table, index]
  );
  if (!rows[0].count) await connection.query(`ALTER TABLE ${table} ADD ${definition}`);
};

const up = async (connection) => {
  await ensureColumn(connection, "chat_groups", "group_type", "ENUM('standard', 'community') NOT NULL DEFAULT 'standard'");
  await connection.query(`
    CREATE TABLE IF NOT EXISTS group_channels (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      group_id INT UNSIGNED NOT NULL,
      name VARCHAR(60) NOT NULL,
      slug VARCHAR(80) NOT NULL,
      description VARCHAR(500) NOT NULL DEFAULT '',
      posting_mode ENUM('members', 'admins') NOT NULL DEFAULT 'members',
      sort_order INT UNSIGNED NOT NULL DEFAULT 0,
      is_archived BOOLEAN NOT NULL DEFAULT FALSE,
      created_by INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY group_channels_slug_unique (group_id, slug),
      INDEX group_channels_order (group_id, is_archived, sort_order, id),
      CONSTRAINT group_channels_group_fk FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
      CONSTRAINT group_channels_creator_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB
  `);
  await ensureColumn(connection, "group_messages", "channel_id", "INT UNSIGNED NULL");
  await ensureColumn(connection, "notifications", "target_channel_id", "INT UNSIGNED NULL");
  await ensureColumn(connection, "notifications", "target_channel_name", "VARCHAR(60) NULL");
  await ensureIndex(
    connection,
    "group_messages",
    "group_messages_channel_history",
    "INDEX group_messages_channel_history (channel_id, created_at, id)"
  );
  const [constraints] = await connection.execute(
    `SELECT COUNT(*) AS count FROM information_schema.table_constraints
     WHERE constraint_schema = DATABASE() AND table_name = 'group_messages'
       AND constraint_name = 'group_messages_channel_fk'`
  );
  if (!constraints[0].count) {
    await connection.query(`
      ALTER TABLE group_messages
      ADD CONSTRAINT group_messages_channel_fk FOREIGN KEY (channel_id)
        REFERENCES group_channels(id) ON DELETE SET NULL
    `);
  }
};

const down = async (connection) => {
  await connection.query("ALTER TABLE group_messages DROP FOREIGN KEY group_messages_channel_fk");
  await connection.query("ALTER TABLE group_messages DROP INDEX group_messages_channel_history");
  await connection.query("ALTER TABLE group_messages DROP COLUMN channel_id");
  await connection.query(`
    ALTER TABLE notifications
      DROP COLUMN target_channel_name,
      DROP COLUMN target_channel_id
  `);
  await connection.query("DROP TABLE IF EXISTS group_channels");
  await connection.query("ALTER TABLE chat_groups DROP COLUMN group_type");
};

module.exports = { up, down };
