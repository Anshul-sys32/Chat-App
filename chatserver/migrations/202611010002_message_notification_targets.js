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
  await ensureColumn(connection, "user_notification_preferences", "direct_messages", "BOOLEAN NOT NULL DEFAULT TRUE");
  await ensureColumn(connection, "user_notification_preferences", "group_messages", "BOOLEAN NOT NULL DEFAULT TRUE");
  await ensureColumn(connection, "notifications", "category", "VARCHAR(32) NOT NULL DEFAULT 'system'");
  await ensureColumn(connection, "notifications", "target_type", "VARCHAR(16) NULL");
  await ensureColumn(connection, "notifications", "target_id", "INT UNSIGNED NULL");
  await ensureColumn(connection, "notifications", "target_name", "VARCHAR(100) NULL");
  await ensureColumn(connection, "notifications", "source_message_id", "BIGINT UNSIGNED NULL");
  await ensureIndex(
    connection,
    "notifications",
    "notifications_message_unique",
    "UNIQUE INDEX notifications_message_unique (user_id, category, source_message_id)"
  );
};

const down = async (connection) => {
  await connection.query("ALTER TABLE notifications DROP INDEX notifications_message_unique");
  await connection.query(`
    ALTER TABLE notifications
      DROP COLUMN source_message_id,
      DROP COLUMN target_name,
      DROP COLUMN target_id,
      DROP COLUMN target_type,
      DROP COLUMN category
  `);
  await connection.query(`
    ALTER TABLE user_notification_preferences
      DROP COLUMN group_messages,
      DROP COLUMN direct_messages
  `);
};

module.exports = { up, down };
