const { ensureBuiltInGroupRoles } = require("../services/groupRoles");

const up = async (connection) => {
  const [columns] = await connection.execute(
    `SELECT column_type AS type FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'group_members' AND column_name = 'role'`
  );
  if (columns[0]?.type?.startsWith("enum(")) {
    await connection.query("ALTER TABLE group_members MODIFY role VARCHAR(40) NOT NULL DEFAULT 'member'");
  }
  await connection.query(`
    CREATE TABLE IF NOT EXISTS group_roles (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      group_id INT UNSIGNED NOT NULL,
      role_key VARCHAR(40) NOT NULL,
      name VARCHAR(60) NOT NULL,
      permissions JSON NOT NULL,
      is_system BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY group_roles_key_unique (group_id, role_key),
      INDEX group_roles_group (group_id, is_system),
      CONSTRAINT group_roles_group_fk FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS community_channel_role_permissions (
      channel_id INT UNSIGNED NOT NULL,
      role_key VARCHAR(40) NOT NULL,
      can_post BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (channel_id, role_key),
      CONSTRAINT channel_role_permission_channel_fk FOREIGN KEY (channel_id) REFERENCES group_channels(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
  const [groups] = await connection.execute("SELECT id FROM chat_groups");
  for (const group of groups) await ensureBuiltInGroupRoles(connection, group.id);
};

const down = async (connection) => {
  await connection.query("UPDATE group_members SET role = 'member' WHERE role NOT IN ('admin', 'member')");
  await connection.query("DROP TABLE IF EXISTS community_channel_role_permissions");
  await connection.query("DROP TABLE IF EXISTS group_roles");
  await connection.query("ALTER TABLE group_members MODIFY role ENUM('admin', 'member') NOT NULL DEFAULT 'member'");
};

module.exports = { up, down };
