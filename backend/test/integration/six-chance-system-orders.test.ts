import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createDb, type Database } from "../../src/db/client.js";
import { createTestAdmin, createTestDraw, createTestUser } from "../helpers/fixtures.js";

// Six Chance system play (migration 0037, rule schema_version 2). A deliberately unusual
// unit price proves nothing is hardcoded: every amount must derive from the draw snapshot.
const PRICE = 123_000;

const SCHEDULE = {
  timezone: "Asia/Tehran",
  active_weekdays: [2, 5],
  draw_time: "21:00",
  sales_open_hours_before_draw: 72,
  sales_close_minutes_before_draw: 30,
  exceptions: [],
};
const COMMON = {
  schedule: SCHEDULE,
  ticket_price_toman: PRICE,
  tiers: [{ code: "MAIN6_CHANCE", match: "6_MAIN_PLUS_CHANCE", prize_type: "JACKPOT_POOL" }],
  minimum_jackpot_toman: 100000000,
  jackpot_contribution_bps: 6000,
  jackpot_net_sales_basis: "CONFIRMED_SALES_LESS_LOWER_TIER_PRIZES_AND_REFUNDS",
  jackpot_no_winner_rollover: true,
  jackpot_max_toman: null,
  lower_tier_payout_cap_toman: null,
  lower_tier_cap_reduction_strategy: "PROPORTIONAL_PRESERVE_TIER_ORDER",
};
const MAIN = { count: 6, min: 1, max: 33, distinct: true, order_matters: false };

const V1_RULES = { ...COMMON, schema_version: 1, selection: { main_numbers: MAIN, chance_symbol: { min: 1, max: 5 } } };

