import type { Env } from "../../config/env.js";
import { ConflictError, ForbiddenError, RateLimitedError, UnauthorizedError } from "../../shared/errors.js";
import { generatePublicNumber, hashIdentifier } from "../../shared/identifiers.js";
import type { AuthRepository } from "./auth.repository.js";
import { hashPassword, verifyDummyPassword, verifyPassword } from "./password.js";
import { digestSessionToken, generateSessionToken } from "./session-token.js";

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export interface UserPrincipal {
  type: "USER";
  sessionId: string;
  userId: string;
}

export interface AdminPrincipal {
  type: "ADMIN";
  sessionId: string;
  adminId: string;
  permissions: string[];
}

export type Principal = UserPrincipal | AdminPrincipal;

export interface IssuedSession {
  token: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60_000);
}

export function createAuthService(repo: AuthRepository, env: Env) {
  async function assertNotRateLimited(
    principalType: "USER" | "ADMIN",
    identifierHash: Buffer,
    ctx: RequestContext,
  ): Promise<void> {
    const since = new Date(Date.now() - env.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60_000);
    const failedCount = await repo.countRecentFailedAttempts(identifierHash, principalType, since);
    if (failedCount >= env.AUTH_RATE_LIMIT_MAX_ATTEMPTS) {
      await repo.recordAuthAttempt({
        principalType,
        identifierHash,
        result: "RATE_LIMITED",
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw new RateLimitedError(
        "Too many failed attempts. Please wait before trying again.",
      );
    }
  }

  return {
    async registerUser(input: { email: string; password: string }) {
      const existing = await repo.findUserByEmail(input.email);
      if (existing) {
        // Registration is allowed to reveal "already registered" — unlike login, this is
        // not a meaningful account-enumeration risk (the client supplied the email itself
        // intending to create it).
        throw new ConflictError("An account with this email already exists.");
      }

      const passwordHash = await hashPassword(input.password);
      const user = await repo.createUser({
        userNumber: generatePublicNumber("U"),
        email: input.email,
      });
      await repo.createUserCredential(user.id, passwordHash);
      return { id: user.id, userNumber: user.user_number, email: user.email };
    },

    async loginUser(
      input: { email: string; password: string },
      ctx: RequestContext,
    ): Promise<IssuedSession> {
      const identifierHash = hashIdentifier(input.email);
      await assertNotRateLimited("USER", identifierHash, ctx);

      const user = await repo.findUserByEmail(input.email);
      const credential = user ? await repo.findUserCredential(user.id) : undefined;

      if (!user || !credential) {
        await verifyDummyPassword();
        await repo.recordAuthAttempt({
          principalType: "USER",
          identifierHash,
          result: "FAILED_UNKNOWN",
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
        });
        throw new UnauthorizedError("Invalid email or password.");
      }

      const passwordOk = await verifyPassword(credential.password_hash, input.password);
      if (!passwordOk) {
        await repo.recordAuthAttempt({
          principalType: "USER",
          identifierHash,
          result: "FAILED_PASSWORD",
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
        });
        throw new UnauthorizedError("Invalid email or password.");
      }

      if (user.status !== "ACTIVE") {
        await repo.recordAuthAttempt({
          principalType: "USER",
          identifierHash,
          result: "FAILED_LOCKED",
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
        });
        throw new ForbiddenError("This account is not active.");
      }

      const { raw, digest } = generateSessionToken();
      const idleExpiresAt = minutesFromNow(env.SESSION_USER_IDLE_MINUTES);
      const absoluteExpiresAt = hoursFromNow(env.SESSION_USER_ABSOLUTE_HOURS);
      await repo.createSession({
        principalType: "USER",
        userId: user.id,
        adminId: null,
        tokenDigest: digest,
        authVersionAtIssue: user.auth_version,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        idleExpiresAt,
        absoluteExpiresAt,
      });
      await repo.recordAuthAttempt({
        principalType: "USER",
        identifierHash,
        result: "SUCCESS",
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { token: raw, idleExpiresAt, absoluteExpiresAt };
    },

    async loginAdmin(
      input: { email: string; password: string },
      ctx: RequestContext,
    ): Promise<IssuedSession> {
      const identifierHash = hashIdentifier(input.email);
      await assertNotRateLimited("ADMIN", identifierHash, ctx);

      const admin = await repo.findAdminByEmail(input.email);
      const credential = admin ? await repo.findAdminCredential(admin.id) : undefined;

      if (!admin || !credential) {
        await verifyDummyPassword();
        await repo.recordAuthAttempt({
          principalType: "ADMIN",
          identifierHash,
          result: "FAILED_UNKNOWN",
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
        });
        throw new UnauthorizedError("Invalid email or password.");
      }

      const passwordOk = await verifyPassword(credential.password_hash, input.password);
      if (!passwordOk) {
        await repo.recordAuthAttempt({
          principalType: "ADMIN",
          identifierHash,
          result: "FAILED_PASSWORD",
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
        });
        throw new UnauthorizedError("Invalid email or password.");
      }

      if (admin.status !== "ACTIVE") {
        await repo.recordAuthAttempt({
          principalType: "ADMIN",
          identifierHash,
          result: "FAILED_LOCKED",
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
        });
        throw new ForbiddenError("This account is not active.");
      }

      const { raw, digest } = generateSessionToken();
      const idleExpiresAt = minutesFromNow(env.SESSION_ADMIN_IDLE_MINUTES);
      const absoluteExpiresAt = hoursFromNow(env.SESSION_ADMIN_ABSOLUTE_HOURS);
      await repo.createSession({
        principalType: "ADMIN",
        userId: null,
        adminId: admin.id,
        tokenDigest: digest,
        authVersionAtIssue: admin.auth_version,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        idleExpiresAt,
        absoluteExpiresAt,
      });
      await repo.recordAuthAttempt({
        principalType: "ADMIN",
        identifierHash,
        result: "SUCCESS",
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { token: raw, idleExpiresAt, absoluteExpiresAt };
    },

    async logout(rawToken: string): Promise<void> {
      const digest = digestSessionToken(rawToken);
      const session = await repo.findActiveSessionByDigest(digest);
      if (session) {
        await repo.setSessionStatus(session.id, "REVOKED");
      }
      // Logout is intentionally idempotent/silent on an unknown or already-inactive token —
      // there is nothing meaningful to reveal to the caller either way.
    },

    async verifySessionToken(rawToken: string): Promise<Principal> {
      const digest = digestSessionToken(rawToken);
      const session = await repo.findActiveSessionByDigest(digest);
      if (!session) {
        throw new UnauthorizedError("Invalid or expired session.");
      }

      const now = new Date();
      if (session.idle_expires_at < now || session.absolute_expires_at < now) {
        await repo.setSessionStatus(session.id, "EXPIRED");
        throw new UnauthorizedError("Invalid or expired session.");
      }

      if (session.principal_type === "USER") {
        const user = session.user_id ? await repo.findUserById(session.user_id) : undefined;
        if (!user || user.status !== "ACTIVE") {
          await repo.setSessionStatus(session.id, "REVOKED");
          throw new UnauthorizedError("Invalid or expired session.");
        }
        if (user.auth_version !== session.auth_version_at_issue) {
          await repo.setSessionStatus(session.id, "REVOKED");
          throw new UnauthorizedError("Session was invalidated by a global logout.");
        }
        await repo.touchSessionIdleExpiry(session.id, minutesFromNow(env.SESSION_USER_IDLE_MINUTES));
        return { type: "USER", sessionId: session.id, userId: user.id };
      }

      const admin = session.admin_id ? await repo.findAdminById(session.admin_id) : undefined;
      if (!admin || admin.status !== "ACTIVE") {
        await repo.setSessionStatus(session.id, "REVOKED");
        throw new UnauthorizedError("Invalid or expired session.");
      }
      if (admin.auth_version !== session.auth_version_at_issue) {
        await repo.setSessionStatus(session.id, "REVOKED");
        throw new UnauthorizedError("Session was invalidated by a global logout.");
      }
      await repo.touchSessionIdleExpiry(session.id, minutesFromNow(env.SESSION_ADMIN_IDLE_MINUTES));
      const permissions = await repo.resolveAdminPermissionCodes(admin.id);
      return { type: "ADMIN", sessionId: session.id, adminId: admin.id, permissions };
    },

    async getUserProfile(userId: string) {
      const user = await repo.findUserById(userId);
      if (!user) throw new UnauthorizedError("Invalid or expired session.");
      return user;
    },

    async getAdminProfile(adminId: string) {
      const admin = await repo.findAdminById(adminId);
      if (!admin) throw new UnauthorizedError("Invalid or expired session.");
      const permissions = await repo.resolveAdminPermissionCodes(adminId);
      return { admin, permissions };
    },

    /** Exposed for later modules (e.g. Users' suspend/close action) — never called from a
     * route in this module itself. */
    bumpUserAuthVersion: repo.bumpUserAuthVersion,
    bumpAdminAuthVersion: repo.bumpAdminAuthVersion,
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
