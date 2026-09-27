import type { Database } from "../../db/client.js";
import type {
  AccountStatusEnum,
  AuthAttemptResultEnum,
  SessionPrincipalEnum,
  SessionStatusEnum,
} from "../../db/types.js";
import { ALL_ADMIN_PERMISSIONS, SUPER_ADMIN_ROLE } from "./permissions.js";

export function createAuthRepository(db: Database) {
  return {
    async findUserByEmail(email: string) {
      return db
        .selectFrom("users")
        .selectAll()
        .where("email", "=", email)
        .executeTakeFirst();
    },

    async findUserById(id: string) {
      return db.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst();
    },

    async findUserCredential(userId: string) {
      return db
        .selectFrom("user_credentials")
        .selectAll()
        .where("user_id", "=", userId)
        .executeTakeFirst();
    },

    async createUser(input: { userNumber: string; email: string }) {
      return db
        .insertInto("users")
        .values({ user_number: input.userNumber, email: input.email })
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    async createUserCredential(userId: string, passwordHash: string) {
      return db
        .insertInto("user_credentials")
        .values({ user_id: userId, password_hash: passwordHash })
        .executeTakeFirstOrThrow();
    },

    async findAdminByEmail(email: string) {
      return db
        .selectFrom("admin_accounts")
        .selectAll()
        .where("email", "=", email)
        .executeTakeFirst();
    },

    async findAdminById(id: string) {
      return db
        .selectFrom("admin_accounts")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
    },

    async findAdminCredential(adminId: string) {
      return db
        .selectFrom("admin_credentials")
        .selectAll()
        .where("admin_id", "=", adminId)
        .executeTakeFirst();
    },

    /** Role codes of every currently-active role assignment. */
    async resolveAdminRoleCodes(adminId: string): Promise<string[]> {
      const rows = await db
        .selectFrom("admin_role_assignments as ara")
        .innerJoin("roles as r", "r.id", "ara.role_id")
        .select("r.code")
        .distinct()
        .where("ara.admin_id", "=", adminId)
        .where("ara.revoked_at", "is", null)
        .execute();
      return rows.map((r) => r.code).sort();
    },

    /** Permission codes granted to an admin via every currently-active role assignment.
     * An active SUPER_ADMIN assignment resolves to the whole permission catalog (plus any
     * extra codes granted in the database), so the top role can never lack a permission. */
    async resolveAdminPermissionCodes(adminId: string): Promise<string[]> {
      const rows = await db
        .selectFrom("admin_role_assignments as ara")
        .innerJoin("role_permissions as rp", "rp.role_id", "ara.role_id")
        .innerJoin("permissions as p", "p.id", "rp.permission_id")
        .select("p.code")
        .distinct()
        .where("ara.admin_id", "=", adminId)
        .where("ara.revoked_at", "is", null)
        .execute();
      const codes = new Set(rows.map((r) => r.code));
      const roles = await this.resolveAdminRoleCodes(adminId);
      if (roles.includes(SUPER_ADMIN_ROLE)) {
        for (const code of ALL_ADMIN_PERMISSIONS) codes.add(code);
      }
      return [...codes].sort();
    },

    async createSession(input: {
      principalType: SessionPrincipalEnum;
      userId: string | null;
      adminId: string | null;
      tokenDigest: Buffer;
      authVersionAtIssue: number;
      ipAddress: string | null;
      userAgent: string | null;
      idleExpiresAt: Date;
      absoluteExpiresAt: Date;
    }) {
      return db
        .insertInto("sessions")
        .values({
          principal_type: input.principalType,
          user_id: input.userId,
          admin_id: input.adminId,
          token_digest: input.tokenDigest,
          auth_version_at_issue: input.authVersionAtIssue,
          ip_address: input.ipAddress,
          user_agent: input.userAgent,
          idle_expires_at: input.idleExpiresAt,
          absolute_expires_at: input.absoluteExpiresAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    async findActiveSessionByDigest(tokenDigest: Buffer) {
      return db
        .selectFrom("sessions")
        .selectAll()
        .where("token_digest", "=", tokenDigest)
        .where("status", "=", "ACTIVE")
        .executeTakeFirst();
    },

    async touchSessionIdleExpiry(sessionId: string, idleExpiresAt: Date) {
      await db
        .updateTable("sessions")
        .set({ idle_expires_at: idleExpiresAt })
        .where("id", "=", sessionId)
        .execute();
    },

    async setSessionStatus(sessionId: string, status: SessionStatusEnum) {
      await db
        .updateTable("sessions")
        .set({ status, revoked_at: new Date() })
        .where("id", "=", sessionId)
        .execute();
    },

    async recordAuthAttempt(input: {
      principalType: SessionPrincipalEnum;
      identifierHash: Buffer;
      result: AuthAttemptResultEnum;
      ipAddress: string | null;
      userAgent: string | null;
    }) {
      await db
        .insertInto("auth_attempts")
        .values({
          principal_type: input.principalType,
          identifier_hash: input.identifierHash,
          result: input.result,
          ip_address: input.ipAddress,
          user_agent: input.userAgent,
        })
        .execute();
    },

    async countRecentFailedAttempts(
      identifierHash: Buffer,
      principalType: SessionPrincipalEnum,
      since: Date,
    ): Promise<number> {
      const result = await db
        .selectFrom("auth_attempts")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("identifier_hash", "=", identifierHash)
        .where("principal_type", "=", principalType)
        .where("created_at", ">=", since)
        .where("result", "!=", "SUCCESS")
        .executeTakeFirstOrThrow();
      return Number(result.count);
    },

    /** Global logout: every session issued before this bump is instantly stale. */
    async bumpUserAuthVersion(userId: string) {
      await db
        .updateTable("users")
        .set((eb) => ({ auth_version: eb("auth_version", "+", 1) }))
        .where("id", "=", userId)
        .execute();
    },

    async bumpAdminAuthVersion(adminId: string) {
      await db
        .updateTable("admin_accounts")
        .set((eb) => ({ auth_version: eb("auth_version", "+", 1) }))
        .where("id", "=", adminId)
        .execute();
    },
  };
}

export type AuthRepository = ReturnType<typeof createAuthRepository>;
export type { AccountStatusEnum };
