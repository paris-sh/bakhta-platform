import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createDb, type Database } from "../../src/db/client.js";
import { ALL_ADMIN_PERMISSIONS } from "../../src/modules/auth/permissions.js";
import { createAdminRepository } from "../../src/modules/admin/admin.repository.js";
import { createAdminService } from "../../src/modules/admin/admin.service.js";
import { createOrdersRepository } from "../../src/modules/orders/orders.repository.js";
import { createTestAdmin, createTestDraw, createTestUser, toSlotSchedule } from "../helpers/fixtures.js";

const PASSWORD = "correct-horse-battery";

const SIX_V2 = {
  schema_version: 2,
  schedule: {
    timezone: "Asia/Tehran",
    active_weekdays: [0, 1, 2, 3, 4, 5, 6],
    draw_time: "21:00",
    sales_open_hours_before_draw: 72,
    sales_close_minutes_before_draw: 30,
    exceptions: [],
  },
  selection: {
    main_numbers: { count: 6, min: 1, max: 33, distinct: true, order_matters: false },
    chance_symbol: { min: 1, max: 5 },
    required_numbers_per_combination: 6,
    maximum_selected_numbers_per_line: 12,
    maximum_selected_symbols_per_line: 5,
    maximum_combinations_per_line: 5000,
    maximum_combinations_per_order: 25000,
  },
  ticket_price_toman: 100000,
  tiers: [{ code: "MAIN6_CHANCE", match: "6_MAIN_PLUS_CHANCE", prize_type: "JACKPOT_POOL" }],
  minimum_jackpot_toman: 100000000,
  jackpot_contribution_bps: 6000,
  jackpot_net_sales_basis: "CONFIRMED_SALES_LESS_LOWER_TIER_PRIZES_AND_REFUNDS",
  jackpot_no_winner_rollover: true,
  jackpot_max_toman: null,
  lower_tier_payout_cap_toman: null,
  lower_tier_cap_reduction_strategy: "PROPORTIONAL_PRESERVE_TIER_ORDER",
};

const ADMIN_ENDPOINTS = [
  "/v1/admin/dashboard",
  "/v1/admin/draws",
  "/v1/admin/orders",
  `/v1/admin/orders/${randomUUID()}`,
  "/v1/admin/audit-logs",
];

