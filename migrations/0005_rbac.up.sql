-- 0005_rbac.up.sql
-- Purpose: role and permission catalog. First release ships ADMIN and SUPER_ADMIN roles
-- but the model supports future SUPPORT, DRAW_OPERATOR, FINANCE, and AUDITOR roles without
-- a schema change (roles/permissions are data, not enum values).

CREATE TABLE roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       VARCHAR NOT NULL,
  name       TEXT NOT NULL,
  is_system  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_roles_code UNIQUE (code)
);

CREATE TRIGGER trg_roles_set_updated_at
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE roles IS 'Named administrative role, e.g. ADMIN, SUPER_ADMIN.';
COMMENT ON COLUMN roles.is_system IS 'System-defined roles (ADMIN, SUPER_ADMIN) cannot be deleted through the admin panel.';

CREATE TABLE permissions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       VARCHAR NOT NULL,
  module     VARCHAR NOT NULL,
  action     VARCHAR NOT NULL,
  risk_level permission_risk_enum NOT NULL DEFAULT 'STANDARD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_permissions_code UNIQUE (code)
);

COMMENT ON TABLE permissions IS 'Atomic backend authorization unit, e.g. results.publish.';

CREATE TABLE role_permissions (
  role_id       UUID NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  permission_id UUID NOT NULL REFERENCES permissions (id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

COMMENT ON TABLE role_permissions IS 'Role-to-permission map. Authorization is enforced by backend checks against this map, not by hiding UI controls.';
