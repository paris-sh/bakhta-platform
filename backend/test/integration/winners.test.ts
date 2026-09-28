import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createDb, type Database } from "../../src/db/client.js";
import { createTestAdmin, createTestDraw, createTestUser } from "../helpers/fixtures.js";

// The winner experience: personal award data only for the ticket's owner, a public ticket
// check that shows prize facts but nothing private, and an anonymous public jackpot
// announcement that follows only the current published result.

const PASSWORD = "correct-horse-battery";
const SCHEDULE = {
  timezone: "Asia/Tehran",
  active_weekdays: [0, 1, 2, 3, 4, 5, 6],
  draw_time: "21:00",
  sales_open_hours_before_draw: 24,
  sales_close_minutes_before_draw: 30,
  exceptions: [],
};

const SIX_RULES = {
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
  ticket_price_toman: 300_000,
  tiers: [
    { code: "MAIN6_CHANCE", match: "6_MAIN_PLUS_CHANCE", prize_type: "JACKPOT_POOL" },
    { code: "MAIN6", match: "6_MAIN", prize_type: "CASH", multiplier: 50, amount_toman: 15_000_000 },
    { code: "MAIN5_CHANCE", match: "5_MAIN_PLUS_CHANCE", prize_type: "CASH", multiplier: 10, amount_toman: 3_000_000 },
    { code: "MAIN5", match: "5_MAIN", prize_type: "CASH", multiplier: 5, amount_toman: 1_500_000 },
    { code: "MAIN4_CHANCE", match: "4_MAIN_PLUS_CHANCE", prize_type: "CASH", multiplier: 3, amount_toman: 900_000 },
    { code: "MAIN4", match: "4_MAIN", prize_type: "CASH", multiplier: 2, amount_toman: 600_000 },
    { code: "MAIN3_CHANCE", match: "3_MAIN_PLUS_CHANCE", prize_type: "FREE_TICKET", quantity: 1 },
  ],
  minimum_jackpot_toman: 100_000_000,
  jackpot_contribution_bps: 6000,
  jackpot_net_sales_basis: "CONFIRMED_SALES_LESS_LOWER_TIER_PRIZES_AND_REFUNDS",
  jackpot_no_winner_rollover: true,
  jackpot_max_toman: null,
  lower_tier_payout_cap_toman: null,
  lower_tier_cap_reduction_strategy: "PROPORTIONAL_PRESERVE_TIER_ORDER",
};

type Line = { sixChanceNumbers: number[]; sixChanceSymbol?: number; sixChanceSymbols?: number[] };
const exact = (numbers: number[], symbol: number): Line => ({ sixChanceNumbers: numbers, sixChanceSymbol: symbol });
const MAIN = [1, 2, 3, 4, 5, 6];

const PUBLIC_CHECK_KEYS = [
  "publicCode",
  "gameCode",
  "gameSlug",
  "drawNumber",
  "drawAt",
  "drawStatus",
  "selection",
  "unitPriceToman",
  "combinationCount",
  "lineTotalToman",
  "status",
  "outcomeStatus",
  "prize",
].sort();

