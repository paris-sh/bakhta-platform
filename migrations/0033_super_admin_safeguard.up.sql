-- 0033_super_admin_safeguard.up.sql
-- Purpose: "Prevent deactivation or demotion of the final active SUPER_ADMIN through a
-- locked transaction." Two entry points can remove the last active SUPER_ADMIN: revoking
-- their admin_role_assignments row, or suspending/closing their admin_accounts row. Both
-- are guarded here. Each guard locks the surviving candidate rows with SELECT ... FOR
-- UPDATE before counting, so two concurrent revocations of two different SUPER_ADMINs
-- cannot both observe "someone else is still active" and both succeed.

CREATE OR REPLACE FUNCTION prevent_last_super_admin_revocation()
RETURNS TRIGGER AS $$
DECLARE
  v_role_code       VARCHAR;
  v_remaining_count INTEGER;
BEGIN
  -- Only relevant on a transition from active (revoked_at IS NULL) to revoked.
  IF NEW.revoked_at IS NULL OR OLD.revoked_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT code INTO v_role_code FROM roles WHERE id = NEW.role_id;
  IF v_role_code IS DISTINCT FROM 'SUPER_ADMIN' THEN
    RETURN NEW;
  END IF;

  -- Lock the surviving candidate rows first (FOR UPDATE cannot be combined with an
  -- aggregate in the same SELECT), then count them in a separate, plain SELECT.
  PERFORM 1
  FROM admin_role_assignments ara
  JOIN admin_accounts aa ON aa.id = ara.admin_id
  JOIN roles r ON r.id = ara.role_id
  WHERE r.code = 'SUPER_ADMIN'
    AND ara.revoked_at IS NULL
    AND aa.status = 'ACTIVE'
    AND ara.id <> NEW.id
  FOR UPDATE OF ara;

  SELECT count(*) INTO v_remaining_count
  FROM admin_role_assignments ara
  JOIN admin_accounts aa ON aa.id = ara.admin_id
  JOIN roles r ON r.id = ara.role_id
  WHERE r.code = 'SUPER_ADMIN'
    AND ara.revoked_at IS NULL
    AND aa.status = 'ACTIVE'
    AND ara.id <> NEW.id;

  IF v_remaining_count = 0 THEN
    RAISE EXCEPTION 'Cannot revoke the final active SUPER_ADMIN assignment (admin_role_assignments.id=%)', NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_admin_role_assignments_super_admin_guard
  BEFORE UPDATE ON admin_role_assignments
  FOR EACH ROW EXECUTE FUNCTION prevent_last_super_admin_revocation();

CREATE OR REPLACE FUNCTION prevent_last_super_admin_deactivation()
RETURNS TRIGGER AS $$
DECLARE
  v_holds_super_admin BOOLEAN;
  v_remaining_count   INTEGER;
BEGIN
  -- Only relevant on a transition away from ACTIVE.
  IF NEW.status = OLD.status OR OLD.status <> 'ACTIVE' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM admin_role_assignments ara
    JOIN roles r ON r.id = ara.role_id
    WHERE ara.admin_id = OLD.id AND ara.revoked_at IS NULL AND r.code = 'SUPER_ADMIN'
  ) INTO v_holds_super_admin;

  IF NOT v_holds_super_admin THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM admin_role_assignments ara
  JOIN admin_accounts aa ON aa.id = ara.admin_id
  JOIN roles r ON r.id = ara.role_id
  WHERE r.code = 'SUPER_ADMIN'
    AND ara.revoked_at IS NULL
    AND aa.status = 'ACTIVE'
    AND aa.id <> OLD.id
  FOR UPDATE OF ara;

  SELECT count(*) INTO v_remaining_count
  FROM admin_role_assignments ara
  JOIN admin_accounts aa ON aa.id = ara.admin_id
  JOIN roles r ON r.id = ara.role_id
  WHERE r.code = 'SUPER_ADMIN'
    AND ara.revoked_at IS NULL
    AND aa.status = 'ACTIVE'
    AND aa.id <> OLD.id;

  IF v_remaining_count = 0 THEN
    RAISE EXCEPTION 'Cannot deactivate the final active SUPER_ADMIN account (admin_accounts.id=%)', OLD.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_admin_accounts_super_admin_guard
  BEFORE UPDATE ON admin_accounts
  FOR EACH ROW EXECUTE FUNCTION prevent_last_super_admin_deactivation();

COMMENT ON FUNCTION prevent_last_super_admin_revocation() IS
  'Blocks revoking admin_role_assignments for the last remaining active SUPER_ADMIN.';
COMMENT ON FUNCTION prevent_last_super_admin_deactivation() IS
  'Blocks suspending/closing the last remaining active SUPER_ADMIN admin_accounts row.';
