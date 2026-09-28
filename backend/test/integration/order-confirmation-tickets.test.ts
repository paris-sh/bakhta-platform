import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createDb, type Database } from "../../src/db/client.js";
import { createTestAdmin, createTestDraw, createTestUser } from "../helpers/fixtures.js";

// The order-confirmation page shows exactly the tickets of the order just confirmed; "all my
// tickets for this draw" is My Tickets filtered by draw. Raw Claim Tokens appear once, in the
// confirmation response only.

const PASSWORD = "correct-horse-battery";

const FOUR_LEAF_RULES = {
  schema_version: 1,
  schedule: {
    timezone: "Asia/Tehran",
    active_weekdays: [0, 1, 2, 3, 4, 5, 6],
    draw_time: "21:00",
    sales_open_hours_before_draw: 24,
    sales_close_minutes_before_draw: 30,
    exceptions: [],
  },
  selection: { digits: 4, min: "0000", max: "9999", order_matters: true, leading_zero_allowed: true, repeated_digits_allowed: true },
  ticket_price_toman: 50000,
  fixed_prize_toman: 60000000,
  total_payout_cap_toman: 300000000,
  rollover: false,
  rounding_unit_toman: 1,
  remainder_destination: "PRIZE_RESERVE",
};

const lines = (...numbers: string[]) => numbers.map((fourLeafNumber) => ({ fourLeafNumber }));

