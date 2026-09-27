-- 0003_admin_permissions.sql
-- Purpose: register the admin permission catalog (backend/src/modules/auth/permissions.ts)
-- in the permissions table so each code can be granted to roles, and grant every catalog
-- permission to the SUPER_ADMIN system role.
--
-- The backend additionally resolves an active SUPER_ADMIN assignment to the full catalog at
-- request time, so these grants are for data completeness and for granting the same codes
-- to narrower roles — not the only thing keeping SUPER_ADMIN fully privileged.
--
-- Idempotent: safe to re-run. An existing row with the same code (e.g. one created by an
-- earlier test fixture) is normalized to the catalog's module/action/risk level.

INSERT INTO permissions (code, module, action, risk_level)
VALUES
  ('dashboard.view',              'dashboard', 'view',                  'STANDARD'),
  ('games.view',                  'games',     'view',                  'STANDARD'),
  ('games.edit',                  'games',     'edit',                  'SENSITIVE'),
  ('games.activate_rule_version', 'games',     'activate_rule_version', 'CRITICAL'),
  ('draws.view',                  'draws',     'view',                  'STANDARD'),
  ('draws.create',                'draws',     'create',                'SENSITIVE'),
  ('draws.manage_evidence',       'draws',     'manage_evidence',       'SENSITIVE'),
  ('orders.view',                 'orders',    'view',                  'SENSITIVE'),
  ('audit.view',                  'audit',     'view',                  'SENSITIVE'),
  ('results.view',                'results',   'view',                  'STANDARD'),
  ('results.enter',               'results',   'enter',                 'SENSITIVE'),
  ('results.publish',             'results',   'publish',               'CRITICAL')
ON CONFLICT (code) DO UPDATE
  SET module = EXCLUDED.module,
      action = EXCLUDED.action,
      risk_level = EXCLUDED.risk_level;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'dashboard.view', 'games.view', 'games.edit', 'games.activate_rule_version',
  'draws.view', 'draws.create', 'draws.manage_evidence', 'orders.view', 'audit.view',
  'results.view', 'results.enter', 'results.publish'
)
WHERE r.code = 'SUPER_ADMIN'
ON CONFLICT (role_id, permission_id) DO NOTHING;
