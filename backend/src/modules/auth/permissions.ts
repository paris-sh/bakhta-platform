// The canonical catalog of admin permission codes. Every requirePermission() check in the
// codebase uses a code from here, and seeds/0003_admin_permissions.sql registers exactly
// these rows in the permissions table (so they can be granted to roles).
//
// SUPER_ADMIN is not granted codes one by one: an admin with an active SUPER_ADMIN role
// assignment resolves to EVERY code in this catalog (see auth.repository.ts), so a newly
// added permission can never be accidentally missing for the top role.

export const ADMIN_PERMISSIONS = {
  DASHBOARD_VIEW: "dashboard.view",
  GAMES_VIEW: "games.view",
  GAMES_EDIT: "games.edit",
  GAMES_ACTIVATE_RULE_VERSION: "games.activate_rule_version",
  DRAWS_VIEW: "draws.view",
  DRAWS_CREATE: "draws.create",
  DRAWS_MANAGE_EVIDENCE: "draws.manage_evidence",
  ORDERS_VIEW: "orders.view",
  AUDIT_VIEW: "audit.view",
} as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[keyof typeof ADMIN_PERMISSIONS];

export const ALL_ADMIN_PERMISSIONS: readonly AdminPermission[] = Object.values(ADMIN_PERMISSIONS);

export const SUPER_ADMIN_ROLE = "SUPER_ADMIN";
