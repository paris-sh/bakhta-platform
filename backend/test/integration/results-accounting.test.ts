import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createDb, type Database } from "../../src/db/client.js";
import { createTestAdmin, createTestDraw } from "../helpers/fixtures.js";

// Phase 6 accounting: confirmed sales, jackpot payment and rollover, the next draw's jackpot,
// award components for system tickets, and corrections that reach existing claims.

const PASSWORD = "correct-horse-battery";
const MIN_JACKPOT = 100_000_000;
const RULES = {
  schema_version: 3,
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
    maximum_combinations_per_line: 1000,
    maximum_combinations_per_order: 5000,
  },
  ticket_price_toman: 300_000,
  tiers: [
    { code: "MAIN6_CHANCE", match: "6_MAIN_PLUS_CHANCE", prize_type: "JACKPOT_POOL" },
    { code: "MAIN6", match: "6_MAIN", prize_type: "CASH", payout_mode: "FIXED_AMOUNT", amount_toman: 15_000_000 },
    { code: "MAIN5_CHANCE", match: "5_MAIN_PLUS_CHANCE", prize_type: "CASH", payout_mode: "FIXED_AMOUNT", amount_toman: 3_000_000 },
    { code: "MAIN5", match: "5_MAIN", prize_type: "CASH", payout_mode: "FIXED_AMOUNT", amount_toman: 1_500_000 },
    { code: "MAIN4_CHANCE", match: "4_MAIN_PLUS_CHANCE", prize_type: "CASH", payout_mode: "FIXED_AMOUNT", amount_toman: 900_000 },
    { code: "MAIN4", match: "4_MAIN", prize_type: "CASH", payout_mode: "FIXED_AMOUNT", amount_toman: 600_000 },
    { code: "MAIN3_CHANCE", match: "3_MAIN_PLUS_CHANCE", prize_type: "FREE_TICKET", quantity: 1 },
  ],
  minimum_jackpot_toman: MIN_JACKPOT,
  jackpot_contribution_bps: 6000,
  jackpot_net_sales_basis: "CONFIRMED_SALES_LESS_LOWER_TIER_PRIZES_AND_REFUNDS",
  jackpot_no_winner_rollover: true,
  jackpot_max_toman: null,
  lower_tier_payout_cap_toman: null,
  lower_tier_cap_reduction_strategy: "PROPORTIONAL_PRESERVE_TIER_ORDER",
  remainder_destination: "PRIZE_RESERVE",
  claim_period_days: 60,
};
const WIN = { drawOrder: [29, 3, 17, 33, 11, 24], symbol: 2 };
/** Ten losing lines (3,000,000 of confirmed sales) so a draw has sales left to roll over. */
const LOSING_ORDER = Array.from({ length: 10 }, () => ({ sixChanceNumbers: [1, 2, 4, 5, 6, 7], sixChanceSymbol: 3 }));

