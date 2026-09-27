import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createDb, type Database } from "../../src/db/client.js";
import {
  credentialExists,
  findActiveSuperAdmin,
  passwordProblem,
  storeAdminPassword,
} from "../../scripts/lib/admin-password.js";
import { createTestAdmin } from "../helpers/fixtures.js";

describe("admin:set-password (database side)", () => {
  let app: FastifyInstance;
  let db: Database;

  beforeAll(() => {
    const env = loadEnv();
    db = createDb(env);
    app = buildApp(env, db);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  async function superAdminRoleId(): Promise<string> {
    const existing = await db.selectFrom("roles").select("id").where("code", "=", "SUPER_ADMIN").executeTakeFirst();
    if (existing) return existing.id;
    const created = await db
      .insertInto("roles")
      .values({ code: "SUPER_ADMIN", name: "Super admin" })
      .returning("id")
      .executeTakeFirstOrThrow();
    return created.id;
  }

  async function makeSuperAdmin(password: string) {
    const admin = await createTestAdmin(db, { password });
    const assignment = await db
      .insertInto("admin_role_assignments")
      .values({ admin_id: admin.id, role_id: await superAdminRoleId() })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { ...admin, assignmentId: assignment.id };
  }

  function login(email: string, password: string) {
    return app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email, password } });
  }

  it("rejects weak passwords and accepts a strong one", () => {
    const email = "bootstrap@dev-local.invalid";
    expect(passwordProblem("short-pw", email)).toMatch(/at least 12/);
    expect(passwordProblem("aaaaaaaaaaaaaaaa", email)).toMatch(/repetitive/);
    expect(passwordProblem(" leading-space-pw", email)).toMatch(/spaces/);
    expect(passwordProblem("my-bootstrap-pass-9", email)).toMatch(/local part/);
    expect(passwordProblem("Violet-Harbor-Lantern-42", email)).toBeNull();
  });

  it("only targets admins holding an active SUPER_ADMIN assignment", async () => {
    const plain = await createTestAdmin(db, { password: "irrelevant-pass-1" });
    expect(await findActiveSuperAdmin(db, plain.email)).toBeUndefined();

    const sa = await makeSuperAdmin("irrelevant-pass-2");
    expect((await findActiveSuperAdmin(db, sa.email))?.id).toBe(sa.id);

    // The schema refuses to revoke the last active SUPER_ADMIN, so keep another one around.
    await makeSuperAdmin("irrelevant-pass-3");
    await db
      .updateTable("admin_role_assignments")
      .set({ revoked_at: new Date(), revoke_reason: "test" })
      .where("id", "=", sa.assignmentId)
      .execute();
    expect(await findActiveSuperAdmin(db, sa.email)).toBeUndefined();
  });

  it("sets a first credential for an admin that has none", async () => {
    const sa = await makeSuperAdmin("placeholder-pass-1");
    await db.deleteFrom("admin_credentials").where("admin_id", "=", sa.id).execute();
    expect(await credentialExists(db, sa.id)).toBe(false);

    const result = await storeAdminPassword(db, sa.id, "Violet-Harbor-Lantern-42");
    expect(result).toEqual({ replaced: false, revokedSessions: 0 });

    const stored = await db
      .selectFrom("admin_credentials")
      .select("password_hash")
      .where("admin_id", "=", sa.id)
      .executeTakeFirstOrThrow();
    expect(stored.password_hash.startsWith("$argon2id$")).toBe(true);
    expect(stored.password_hash).not.toContain("Violet-Harbor-Lantern-42");

    expect((await login(sa.email, "Violet-Harbor-Lantern-42")).statusCode).toBe(200);

    const audit = await db
      .selectFrom("audit_logs")
      .selectAll()
      .where("entity_id", "=", sa.id)
      .where("action", "=", "admin_credentials.set_cli")
      .executeTakeFirstOrThrow();
    expect(audit.actor_type).toBe("SYSTEM");
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain("argon2");
    expect(serialized).not.toContain("Violet-Harbor-Lantern-42");
  });

  it("resets an existing credential, revokes live sessions and retires the old password", async () => {
    const sa = await makeSuperAdmin("old-password-value-1");
    const session = await login(sa.email, "old-password-value-1");
    expect(session.statusCode).toBe(200);
    const { token } = session.json();

    const result = await storeAdminPassword(db, sa.id, "Copper-Meadow-Signal-77");
    expect(result).toEqual({ replaced: true, revokedSessions: 1 });

    const me = await app.inject({ method: "GET", url: "/v1/admin/me", headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(401);
    expect((await login(sa.email, "old-password-value-1")).statusCode).toBe(401);
    expect((await login(sa.email, "Copper-Meadow-Signal-77")).statusCode).toBe(200);

    const audit = await db
      .selectFrom("audit_logs")
      .select("action")
      .where("entity_id", "=", sa.id)
      .where("action", "like", "admin_credentials.%")
      .execute();
    expect(audit.map((a) => a.action)).toEqual(["admin_credentials.reset_cli"]);
  });
});