describe("admin panel endpoints", () => {
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

  async function adminToken(permissionCodes: string[], opts: { superAdmin?: boolean } = {}) {
    const admin = await createTestAdmin(db, { password: PASSWORD, permissionCodes });
    if (opts.superAdmin) {
      // Seeds create SUPER_ADMIN; a migrated-only test database may not have it yet.
      const role =
        (await db.selectFrom("roles").select("id").where("code", "=", "SUPER_ADMIN").executeTakeFirst()) ??
        (await db
          .insertInto("roles")
          .values({ code: "SUPER_ADMIN", name: "Super admin" })
          .returning("id")
          .executeTakeFirstOrThrow());
      await db.insertInto("admin_role_assignments").values({ admin_id: admin.id, role_id: role.id }).execute();
    }
    const login = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/login",
      payload: { email: admin.email, password: PASSWORD },
    });
    return { admin, token: login.json().token as string };
  }

  async function userToken() {
    const user = await createTestUser(db, { password: PASSWORD });
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: user.email, password: PASSWORD } });
    return { user, token: login.json().token as string };
  }

  const get = (url: string, token?: string) =>
    app.inject({ method: "GET", url, headers: token ? { authorization: `Bearer ${token}` } : {} });

  describe("identity separation and RBAC", () => {
    it("rejects every admin endpoint without a session (401)", async () => {
      for (const url of ADMIN_ENDPOINTS) expect((await get(url)).statusCode).toBe(401);
    });

    it("rejects a customer session on admin endpoints (403) and an admin session on customer endpoints (403)", async () => {
      const { token: customer } = await userToken();
      for (const url of ADMIN_ENDPOINTS) expect((await get(url, customer)).statusCode).toBe(403);
      const { token: admin } = await adminToken(ALL_ADMIN_PERMISSIONS as string[]);
      expect((await get("/v1/me", admin)).statusCode).toBe(403);
      expect((await get("/v1/me/orders", admin)).statusCode).toBe(403);
    });

    it("enforces the specific permission per endpoint", async () => {
      const { token } = await adminToken(["draws.view"]);
      expect((await get("/v1/admin/draws", token)).statusCode).toBe(200);
      expect((await get("/v1/admin/dashboard", token)).statusCode).toBe(403);
      expect((await get("/v1/admin/orders", token)).statusCode).toBe(403);
      expect((await get("/v1/admin/audit-logs", token)).statusCode).toBe(403);
    });

    it("SUPER_ADMIN resolves to every catalog permission and reports its role", async () => {
      const { token } = await adminToken([], { superAdmin: true });
      const me = await get("/v1/admin/me", token);
      expect(me.statusCode).toBe(200);
      expect(me.json().roles).toContain("SUPER_ADMIN");
      for (const code of ALL_ADMIN_PERMISSIONS) expect(me.json().permissions).toContain(code);
      const serialized = JSON.stringify(me.json());
      expect(serialized).not.toMatch(/password|hash|digest/i);
    });
  });

  describe("dashboard", () => {
    it("omits order and audit sections the admin may not see", async () => {
      const { token } = await adminToken(["dashboard.view"]);
      const res = await get("/v1/admin/dashboard", token);
      expect(res.statusCode).toBe(200);
      expect(res.json().sales).toBeNull();
      expect(res.json().recentOrders).toBeNull();
      expect(res.json().recentAudit).toBeNull();
      expect(Array.isArray(res.json().games)).toBe(true);
    });

    it("reports confirmed order totals that match the database", async () => {
      // The endpoint works for a permitted admin …
      const { token } = await adminToken(["dashboard.view", "orders.view", "audit.view"]);
      const res = await get("/v1/admin/dashboard", token);
      expect(res.statusCode).toBe(200);
      expect(res.json().sales.trend).toHaveLength(14);
      expect(Array.isArray(res.json().recentAudit)).toBe(true);

      // … and its totals equal the database's. Other test files confirm orders concurrently,
      // so both sides are read from ONE repeatable-read snapshot: the dashboard service and
      // the expected totals see exactly the same rows, whatever is committed meanwhile.
      await db
        .transaction()
        .setIsolationLevel("repeatable read")
        .execute(async (trx) => {
          const service = createAdminService(createAdminRepository(trx as unknown as Database), createOrdersRepository(trx as unknown as Database));
          const body = await service.getDashboard(ALL_ADMIN_PERMISSIONS as unknown as string[]);
          const expected = await trx
            .selectFrom("orders")
            .select([(eb) => eb.fn.countAll<string>().as("n"), (eb) => eb.fn.sum<string>("total_toman").as("v")])
            .where("status", "=", "CONFIRMED")
            .executeTakeFirstOrThrow();
          expect(body.sales!.confirmedOrders).toBe(Number(expected.n));
          expect(body.sales!.confirmedValueToman).toBe(String(expected.v ?? "0"));
          const combos = await trx
            .selectFrom("tickets")
            .select((eb) => eb.fn.sum<string>("combination_count").as("c"))
            .where("status", "=", "CONFIRMED")
            .where("game_type", "=", "SIX_CHANCE")
            .executeTakeFirstOrThrow();
          expect(body.sales!.sixChanceCombinations).toBe(Number(combos.c ?? 0));
        });
    });
  });

  describe("draws list", () => {
    it("filters by game and paginates server-side, flagging the next open draw", async () => {
      const { admin, token } = await adminToken(["draws.view"]);
      const { game, draw } = await createTestDraw(db, { gameType: "SIX_CHANCE", createdBy: admin.id, rules: SIX_V2 });
      const page1 = await get(`/v1/admin/draws?gameId=${game.id}&pageSize=1&page=1`, token);
      expect(page1.statusCode).toBe(200);
      expect(page1.json()).toMatchObject({ page: 1, pageSize: 1, total: 1 });
      expect(page1.json().items[0]).toMatchObject({
        id: draw.id,
        ruleVersionNumber: 1,
        rulesSchemaVersion: 2,
        salesState: "OPEN",
        isNextForGame: true,
      });
      const none = await get(`/v1/admin/draws?gameId=${game.id}&state=SALES_CLOSED`, token);
      expect(none.json().total).toBe(0);
    });
  });

  describe("orders", () => {
    async function seedOrders() {
      const { admin } = await adminToken([]);
      const { draw } = await createTestDraw(db, { gameType: "SIX_CHANCE", createdBy: admin.id, rules: SIX_V2 });
      const guestEmail = `buyer-${randomUUID().slice(0, 8)}@example.com`;
      const guest = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: {
          drawId: draw.id,
          guestEmail,
          tickets: [
            { sixChanceNumbers: [1, 2, 3, 4, 5, 6, 7], sixChanceSymbols: [1, 2] },
            { sixChanceNumbers: [3, 11, 17, 24, 29, 33], sixChanceSymbol: 4 },
          ],
        },
      });
      await app.inject({ method: "POST", url: `/v1/dev/orders/${guest.json().id}/confirm` });
      const { token: userTok } = await userToken();
      await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID(), authorization: `Bearer ${userTok}` },
        payload: { drawId: draw.id, tickets: [{ isQuickPick: true }] },
      });
      return { draw, guestEmail, guestOrderId: guest.json().id as string, guestOrderNumber: guest.json().orderNumber as string };
    }

    it("filters, paginates and never exposes a full customer email or claim data", async () => {
      const { draw, guestEmail, guestOrderNumber } = await seedOrders();
      const { token } = await adminToken(["orders.view"]);
      const all = await get(`/v1/admin/orders?drawId=${draw.id}`, token);
      expect(all.statusCode).toBe(200);
      expect(all.json().total).toBe(2);
      const guests = await get(`/v1/admin/orders?drawId=${draw.id}&purchaserType=GUEST`, token);
      expect(guests.json().total).toBe(1);
      expect(guests.json().items[0]).toMatchObject({
        orderNumber: guestOrderNumber,
        status: "CONFIRMED",
        ticketCount: 2,
        combinationCount: 15,
        totalToman: "1500000",
      });
      expect(guests.json().items[0].customer.kind).toBe("GUEST");
      const paged = await get(`/v1/admin/orders?drawId=${draw.id}&pageSize=1&page=2`, token);
      expect(paged.json()).toMatchObject({ page: 2, pageSize: 1, total: 2 });
      expect(paged.json().items).toHaveLength(1);
      const byNumber = await get(`/v1/admin/orders?orderNumber=${guestOrderNumber.slice(4, 10)}`, token);
      expect(byNumber.json().items.some((o: { orderNumber: string }) => o.orderNumber === guestOrderNumber)).toBe(true);

      const serialized = JSON.stringify(all.json());
      expect(serialized).not.toContain(guestEmail);
      expect(serialized).not.toMatch(/claim|digest|token/i);
    });

    it("order detail shows system-play pools, combination count and line totals only", async () => {
      const { guestOrderId, guestEmail } = await seedOrders();
      const { token } = await adminToken(["orders.view"]);
      const res = await get(`/v1/admin/orders/${guestOrderId}`, token);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.combinationCount).toBe(15);
      expect(body.tickets[0]).toMatchObject({
        combinationCount: 14,
        lineTotalToman: "1400000",
        unitPriceToman: "100000",
        selection: { kind: "SIX_CHANCE_SYSTEM", numbers: [1, 2, 3, 4, 5, 6, 7], symbols: [1, 2] },
      });
      expect(body.tickets[1].selection).toEqual({ kind: "SIX_CHANCE", numbers: [3, 11, 17, 24, 29, 33], symbol: 4 });
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(guestEmail);
      expect(serialized).not.toMatch(/claim|digest|token/i);
      expect((await get(`/v1/admin/orders/${randomUUID()}`, token)).statusCode).toBe(404);
    });
  });

  describe("audit log", () => {
    it("lists entries with sensitive values redacted at any depth", async () => {
      const { admin, token } = await adminToken(["audit.view"]);
      const entityId = randomUUID();
      await db
        .insertInto("audit_logs")
        .values({
          actor_type: "ADMIN",
          actor_admin_id: admin.id,
          action: "test.redaction",
          entity_type: "test_entity",
          entity_id: entityId,
          old_values: JSON.stringify({ password_hash: "argon2id$secret" }),
          new_values: JSON.stringify({
            safe: "visible",
            nested: { claim_token_digest: "deadbeef", apiKey: "k" },
            list: [{ sessionToken: "t" }],
          }),
          reason: "redaction test",
        })
        .execute();
      const res = await get(`/v1/admin/audit-logs?entityId=${entityId}`, token);
      expect(res.statusCode).toBe(200);
      const [entry] = res.json().items;
      expect(entry.actor.adminEmail).toBe(admin.email);
      expect(entry.oldValues).toEqual({ password_hash: "[REDACTED]" });
      expect(entry.newValues).toEqual({
        safe: "visible",
        nested: { claim_token_digest: "[REDACTED]", apiKey: "[REDACTED]" },
        list: [{ sessionToken: "[REDACTED]" }],
      });
      expect(JSON.stringify(res.json())).not.toMatch(/argon2id|deadbeef/);
      const byActor = await get(`/v1/admin/audit-logs?actor=${encodeURIComponent(admin.email)}&action=redaction`, token);
      expect(byActor.json().total).toBe(1);
    });

    it("exposes no write operations", async () => {
      const { token } = await adminToken(["audit.view"]);
      for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) {
        const res = await app.inject({ method, url: "/v1/admin/audit-logs", headers: { authorization: `Bearer ${token}` } });
        expect(res.statusCode).toBe(404);
      }
    });
  });

  describe("rule drafts through the existing API", () => {
    it("clones the active version into a draft, edits it, and activates it with its reason", async () => {
      const { admin, token } = await adminToken(["games.view", "games.edit", "games.activate_rule_version"]);
      const { game } = await createTestDraw(db, { gameType: "SIX_CHANCE", createdBy: admin.id, rules: SIX_V2 });
      const auth = { authorization: `Bearer ${token}` };
      const list = await get(`/v1/admin/games/${game.id}/rule-versions`, token);
      const active = list.json().find((v: { status: string }) => v.status === "ACTIVE");
      // A v2 clone is refused: new rule versions must make payout mode and claim period explicit.
      const legacy = await app.inject({
        method: "POST",
        url: `/v1/admin/games/${game.id}/rule-versions`,
        headers: auth,
        payload: { rules: active.rules, changeReason: "clone" },
      });
      expect(legacy.statusCode).toBe(400);
      expect(legacy.json().error.details.requiredSchemaVersion).toBe(4);
      const upgraded = {
        ...active.rules,
        schema_version: 4,
        schedule: toSlotSchedule(active.rules.schedule),
        claim_period_days: 90,
        remainder_destination: "PRIZE_RESERVE",
        tiers: active.rules.tiers.map((t: { prize_type: string }) => (t.prize_type === "CASH" ? { ...t, payout_mode: "FIXED_AMOUNT" } : t)),
      };
      const draft = await app.inject({
        method: "POST",
        url: `/v1/admin/games/${game.id}/rule-versions`,
        headers: auth,
        payload: { rules: upgraded, changeReason: "clone" },
      });
      expect(draft.statusCode).toBe(201);
      const edited = await app.inject({
        method: "PATCH",
        url: `/v1/admin/rule-versions/${draft.json().id}`,
        headers: auth,
        payload: {
          rules: { ...upgraded, ticket_price_toman: 120000 },
          changeReason: "Raise price to 120,000 for the next draws",
        },
      });
      expect(edited.statusCode).toBe(200);
      const activated = await app.inject({
        method: "POST",
        url: `/v1/admin/rule-versions/${draft.json().id}/activate`,
        headers: auth,
      });
      expect(activated.statusCode).toBe(200);
      expect(activated.json()).toMatchObject({ status: "ACTIVE", versionNumber: 2 });
      const audit = await db
        .selectFrom("audit_logs")
        .select(["action", "reason"])
        .where("entity_id", "=", draft.json().id)
        .where("action", "=", "game_rule_versions.activate")
        .executeTakeFirst();
      expect(audit?.reason).toBe("Raise price to 120,000 for the next draws");
      // An ACTIVE version is immutable.
      const again = await app.inject({
        method: "PATCH",
        url: `/v1/admin/rule-versions/${draft.json().id}`,
        headers: auth,
        payload: { changeReason: "late edit" },
      });
      expect(again.statusCode).toBe(409);
    });
  });
});
