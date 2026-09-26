import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createDb, type Database } from "../../src/db/client.js";
import { createTestUser } from "../helpers/fixtures.js";

describe("session lifecycle", () => {
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

  async function loginNewUser(): Promise<{ token: string; userId: string }> {
    const password = "correct-horse-battery";
    const user = await createTestUser(db, { password });
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: user.email, password },
    });
    return { token: login.json().token as string, userId: user.id };
  }

  it("rejects a session past its idle_expires_at, and flips its status to EXPIRED", async () => {
    const { token } = await loginNewUser();

    // Simulate the clock moving past idle expiry rather than waiting in real time.
    await db
      .updateTable("sessions")
      .set({ idle_expires_at: new Date(Date.now() - 1000) })
      .where(
        "token_digest",
        "=",
        (await import("../../src/modules/auth/session-token.js")).digestSessionToken(token),
      )
      .execute();

    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);

    const { digestSessionToken } = await import("../../src/modules/auth/session-token.js");
    const session = await db
      .selectFrom("sessions")
      .select(["status"])
      .where("token_digest", "=", digestSessionToken(token))
      .executeTakeFirstOrThrow();
    expect(session.status).toBe("EXPIRED");
  });

  it("rejects a session past its absolute_expires_at", async () => {
    const { token } = await loginNewUser();
    const { digestSessionToken } = await import("../../src/modules/auth/session-token.js");

    // sessions.ck_sessions_expiry_order requires idle_expires_at <= absolute_expires_at, so
    // "absolute expired but idle still fresh" is not a reachable state — the DB itself
    // guarantees idle_expires_at has also passed whenever absolute_expires_at has. Set both,
    // consistent with that invariant, to exercise the absolute-expiry branch specifically.
    await db
      .updateTable("sessions")
      .set({
        idle_expires_at: new Date(Date.now() - 2000),
        absolute_expires_at: new Date(Date.now() - 1000),
      })
      .where("token_digest", "=", digestSessionToken(token))
      .execute();

    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it("global logout (auth_version bump) instantly invalidates an existing session", async () => {
    const { token, userId } = await loginNewUser();

    const before = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.statusCode).toBe(200);

    await app.authService.bumpUserAuthVersion(userId);

    const after = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it("sliding idle expiry: a successful request pushes idle_expires_at further out", async () => {
    const { token } = await loginNewUser();
    const { digestSessionToken } = await import("../../src/modules/auth/session-token.js");
    const digest = digestSessionToken(token);

    const initial = await db
      .selectFrom("sessions")
      .select(["idle_expires_at"])
      .where("token_digest", "=", digest)
      .executeTakeFirstOrThrow();

    // Force the stored idle_expires_at artificially backward so the post-request bump is
    // unambiguous regardless of how fast this test runs.
    await db
      .updateTable("sessions")
      .set({ idle_expires_at: new Date(Date.now() + 1000) })
      .where("token_digest", "=", digest)
      .execute();

    await app.inject({ method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${token}` } });

    const after = await db
      .selectFrom("sessions")
      .select(["idle_expires_at"])
      .where("token_digest", "=", digest)
      .executeTakeFirstOrThrow();

    expect(after.idle_expires_at.getTime()).toBeGreaterThan(
      new Date(Date.now() + 1000).getTime(),
    );
    expect(initial.idle_expires_at).toBeDefined();
  });

  it("rate-limits login after repeated failed attempts for the same email", async () => {
    const env = loadEnv();
    const password = "correct-horse-battery";
    const user = await createTestUser(db, { password });

    let lastStatus = 0;
    for (let i = 0; i < env.AUTH_RATE_LIMIT_MAX_ATTEMPTS + 1; i++) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email: user.email, password: "wrong-password" },
      });
      lastStatus = response.statusCode;
    }

    expect(lastStatus).toBe(429);

    // Even the CORRECT password is now rejected until the window passes — the limiter
    // guards the identifier, not "wrong password specifically".
    const correctAttempt = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: user.email, password },
    });
    expect(correctAttempt.statusCode).toBe(429);
  });
});