function v2Rules(limits: Partial<Record<string, number>> = {}) {
  return {
    ...COMMON,
    schema_version: 2,
    selection: {
      main_numbers: MAIN,
      chance_symbol: { min: 1, max: 5 },
      required_numbers_per_combination: 6,
      maximum_selected_numbers_per_line: 12,
      maximum_selected_symbols_per_line: 5,
      maximum_combinations_per_line: 1000,
      maximum_combinations_per_order: 5000,
      ...limits,
    },
  };
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("Six Chance system play", () => {
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

  async function drawWith(rules: Record<string, unknown>) {
    const admin = await createTestAdmin(db, { password: "x" });
    const { draw } = await createTestDraw(db, { gameType: "SIX_CHANCE", createdBy: admin.id, rules });
    return draw;
  }

  function order(drawId: string, tickets: Record<string, unknown>[], opts: { token?: string } = {}) {
    return app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: {
        "idempotency-key": randomUUID(),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      payload: {
        drawId,
        ...(opts.token ? {} : { guestEmail: "system@test.invalid" }),
        tickets,
      },
    });
  }

  it("prices a 7 numbers × 2 symbols line as 14 combinations and stores it as ONE ticket", async () => {
    const draw = await drawWith(v2Rules());
    const res = await order(draw.id, [{ sixChanceNumbers: [7, 1, 2, 3, 4, 5, 6], sixChanceSymbols: [2, 1] }]);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.tickets).toHaveLength(1);
    const t = body.tickets[0];
    expect(t.selection).toEqual({ kind: "SIX_CHANCE_SYSTEM", numbers: [1, 2, 3, 4, 5, 6, 7], symbols: [1, 2] });
    expect(t.combinationCount).toBe(14);
    expect(t.unitPriceToman).toBe(String(PRICE));
    expect(t.lineTotalToman).toBe(String(PRICE * 14));
    expect(body.subtotalToman).toBe(String(PRICE * 14));
    expect(body.totalToman).toBe(String(PRICE * 14));

    const row = await db
      .selectFrom("tickets")
      .innerJoin("six_chance_system_ticket_selections as s", "s.ticket_id", "tickets.id")
      .select(["tickets.combination_count", "tickets.line_total_toman", "s.numbers", "s.symbols", "s.combination_count as sel_count"])
      .where("tickets.id", "=", t.id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ combination_count: 14, sel_count: 14, numbers: [1, 2, 3, 4, 5, 6, 7], symbols: [1, 2] });
    expect(String(row.line_total_toman)).toBe(String(PRICE * 14));
    const exactRows = await db.selectFrom("six_chance_ticket_selections").select("id").where("ticket_id", "=", t.id).execute();
    expect(exactRows).toHaveLength(0);
  });

  it("multi-line guest order: exact + 7×2 + 8×3 + Quick Pick → one ticket and one Claim Token per line", async () => {
    const draw = await drawWith(v2Rules());
    const res = await order(draw.id, [
      { sixChanceNumbers: [3, 11, 17, 24, 29, 33], sixChanceSymbol: 4 },
      { sixChanceNumbers: range(1, 7), sixChanceSymbols: [1, 2] },
      { sixChanceNumbers: range(10, 17), sixChanceSymbols: [1, 3, 5] },
      { isQuickPick: true },
    ]);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.tickets.map((t: { combinationCount: number }) => t.combinationCount)).toEqual([1, 14, 84, 1]);
    expect(body.tickets[0].selection.kind).toBe("SIX_CHANCE");
    expect(body.tickets[3].selection.kind).toBe("SIX_CHANCE");
    expect(body.tickets[3].isQuickPick).toBe(true);
    expect(body.subtotalToman).toBe(String(PRICE * 100));

    const confirm = await app.inject({ method: "POST", url: `/v1/dev/orders/${body.id}/confirm` });
    expect(confirm.statusCode).toBe(200);
    const tokens = confirm.json().tickets.map((t: { claimToken: string | null }) => t.claimToken);
    expect(tokens).toHaveLength(4);
    expect(tokens.every((tk: string | null) => typeof tk === "string")).toBe(true);
    const credentials = await db
      .selectFrom("claim_credentials")
      .innerJoin("tickets", "tickets.id", "claim_credentials.ticket_id")
      .select("claim_credentials.id")
      .where("tickets.order_id", "=", body.id)
      .execute();
    expect(credentials).toHaveLength(4);
  });

  it("registered-user system line gets no Claim Token", async () => {
    const draw = await drawWith(v2Rules());
    const user = await createTestUser(db, { password: "correct-horse-battery" });
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: user.email, password: "correct-horse-battery" },
    });
    const res = await order(draw.id, [{ sixChanceNumbers: range(1, 8), sixChanceSymbols: [1] }], {
      token: login.json().token,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().tickets[0].combinationCount).toBe(28);
    const confirm = await app.inject({ method: "POST", url: `/v1/dev/orders/${res.json().id}/confirm` });
    expect(confirm.json().tickets[0].claimToken).toBeNull();
  });

  it("ignores client-supplied counts and totals", async () => {
    const draw = await drawWith(v2Rules());
    const res = await order(draw.id, [
      { sixChanceNumbers: range(1, 7), sixChanceSymbols: [1, 2], combinationCount: 1, lineTotalToman: "1", unitPriceToman: "1" },
    ]);
    expect(res.statusCode).toBe(201);
    expect(res.json().tickets[0].combinationCount).toBe(14);
    expect(res.json().totalToman).toBe(String(PRICE * 14));
  });

  describe("limits come from the draw's snapshotted rule version", () => {
    it("rejects more numbers than maximum_selected_numbers_per_line", async () => {
      const draw = await drawWith(v2Rules({ maximum_selected_numbers_per_line: 8 }));
      const res = await order(draw.id, [{ sixChanceNumbers: range(1, 9), sixChanceSymbols: [1] }]);
      expect(res.statusCode).toBe(400);
    });

    it("rejects more symbols than maximum_selected_symbols_per_line", async () => {
      const draw = await drawWith(v2Rules({ maximum_selected_symbols_per_line: 2 }));
      const res = await order(draw.id, [{ sixChanceNumbers: range(1, 7), sixChanceSymbols: [1, 2, 3] }]);
      expect(res.statusCode).toBe(400);
    });

    it("rejects a line over maximum_combinations_per_line", async () => {
      const draw = await drawWith(v2Rules({ maximum_combinations_per_line: 50 }));
      const ok = await order(draw.id, [{ sixChanceNumbers: range(1, 8), sixChanceSymbols: [1] }]); // 28
      expect(ok.statusCode).toBe(201);
      const tooBig = await order(draw.id, [{ sixChanceNumbers: range(1, 9), sixChanceSymbols: [1] }]); // 84
      expect(tooBig.statusCode).toBe(400);
      expect(tooBig.json().error.message).toMatch(/limit per line is 50/);
    });

    it("rejects an order over maximum_combinations_per_order", async () => {
      const draw = await drawWith(v2Rules({ maximum_combinations_per_line: 50, maximum_combinations_per_order: 60 }));
      const res = await order(draw.id, [
        { sixChanceNumbers: range(1, 8), sixChanceSymbols: [1] }, // 28
        { sixChanceNumbers: range(10, 17), sixChanceSymbols: [1] }, // 28
        { sixChanceNumbers: range(20, 26), sixChanceSymbols: [1] }, // 7 → 63 total
      ]);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toMatch(/limit per order is 60/);
    });

    it("rejects duplicate numbers, duplicate symbols and both symbol fields", async () => {
      const draw = await drawWith(v2Rules());
      for (const ticket of [
        { sixChanceNumbers: [1, 2, 3, 4, 5, 6, 6], sixChanceSymbols: [1] },
        { sixChanceNumbers: range(1, 7), sixChanceSymbols: [2, 2] },
        { sixChanceNumbers: range(1, 7), sixChanceSymbol: 1, sixChanceSymbols: [1, 2] },
      ]) {
        expect((await order(draw.id, [ticket])).statusCode).toBe(400);
      }
    });
  });

  describe("schema_version 1 draws (backward compatibility)", () => {
    it("still accept the original exact-pick payload, priced as one combination", async () => {
      const draw = await drawWith(V1_RULES);
      const res = await order(draw.id, [{ sixChanceNumbers: [3, 11, 17, 24, 29, 33], sixChanceSymbol: 4 }]);
      expect(res.statusCode).toBe(201);
      const t = res.json().tickets[0];
      expect(t.selection).toEqual({ kind: "SIX_CHANCE", numbers: [3, 11, 17, 24, 29, 33], symbol: 4 });
      expect(t.combinationCount).toBe(1);
      expect(t.lineTotalToman).toBe(String(PRICE));
    });

    it("reject system lines (exact picks only)", async () => {
      const draw = await drawWith(V1_RULES);
      expect((await order(draw.id, [{ sixChanceNumbers: range(1, 7), sixChanceSymbol: 1 }])).statusCode).toBe(400);
      expect((await order(draw.id, [{ sixChanceNumbers: range(1, 6), sixChanceSymbols: [1, 2] }])).statusCode).toBe(400);
    });
  });

  it("flags overlapping lines (allowed, informational) but not disjoint ones", async () => {
    const draw = await drawWith(v2Rules());
    const res = await order(draw.id, [
      { sixChanceNumbers: range(1, 8), sixChanceSymbols: [1, 2] },
      { sixChanceNumbers: [2, 3, 4, 5, 6, 7], sixChanceSymbol: 2 }, // inside line 1
      { sixChanceNumbers: range(20, 26), sixChanceSymbols: [1] }, // disjoint
    ]);
    expect(res.statusCode).toBe(201);
    expect(res.json().tickets.map((t: { duplicateInOrder: boolean }) => t.duplicateInOrder)).toEqual([true, true, false]);
  });

  it("public ticket check shows the pools and chance count, but no owner or email", async () => {
    const draw = await drawWith(v2Rules());
    const res = await order(draw.id, [{ sixChanceNumbers: range(1, 7), sixChanceSymbols: [1, 2] }]);
    const check = await app.inject({ method: "GET", url: `/v1/tickets/check/${res.json().tickets[0].publicCode}` });
    expect(check.statusCode).toBe(200);
    const body = check.json();
    expect(body.selection).toEqual({ kind: "SIX_CHANCE_SYSTEM", numbers: range(1, 7), symbols: [1, 2] });
    expect(body.combinationCount).toBe(14);
    expect(body.lineTotalToman).toBe(String(PRICE * 14));
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("system@test.invalid");
    expect(serialized).not.toMatch(/owner|guestEmail|claim/i);
  });
});
