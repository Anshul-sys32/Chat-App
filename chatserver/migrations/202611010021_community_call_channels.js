const up = async (connection) => {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'group_channels' AND column_name = 'channel_type'`
  );
  if (!rows[0].count) {
    await connection.query(
      "ALTER TABLE group_channels ADD COLUMN channel_type ENUM('text', 'audio', 'video') NOT NULL DEFAULT 'text' AFTER description"
    );
  }
};

const down = async (connection) => {
  await connection.query("ALTER TABLE group_channels DROP COLUMN channel_type");
};

module.exports = { up, down };