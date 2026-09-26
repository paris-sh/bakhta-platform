-- 0006_admin_role_assignments.up.sql
-- Purpose: versioned role assignment history. Revocation is a soft state (revoked_at set),
-- never a delete, so "who had SUPER_ADMIN and when" remains reconstructable.

CREATE TABLE admin_role_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      UUID NOT NULL REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  role_id       UUID NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  assigned_by   UUID REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by    UUID REFERENCES admin_accounts (id) ON DELETE RESTRICT,
  revoked_at    TIMESTAMPTZ,
  revoke_reason TEXT,
  CONSTRAINT ck_admin_role_assignments_revoke_reason
    CHECK (revoked_at IS NULL OR revoke_reason IS NOT NULL)
);

-- Appendix Key PostgreSQL Constraints: one_active_assignment_per_role
CREATE UNIQUE INDEX one_active_assignment_per_role
  ON admin_role_assignments (admin_id, role_id) WHERE revoked_at IS NULL;

CREATE INDEX ix_admin_role_assignments_role_active
  ON admin_role_assignments (role_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE admin_role_assignments IS 'Versioned admin-to-role assignment. Revocation is soft (revoked_at), never deleted.';
