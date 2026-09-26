import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createDb, type Database } from "../../src/db/client.js";
import { createTestUser } from "../helpers/fixtures.js";

describe("user auth flow", () => {
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

  it("registers a new user", async () => {
    const email = `register-${randomUUID()}@test.invalid`;
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password: "correct-horse-battery" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.email).toBe(email);
    expect(body.userNumber).toMatch(/^U-/);
  });

  it("rejects registering the same email twice", async () => {
    const email = `dup-${randomUUID()}@test.invalid`;
    await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password: "correct-horse-battery" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password: "another-password-1" },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("CONFLICT");
  });

  it("logs in, fetches /v1/me, then logs out and can no longer use the token", async () => {
    const password = "correct-horse-battery";
    const user = await createTestUser(db, { password });

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: user.email, password },
    });
    expect(login.statusCode).toBe(200);
    const { token } = login.json();
    expect(typeof token).toBe("string");

    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(user.email);

    const logout = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logout.statusCode).toBe(204);

    const meAfterLogout = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(meAfterLogout.statusCode).toBe(401);
  });

  it("rejects the wrong password with a generic message", async () => {
    const user = await createTestUser(db, { password: "correct-horse-battery" });
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: user.email, password: "wrong-password" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toBe("Invalid email or password.");
  });

  it("rejects an unknown email with the SAME generic message (no account enumeration)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: `nobody-${randomUUID()}@test.invalid`, password: "whatever123" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toBe("Invalid email or password.");
  });

  it("rejects login for a suspended account after a correct password", async () => {
    const password = "correct-horse-battery";
    const user = await createTestUser(db, { password, status: "SUSPENDED" });
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: user.email, password },
    });
    expect(response.statusCode).toBe(403);
  });

  it("rejects a missing Authorization header on a protected route", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/me" });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a well-formed but unknown bearer token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects an ADMIN-only route reached with a USER session", async () => {
    const password = "correct-horse-battery";
    const user = await createTestUser(db, { password });
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: user.email, password },
    });
    const { token } = login.json();

    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(403);
  });
});
