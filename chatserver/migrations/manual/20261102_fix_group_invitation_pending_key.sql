-- Repair for migration 202611010007_group_invitation_pending_key.
-- Run against the intended database with a MySQL client, then rerun
-- `npm run db:migrate` from the chatserver directory so schema_migrations
-- records version 202611010007_group_invitation_pending_key.
--
-- This is safe to rerun. It replaces the old uniqueness rule
-- (group_id, invitee_id, status), which incorrectly allowed only one
-- historical rejection, with a nullable pending_slot unique key.
-- The group_id foreign key is intentionally not recreated here: MySQL rejects
-- it for this database's current schema. The invitation-state repair does not
-- require that foreign key; diagnose/restore it separately after this repair.

DELIMITER $$

DROP PROCEDURE IF EXISTS fix_group_invitation_pending_key $$
CREATE PROCEDURE fix_group_invitation_pending_key()
BEGIN
  DECLARE old_index_count INT DEFAULT 0;
  DECLARE support_index_count INT DEFAULT 0;
  DECLARE pending_column_count INT DEFAULT 0;
  DECLARE pending_index_count INT DEFAULT 0;

  SELECT COUNT(*) INTO support_index_count
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'group_invitations'
    AND index_name = 'group_invitations_group';

  IF support_index_count = 0 THEN
    ALTER TABLE group_invitations
      ADD INDEX group_invitations_group (group_id, invitee_id);
  END IF;

  SELECT COUNT(*) INTO old_index_count
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'group_invitations'
    AND index_name = 'group_invitations_state';

  IF old_index_count > 0 THEN
    ALTER TABLE group_invitations DROP INDEX group_invitations_state;
  END IF;

  SELECT COUNT(*) INTO pending_column_count
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'group_invitations'
    AND column_name = 'pending_slot';

  IF pending_column_count = 0 THEN
    ALTER TABLE group_invitations ADD COLUMN pending_slot TINYINT UNSIGNED NULL;
  END IF;

  UPDATE group_invitations
    SET pending_slot = CASE WHEN status = 'pending' THEN 1 ELSE NULL END;

  ALTER TABLE group_invitations MODIFY pending_slot TINYINT UNSIGNED NULL DEFAULT 1;

  SELECT COUNT(*) INTO pending_index_count
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'group_invitations'
    AND index_name = 'group_invitations_pending_unique';

  IF pending_index_count = 0 THEN
    ALTER TABLE group_invitations
      ADD UNIQUE INDEX group_invitations_pending_unique (group_id, invitee_id, pending_slot);
  END IF;

END $$

CALL fix_group_invitation_pending_key() $$
DROP PROCEDURE fix_group_invitation_pending_key $$

DELIMITER ;