describe("winner experience", () => {
  let app: FastifyInstance;
  let db: Database;
  let superToken: string;

  beforeAll(async () => {
    const env = loadEnv();
    db = createDb(env);
    app = buildApp(env, db);
    const admin = await createTestAdmin(db, { password: PASSWORD });
    const role =
      (await db.selectFrom("roles").select("id").where("code", "=", "SUPER_ADMIN").executeTakeFirst()) ??
      (await db.insertInto("roles").values({ code: "SUPER_ADMIN", name: "Super admin" }).returning("id").executeTakeFirstOrThrow());
    await db.insertInto("admin_role_assignments").values({ admin_id: admin.id, role_id: role.id }).execute();
    superToken = (await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email: admin.email, password: PASSWORD } })).json().token;
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const call = (method: "GET" | "PUT" | "POST", url: string, token: string | null, payload?: unknown) =>
    app.inject({ method, url, ...(token ? { headers: auth(token) } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });

  async function newUser() {
    const user = await createTestUser(db, { password: PASSWORD });
    const token = (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: user.email, password: PASSWORD } })).json().token as string;
    return { user, token };
  }

  /** A Six Chance draw (its own game) with confirmed orders, moved into the past. */
  async function heldDraw(orders: { token: string | null; lines: Line[] }[], jackpot = 100_000_000) {
    const creator = await createTestAdmin(db, { password: PASSWORD });
    const { draw, game } = await createTestDraw(db, { gameType: "SIX_CHANCE", createdBy: creator.id, rules: SIX_RULES });
    const confirmations = [];
    for (const o of orders) {
      const guestEmail = `guest-${randomUUID().slice(0, 6)}@example.com`;
      const created = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID(), ...(o.token ? auth(o.token) : {}) },
        payload: { drawId: draw.id, tickets: o.lines, ...(o.token ? {} : { guestEmail }) },
      });
      expect(created.statusCode).toBe(201);
      const confirmed = await app.inject({ method: "POST", url: `/v1/dev/orders/${created.json().id}/confirm` });
      expect(confirmed.statusCode).toBe(200);
      confirmations.push({ ...confirmed.json(), guestEmail: o.token ? null : guestEmail });
    }
    const now = Date.now();
    await db
      .updateTable("draws")
      .set({
        sales_opens_at: new Date(now - 3 * 3600_000),
        sales_closes_at: new Date(now - 2 * 3600_000),
        draw_at: new Date(now - 3600_000),
        opening_jackpot_toman: String(jackpot),
      })
      .where("id", "=", draw.id)
      .execute();
    return { draw, game, confirmations };
  }

  async function publish(drawId: string, drawOrder: number[], symbol: number, correctionReason?: string) {
    const saved = await call("PUT", `/v1/admin/results/draws/${drawId}/draft`, superToken, {
      sixChance: { drawOrder, symbol },
      ...(correctionReason ? { correctionReason } : {}),
    });
    expect(saved.statusCode).toBe(200);
    const preview = (await call("POST", `/v1/admin/results/draws/${drawId}/preview`, superToken)).json();
    const res = await call("POST", `/v1/admin/results/draws/${drawId}/publish`, superToken, {
      resultId: preview.resultId,
      calculationHash: preview.calculationHash,
      reason: "Official live draw result",
    });
    expect(res.statusCode).toBe(200);
  }

  const announcement = async (slug: string) => {
    const res = await app.inject({ method: "GET", url: `/v1/results/jackpot-announcement?game=${slug}` });
    expect(res.statusCode).toBe(200);
    return res;
  };

  describe("a split jackpot (two winning tickets, uneven whole-Toman split)", () => {
    let fx: Awaited<ReturnType<typeof heldDraw>>;
    let winner: Awaited<ReturnType<typeof newUser>>;
    let loser: Awaited<ReturnType<typeof newUser>>;

    beforeAll(async () => {
      winner = await newUser();
      loser = await newUser();
      fx = await heldDraw(
        [
          { token: winner.token, lines: [exact(MAIN, 1), exact([10, 11, 12, 13, 14, 15], 3)] },
          { token: loser.token, lines: [exact([20, 21, 22, 23, 24, 25], 2)] },
          { token: null, lines: [exact(MAIN, 1)] },
        ],
        100_000_001,
      );
      await publish(fx.draw.id, MAIN, 1);
    });

    it("the registered jackpot winner sees their own authoritative award", async () => {
      const res = await call("GET", "/v1/me/winnings", winner.token);
      expect(res.statusCode).toBe(200);
      const won = res.json();
      expect(won).toHaveLength(1);
      const ticket = won[0];
      const award = await db
        .selectFrom("prize_awards")
        .select(["amount_toman", "claim_deadline_at", "tier_code"])
        .where("ticket_id", "=", ticket.id)
        .where("is_current", "=", true)
        .executeTakeFirstOrThrow();
      expect(["50000001", "50000000"]).toContain(award.amount_toman);
      expect(ticket.prize).toEqual({
        tierCode: "MAIN6_CHANCE",
        tierMatch: "6_MAIN_PLUS_CHANCE",
        isJackpot: true,
        awardType: "CASH",
        totalCashToman: award.amount_toman,
        freeTicketQuantity: 0,
        components: [
          {
            tierCode: "MAIN6_CHANCE",
            tierMatch: "6_MAIN_PLUS_CHANCE",
            isJackpot: true,
            componentType: "CASH",
            amountToman: award.amount_toman,
            freeTicketQuantity: null,
            matchedCombinations: 1,
          },
        ],
        claimDeadlineAt: award.claim_deadline_at.toISOString(),
      });
      expect(ticket.claim).toBeNull();
      expect(ticket.outcomeStatus).toBe("WINNER");
      expect(ticket.draw).toMatchObject({ id: fx.draw.id, drawNumber: fx.draw.draw_number, game: { slug: fx.game.slug, gameType: "SIX_CHANCE" } });

      const mine = (await call("GET", `/v1/me/tickets?drawId=${fx.draw.id}`, winner.token)).json();
      expect(mine).toHaveLength(2);
      expect(mine.filter((t: { prize: unknown }) => t.prize !== null)).toHaveLength(1);
      expect(mine.find((t: { prize: unknown }) => t.prize === null).outcomeStatus).toBe("NOT_WINNER");
    });

    it("a losing user gets no winnings, and never sees the winner's ticket or award", async () => {
      const winnings = await call("GET", "/v1/me/winnings", loser.token);
      expect(winnings.json()).toEqual([]);
      const tickets = await call("GET", `/v1/me/tickets?drawId=${fx.draw.id}`, loser.token);
      expect(tickets.json()).toHaveLength(1);
      expect(tickets.json()[0].prize).toBeNull();
      const winnerTicket = (await call("GET", "/v1/me/winnings", winner.token)).json()[0];
      for (const body of [winnings.body, tickets.body]) {
        expect(body).not.toContain(winnerTicket.id);
        expect(body).not.toContain(winnerTicket.publicCode);
        expect(body).not.toContain(winner.user.id);
      }
      // Personal award data needs a user session.
      expect((await call("GET", "/v1/me/winnings", null)).statusCode).toBe(401);
      expect((await call("GET", "/v1/me/winnings", superToken)).statusCode).toBe(403);
    });

    it("the public announcement is anonymous and shows the split", async () => {
      const res = await announcement(fx.game.slug);
      expect(res.json()).toEqual({
        announcement: {
          game: { slug: fx.game.slug, gameType: "SIX_CHANCE", nameEn: fx.game.name_en, nameFa: fx.game.name_fa },
          drawNumber: fx.draw.draw_number,
          drawAt: expect.any(String),
          winningTickets: 2,
          jackpotToman: "100000001",
          sharesPerTicket: [
            { amountToman: "50000001", tickets: 1 },
            { amountToman: "50000000", tickets: 1 },
          ],
        },
      });
      const secrets = [
        winner.user.id,
        winner.user.email,
        fx.draw.id,
        ...fx.confirmations.flatMap((c) => [c.order.id, c.guestEmail, ...c.tickets.flatMap((t: { id: string; publicCode: string; claimToken: string | null }) => [t.id, t.publicCode, t.claimToken])]),
      ].filter((s): s is string => typeof s === "string");
      for (const s of secrets) expect(res.body).not.toContain(s);
      expect(res.body).not.toMatch(/claim|owner|email|version|reason/i);
    });

    it("the guest ticket check shows public prize facts and nothing private", async () => {
      const guest = fx.confirmations[2];
      const ticket = guest.tickets[0];
      const res = await app.inject({ method: "GET", url: `/v1/tickets/check/${ticket.publicCode}` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Object.keys(body).sort()).toEqual(PUBLIC_CHECK_KEYS);
      expect(body.prize).toMatchObject({ isJackpot: true, tierMatch: "6_MAIN_PLUS_CHANCE", claimDeadlineAt: expect.any(String) });
      expect(["50000001", "50000000"]).toContain(body.prize.totalCashToman);
      expect(Object.keys(body.prize).sort()).toEqual(["awardType", "claimDeadlineAt", "components", "freeTicketQuantity", "isJackpot", "tierCode", "tierMatch", "totalCashToman"]);
      for (const s of [ticket.claimToken, ticket.id, guest.order.id, guest.guestEmail, fx.draw.id]) expect(res.body).not.toContain(s);

      const losing = await app.inject({ method: "GET", url: `/v1/tickets/check/${fx.confirmations[1].tickets[0].publicCode}` });
      expect(losing.json().prize).toBeNull();
      expect(losing.json().outcomeStatus).toBe("NOT_WINNER");
    });
  });

  describe("single jackpot, mixed components and several winning tickets for one user", () => {
    it("reports every winning ticket with its components; the announcement follows each game's latest result", async () => {
      const player = await newUser();
      const mixed = await heldDraw([
        {
          token: player.token,
          lines: [
            { sixChanceNumbers: [1, 2, 3, 4, 5, 6, 7], sixChanceSymbols: [1] }, // 7-number system line
            exact([1, 2, 3, 4, 30, 31], 1),
            exact([10, 11, 12, 13, 14, 15], 2),
          ],
        },
      ]);
      await publish(mixed.draw.id, [1, 2, 3, 4, 20, 21], 1);
      const jackpot = await heldDraw([{ token: player.token, lines: [exact(MAIN, 2)] }]);
      await publish(jackpot.draw.id, MAIN, 2);

      const won = (await call("GET", "/v1/me/winnings", player.token)).json();
      expect(won).toHaveLength(3);

      const system = won.find((t: { selection: { kind: string } }) => t.selection.kind === "SIX_CHANCE_SYSTEM");
      expect(system.prize).toMatchObject({
        awardType: "MIXED",
        isJackpot: false,
        totalCashToman: "2700000",
        freeTicketQuantity: 4,
        components: [
          { tierCode: "MAIN4_CHANCE", componentType: "CASH", amountToman: "2700000", matchedCombinations: 3, isJackpot: false },
          { tierCode: "MAIN3_CHANCE", componentType: "FREE_TICKET", freeTicketQuantity: 4, matchedCombinations: 4, isJackpot: false },
        ],
      });
      const ordinary = won.find((t: { selection: { kind: string; numbers?: number[] } }) => t.selection.kind === "SIX_CHANCE" && t.selection.numbers?.includes(30));
      expect(ordinary.prize).toMatchObject({ awardType: "CASH", tierCode: "MAIN4_CHANCE", totalCashToman: "900000", isJackpot: false });
      const top = won.find((t: { draw: { id: string } }) => t.draw.id === jackpot.draw.id);
      expect(top.prize).toMatchObject({ isJackpot: true, totalCashToman: "100000000" });

      // Zero jackpot winners → no announcement; one → exactly one ticket, full jackpot.
      expect((await announcement(mixed.game.slug)).json()).toEqual({ announcement: null });
      const single = (await announcement(jackpot.game.slug)).json().announcement;
      expect(single).toMatchObject({ winningTickets: 1, jackpotToman: "100000000", sharesPerTicket: [{ amountToman: "100000000", tickets: 1 }] });
      // A game without any published result has no announcement either.
      expect((await announcement("no-such-game")).json()).toEqual({ announcement: null });
      expect((await app.inject({ method: "GET", url: "/v1/results/jackpot-announcement?game=Bad Slug" })).statusCode).toBe(400);
    });
  });

  describe("corrected results and paid claims", () => {
    it("shows only the corrected current award, keeps the PAID claim flagged, and withdraws the announcement", async () => {
      const player = await newUser();
      const fx = await heldDraw([{ token: player.token, lines: [exact(MAIN, 1)] }]);
      await publish(fx.draw.id, MAIN, 1);
      expect((await announcement(fx.game.slug)).json().announcement.winningTickets).toBe(1);

      const ticketId = fx.confirmations[0].tickets[0].id;
      const original = await db.selectFrom("prize_awards").select(["id", "amount_toman"]).where("ticket_id", "=", ticketId).where("is_current", "=", true).executeTakeFirstOrThrow();
      expect(original.amount_toman).toBe("100000000");
      const claim = await db
        .insertInto("prize_claims")
        .values({
          claim_number: `CLM-${randomUUID().slice(0, 8)}`,
          ticket_id: ticketId,
          current_award_id: original.id,
          claimant_type: "USER",
          claimant_user_id: player.user.id,
          submission_method: "ACCOUNT",
          status: "PAID",
          approved_at: new Date(),
          paid_at: new Date(),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await db.insertInto("prize_claim_award_links").values({ claim_id: claim.id, award_id: original.id, ticket_id: ticketId, link_reason: "INITIAL_CLAIM", linked_by_type: "SYSTEM" }).execute();

      const before = (await call("GET", "/v1/me/winnings", player.token)).json()[0];
      expect(before.claim).toEqual({ status: "PAID", requiresManualReconciliation: false, paidAt: expect.any(String) });

      // The symbol was entered wrongly: the ticket is really a 6-main (no chance) winner.
      await publish(fx.draw.id, MAIN, 2, "Chance symbol was misread on the live stream");

      const after = (await call("GET", "/v1/me/winnings", player.token)).json();
      expect(after).toHaveLength(1);
      expect(after[0].prize).toMatchObject({ tierCode: "MAIN6", isJackpot: false, totalCashToman: "15000000" });
      expect(after[0].prize.components).toEqual([expect.objectContaining({ tierCode: "MAIN6", amountToman: "15000000" })]);
      expect(after[0].claim).toMatchObject({ status: "PAID", requiresManualReconciliation: true });
      // The superseded jackpot award still exists, but is never presented as current.
      const superseded = await db.selectFrom("prize_awards").select(["is_current", "status"]).where("id", "=", original.id).executeTakeFirstOrThrow();
      expect(superseded).toEqual({ is_current: false, status: "SUPERSEDED" });
      expect(JSON.stringify(after)).not.toContain("100000000");

      const check = (await app.inject({ method: "GET", url: `/v1/tickets/check/${fx.confirmations[0].tickets[0].publicCode}` })).json();
      expect(check.prize).toMatchObject({ tierCode: "MAIN6", totalCashToman: "15000000" });
      expect(check).not.toHaveProperty("claim");

      expect((await announcement(fx.game.slug)).json()).toEqual({ announcement: null });
    });
  });
});
