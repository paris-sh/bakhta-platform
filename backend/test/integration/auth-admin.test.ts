import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createDb, type Database } from "../../src/db/client.js";
import { createTestAdmin } from "../helpers/fixtures.js";

describe("admin auth flow", () => {
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

  it("logs in an admin and resolves their granted permissions", async () => {
    const password = "correct-horse-battery";
    const permCode = `test.permission.${randomUUID().slice(0, 8)}`;
    const admin = await createTestAdmin(db, { password, permissionCodes: [permCode] });

    const login = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/login",
      payload: { email: admin.email, password },
    });
    expect(login.statusCode).toBe(200);
    const { token } = login.json();

    const me = await app.inject({
      method: "GET",
      url: "/v1/admin/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(body.email).toBe(admin.email);
    expect(body.permissions).toContain(permCode);
  });

  it("an admin with no role assignments has an empty permission set", async () => {
    const password = "correct-horse-battery";
    const admin = await createTestAdmin(db, { password });

    const login = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/login",
      payload: { email: admin.email, password },
    });
    const { token } = login.json();

    const me = await app.inject({
      method: "GET",
      url: "/v1/admin/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.json().permissions).toEqual([]);
  });

  it("rejects a USER-only route reached with an ADMIN session", async () => {
    const password = "correct-horse-battery";
    const admin = await createTestAdmin(db, { password });
    const login = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/login",
      payload: { email: admin.email, password },
    });
    const { token } = login.json();

    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(403);
  });
});
