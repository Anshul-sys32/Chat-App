const up = async (connection) => {
  const [columns] = await connection.execute(
    `SELECT COUNT(*) AS count FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'chat_groups' AND column_name = 'is_active'`
  );
  if (!columns[0].count) {
    await connection.query("ALTER TABLE chat_groups ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE");
  }
};

const down = async (connection) => {
  await connection.query("ALTER TABLE chat_groups DROP COLUMN is_active");
};

module.exports = { up, down };
