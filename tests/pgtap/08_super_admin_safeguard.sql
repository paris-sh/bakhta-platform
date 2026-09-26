-- 08_super_admin_safeguard.sql
-- Purpose: verify the final active SUPER_ADMIN cannot be revoked or deactivated, whether the
-- attempt comes through revoking the role assignment or through suspending the account, while
-- a second active SUPER_ADMIN can still be revoked/deactivated freely.

BEGIN;
SELECT plan(6);

DO $do$
DECLARE
  v_role_id UUID;
  v_admin1  UUID := test_helpers.make_admin();
  v_admin2  UUID := test_helpers.make_admin();
BEGIN
  SELECT id INTO v_role_id FROM roles WHERE code = 'SUPER_ADMIN';
  IF v_role_id IS NULL THEN
    INSERT INTO roles (code, name, is_system) VALUES ('SUPER_ADMIN', 'Super Administrator', TRUE)
    RETURNING id INTO v_role_id;
  END IF;

  INSERT INTO admin_role_assignments (admin_id, role_id) VALUES (v_admin1, v_role_id);
  INSERT INTO admin_role_assignments (admin_id, role_id) VALUES (v_admin2, v_role_id);

  PERFORM set_config('test.role_id', v_role_id::text, true);
  PERFORM set_config('test.admin1', v_admin1::text, true);
  PERFORM set_config('test.admin2', v_admin2::text, true);
END
$do$;

-- Two active SUPER_ADMINs exist; revoking one is fine.
SELECT lives_ok(
  format($$ UPDATE admin_role_assignments SET revoked_at = now(), revoke_reason = 'test revoke'
             WHERE admin_id = '%s' AND role_id = '%s' $$,
    current_setting('test.admin2'), current_setting('test.role_id')),
  'revoking a SUPER_ADMIN assignment succeeds while another active SUPER_ADMIN remains'
);

-- Now only admin1 is an active SUPER_ADMIN; revoking it must fail.
SELECT throws_ok(
  format($$ UPDATE admin_role_assignments SET revoked_at = now(), revoke_reason = 'test revoke last'
             WHERE admin_id = '%s' AND role_id = '%s' $$,
    current_setting('test.admin1'), current_setting('test.role_id')),
  NULL, 'revoking the final active SUPER_ADMIN assignment is rejected'
);

SELECT is(
  (SELECT revoked_at FROM admin_role_assignments WHERE admin_id = current_setting('test.admin1')::uuid),
  NULL::timestamptz, 'the final SUPER_ADMIN assignment remains un-revoked after the rejected attempt'
);

-- Suspending the account of the (only) remaining active SUPER_ADMIN must also fail.
SELECT throws_ok(
  format($$ UPDATE admin_accounts SET status = 'SUSPENDED' WHERE id = '%s' $$, current_setting('test.admin1')),
  NULL, 'suspending the final active SUPER_ADMIN account is rejected'
);

-- Re-activate a second SUPER_ADMIN, then confirm admin1 CAN now be suspended.
SELECT lives_ok(
  format($$ INSERT INTO admin_role_assignments (admin_id, role_id) VALUES ('%s', '%s') $$,
    current_setting('test.admin2'), current_setting('test.role_id')),
  'admin2 can be re-granted SUPER_ADMIN (a fresh assignment row, the old one stays revoked)'
);

SELECT lives_ok(
  format($$ UPDATE admin_accounts SET status = 'SUSPENDED' WHERE id = '%s' $$, current_setting('test.admin1')),
  'admin1 can now be suspended because admin2 is again an active SUPER_ADMIN'
);

SELECT * FROM finish();
ROLLBACK;
