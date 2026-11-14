const up = async (connection) => {
  const [groupIndexes] = await connection.execute(
    `SELECT COUNT(*) AS count FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'group_invitations'
       AND index_name = 'group_invitations_group'`
  );
  const [oldIndexes] = await connection.execute(
    `SELECT COUNT(*) AS count FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'group_invitations'
       AND index_name = 'group_invitations_state'`
  );
  const [slotColumns] = await connection.execute(
    `SELECT COUNT(*) AS count FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'group_invitations'
       AND column_name = 'pending_slot'`
  );
  if (!groupIndexes[0].count) {
    await connection.query("ALTER TABLE group_invitations ADD INDEX group_invitations_group (group_id, invitee_id)");
  }
  if (oldIndexes[0].count) {
    await connection.query("ALTER TABLE group_invitations DROP INDEX group_invitations_state");
  }
  if (!slotColumns[0].count) {
    await connection.query("ALTER TABLE group_invitations ADD COLUMN pending_slot TINYINT UNSIGNED NULL");
  }
  const [[{ duplicatePendingPairs }]] = await connection.execute(
    `SELECT COUNT(*) AS duplicatePendingPairs FROM (
       SELECT group_id, invitee_id FROM group_invitations
       WHERE status = 'pending' GROUP BY group_id, invitee_id HAVING COUNT(*) > 1
     ) duplicate_pairs`
  );
  if (Number(duplicatePendingPairs) > 0) {
    throw new Error("Resolve duplicate pending invitations per group/user before adding the pending-only unique index.");
  }
  await connection.execute(
    "UPDATE group_invitations SET pending_slot = CASE WHEN status = 'pending' THEN 1 ELSE NULL END"
  );
  await connection.query("ALTER TABLE group_invitations MODIFY pending_slot TINYINT UNSIGNED NULL DEFAULT 1");
  const [pendingIndexes] = await connection.execute(
    `SELECT COUNT(*) AS count FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'group_invitations'
       AND index_name = 'group_invitations_pending_unique'`
  );
  if (!pendingIndexes[0].count) {
    await connection.query(
      "ALTER TABLE group_invitations ADD UNIQUE KEY group_invitations_pending_unique (group_id, invitee_id, pending_slot)"
    );
  }
};

const down = async (connection) => {
  await connection.query("ALTER TABLE group_invitations DROP INDEX group_invitations_pending_unique");
  await connection.query("ALTER TABLE group_invitations DROP COLUMN pending_slot");
  await connection.query("ALTER TABLE group_invitations ADD UNIQUE KEY group_invitations_state (group_id, invitee_id, status)");
  await connection.query("ALTER TABLE group_invitations DROP INDEX group_invitations_group");
};

module.exports = { up, down };