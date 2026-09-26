// node-postgres surfaces raw driver errors with a `.code` (SQLSTATE) and, for constraint
// violations, a `.constraint` (the constraint name) — this is how the "DB unique index is
// the final authority, the app catches the violation rather than relying on a
// check-then-insert race" pattern (already established at the database/pgTAP layer) is
// implemented at the application layer too.

const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(err: unknown, constraintName?: string): boolean {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as { code?: unknown; constraint?: unknown };
  if (candidate.code !== UNIQUE_VIOLATION) return false;
  if (constraintName === undefined) return true;
  return candidate.constraint === constraintName;
}
