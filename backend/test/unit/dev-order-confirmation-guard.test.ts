import { describe, expect, it } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Env } from "../../src/config/env.js";
import { requireDevOrderConfirmation } from "../../src/modules/orders/orders.routes.js";

function fakeEnv(overrides: Partial<Env>): Env {
  return {
    DATABASE_URL: "postgresql://irrelevant",
    HOST: "0.0.0.0",
    PORT: 3000,
    LOG_LEVEL: "silent",
    NODE_ENV: "development",
    SESSION_USER_IDLE_MINUTES: 60,
    SESSION_USER_ABSOLUTE_HOURS: 336,
    SESSION_ADMIN_IDLE_MINUTES: 15,
    SESSION_ADMIN_ABSOLUTE_HOURS: 8,
    AUTH_RATE_LIMIT_MAX_ATTEMPTS: 10,
    AUTH_RATE_LIMIT_WINDOW_MINUTES: 15,
    DEV_ORDER_CONFIRMATION_ENABLED: false,
    CORS_ORIGINS: ["http://localhost:3001"],
    ...overrides,
  };
}

const fakeRequest = {} as FastifyRequest;
const fakeReply = {} as FastifyReply;

describe("requireDevOrderConfirmation", () => {
  it("blocks when the flag is off, even in development", async () => {
    const guard = requireDevOrderConfirmation(
      fakeEnv({ NODE_ENV: "development", DEV_ORDER_CONFIRMATION_ENABLED: false }),
    );
    await expect(guard(fakeRequest, fakeReply)).rejects.toThrow();
  });

  it("blocks when NODE_ENV is production, EVEN IF the flag is mistakenly true", async () => {
    const guard = requireDevOrderConfirmation(
      fakeEnv({ NODE_ENV: "production", DEV_ORDER_CONFIRMATION_ENABLED: true }),
    );
    await expect(guard(fakeRequest, fakeReply)).rejects.toThrow();
  });

  it("allows it only when both conditions hold: non-production AND the flag is true", async () => {
    const guard = requireDevOrderConfirmation(
      fakeEnv({ NODE_ENV: "development", DEV_ORDER_CONFIRMATION_ENABLED: true }),
    );
    await expect(guard(fakeRequest, fakeReply)).resolves.toBeUndefined();
  });

  it("also allows it in NODE_ENV=test with the flag true (how the test suite itself runs)", async () => {
    const guard = requireDevOrderConfirmation(
      fakeEnv({ NODE_ENV: "test", DEV_ORDER_CONFIRMATION_ENABLED: true }),
    );
    await expect(guard(fakeRequest, fakeReply)).resolves.toBeUndefined();
  });
});
