const up = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS community_bots (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      group_id INT UNSIGNED NOT NULL,
      bot_key VARCHAR(40) NOT NULL,
      name VARCHAR(80) NOT NULL,
      description VARCHAR(240) NOT NULL DEFAULT '',
      bot_type ENUM('builtin', 'custom') NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      config JSON NULL,
      created_by INT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY community_bots_key_unique (group_id, bot_key),
      UNIQUE KEY community_bots_id_group_unique (id, group_id),
      INDEX community_bots_group_enabled (group_id, enabled),
      CONSTRAINT community_bots_group_fk FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
      CONSTRAINT community_bots_creator_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS community_bot_commands (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      bot_id BIGINT UNSIGNED NOT NULL,
      group_id INT UNSIGNED NOT NULL,
      command_key VARCHAR(32) NOT NULL,
      description VARCHAR(120) NOT NULL DEFAULT '',
      response_content VARCHAR(2000) NOT NULL,
      response_data JSON NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY community_bot_command_unique (group_id, command_key),
      INDEX community_bot_commands_enabled (bot_id, enabled),
      CONSTRAINT community_bot_command_bot_fk FOREIGN KEY (bot_id, group_id) REFERENCES community_bots(id, group_id) ON DELETE CASCADE,
      CONSTRAINT community_bot_command_group_fk FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
  const [columns] = await connection.execute(
    `SELECT column_name AS name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'group_messages'`
  );
  if (!columns.some((column) => column.name === "bot_id")) {
    await connection.query(`
      ALTER TABLE group_messages ADD COLUMN bot_id BIGINT UNSIGNED NULL,
      ADD INDEX group_messages_bot (bot_id),
      ADD CONSTRAINT group_messages_bot_fk FOREIGN KEY (bot_id) REFERENCES community_bots(id) ON DELETE SET NULL
    `);
  }
  await connection.execute(
    `UPDATE group_roles SET permissions = JSON_SET(permissions, '$.manageBots', role_key = 'admin')
     WHERE is_system = TRUE`
  );
};

const down = async (connection) => {
  const [columns] = await connection.execute(
    `SELECT column_name AS name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'group_messages'`
  );
  if (columns.some((column) => column.name === "bot_id")) {
    await connection.query("ALTER TABLE group_messages DROP FOREIGN KEY group_messages_bot_fk, DROP INDEX group_messages_bot, DROP COLUMN bot_id");
  }
  await connection.query("DROP TABLE IF EXISTS community_bot_commands");
  await connection.query("DROP TABLE IF EXISTS community_bots");
  await connection.execute("UPDATE group_roles SET permissions = JSON_REMOVE(permissions, '$.manageBots') WHERE is_system = TRUE");
};

module.exports = { up, down };