describe("order confirmation tickets", () => {
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

  async function newDraw() {
    const creator = await createTestAdmin(db, { password: PASSWORD });
    return (await createTestDraw(db, { gameType: "FOUR_LEAF", createdBy: creator.id, rules: FOUR_LEAF_RULES })).draw;
  }

  async function userToken() {
    const user = await createTestUser(db, { password: PASSWORD });
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: user.email, password: PASSWORD } });
    return { user, token: login.json().token as string };
  }

  async function placeAndConfirm(drawId: string, tickets: { fourLeafNumber: string }[], token: string | null) {
    const created = await app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { "idempotency-key": randomUUID(), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      payload: { drawId, tickets, ...(token ? {} : { guestEmail: `guest-${randomUUID().slice(0, 6)}@example.com` }) },
    });
    expect(created.statusCode).toBe(201);
    const confirmed = await app.inject({ method: "POST", url: `/v1/dev/orders/${created.json().id}/confirm` });
    expect(confirmed.statusCode).toBe(200);
    return { order: created.json(), confirmation: confirmed.json() };
  }

  const myTickets = (token: string, query = "") =>
    app.inject({ method: "GET", url: `/v1/me/tickets${query}`, headers: { authorization: `Bearer ${token}` } });

  it("a one-ticket order confirms exactly one ticket", async () => {
    const draw = await newDraw();
    const { token } = await userToken();
    const { order, confirmation } = await placeAndConfirm(draw.id, lines("0427"), token);
    expect(confirmation.order.id).toBe(order.id);
    expect(confirmation.tickets).toHaveLength(1);
    expect(confirmation.tickets[0].selection).toEqual({ kind: "FOUR_LEAF", numberValue: "0427" });
    expect(confirmation.tickets[0].status).toBe("CONFIRMED");
  });

  it("a multi-ticket order confirms every ticket, in line order — never only the last one", async () => {
    const draw = await newDraw();
    const { token } = await userToken();
    const { order, confirmation } = await placeAndConfirm(draw.id, lines("1111", "2222", "3333", "4444"), token);
    expect(confirmation.tickets.map((t: { lineNumber: number }) => t.lineNumber)).toEqual([1, 2, 3, 4]);
    expect(confirmation.tickets.map((t: { selection: { numberValue: string } }) => t.selection.numberValue)).toEqual(["1111", "2222", "3333", "4444"]);
    expect(new Set(confirmation.tickets.map((t: { id: string }) => t.id))).toEqual(new Set(order.tickets.map((t: { id: string }) => t.id)));
  });

  it("two orders for the same draw: each confirmation lists only its own tickets; My Tickets (draw filter) lists both", async () => {
    const draw = await newDraw();
    const otherDraw = await newDraw();
    const { token } = await userToken();
    const first = await placeAndConfirm(draw.id, lines("0001", "0002"), token);
    const second = await placeAndConfirm(draw.id, lines("0003"), token);
    const elsewhere = await placeAndConfirm(otherDraw.id, lines("0009"), token);

    const firstIds = first.confirmation.tickets.map((t: { id: string }) => t.id);
    const secondIds = second.confirmation.tickets.map((t: { id: string }) => t.id);
    expect(secondIds).toHaveLength(1);
    expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false);

    const filtered = await myTickets(token, `?drawId=${draw.id}`);
    expect(filtered.statusCode).toBe(200);
    const ids = filtered.json().map((t: { id: string }) => t.id).sort();
    expect(ids).toEqual([...firstIds, ...secondIds].sort());
    expect(filtered.json().every((t: { draw: { id: string } }) => t.draw.id === draw.id)).toBe(true);

    const all = (await myTickets(token)).json();
    expect(all).toHaveLength(4);
    expect(all.map((t: { id: string }) => t.id)).toContain(elsewhere.confirmation.tickets[0].id);
  });

  it("the draw filter never reveals another user's tickets and validates its input", async () => {
    const draw = await newDraw();
    const owner = await userToken();
    const stranger = await userToken();
    await placeAndConfirm(draw.id, lines("5555"), owner.token);
    const res = await myTickets(stranger.token, `?drawId=${draw.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect((await myTickets(stranger.token, "?drawId=not-a-uuid")).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/v1/me/tickets?drawId=${draw.id}` })).statusCode).toBe(401);
  });

  it("guest confirmation returns the order's own tickets with one-time Claim Tokens; registered tickets get none", async () => {
    const draw = await newDraw();
    const guestFirst = await placeAndConfirm(draw.id, lines("7001", "7002"), null);
    const guestSecond = await placeAndConfirm(draw.id, lines("7003"), null);
    expect(guestSecond.confirmation.tickets).toHaveLength(1);
    expect(guestSecond.confirmation.tickets[0].id).not.toBe(guestFirst.confirmation.tickets[0].id);
    for (const t of [...guestFirst.confirmation.tickets, ...guestSecond.confirmation.tickets]) {
      expect(typeof t.claimToken).toBe("string");
      expect(t.ownerUserId).toBeNull();
    }

    const { token } = await userToken();
    const registered = await placeAndConfirm(draw.id, lines("7004", "7005"), token);
    expect(registered.confirmation.tickets.every((t: { claimToken: string | null }) => t.claimToken === null)).toBe(true);
  });

  it("Claim Tokens are shown once: only digests are stored and no other endpoint returns them", async () => {
    const draw = await newDraw();
    const { order, confirmation } = await placeAndConfirm(draw.id, lines("8001", "8002"), null);
    const raw = confirmation.tickets.map((t: { claimToken: string }) => t.claimToken);

    // Only the SHA-256 digest is in the database.
    const stored = await db
      .selectFrom("claim_credentials")
      .select(["ticket_id", "token_digest"])
      .where("ticket_id", "in", confirmation.tickets.map((t: { id: string }) => t.id))
      .execute();
    expect(stored).toHaveLength(2);
    for (const t of confirmation.tickets) {
      const row = stored.find((s) => s.ticket_id === t.id)!;
      expect(Buffer.from(row.token_digest).equals(createHash("sha256").update(t.claimToken).digest())).toBe(true);
    }

    // A second confirmation is refused and reveals nothing.
    const again = await app.inject({ method: "POST", url: `/v1/dev/orders/${order.id}/confirm` });
    expect(again.statusCode).toBe(409);
    // Neither the public ticket check nor the order endpoints ever repeat a token.
    const bodies = [again.body];
    for (const t of confirmation.tickets) {
      const check = await app.inject({ method: "GET", url: `/v1/tickets/check/${t.publicCode}` });
      expect(check.statusCode).toBe(200);
      expect(check.json()).not.toHaveProperty("claimToken");
      bodies.push(check.body);
    }
    for (const body of bodies) for (const token of raw) expect(body).not.toContain(token);

    // Registered users' order and ticket reads have no claimToken field at all.
    const { token } = await userToken();
    const mine = await placeAndConfirm(draw.id, lines("8003"), token);
    const orderRead = await app.inject({ method: "GET", url: `/v1/orders/${mine.order.id}`, headers: { authorization: `Bearer ${token}` } });
    expect(orderRead.json().tickets[0]).not.toHaveProperty("claimToken");
    expect((await myTickets(token)).json()[0]).not.toHaveProperty("claimToken");
  });
});
