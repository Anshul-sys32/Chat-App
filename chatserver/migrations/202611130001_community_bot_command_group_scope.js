const up = async (connection) => {
  const [columns] = await connection.execute(
    `SELECT column_name AS name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'community_bot_commands'`
  );
  if (!columns.some((column) => column.name === "group_id")) {
    await connection.query("ALTER TABLE community_bot_commands ADD COLUMN group_id INT UNSIGNED NULL AFTER bot_id");
  }

  await connection.query(
    `UPDATE community_bot_commands command
     JOIN community_bots bot ON bot.id = command.bot_id
     SET command.group_id = bot.group_id
     WHERE command.group_id IS NULL`
  );
  await connection.query("ALTER TABLE community_bot_commands MODIFY COLUMN group_id INT UNSIGNED NOT NULL");

  const [indexes] = await connection.execute(
    `SELECT index_name AS name FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'community_bot_commands'
       AND index_name IN ('community_bot_command_unique', 'community_bot_commands_group_key')`
  );
  if (!indexes.length) {
    await connection.query("ALTER TABLE community_bot_commands ADD INDEX community_bot_commands_group_key (group_id, command_key)");
  }
};

module.exports = { up };