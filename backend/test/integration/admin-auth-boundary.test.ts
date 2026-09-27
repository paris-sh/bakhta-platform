import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createDb, type Database } from "../../src/db/client.js";

// Every admin endpoint authenticates BEFORE validating its params, query or body: an
// unauthenticated caller always gets 401, never a 400 that reveals the expected shape.

/** Full method + path pairs from Fastify's route tree (it prints children relative to parents). */
function adminRoutes(tree: string): [string, string][] {
  const routes: [string, string][] = [];
  const stack: string[] = [];
  for (const line of tree.split("\n")) {
    const m = line.match(/^(.*?)(?:├── |└── )(\S+) \(([^)]+)\)/);
    if (!m) continue;
    const depth = m[1]!.length / 4;
    stack.length = depth;
    const full = stack.join("") + m[2]!;
    stack[depth] = m[2]!;
    if (!full.startsWith("/v1/admin/") || full === "/v1/admin/auth/login") continue;
    for (const method of m[3]!.split(",").map((x) => x.trim())) {
      if (method !== "HEAD" && method !== "OPTIONS") routes.push([method, full]);
    }
  }
  return routes;
}

describe("admin authentication boundary", () => {
  let app: FastifyInstance;
  let db: Database;

  beforeAll(async () => {
    const env = loadEnv();
    db = createDb(env);
    app = buildApp(env, db);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  it("returns 401 before any validation on every admin route", async () => {
    const routes = adminRoutes(app.printRoutes({ commonPrefix: false }));
    expect(routes.length).toBeGreaterThan(25);
    const uuid = "00000000-0000-4000-8000-000000000000";
    const failures: string[] = [];
    for (const [method, path] of routes) {
      for (const idValue of [uuid, "not-a-uuid"]) {
        const url = path.replace(/:[A-Za-z]+/g, idValue) + (method === "GET" ? "?page=abc&pageSize=-5&from=nope" : "");
        const res = await app.inject({
          method: method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
          url,
          ...(method !== "GET" ? { payload: { garbage: true, reason: 1 } } : {}),
        });
        if (res.statusCode !== 401) failures.push(`${res.statusCode} ${method} ${url}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("returns 401 for an invalid bearer token too", async () => {
    const res = await app.inject({ method: "PATCH", url: "/v1/admin/games/not-a-uuid", headers: { authorization: "Bearer nope" }, payload: { garbage: true } });
    expect(res.statusCode).toBe(401);
  });
});
