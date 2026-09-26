-- 0033_super_admin_safeguard.down.sql
DROP TRIGGER IF EXISTS trg_admin_accounts_super_admin_guard ON admin_accounts;
DROP FUNCTION IF EXISTS prevent_last_super_admin_deactivation();
DROP TRIGGER IF EXISTS trg_admin_role_assignments_super_admin_guard ON admin_role_assignments;
DROP FUNCTION IF EXISTS prevent_last_super_admin_revocation();
