import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createDb, type Database } from "../../src/db/client.js";
import { choose } from "../../src/modules/results/matching.js";
import { createTestAdmin, createTestDraw } from "../helpers/fixtures.js";

const PASSWORD = "correct-horse-battery";
const SCHEDULE = {
  timezone: "Asia/Tehran",
  active_weekdays: [0, 1, 2, 3, 4, 5, 6],
  draw_time: "21:00",
  sales_open_hours_before_draw: 24,
  sales_close_minutes_before_draw: 30,
  exceptions: [],
};

const FOUR_LEAF_RULES = {
  schema_version: 1,
  schedule: SCHEDULE,
  selection: { digits: 4, min: "0000", max: "9999", order_matters: true, leading_zero_allowed: true, repeated_digits_allowed: true },
  ticket_price_toman: 50000,
  fixed_prize_toman: 60000000,
  total_payout_cap_toman: 300000000,
  rollover: false,
  rounding_unit_toman: 1,
  remainder_destination: "PRIZE_RESERVE",
};

const PRICE = 300_000;
function sixRules(price = PRICE) {
  return {
    schema_version: 2,
    schedule: SCHEDULE,
    selection: {
      main_numbers: { count: 6, min: 1, max: 33, distinct: true, order_matters: false },
      chance_symbol: { min: 1, max: 5 },
      required_numbers_per_combination: 6,
      maximum_selected_numbers_per_line: 12,
      maximum_selected_symbols_per_line: 5,
      maximum_combinations_per_line: 1000,
      maximum_combinations_per_order: 5000,
    },
    ticket_price_toman: price,
    tiers: [
      { code: "MAIN6_CHANCE", match: "6_MAIN_PLUS_CHANCE", prize_type: "JACKPOT_POOL" },
      { code: "MAIN6", match: "6_MAIN", prize_type: "CASH", multiplier: 50, amount_toman: 15_000_000 },
      { code: "MAIN5_CHANCE", match: "5_MAIN_PLUS_CHANCE", prize_type: "CASH", multiplier: 10, amount_toman: 3_000_000 },
      { code: "MAIN5", match: "5_MAIN", prize_type: "CASH", multiplier: 5, amount_toman: 1_500_000 },
      { code: "MAIN4_CHANCE", match: "4_MAIN_PLUS_CHANCE", prize_type: "CASH", multiplier: 3, amount_toman: 900_000 },
      { code: "MAIN4", match: "4_MAIN", prize_type: "CASH", multiplier: 2, amount_toman: 600_000 },
      { code: "MAIN3_CHANCE", match: "3_MAIN_PLUS_CHANCE", prize_type: "FREE_TICKET", quantity: 1 },
    ],
    minimum_jackpot_toman: 100000000,
    jackpot_contribution_bps: 6000,
    jackpot_net_sales_basis: "CONFIRMED_SALES_LESS_LOWER_TIER_PRIZES_AND_REFUNDS",
    jackpot_no_winner_rollover: true,
    jackpot_max_toman: null,
    lower_tier_payout_cap_toman: null,
    lower_tier_cap_reduction_strategy: "PROPORTIONAL_PRESERVE_TIER_ORDER",
  };
}

