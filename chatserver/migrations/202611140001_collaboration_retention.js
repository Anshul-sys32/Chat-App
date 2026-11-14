const quoteIdentifier = (value) => {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new Error("Invalid database identifier.");
  return `\`${value}\``;
};

const setForeignKeyPolicy = async (connection, {
  table,
  column,
  referencedTable,
  referencedColumn,
  constraint,
  deleteRule,
  nullable = false,
}) => {
  const [columns] = await connection.execute(
    `SELECT is_nullable AS isNullable FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  if (!columns.length) throw new Error(`Missing ${table}.${column} during collaboration retention migration.`);

  const [foreignKeys] = await connection.execute(
    `SELECT key_usage.constraint_name AS constraintName,
            referential_constraint.delete_rule AS deleteRule
     FROM information_schema.key_column_usage key_usage
     JOIN information_schema.referential_constraints referential_constraint
       ON referential_constraint.constraint_schema = key_usage.constraint_schema
      AND referential_constraint.table_name = key_usage.table_name
      AND referential_constraint.constraint_name = key_usage.constraint_name
     WHERE key_usage.constraint_schema = DATABASE() AND key_usage.table_name = ?
       AND key_usage.column_name = ? AND key_usage.referenced_table_name IS NOT NULL`,
    [table, column]
  );
  const alreadyConfigured = foreignKeys.some((foreignKey) => (
    foreignKey.constraintName === constraint
      && String(foreignKey.deleteRule).toUpperCase() === deleteRule
  ));
  if (alreadyConfigured && (!nullable || columns[0].isNullable === "YES")) return;

  const quotedTable = quoteIdentifier(table);
  const quotedColumn = quoteIdentifier(column);
  for (const foreignKey of foreignKeys) {
    await connection.query(
      `ALTER TABLE ${quotedTable} DROP FOREIGN KEY ${quoteIdentifier(foreignKey.constraintName)}`
    );
  }
  if (nullable && columns[0].isNullable !== "YES") {
    await connection.query(`ALTER TABLE ${quotedTable} MODIFY ${quotedColumn} INT UNSIGNED NULL`);
  }
  await connection.query(
    `ALTER TABLE ${quotedTable} ADD CONSTRAINT ${quoteIdentifier(constraint)}
     FOREIGN KEY (${quotedColumn}) REFERENCES ${quoteIdentifier(referencedTable)} (${quoteIdentifier(referencedColumn)})
     ON DELETE ${deleteRule}`
  );
};

const retainedPolicies = [
  { table: "community_collab_sessions", column: "channel_id", referencedTable: "group_channels", referencedColumn: "id", constraint: "community_collab_channel_retention_fk", deleteRule: "RESTRICT" },
  { table: "community_collab_sessions", column: "creator_id", referencedTable: "users", referencedColumn: "id", constraint: "community_collab_creator_retention_fk", deleteRule: "SET NULL", nullable: true },
  { table: "community_collab_code_states", column: "updated_by", referencedTable: "users", referencedColumn: "id", constraint: "community_collab_code_user_retention_fk", deleteRule: "SET NULL", nullable: true },
  { table: "community_code_rooms", column: "updated_by", referencedTable: "users", referencedColumn: "id", constraint: "community_code_room_user_retention_fk", deleteRule: "SET NULL", nullable: true },
  { table: "community_whiteboard_items", column: "created_by", referencedTable: "users", referencedColumn: "id", constraint: "community_whiteboard_creator_retention_fk", deleteRule: "SET NULL", nullable: true },
  { table: "community_whiteboard_items", column: "updated_by", referencedTable: "users", referencedColumn: "id", constraint: "community_whiteboard_updater_retention_fk", deleteRule: "SET NULL", nullable: true },
];

const originalPolicies = [
  { table: "community_whiteboard_items", column: "created_by", referencedTable: "users", referencedColumn: "id", constraint: "community_whiteboard_creator_fk", deleteRule: "CASCADE" },
  { table: "community_whiteboard_items", column: "updated_by", referencedTable: "users", referencedColumn: "id", constraint: "community_whiteboard_updater_fk", deleteRule: "CASCADE" },
  { table: "community_code_rooms", column: "updated_by", referencedTable: "users", referencedColumn: "id", constraint: "community_code_room_user_fk", deleteRule: "CASCADE" },
  { table: "community_collab_code_states", column: "updated_by", referencedTable: "users", referencedColumn: "id", constraint: "community_collab_code_user_fk", deleteRule: "CASCADE" },
  { table: "community_collab_sessions", column: "channel_id", referencedTable: "group_channels", referencedColumn: "id", constraint: "community_collab_channel_fk", deleteRule: "CASCADE" },
  { table: "community_collab_sessions", column: "creator_id", referencedTable: "users", referencedColumn: "id", constraint: "community_collab_creator_fk", deleteRule: "CASCADE" },
];

const applyPolicies = async (connection, policies) => {
  for (const policy of policies) await setForeignKeyPolicy(connection, policy);
};

const up = async (connection) => applyPolicies(connection, retainedPolicies);
const down = async (connection) => applyPolicies(connection, originalPolicies);

module.exports = { up, down };