describe("results accounting, jackpots and corrections", () => {
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
    if (opts.superAdmin) await db.insertInto("admin_role_assignments").values({ admin_id: admin.id, role_id: await superAdminRoleId() }).execute();
    const login = await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email: admin.email, password: PASSWORD } });
    return { admin, token: login.json().token as string };
  }

  const call = (method: "GET" | "PUT" | "POST", url: string, token: string | null, payload?: unknown) =>
    app.inject({ method, url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });

  /** A Six Chance draw with confirmed tickets, moved `hoursAgo` into the past. */
  async function heldDraw(tickets: Record<string, unknown>[][], opts: { jackpot?: number | null; hoursAgo?: number } = {}) {
    const creator = await createTestAdmin(db, { password: "x" });
    const { draw, game, ruleVersion } = await createTestDraw(db, { gameType: "SIX_CHANCE", createdBy: creator.id, rules: RULES });
    for (const lines of tickets) {
      const created = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: { drawId: draw.id, guestEmail: `buyer-${randomUUID().slice(0, 6)}@example.com`, tickets: lines },
      });
      expect(created.statusCode).toBe(201);
      expect((await app.inject({ method: "POST", url: `/v1/dev/orders/${created.json().id}/confirm` })).statusCode).toBe(200);
    }
    await moveToPast(draw.id, opts.hoursAgo ?? 1, opts.jackpot === undefined ? MIN_JACKPOT : opts.jackpot);
    return { draw, game, ruleVersion };
  }

  async function moveToPast(drawId: string, hoursAgo: number, jackpot: number | null) {
    const now = Date.now();
    await db
      .updateTable("draws")
      .set({
        sales_opens_at: new Date(now - (hoursAgo + 3) * 3600_000),
        sales_closes_at: new Date(now - (hoursAgo + 1) * 3600_000),
        draw_at: new Date(now - hoursAgo * 3600_000),
        opening_jackpot_toman: jackpot === null ? null : String(jackpot),
      })
      .where("id", "=", drawId)
      .execute();
  }

  /** Another draw of the same game, `hoursFromNow` relative to now (negative = past). */
  async function sameGameDraw(source: { game_id: string; current_rule_version_id: string }, drawNumber: number, hoursFromNow: number, jackpot: number | null) {
    const now = Date.now();
    return db
      .insertInto("draws")
      .values({
        game_id: source.game_id,
        game_type: "SIX_CHANCE",
        draw_number: String(drawNumber),
        status: "SALES_OPEN",
        sales_opens_at: new Date(now + (hoursFromNow - 3) * 3600_000),
        sales_closes_at: new Date(now + (hoursFromNow - 1) * 3600_000),
        draw_at: new Date(now + hoursFromNow * 3600_000),
        official_timezone: "Asia/Tehran",
        current_rule_version_id: source.current_rule_version_id,
        current_rules_snapshot: JSON.stringify(RULES),
        opening_jackpot_toman: jackpot === null ? null : String(jackpot),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async function publish(drawId: string, token: string, value = WIN, extra: Record<string, unknown> = {}) {
    const saved = await call("PUT", `/v1/admin/results/draws/${drawId}/draft`, token, { sixChance: value, ...extra });
    expect(saved.statusCode).toBe(200);
    const preview = (await call("POST", `/v1/admin/results/draws/${drawId}/preview`, token)).json();
    const res = await call("POST", `/v1/admin/results/draws/${drawId}/publish`, token, {
      resultId: preview.resultId,
      calculationHash: preview.calculationHash,
      reason: "Official live draw result",
    });
    return { preview, res };
  }

  async function publishedSummary(drawId: string) {
    const run = await db
      .selectFrom("prize_calculation_runs")
      .select("summary")
      .where("draw_id", "=", drawId)
      .where("status", "=", "PUBLISHED")
      .executeTakeFirstOrThrow();
    return run.summary as Record<string, any>;
  }

  const orderTotal = async (drawId: string) =>
    (await db.selectFrom("orders").select("total_toman").where("draw_id", "=", drawId).where("status", "=", "CONFIRMED").execute()).reduce(
      (n, o) => n + BigInt(o.total_toman),
      0n,
    );

  it("stores one MIXED award with per-tier components for a system line winning cash and free rows", async () => {
    // Pool of 8 with 5 winning numbers, symbols {1, 2}; winning symbol 2.
    const { draw } = await heldDraw([[{ sixChanceNumbers: [3, 11, 17, 24, 29, 5, 6, 7], sixChanceSymbols: [1, 2] }]]);
    const { token } = await adminToken([], { superAdmin: true });
    const { preview, res } = await publish(draw.id, token);
    expect(preview.blockers).toEqual([]);
    expect(res.statusCode).toBe(200);

    const award = await db.selectFrom("prize_awards").selectAll().where("draw_id", "=", draw.id).executeTakeFirstOrThrow();
    const cash = 3 * 3_000_000 + 3 * 1_500_000 + 15 * 900_000 + 15 * 600_000;
    expect(award).toMatchObject({ award_type: "MIXED", tier_code: "MAIN5_CHANCE", amount_toman: String(cash), free_ticket_quantity: 10 });
    const components = await db.selectFrom("prize_award_components").selectAll().where("award_id", "=", award.id).orderBy("created_at").execute();
    expect(components.map((c) => [c.tier_code, c.component_type, c.matched_combinations, c.amount_toman, c.free_ticket_quantity])).toEqual(
      expect.arrayContaining([
        ["MAIN5_CHANCE", "CASH", 3, "9000000", null],
        ["MAIN5", "CASH", 3, "4500000", null],
        ["MAIN4_CHANCE", "CASH", 15, "13500000", null],
        ["MAIN4", "CASH", 15, "9000000", null],
        ["MAIN3_CHANCE", "FREE_TICKET", 10, null, 10],
      ]),
    );
    expect(components).toHaveLength(5);
    // Components are append-only.
    await expect(db.updateTable("prize_award_components").set({ tier_code: "X" }).where("award_id", "=", award.id).execute()).rejects.toThrow(/append-only/);

    const summary = await publishedSummary(draw.id);
    const sales = await orderTotal(draw.id);
    expect(summary.financials).toMatchObject({
      revenueSource: "CONFIRMED_ORDER_TOTALS",
      confirmedSalesToman: String(sales),
      lowerTierCashToman: String(cash),
      freeRowsAwarded: 10,
    });
    expect(summary.claimPeriodDays).toBe(60);
    expect(summary.claimPeriodSource).toBe("RULES");
  });

  describe("advertised jackpot override", () => {
    const history = (drawId: string) =>
      db
        .selectFrom("admin_overrides")
        .selectAll()
        .where("entity_id", "=", drawId)
        .where("action_type", "=", "draws.opening_jackpot_override")
        .orderBy("created_at")
        .execute();

    it("is SUPER_ADMIN only, needs a reason, and keeps every change as append-only history", async () => {
      const { draw } = await heldDraw([[{ sixChanceNumbers: [1, 2, 4, 5, 6, 7], sixChanceSymbol: 3 }]], { jackpot: null });
      const superAdmin = await adminToken([], { superAdmin: true });
      await call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, superAdmin.token, { sixChance: WIN });
      const blocked = (await call("POST", `/v1/admin/results/draws/${draw.id}/preview`, superAdmin.token)).json();
      expect(blocked.blockers.map((b: { code: string }) => b.code)).toEqual(["JACKPOT_VALUE_MISSING"]);

      const url = `/v1/admin/results/draws/${draw.id}/jackpot`;
      const nonSuper = await adminToken(["results.view", "results.enter", "results.publish"]);
      expect((await call("POST", url, nonSuper.token, { amountToman: "136000000", reason: "From the published schedule" })).statusCode).toBe(403);
      expect((await call("POST", url, superAdmin.token, { amountToman: "136000000", reason: "no" })).statusCode).toBe(400);

      // First entry, then a change after sales have started (the draw is already held).
      expect((await call("POST", url, superAdmin.token, { amountToman: "136000000", reason: "From the published schedule" })).statusCode).toBe(200);
      const second = await call("POST", url, superAdmin.token, { amountToman: "150000000", reason: "Board raised the advertised jackpot" });
      expect(second.json()).toMatchObject({ openingJackpotToman: "150000000", previousToman: "136000000", requiresCorrection: false });
      expect((await call("POST", url, superAdmin.token, { amountToman: "150000000", reason: "Same value again" })).json().error.code).toBe("JACKPOT_UNCHANGED");

      const rows = await history(draw.id);
      expect(rows.map((r) => [r.before_snapshot, r.after_snapshot, r.reason, r.admin_id, r.scope])).toEqual([
        [{ opening_jackpot_toman: null }, { opening_jackpot_toman: "136000000" }, "From the published schedule", superAdmin.admin.id, "SPECIFIC_RECORD"],
        [{ opening_jackpot_toman: "136000000" }, { opening_jackpot_toman: "150000000" }, "Board raised the advertised jackpot", superAdmin.admin.id, "SPECIFIC_RECORD"],
      ]);
      await expect(db.updateTable("admin_overrides").set({ reason: "x" }).where("entity_id", "=", draw.id).execute()).rejects.toThrow(/append-only/);
      const audits = await db.selectFrom("audit_logs").select(["old_values", "new_values", "reason"]).where("entity_id", "=", draw.id).where("action", "=", "draws.opening_jackpot_override").execute();
      expect(audits).toHaveLength(2);

      // The draw exposes only the latest effective value; the admin detail shows the history.
      expect((await db.selectFrom("draws").select("opening_jackpot_toman").where("id", "=", draw.id).executeTakeFirstOrThrow()).opening_jackpot_toman).toBe("150000000");
      const detail = (await call("GET", `/v1/admin/results/draws/${draw.id}`, superAdmin.token)).json();
      expect(detail.jackpot.currentToman).toBe("150000000");
      expect(detail.jackpot.history.map((h: { newToman: string }) => h.newToman)).toEqual(["150000000", "136000000"]);

      const preview = (await call("POST", `/v1/admin/results/draws/${draw.id}/preview`, superAdmin.token)).json();
      expect(preview.blockers).toEqual([]);
      expect(preview.summary.jackpot).toMatchObject({ minimumJackpotToman: String(MIN_JACKPOT), openingJackpotToman: "150000000" });
    });

    it("invalidates an existing preview fingerprint", async () => {
      const { draw } = await heldDraw([[{ sixChanceNumbers: [3, 11, 17, 24, 29, 1], sixChanceSymbol: 4 }], LOSING_ORDER]);
      const { token } = await adminToken([], { superAdmin: true });
      await call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, token, { sixChance: WIN });
      const before = (await call("POST", `/v1/admin/results/draws/${draw.id}/preview`, token)).json();
      await call("POST", `/v1/admin/results/draws/${draw.id}/jackpot`, token, { amountToman: "120000000", reason: "Corrected advertised amount" });
      const stale = await call("POST", `/v1/admin/results/draws/${draw.id}/publish`, token, { resultId: before.resultId, calculationHash: before.calculationHash, reason: "Official live draw result" });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe("PREVIEW_OUTDATED");
      expect(await db.selectFrom("prize_calculation_runs").select("id").where("draw_id", "=", draw.id).execute()).toHaveLength(0);
      const after = (await call("POST", `/v1/admin/results/draws/${draw.id}/preview`, token)).json();
      expect(after.calculationHash).not.toBe(before.calculationHash);
      expect(after.summary.financials.nextJackpotToman).not.toBe(before.summary.financials.nextJackpotToman);
    });

    it("on a published draw opens a correction instead of touching awards; the correction flags the PAID claim", async () => {
      const jackpotLine = { sixChanceNumbers: [3, 11, 17, 24, 29, 33], sixChanceSymbol: 2 };
      const { draw, game } = await heldDraw([[jackpotLine], [jackpotLine]], { jackpot: 100_000_000 });
      const { token } = await adminToken([], { superAdmin: true });
      expect((await publish(draw.id, token)).res.statusCode).toBe(200);
      const original = await db
        .selectFrom("prize_awards as a")
        .innerJoin("claim_credentials as cc", "cc.ticket_id", "a.ticket_id")
        .select(["a.id", "a.ticket_id", "a.amount_toman", "cc.id as credential_id"])
        .where("a.draw_id", "=", draw.id)
        .orderBy("a.ticket_id")
        .execute();
      expect(original.map((a) => a.amount_toman)).toEqual(["50000000", "50000000"]);
      const paid = await db
        .insertInto("prize_claims")
        .values({
          claim_number: `CLM-${randomUUID().slice(0, 8)}`,
          ticket_id: original[0]!.ticket_id,
          current_award_id: original[0]!.id,
          claimant_type: "GUEST",
          claim_credential_id: original[0]!.credential_id,
          submission_method: "CLAIM_TOKEN",
          status: "PAID",
          approved_at: new Date(),
          paid_at: new Date(),
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const res = await call("POST", `/v1/admin/results/draws/${draw.id}/jackpot`, token, { amountToman: "160000001", reason: "Advertised jackpot was 160,000,001" });
      expect(res.json()).toMatchObject({ requiresCorrection: true, correctionDraftVersion: 2 });
      // Nothing about the published result changed.
      const still = await db.selectFrom("prize_awards").select(["id", "amount_toman", "is_current"]).where("draw_id", "=", draw.id).orderBy("ticket_id").execute();
      expect(still).toEqual(original.map((a) => ({ id: a.id, amount_toman: a.amount_toman, is_current: true })));
      expect((await call("GET", `/v1/results/${game.slug}/1`, null)).json().jackpot.amountToman).toBe("100000000");
      const draft = await db.selectFrom("results").selectAll().where("draw_id", "=", draw.id).where("status", "=", "ENTERED").executeTakeFirstOrThrow();
      expect(draft).toMatchObject({ version_number: 2 });
      expect(draft.correction_reason).toMatch(/Advertised jackpot changed from 100000000 to 160000001/);

      // Publishing the opened correction pays the new jackpot through the normal workflow.
      const preview = (await call("POST", `/v1/admin/results/draws/${draw.id}/preview`, token)).json();
      expect(preview).toMatchObject({ isCorrection: true, versionNumber: 2 });
      const published = await call("POST", `/v1/admin/results/draws/${draw.id}/publish`, token, {
        resultId: preview.resultId,
        calculationHash: preview.calculationHash,
        reason: "Correction for the advertised jackpot",
      });
      expect(published.json()).toMatchObject({ isCorrection: true, claimsFlaggedForReconciliation: 1 });
      const current = await db.selectFrom("prize_awards").select("amount_toman").where("draw_id", "=", draw.id).where("is_current", "=", true).orderBy("ticket_id").execute();
      expect(current.map((a) => a.amount_toman)).toEqual(["80000001", "80000000"]);
      expect(await db.selectFrom("prize_awards").select("id").where("draw_id", "=", draw.id).where("status", "=", "SUPERSEDED").execute()).toHaveLength(2);
      const claim = await db.selectFrom("prize_claims").selectAll().where("id", "=", paid.id).executeTakeFirstOrThrow();
      expect(claim).toMatchObject({ status: "PAID", current_award_id: original[0]!.id, requires_manual_reconciliation: true });
      const pub = (await call("GET", `/v1/results/${game.slug}/1`, null)).json();
      expect(pub.jackpot.amountToman).toBe("160000001");
      expect(JSON.stringify(pub)).not.toMatch(/correct|Advertised jackpot was|version/i);
    });

    it("flags a published downstream draw when a corrected jackpot changes the next jackpot", async () => {
      const { draw } = await heldDraw([[{ sixChanceNumbers: [3, 11, 17, 24, 29, 1], sixChanceSymbol: 4 }], LOSING_ORDER], { hoursAgo: 3 });
      const next = await sameGameDraw(draw, 2, -1, MIN_JACKPOT);
      const { token } = await adminToken([], { superAdmin: true });
      expect((await publish(draw.id, token)).res.statusCode).toBe(200); // applies to the (then unpublished) next draw
      const applied = (await db.selectFrom("draws").select("opening_jackpot_toman").where("id", "=", next.id).executeTakeFirstOrThrow()).opening_jackpot_toman;
      expect((await publish(next.id, token, { drawOrder: [1, 2, 4, 5, 6, 7], symbol: 3 })).res.statusCode).toBe(200);

      await call("POST", `/v1/admin/results/draws/${draw.id}/jackpot`, token, { amountToman: "120000000", reason: "Advertised jackpot was 120,000,000" });
      const preview = (await call("POST", `/v1/admin/results/draws/${draw.id}/preview`, token)).json();
      expect(preview.downstream).toMatchObject({ action: "REQUIRES_MANUAL_RECONCILIATION", drawNumber: "2" });
      const res = await call("POST", `/v1/admin/results/draws/${draw.id}/publish`, token, { resultId: preview.resultId, calculationHash: preview.calculationHash, reason: "Correction for the advertised jackpot" });
      expect(res.json().downstreamJackpot).toMatchObject({ action: "REQUIRES_MANUAL_RECONCILIATION", drawId: next.id });
      expect((await db.selectFrom("draws").select("opening_jackpot_toman").where("id", "=", next.id).executeTakeFirstOrThrow()).opening_jackpot_toman).toBe(applied);
      expect(await db.selectFrom("audit_logs").select("id").where("entity_id", "=", next.id).where("action", "=", "draws.jackpot_reconciliation_required").execute()).toHaveLength(1);
    });
  });

  it("pays the full accumulated jackpot, resets the next draw to the minimum and hides accounting publicly", async () => {
    const jackpotLine = { sixChanceNumbers: [3, 11, 17, 24, 29, 33], sixChanceSymbol: 2 };
    const { draw, game } = await heldDraw([[jackpotLine, jackpotLine], [jackpotLine]], { jackpot: 160_000_000 });
    const next = await sameGameDraw(draw, 2, 24, 160_000_000);
    // PostgreSQL keeps microseconds that a JS Date cannot hold; the draw must never find itself.
    await sql`UPDATE draws SET draw_at = draw_at + interval '0.000173 seconds' WHERE id = ${draw.id}`.execute(db);
    const { token } = await adminToken([], { superAdmin: true });
    const { preview, res } = await publish(draw.id, token);
    expect(preview.downstream).toMatchObject({ action: "APPLY", drawNumber: "2", nextJackpotToman: String(MIN_JACKPOT) });
    expect(res.json().downstreamJackpot).toMatchObject({ action: "APPLIED", previousToman: "160000000", nextJackpotToman: String(MIN_JACKPOT) });

    const awards = await db.selectFrom("prize_awards").select("amount_toman").where("draw_id", "=", draw.id).execute();
    expect(awards.map((a) => BigInt(a.amount_toman!)).reduce((a, b) => a + b, 0n)).toBe(160_000_000n);
    expect(awards.map((a) => a.amount_toman).sort()).toEqual(["53333333", "53333333", "53333334"]);

    const f = (await publishedSummary(draw.id)).financials;
    const sales = await orderTotal(draw.id);
    expect(f).toMatchObject({ formula: "JACKPOT_WON", jackpotPaidToman: "160000000", totalCashPrizesToman: "160000000", nextJackpotToman: String(MIN_JACKPOT) });
    expect(BigInt(f.bakhtaFundingRequiredToman)).toBe(160_000_000n - sales);

    const nextRow = await db.selectFrom("draws").select("opening_jackpot_toman").where("id", "=", next.id).executeTakeFirstOrThrow();
    expect(nextRow.opening_jackpot_toman).toBe(String(MIN_JACKPOT));
    const applied = await db.selectFrom("audit_logs").selectAll().where("entity_id", "=", next.id).where("action", "=", "draws.opening_jackpot_apply").executeTakeFirstOrThrow();
    expect(applied.old_values).toMatchObject({ opening_jackpot_toman: "160000000" });

    const pub = await call("GET", `/v1/results/${game.slug}/1`, null);
    expect(pub.json().jackpot).toEqual({ amountToman: "160000000", won: true, nextJackpotToman: String(MIN_JACKPOT) });
    expect(pub.body).not.toMatch(/bakhta|funding|retained|confirmedSales|rollover|financials/i);
  });

  it("rolls the configured share of remaining sales into the next draw; a published next draw is flagged, not overwritten", async () => {
    // No jackpot winner; one MAIN4 row (600,000) as the only lower-tier prize.
    const { draw } = await heldDraw([[{ sixChanceNumbers: [3, 11, 17, 24, 1, 2], sixChanceSymbol: 5 }], LOSING_ORDER], { hoursAgo: 3 });
    const sales = await orderTotal(draw.id);
    const next = await sameGameDraw(draw, 2, -1, MIN_JACKPOT);
    const { token } = await adminToken([], { superAdmin: true });

    // Publish the later draw first, so the earlier one must not overwrite it.
    const later = await publish(next.id, token, { drawOrder: [1, 2, 4, 5, 6, 7], symbol: 3 });
    expect(later.res.statusCode).toBe(200);

    const { preview, res } = await publish(draw.id, token);
    const remaining = sales - 600_000n;
    const addition = (remaining * 6000n) / 10_000n;
    expect(preview.summary.financials).toMatchObject({
      formula: "NO_JACKPOT_WINNER",
      confirmedSalesToman: String(sales),
      lowerTierCashToman: "600000",
      remainingSalesToman: String(remaining),
      rolloverAdditionToman: String(addition),
      bakhtaRetainedToman: String(remaining - addition),
      bakhtaFundingRequiredToman: "0",
      nextJackpotToman: String(BigInt(MIN_JACKPOT) + addition),
    });
    expect(preview.downstream).toMatchObject({ action: "REQUIRES_MANUAL_RECONCILIATION" });
    expect(preview.warnings.map((w: { code: string }) => w.code)).toContain("DOWNSTREAM_JACKPOT_LOCKED");
    expect(res.json().downstreamJackpot).toMatchObject({ action: "REQUIRES_MANUAL_RECONCILIATION", drawId: next.id });
    const nextRow = await db.selectFrom("draws").select("opening_jackpot_toman").where("id", "=", next.id).executeTakeFirstOrThrow();
    expect(nextRow.opening_jackpot_toman).toBe(String(MIN_JACKPOT));
    const flagged = await db.selectFrom("audit_logs").selectAll().where("entity_id", "=", next.id).where("action", "=", "draws.jackpot_reconciliation_required").executeTakeFirstOrThrow();
    expect(flagged.severity).toBe("WARNING");
  });

  it("prefills the next draw's jackpot from the latest published calculation (reminder and manual create)", async () => {
    // A lower-prize deficit: the jackpot carries forward unchanged and Bakhta funds the gap.
    const { draw, game } = await heldDraw([[{ sixChanceNumbers: [3, 11, 17, 24, 29, 1], sixChanceSymbol: 4 }]], { jackpot: 136_000_000 });
    const { token } = await adminToken([], { superAdmin: true });
    const { res } = await publish(draw.id, token);
    expect(res.json().downstreamJackpot).toMatchObject({ action: "NO_NEXT_DRAW", nextJackpotToman: "136000000" });
    const f = (await publishedSummary(draw.id)).financials;
    expect(f).toMatchObject({ lowerTierCashToman: "1500000", rolloverAdditionToman: "0", bakhtaRetainedToman: "0", bakhtaFundingRequiredToman: "1200000", nextJackpotToman: "136000000" });

    // The reminder (read-only) suggests the carried-forward jackpot, not the minimum.
    const viewer = await adminToken(["draws.view"]);
    const reminders = await call("GET", `/v1/admin/games/${game.id}/schedule/reminders`, viewer.token);
    expect(reminders.statusCode).toBe(200);
    expect(reminders.json()).toMatchObject({ suggestedJackpotToman: "136000000", jackpotSource: "LATEST_PUBLISHED_CALCULATION" });

    // The SUPER_ADMIN's manual create without an entered amount snapshots the same value.
    const at = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
    const created = await call("POST", `/v1/admin/games/${game.id}/draws`, token, { salesOpensAt: at(30), salesClosesAt: at(40), drawAt: at(41) });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ openingJackpotToman: "136000000", jackpotSource: "LATEST_PUBLISHED_CALCULATION" });
  });

  it("corrects a result with existing claims: follows the ticket, flags reconciliation, never alters a PAID claim", async () => {
    // v1 WIN (… 29 33, symbol 2): A = 5 numbers → MAIN5; C = 4 numbers + symbol → MAIN4_CHANCE.
    // v2 (3 11 17 24 30 33, symbol 4): A = 4 numbers + symbol → MAIN4_CHANCE; C wins nothing.
    const { draw } = await heldDraw([
      [{ sixChanceNumbers: [3, 11, 17, 24, 29, 1], sixChanceSymbol: 4 }],
      [{ sixChanceNumbers: [3, 11, 17, 29, 2, 1], sixChanceSymbol: 2 }],
      LOSING_ORDER,
    ]);
    const next = await sameGameDraw(draw, 2, 24, MIN_JACKPOT);
    const { admin, token } = await adminToken([], { superAdmin: true });
    expect((await publish(draw.id, token)).res.statusCode).toBe(200);

    const awards = await db
      .selectFrom("prize_awards as a")
      .innerJoin("tickets as t", "t.id", "a.ticket_id")
      .innerJoin("claim_credentials as cc", "cc.ticket_id", "t.id")
      .select(["a.id", "a.ticket_id", "a.tier_code", "cc.id as credential_id"])
      .where("a.draw_id", "=", draw.id)
      .execute();
    const a = awards.find((x) => x.tier_code === "MAIN5")!;
    const c = awards.find((x) => x.tier_code === "MAIN4_CHANCE")!;
    const claim = async (award: typeof a, status: "PENDING_REVIEW" | "PAID") => {
      const row = await db
        .insertInto("prize_claims")
        .values({
          claim_number: `CLM-${randomUUID().slice(0, 8)}`,
          ticket_id: award.ticket_id,
          current_award_id: award.id,
          claimant_type: "GUEST",
          claim_credential_id: award.credential_id,
          submission_method: "CLAIM_TOKEN",
          status,
          ...(status === "PAID" ? { approved_at: new Date(), paid_at: new Date() } : {}),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await db.insertInto("prize_claim_award_links").values({ claim_id: row.id, award_id: award.id, ticket_id: award.ticket_id, link_reason: "INITIAL_CLAIM", linked_by_type: "SYSTEM" }).execute();
      return row.id;
    };
    const pendingClaim = await claim(a, "PENDING_REVIEW");
    const paidClaim = await claim(c, "PAID");
    const nextBefore = (await db.selectFrom("draws").select("opening_jackpot_toman").where("id", "=", next.id).executeTakeFirstOrThrow()).opening_jackpot_toman;

    // A correction needs a reason, and is not blocked by the claims.
    const noReason = await call("PUT", `/v1/admin/results/draws/${draw.id}/draft`, token, { sixChance: { drawOrder: [3, 11, 17, 24, 30, 33], symbol: 4 } });
    expect(noReason.statusCode).toBe(400);
    const { res } = await publish(draw.id, token, { drawOrder: [3, 11, 17, 24, 30, 33], symbol: 4 }, { correctionReason: "Ball five was misread on the stream" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ isCorrection: true, claimsFlaggedForReconciliation: 2 });

    const newA = await db.selectFrom("prize_awards").selectAll().where("ticket_id", "=", a.ticket_id).where("is_current", "=", true).executeTakeFirstOrThrow();
    expect(newA).toMatchObject({ tier_code: "MAIN4_CHANCE", supersedes_award_id: a.id });
    const pending = await db.selectFrom("prize_claims").selectAll().where("id", "=", pendingClaim).executeTakeFirstOrThrow();
    expect(pending).toMatchObject({ current_award_id: newA.id, requires_manual_reconciliation: true, status: "PENDING_REVIEW" });
    const links = await db.selectFrom("prize_claim_award_links").select(["award_id", "link_reason"]).where("claim_id", "=", pendingClaim).execute();
    expect(links.map((l) => l.link_reason).sort()).toEqual(["INITIAL_CLAIM", "RESULT_CORRECTION"]);

    const paid = await db.selectFrom("prize_claims").selectAll().where("id", "=", paidClaim).executeTakeFirstOrThrow();
    expect(paid).toMatchObject({ status: "PAID", current_award_id: c.id, requires_manual_reconciliation: true });
    expect(paid.manual_reconciliation_notes).toMatch(/PAID/);
    expect(await db.selectFrom("prize_claim_award_links").select("award_id").where("claim_id", "=", paidClaim).execute()).toHaveLength(1);
    const oldC = await db.selectFrom("prize_awards").select(["status", "is_current"]).where("id", "=", c.id).executeTakeFirstOrThrow();
    expect(oldC).toEqual({ status: "SUPERSEDED", is_current: false });

    const history = await db.selectFrom("prize_claim_status_history").select(["claim_id", "from_status", "to_status", "actor_admin_id"]).where("claim_id", "in", [pendingClaim, paidClaim]).execute();
    expect(history).toHaveLength(2);
    expect(history.every((h) => h.from_status === h.to_status && h.actor_admin_id === admin.id)).toBe(true);
    const claimAudits = await db.selectFrom("audit_logs").select("entity_id").where("action", "=", "prize_claims.correction_reconciliation").where("entity_id", "in", [pendingClaim, paidClaim]).execute();
    expect(claimAudits).toHaveLength(2);

    // The corrected result changes this draw's next jackpot; the unpublished next draw follows.
    const summary = await publishedSummary(draw.id);
    expect(summary.downstreamJackpot).toMatchObject({ drawId: next.id, previousToman: nextBefore });
    const nextAfter = (await db.selectFrom("draws").select("opening_jackpot_toman").where("id", "=", next.id).executeTakeFirstOrThrow()).opening_jackpot_toman;
    expect(nextAfter).toBe(summary.financials.nextJackpotToman);
    expect(nextAfter).not.toBe(nextBefore);
  });
});