describe("results and prize calculation", () => {
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

  async function superAdminRoleId() {
    const found = await db.selectFrom("roles").select("id").where("code", "=", "SUPER_ADMIN").executeTakeFirst();
    if (found) return found.id;
    return (await db.insertInto("roles").values({ code: "SUPER_ADMIN", name: "Super admin" }).returning("id").executeTakeFirstOrThrow()).id;
  }

  async function adminToken(permissionCodes: string[], opts: { superAdmin?: boolean } = {}) {
    const admin = await createTestAdmin(db, { password: PASSWORD, permissionCodes });
    if (opts.superAdmin) {
      await db.insertInto("admin_role_assignments").values({ admin_id: admin.id, role_id: await superAdminRoleId() }).execute();
    }
    const login = await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email: admin.email, password: PASSWORD } });
    return { admin, token: login.json().token as string };
  }

  const call = (method: "GET" | "PUT" | "POST", url: string, token: string | null, payload?: unknown) =>
    app.inject({ method, url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });

  /** A draw with confirmed tickets, then moved into the past so it awaits its result. */
  async function heldDraw(gameType: "FOUR_LEAF" | "SIX_CHANCE", tickets: Record<string, unknown>[][], rules?: Record<string, unknown>, openingJackpot?: number | null) {
    // Six Chance draws snapshot their advertised jackpot; default to the rules' minimum.
    const jackpot = openingJackpot === undefined ? (gameType === "SIX_CHANCE" ? 100_000_000 : null) : openingJackpot;
    const creator = await createTestAdmin(db, { password: "x" });
    const { draw, game } = await createTestDraw(db, { gameType, createdBy: creator.id, rules: rules ?? (gameType === "FOUR_LEAF" ? FOUR_LEAF_RULES : sixRules()) });
    for (const lines of tickets) {
      const created = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: { drawId: draw.id, guestEmail: `buyer-${randomUUID().slice(0, 6)}@example.com`, tickets: lines },
      });
      expect(created.statusCode).toBe(201);
      const confirmed = await app.inject({ method: "POST", url: `/v1/dev/orders/${created.json().id}/confirm` });
      expect(confirmed.statusCode).toBe(200);
    }
    // An unconfirmed order that must never participate.
    await app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { "idempotency-key": randomUUID() },
      payload: { drawId: draw.id, guestEmail: "pending@example.com", tickets: tickets[0] },
    });
    const now = Date.now();
    await db
      .updateTable("draws")
      .set({
        sales_opens_at: new Date(now - 3 * 3600_000),
        sales_closes_at: new Date(now - 2 * 3600_000),
        draw_at: new Date(now - 3600_000),
        ...(jackpot !== null ? { opening_jackpot_toman: String(jackpot) } : {}),
      })
      .where("id", "=", draw.id)
      .execute();
    return { draw, game };
  }

  async function previewAndPublish(drawId: string, token: string, reason = "Official live draw result") {
    const preview = await call("POST", `/v1/admin/results/draws/${drawId}/preview`, token);
    expect(preview.statusCode).toBe(200);
    const p = preview.json();
    const publish = await call("POST", `/v1/admin/results/draws/${drawId}/publish`, token, { resultId: p.resultId, calculationHash: p.calculationHash, reason });
    return { preview: p, publish };
  }

  describe("permissions", () => {
    it("requires results.view / results.enter, and SUPER_ADMIN (not just the permission) to publish", async () => {
      const { draw } = await heldDraw("FOUR_LEAF", [[{ fourLeafNumber: "0427" }]]);
      const viewer = await adminToken(["results.view"]);
      const enterer = await adminToken(["results.view", "results.enter"]);
      const publisherNoRole = await adminToken(["results.view", "results.enter", "results.publish"]);
      const superAdmin = await adminToken([], { superAdmin: true });

      expect((await call("GET", "/v1/admin/results", null)).statusCode).toBe(401);
      expect((await call("GET", "/v1/admin/results", (await adminToken([])).token)).statusCode).toBe(403);
      expect((await call("GET", "/v1/admin/results", viewer.token)).statusCode).toBe(200);
      expect((await call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, viewer.token, { fourLeaf: { numberValue: "0427" } })).statusCode).toBe(403);

      const saved = await call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, enterer.token, { fourLeaf: { numberValue: "0427" } });
      expect(saved.statusCode).toBe(200);
      const preview = (await call("POST", `/v1/admin/results/draws/${draw.id}/preview`, enterer.token)).json();
      const body = { resultId: preview.resultId, calculationHash: preview.calculationHash, reason: "Official live draw result" };
      expect((await call("POST", `/v1/admin/results/draws/${draw.id}/publish`, enterer.token, body)).statusCode).toBe(403);
      const denied = await call("POST", `/v1/admin/results/draws/${draw.id}/publish`, publisherNoRole.token, body);
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.message).toMatch(/SUPER_ADMIN/);
      const ok = await call("POST", `/v1/admin/results/draws/${draw.id}/publish`, superAdmin.token, body);
      expect(ok.statusCode).toBe(200);
    });
  });

  it("authenticates before validating params and body on protected admin endpoints", async () => {
    const drawId = randomUUID();
    const protectedCalls: ["POST" | "PUT", string, unknown][] = [
      ["POST", `/v1/admin/results/draws/${drawId}/jackpot`, undefined],
      ["POST", `/v1/admin/results/draws/${drawId}/jackpot`, {}],
      ["POST", `/v1/admin/results/draws/${drawId}/jackpot`, { amountToman: "abc", reason: "" }],
      ["POST", `/v1/admin/results/draws/not-a-uuid/jackpot`, { amountToman: "-1" }],
      ["PUT", `/v1/admin/results/draws/${drawId}/draft`, { sixChance: { drawOrder: [1], symbol: 99 } }],
      ["POST", `/v1/admin/results/draws/${drawId}/publish`, { resultId: "x", calculationHash: "y", reason: "" }],
    ];
    for (const [method, url, payload] of protectedCalls) {
      const res = await call(method, url, null, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.json().error.code).toBe("UNAUTHORIZED");
    }
    // An invalid session is rejected the same way, before validation.
    const badToken = await call("POST", `/v1/admin/results/draws/${drawId}/jackpot`, "not-a-real-token", { amountToman: "abc" });
    expect(badToken.statusCode).toBe(401);
    // A signed-in admin without the SUPER_ADMIN role is refused before validation too.
    const nonSuper = await adminToken(["results.view", "results.enter", "results.publish"]);
    expect((await call("POST", `/v1/admin/results/draws/${drawId}/jackpot`, nonSuper.token, {})).statusCode).toBe(403);
    // Normal validation still applies once the caller is authorised.
    const { token } = await adminToken([], { superAdmin: true });
    const invalid = await call("POST", `/v1/admin/results/draws/${drawId}/jackpot`, token, { amountToman: "abc", reason: "" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("VALIDATION_ERROR");
    expect((await call("POST", `/v1/admin/results/draws/not-a-uuid/jackpot`, token, { amountToman: "100", reason: "Valid reason" })).statusCode).toBe(400);
    const missingDraw = await call("POST", `/v1/admin/results/draws/${drawId}/jackpot`, token, { amountToman: "100000000", reason: "Valid reason" });
    expect(missingDraw.statusCode).toBe(404);
  });

  it("allows the browser to PUT a draft across origins (CORS preflight)", async () => {
    const origin = loadEnv().CORS_ORIGINS[0]!;
    const res = await app.inject({
      method: "OPTIONS",
      url: `/v1/admin/results/draws/${randomUUID()}/draft`,
      headers: { origin, "access-control-request-method": "PUT", "access-control-request-headers": "authorization,content-type" },
    });
    expect(res.statusCode).toBe(204);
    expect(String(res.headers["access-control-allow-methods"])).toContain("PUT");
  });

  describe("draft entry", () => {
    it("before the draw is held: ordinary admins wait; a SUPER_ADMIN needs a reason", async () => {
      const creator = await createTestAdmin(db, { password: "x" });
      const { draw } = await createTestDraw(db, { gameType: "FOUR_LEAF", createdBy: creator.id, rules: FOUR_LEAF_RULES });
      const enterer = await adminToken(["results.view", "results.enter"]);
      const waiting = await call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, enterer.token, { fourLeaf: { numberValue: "1234" }, earlyReason: "Testing before the draw" });
      expect(waiting.statusCode).toBe(409);
      expect(waiting.json().error.code).toBe("DRAW_NOT_HELD_YET");
      const { token } = await adminToken([], { superAdmin: true });
      const noReason = await call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, token, { fourLeaf: { numberValue: "1234" } });
      expect(noReason.statusCode).toBe(409);
      expect(noReason.json().error.code).toBe("EARLY_REASON_REQUIRED");
    });

    it("validates values against the draw's snapshotted rules", async () => {
      const { draw } = await heldDraw("SIX_CHANCE", [[{ sixChanceNumbers: [1, 2, 3, 4, 5, 6], sixChanceSymbol: 1 }]]);
      const { token } = await adminToken([], { superAdmin: true });
      const put = (payload: unknown) => call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, token, payload);
      expect((await put({ sixChance: { drawOrder: [1, 2, 3, 4, 5, 5], symbol: 1 } })).json().error.message).toMatch(/different/);
      expect((await put({ sixChance: { drawOrder: [1, 2, 3, 4, 5, 34], symbol: 1 } })).json().error.message).toMatch(/between 1 and 33/);
      expect((await put({ sixChance: { drawOrder: [1, 2, 3, 4, 5, 6], symbol: 6 } })).json().error.message).toMatch(/symbol/);
      expect((await put({ fourLeaf: { numberValue: "1234" } })).statusCode).toBe(400);
      expect((await put({ sixChance: { drawOrder: [1, 2, 3, 4, 5], symbol: 1 } })).statusCode).toBe(400);
    });

    it("edits the single draft in place before publication and moves the draw to RESULT_ENTERED", async () => {
      const { draw } = await heldDraw("FOUR_LEAF", [[{ fourLeafNumber: "0427" }]]);
      const { token } = await adminToken([], { superAdmin: true });
      const first = (await call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, token, { fourLeaf: { numberValue: "1111" } })).json();
      const second = (await call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, token, { fourLeaf: { numberValue: "0427" } })).json();
      expect(second.resultId).toBe(first.resultId);
      expect(second.versionNumber).toBe(1);
      const detail = (await call("GET", `/v1/admin/results/draws/${draw.id}`, token)).json();
      expect(detail.versions).toHaveLength(1);
      expect(detail.draft.value).toEqual({ kind: "FOUR_LEAF", numberValue: "0427" });
      expect(detail.draw.status).toBe("RESULT_ENTERED");
      const history = await db.selectFrom("draw_status_history").select("to_status").where("draw_id", "=", draw.id).execute();
      expect(history.map((h) => h.to_status)).toEqual(["RESULT_ENTERED"]);
    });
  });

  describe("Four Leaf publication", () => {
    it("publishes atomically: result, run, awards, ticket outcomes, draw state and audit", async () => {
      const { draw, game } = await heldDraw("FOUR_LEAF", [[{ fourLeafNumber: "0427" }, { fourLeafNumber: "4270" }], [{ fourLeafNumber: "0427" }]]);
      const { admin, token } = await adminToken([], { superAdmin: true });
      await call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, token, { fourLeaf: { numberValue: "0427" } });
      const { preview, publish } = await previewAndPublish(draw.id, token);
      expect(preview.summary).toMatchObject({ confirmedTickets: 3, winningTickets: 2, totalCashLiabilityToman: "120000000" });
      expect(preview.blockers).toEqual([]);
      expect(publish.statusCode).toBe(200);
      expect(publish.json()).toMatchObject({ alreadyPublished: false, isCorrection: false, winningTickets: 2 });

      const result = await db.selectFrom("results").selectAll().where("draw_id", "=", draw.id).executeTakeFirstOrThrow();
      expect(result).toMatchObject({ status: "PUBLISHED", is_public_current: true, published_by: admin.id, publication_reason: "Official live draw result" });
      const runs = await db.selectFrom("prize_calculation_runs").selectAll().where("draw_id", "=", draw.id).execute();
      expect(runs).toHaveLength(1);
      expect(runs[0]!.status).toBe("PUBLISHED");
      expect(Buffer.from(runs[0]!.calculation_hash).toString("hex")).toBe(preview.calculationHash);
      const awards = await db.selectFrom("prize_awards").selectAll().where("draw_id", "=", draw.id).execute();
      expect(awards).toHaveLength(2);
      expect(awards.every((a) => a.is_current && a.status === "ACTIVE" && a.amount_toman === "60000000" && a.award_type === "CASH")).toBe(true);
      const outcomes = await db.selectFrom("tickets").select(["status", "outcome_status"]).where("draw_id", "=", draw.id).execute();
      expect(outcomes.filter((t) => t.status === "CONFIRMED").map((t) => t.outcome_status).sort()).toEqual(["NOT_WINNER", "WINNER", "WINNER"]);
      expect(outcomes.filter((t) => t.status !== "CONFIRMED").every((t) => t.outcome_status === "PENDING")).toBe(true);
      const drawRow = await db.selectFrom("draws").select(["status", "published_at"]).where("id", "=", draw.id).executeTakeFirstOrThrow();
      expect(drawRow.status).toBe("PUBLISHED");
      expect(drawRow.published_at).not.toBeNull();
      const audit = await db.selectFrom("audit_logs").selectAll().where("entity_id", "=", result.id).where("action", "=", "results.publish").executeTakeFirstOrThrow();
      expect(audit.reason).toBe("Official live draw result");

      const pub = await call("GET", `/v1/results/${game.slug}/1`, null);
      expect(pub.statusCode).toBe(200);
      expect(pub.json()).toMatchObject({ winning: { kind: "FOUR_LEAF", numberValue: "0427" }, confirmedTickets: 3, totalPrizeToman: "120000000" });
    });

    it("is idempotent: repeated and concurrent publish attempts create one run and one set of awards", async () => {
      const { draw } = await heldDraw("FOUR_LEAF", [[{ fourLeafNumber: "0427" }]]);
      const { token } = await adminToken([], { superAdmin: true });
      await call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, token, { fourLeaf: { numberValue: "0427" } });
      const preview = (await call("POST", `/v1/admin/results/draws/${draw.id}/preview`, token)).json();
      const body = { resultId: preview.resultId, calculationHash: preview.calculationHash, reason: "Official live draw result" };
      const [a, b] = await Promise.all([
        call("POST", `/v1/admin/results/draws/${draw.id}/publish`, token, body),
        call("POST", `/v1/admin/results/draws/${draw.id}/publish`, token, body),
      ]);
      expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
      expect([a.json().alreadyPublished, b.json().alreadyPublished].sort()).toEqual([false, true]);
      const again = await call("POST", `/v1/admin/results/draws/${draw.id}/publish`, token, body);
      expect(again.json().alreadyPublished).toBe(true);
      expect(await db.selectFrom("prize_calculation_runs").select("id").where("draw_id", "=", draw.id).execute()).toHaveLength(1);
      expect(await db.selectFrom("prize_awards").select("id").where("draw_id", "=", draw.id).execute()).toHaveLength(1);
      const publishAudits = await db.selectFrom("audit_logs").select("id").where("entity_id", "=", preview.resultId).where("action", "=", "results.publish").execute();
      expect(publishAudits).toHaveLength(1);
    });

    it("refuses a publish whose preview is outdated and writes nothing", async () => {
      const { draw } = await heldDraw("FOUR_LEAF", [[{ fourLeafNumber: "0427" }]]);
      const { token } = await adminToken([], { superAdmin: true });
      await call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, token, { fourLeaf: { numberValue: "0427" } });
      const preview = (await call("POST", `/v1/admin/results/draws/${draw.id}/preview`, token)).json();
      await call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, token, { fourLeaf: { numberValue: "9999" } });
      const res = await call("POST", `/v1/admin/results/draws/${draw.id}/publish`, token, { resultId: preview.resultId, calculationHash: preview.calculationHash, reason: "Official live draw result" });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("PREVIEW_OUTDATED");
      expect(await db.selectFrom("prize_calculation_runs").select("id").where("draw_id", "=", draw.id).execute()).toHaveLength(0);
      const r = await db.selectFrom("results").select(["status", "is_public_current"]).where("draw_id", "=", draw.id).executeTakeFirstOrThrow();
      expect(r).toEqual({ status: "ENTERED", is_public_current: false });
    });
  });

  describe("Six Chance publication", () => {
    const WIN = [29, 3, 17, 33, 11, 24];

    it("evaluates exact picks and system pools without expansion and pays each tier", async () => {
      const systemNumbers = [3, 11, 17, 24, 29, 5, 6, 7]; // 5 winning numbers in a pool of 8
      const { draw } = await heldDraw(
        "SIX_CHANCE",
        [
          [
            { sixChanceNumbers: [3, 11, 17, 24, 29, 33], sixChanceSymbol: 2 }, // jackpot
            { sixChanceNumbers: [3, 11, 17, 24, 29, 1], sixChanceSymbol: 4 }, // 5 main
            { sixChanceNumbers: [1, 2, 4, 5, 6, 7], sixChanceSymbol: 2 }, // nothing
          ],
          [{ sixChanceNumbers: systemNumbers, sixChanceSymbols: [1, 5] }], // system, winning symbol not in pool
        ],
        sixRules(),
        100_000_000,
      );
      const { token } = await adminToken([], { superAdmin: true });
      await call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, token, { sixChance: { drawOrder: WIN, symbol: 2 } });
      const { preview, publish } = await previewAndPublish(draw.id, token);
      expect(preview.blockers).toEqual([]);
      const tiers = Object.fromEntries(preview.summary.tiers.map((t: { code: string; winningCombinations: number }) => [t.code, t.winningCombinations]));
      // System: C(5,5)·C(3,1)=3 combos × 2 symbols → MAIN5 = 6; C(5,4)·C(3,2)=15 × 2 → MAIN4 = 30.
      expect(tiers).toMatchObject({ MAIN6_CHANCE: 1, MAIN5: 1 + 6, MAIN4: 30, MAIN5_CHANCE: 0 });
      expect(publish.statusCode).toBe(200);

      const awards = await db
        .selectFrom("prize_awards as a")
        .innerJoin("tickets as t", "t.id", "a.ticket_id")
        .select(["a.tier_code", "a.amount_toman", "t.combination_count"])
        .where("a.draw_id", "=", draw.id)
        .execute();
      const systemAward = awards.find((a) => a.combination_count === choose(8, 6) * 2)!;
      expect(systemAward).toMatchObject({ tier_code: "MAIN5", amount_toman: String(6 * 1_500_000 + 30 * 600_000) });
      expect(awards.find((a) => a.tier_code === "MAIN6_CHANCE")!.amount_toman).toBe("100000000");
      expect(awards).toHaveLength(3);
    });

    it("pays the fixed amount_toman when a historical rule's multiplier disagrees, without blocking", async () => {
      // Price 100,000 with MAIN4 = 600,000 but multiplier 2 (→ 200,000): amount_toman wins.
      const { draw } = await heldDraw("SIX_CHANCE", [[{ sixChanceNumbers: [3, 11, 17, 24, 1, 2], sixChanceSymbol: 5 }]], sixRules(100_000));
      const { token } = await adminToken([], { superAdmin: true });
      await call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, token, { sixChance: { drawOrder: WIN, symbol: 2 } });
      const { preview, publish } = await previewAndPublish(draw.id, token);
      expect(preview.blockers).toEqual([]);
      expect(preview.warnings).toContainEqual(expect.objectContaining({ code: "TIER_MULTIPLIER_IGNORED", params: expect.objectContaining({ tier: "MAIN4" }) }));
      expect(publish.statusCode).toBe(200);
      const award = await db.selectFrom("prize_awards").selectAll().where("draw_id", "=", draw.id).executeTakeFirstOrThrow();
      expect(award).toMatchObject({ tier_code: "MAIN4", award_type: "CASH", amount_toman: "600000" });
    });
  });

  describe("corrections", () => {
    it("lets only a SUPER_ADMIN correct, keeps history and superseded awards, and hides it all publicly", async () => {
      const { draw, game } = await heldDraw("FOUR_LEAF", [[{ fourLeafNumber: "0427" }, { fourLeafNumber: "1111" }]]);
      const superAdmin = await adminToken([], { superAdmin: true });
      const enterer = await adminToken(["results.view", "results.enter"]);
      await call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, superAdmin.token, { fourLeaf: { numberValue: "0427" } });
      await previewAndPublish(draw.id, superAdmin.token);
      const firstAward = await db.selectFrom("prize_awards").selectAll().where("draw_id", "=", draw.id).executeTakeFirstOrThrow();

      const nonSuper = await call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, enterer.token, { fourLeaf: { numberValue: "1111" }, correctionReason: "Wrong ball read on stream" });
      expect(nonSuper.statusCode).toBe(403);
      const noReason = await call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, superAdmin.token, { fourLeaf: { numberValue: "1111" } });
      expect(noReason.statusCode).toBe(400);
      const REASON = "Operator misread the third digit on the live stream";
      const draft = await call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, superAdmin.token, { fourLeaf: { numberValue: "1111" }, correctionReason: REASON });
      expect(draft.json()).toMatchObject({ versionNumber: 2, isCorrection: true });
      const { publish } = await previewAndPublish(draw.id, superAdmin.token, "Corrected official result");
      expect(publish.json()).toMatchObject({ isCorrection: true, versionNumber: 2 });

      const results = await db.selectFrom("results").selectAll().where("draw_id", "=", draw.id).orderBy("version_number").execute();
      expect(results.map((r) => [r.version_number, r.status, r.is_public_current])).toEqual([
        [1, "SUPERSEDED", false],
        [2, "PUBLISHED", true],
      ]);
      const runs = await db.selectFrom("prize_calculation_runs").select(["status", "result_id"]).where("draw_id", "=", draw.id).execute();
      expect(runs.map((r) => r.status).sort()).toEqual(["PUBLISHED", "SUPERSEDED"]);
      const awards = await db.selectFrom("prize_awards").selectAll().where("draw_id", "=", draw.id).orderBy("created_at").execute();
      expect(awards).toHaveLength(2);
      expect(awards[0]).toMatchObject({ id: firstAward.id, is_current: false, status: "SUPERSEDED" });
      expect(awards[1]).toMatchObject({ is_current: true, status: "ACTIVE" });
      expect(awards[1]!.ticket_id).not.toBe(firstAward.ticket_id);
      const outcomes = await db.selectFrom("tickets").select(["id", "outcome_status"]).where("draw_id", "=", draw.id).where("status", "=", "CONFIRMED").execute();
      expect(outcomes.find((t) => t.id === firstAward.ticket_id)!.outcome_status).toBe("NOT_WINNER");
      expect(outcomes.find((t) => t.id === awards[1]!.ticket_id)!.outcome_status).toBe("WINNER");
      const audit = await db.selectFrom("audit_logs").select(["action", "reason"]).where("entity_type", "=", "results").where("entity_id", "=", results[1]!.id).execute();
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["results.correction_draft_create", "results.publish_correction"]));

      // Internal: every version with its reason.
      const detail = (await call("GET", `/v1/admin/results/draws/${draw.id}`, superAdmin.token)).json();
      expect(detail.versions.map((v: { versionNumber: number; correctionReason: string | null }) => [v.versionNumber, v.correctionReason])).toEqual([
        [2, REASON],
        [1, null],
      ]);

      // Public: only the current value; no reason, version, correction marker or internal id.
      const pub = await call("GET", `/v1/results/${game.slug}/1`, null);
      expect(pub.json().winning).toEqual({ kind: "FOUR_LEAF", numberValue: "1111" });
      const list = await call("GET", `/v1/results?game=${game.slug}`, null);
      expect(list.json().items).toHaveLength(1);
      for (const body of [pub.body, list.body]) {
        expect(body).not.toContain(REASON);
        expect(body).not.toContain("Corrected official result");
        expect(body).not.toMatch(/correct|version|supersed|reason/i);
        expect(body).not.toContain(draw.id);
        for (const r of results) expect(body).not.toContain(r.id);
        expect(body).not.toContain("0427");
        expect(body).not.toMatch(/@|confirmedSales|publicCode|T-[0-9A-F]{8}/);
      }
    });
  });

  describe("public results", () => {
    it("returns 404 for draws without a published result and lists only published ones", async () => {
      const { game } = await heldDraw("FOUR_LEAF", [[{ fourLeafNumber: "0427" }]]);
      expect((await call("GET", `/v1/results/${game.slug}/1`, null)).statusCode).toBe(404);
      expect((await call("GET", `/v1/results?game=${game.slug}`, null)).json().total).toBe(0);
    });
  });
});
