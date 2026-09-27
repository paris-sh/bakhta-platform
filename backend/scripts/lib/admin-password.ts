// Database side of `npm run admin:set-password` — kept separate from the interactive CLI so
// it can be integration-tested. Never logs or returns the password or its hash.
import type { Database } from "../../src/db/client.js";
import { hashPassword } from "../../src/modules/auth/password.js";
import { SUPER_ADMIN_ROLE } from "../../src/modules/auth/permissions.js";

export const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 200; // matches the login schema's upper bound

/** Returns a reason the password is unacceptable, or null when it is fine. */
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (password.trim() !== password) return "Leading or trailing spaces are not allowed.";
  if (new Set(password).size < 6) return "Too repetitive; use more distinct characters.";
  const localPart = email.split("@")[0]?.toLowerCase() ?? "";
  if (localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
    return "Must not contain the email's local part.";
  }
  return null;
}

/** The admin with this email, only if it holds an active SUPER_ADMIN assignment. */
export async function findActiveSuperAdmin(db: Database, email: string) {
  return db
    .selectFrom("admin_accounts as a")
    .select(["a.id", "a.email", "a.status"])
    .where("a.email", "=", email)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("admin_role_assignments as ara")
          .innerJoin("roles as r", "r.id", "ara.role_id")
          .select("ara.id")
          .whereRef("ara.admin_id", "=", "a.id")
          .where("ara.revoked_at", "is", null)
          .where("r.code", "=", SUPER_ADMIN_ROLE),
      ),
    )
    .executeTakeFirst();
}

export async function credentialExists(db: Database, adminId: string): Promise<boolean> {
  const row = await db.selectFrom("admin_credentials").select("id").where("admin_id", "=", adminId).executeTakeFirst();
  return row !== undefined;
}

/**
 * Stores an Argon2id hash (same parameters as the app) and, in the same transaction, bumps
 * auth_version, revokes the admin's active sessions and writes a SYSTEM audit entry that
 * records no secret material.
 */
export async function storeAdminPassword(db: Database, adminId: string, password: string) {
  const passwordHash = await hashPassword(password);
  return db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom("admin_credentials")
      .select("id")
      .where("admin_id", "=", adminId)
      .forUpdate()
      .executeTakeFirst();
    await trx
      .insertInto("admin_credentials")
      .values({ admin_id: adminId, password_hash: passwordHash })
      .onConflict((oc) =>
        oc.column("admin_id").doUpdateSet({ password_hash: passwordHash, password_updated_at: new Date() }),
      )
      .execute();
    await trx
      .updateTable("admin_accounts")
      .set((eb) => ({ auth_version: eb("auth_version", "+", 1) }))
      .where("id", "=", adminId)
      .execute();
    const sessions = await trx
      .updateTable("sessions")
      .set({ status: "REVOKED", revoked_at: new Date() })
      .where("admin_id", "=", adminId)
      .where("status", "=", "ACTIVE")
      .executeTakeFirst();
    await trx
      .insertInto("audit_logs")
      .values({
        actor_type: "SYSTEM",
        action: existing ? "admin_credentials.reset_cli" : "admin_credentials.set_cli",
        entity_type: "admin_accounts",
        entity_id: adminId,
        changed_fields: ["password_hash"],
        new_values: { password_updated: true },
        reason: "Password set from the admin:set-password CLI.",
        severity: "WARNING",
      })
      .execute();
    return { replaced: existing !== undefined, revokedSessions: Number(sessions.numUpdatedRows) };
  });
}
