const up = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS community_integrations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      group_id INT UNSIGNED NOT NULL,
      channel_id INT UNSIGNED NOT NULL,
      provider VARCHAR(32) NOT NULL,
      name VARCHAR(80) NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      config JSON NOT NULL,
      secret_ciphertext TEXT NULL,
      secret_iv VARCHAR(24) NULL,
      secret_tag VARCHAR(32) NULL,
      secret_key_version VARCHAR(16) NOT NULL DEFAULT 'v1',
      created_by INT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY community_integrations_name_unique (group_id, provider, name),
      INDEX community_integrations_worker (provider, enabled, updated_at),
      CONSTRAINT community_integrations_group_fk FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
      CONSTRAINT community_integrations_channel_fk FOREIGN KEY (channel_id) REFERENCES group_channels(id) ON DELETE CASCADE,
      CONSTRAINT community_integrations_creator_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS community_integration_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      integration_id BIGINT UNSIGNED NOT NULL,
      event_key VARCHAR(191) NOT NULL,
      event_type VARCHAR(80) NOT NULL,
      payload JSON NOT NULL,
      status ENUM('queued', 'processing', 'succeeded', 'failed') NOT NULL DEFAULT 'queued',
      attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
      available_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      locked_at TIMESTAMP NULL,
      last_error VARCHAR(500) NULL,
      completed_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY community_integration_event_unique (integration_id, event_key),
      INDEX community_integration_event_queue (status, available_at, id),
      CONSTRAINT community_integration_event_integration_fk FOREIGN KEY (integration_id) REFERENCES community_integrations(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS community_integration_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      integration_id BIGINT UNSIGNED NOT NULL,
      event_id BIGINT UNSIGNED NULL,
      action VARCHAR(40) NOT NULL,
      status VARCHAR(20) NOT NULL,
      message VARCHAR(500) NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX community_integration_logs_history (integration_id, id),
      CONSTRAINT community_integration_log_integration_fk FOREIGN KEY (integration_id) REFERENCES community_integrations(id) ON DELETE CASCADE,
      CONSTRAINT community_integration_log_event_fk FOREIGN KEY (event_id) REFERENCES community_integration_events(id) ON DELETE SET NULL
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS community_integration_webhook_limits (
      integration_id BIGINT UNSIGNED NOT NULL,
      window_start DATETIME NOT NULL,
      request_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (integration_id, window_start),
      CONSTRAINT community_integration_webhook_limit_fk FOREIGN KEY (integration_id) REFERENCES community_integrations(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
  const [columns] = await connection.execute(
    `SELECT column_name AS name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'group_messages'`
  );
  if (!columns.some((column) => column.name === "integration_id")) {
    await connection.query(`
      ALTER TABLE group_messages ADD COLUMN integration_id BIGINT UNSIGNED NULL,
      ADD INDEX group_messages_integration (integration_id),
      ADD CONSTRAINT group_messages_integration_fk FOREIGN KEY (integration_id) REFERENCES community_integrations(id) ON DELETE SET NULL
    `);
  }
  await connection.execute(
    `UPDATE group_roles SET permissions = JSON_SET(permissions, '$.manageIntegrations', role_key = 'admin')
     WHERE is_system = TRUE`
  );
};

const down = async (connection) => {
  const [columns] = await connection.execute(
    `SELECT column_name AS name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'group_messages'`
  );
  if (columns.some((column) => column.name === "integration_id")) {
    await connection.query("ALTER TABLE group_messages DROP FOREIGN KEY group_messages_integration_fk, DROP INDEX group_messages_integration, DROP COLUMN integration_id");
  }
  await connection.query("DROP TABLE IF EXISTS community_integration_logs");
  await connection.query("DROP TABLE IF EXISTS community_integration_webhook_limits");
  await connection.query("DROP TABLE IF EXISTS community_integration_events");
  await connection.query("DROP TABLE IF EXISTS community_integrations");
  await connection.execute("UPDATE group_roles SET permissions = JSON_REMOVE(permissions, '$.manageIntegrations') WHERE is_system = TRUE");
};

module.exports = { up, down };