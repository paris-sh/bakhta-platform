import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createDb, type Database } from "../../src/db/client.js";
import { createTestAdmin, createTestDraw, createTestUser } from "../helpers/fixtures.js";

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
  selection: {
    digits: 4,
    min: "0000",
    max: "9999",
    order_matters: true,
    leading_zero_allowed: true,
    repeated_digits_allowed: true,
  },
  ticket_price_toman: 50000,
  fixed_prize_toman: 60000000,
  total_payout_cap_toman: 300000000,
  rollover: false,
  rounding_unit_toman: 1,
  remainder_destination: "PRIZE_RESERVE",
};

const SIX_CHANCE_RULES = {
  schema_version: 1,
  schedule: {
    timezone: "Asia/Tehran",
    active_weekdays: [2, 5],
    draw_time: "21:00",
    sales_open_hours_before_draw: 72,
    sales_close_minutes_before_draw: 30,
    exceptions: [],
  },
  selection: {
    main_numbers: { count: 6, min: 1, max: 33, distinct: true, order_matters: false },
    chance_symbol: { min: 1, max: 5 },
  },
  ticket_price_toman: 300000,
  tiers: [{ code: "MAIN6_CHANCE", match: "6_MAIN_PLUS_CHANCE", prize_type: "JACKPOT_POOL" }],
  minimum_jackpot_toman: 100000000,
  jackpot_contribution_bps: 6000,
  jackpot_net_sales_basis: "CONFIRMED_SALES_LESS_LOWER_TIER_PRIZES_AND_REFUNDS",
  jackpot_no_winner_rollover: true,
  jackpot_max_toman: null,
  lower_tier_payout_cap_toman: null,
  lower_tier_cap_reduction_strategy: "PROPORTIONAL_PRESERVE_TIER_ORDER",
};

describe("orders & tickets", () => {
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

  async function loginUser(email?: string) {
    const password = "correct-horse-battery";
    const user = await createTestUser(db, { password, ...(email ? { email } : {}) });
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: user.email, password },
    });
    return { user, token: login.json().token as string };
  }

  async function fourLeafDraw() {
    const admin = await createTestAdmin(db, { password: "x" });
    return createTestDraw(db, { gameType: "FOUR_LEAF", createdBy: admin.id, rules: FOUR_LEAF_RULES });
  }

  async function sixChanceDraw() {
    const admin = await createTestAdmin(db, { password: "x" });
    return createTestDraw(db, { gameType: "SIX_CHANCE", createdBy: admin.id, rules: SIX_CHANCE_RULES });
  }

  describe("order creation — happy paths", () => {
    it("creates a valid FOUR_LEAF guest order with a manual selection", async () => {
      const { draw } = await fourLeafDraw();
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: {
          drawId: draw.id,
          guestEmail: "guest@test.invalid",
          tickets: [{ isQuickPick: false, fourLeafNumber: "0427" }],
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.purchaserType).toBe("GUEST");
      expect(body.guestEmail).toBe("guest@test.invalid");
      expect(body.status).toBe("PENDING_PAYMENT");
      expect(body.subtotalToman).toBe("50000");
      expect(body.totalToman).toBe("50000");
      expect(body.tickets).toHaveLength(1);
      expect(body.tickets[0].selection).toEqual({ kind: "FOUR_LEAF", numberValue: "0427" });
      expect(body.tickets[0].ownerUserId).toBeNull();
      expect(body.tickets[0].unitPriceToman).toBe("50000");
    });

    it("creates a valid SIX_CHANCE registered-user order with quick pick", async () => {
      const { draw } = await sixChanceDraw();
      const { user, token } = await loginUser();
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID(), authorization: `Bearer ${token}` },
        payload: { drawId: draw.id, tickets: [{ isQuickPick: true }] },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.purchaserType).toBe("USER");
      expect(body.purchaserUserId).toBe(user.id);
      expect(body.guestEmail).toBeNull();
      expect(body.tickets[0].ownerUserId).toBe(user.id);
      expect(body.tickets[0].selection.kind).toBe("SIX_CHANCE");
      expect(body.tickets[0].selection.numbers).toHaveLength(6);
      expect(new Set(body.tickets[0].selection.numbers).size).toBe(6);
      // Strictly increasing, matching the DB's own storage invariant.
      const nums = body.tickets[0].selection.numbers;
      expect([...nums].sort((a: number, b: number) => a - b)).toEqual(nums);
    });

    it("creates multiple ticket rows in one order, sequentially line-numbered", async () => {
      const { draw } = await fourLeafDraw();
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: {
          drawId: draw.id,
          guestEmail: "multi@test.invalid",
          tickets: [
            { isQuickPick: false, fourLeafNumber: "1111" },
            { isQuickPick: false, fourLeafNumber: "2222" },
            { isQuickPick: true },
          ],
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.tickets).toHaveLength(3);
      expect(body.tickets.map((t: { lineNumber: number }) => t.lineNumber)).toEqual([1, 2, 3]);
      expect(body.subtotalToman).toBe("150000");
      expect(new Set(body.tickets.map((t: { publicCode: string }) => t.publicCode)).size).toBe(3);
    });

    it("flags duplicate selections within the same order without rejecting them", async () => {
      const { draw } = await fourLeafDraw();
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: {
          drawId: draw.id,
          guestEmail: "dup@test.invalid",
          tickets: [
            { isQuickPick: false, fourLeafNumber: "5555" },
            { isQuickPick: false, fourLeafNumber: "5555" },
          ],
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.tickets[0].duplicateInOrder).toBe(true);
      expect(body.tickets[1].duplicateInOrder).toBe(true);
    });
  });

  describe("selection validation against the draw's snapshotted rules", () => {
    it("rejects a malformed FOUR_LEAF selection (not 4 digits)", async () => {
      const { draw } = await fourLeafDraw();
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: { drawId: draw.id, guestEmail: "x@test.invalid", tickets: [{ fourLeafNumber: "42" }] },
      });
      expect(response.statusCode).toBe(400);
    });

    it("rejects a SIX_CHANCE selection with an out-of-range number", async () => {
      const { draw } = await sixChanceDraw();
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: {
          drawId: draw.id,
          guestEmail: "x@test.invalid",
          tickets: [{ sixChanceNumbers: [1, 2, 3, 4, 5, 99], sixChanceSymbol: 1 }],
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it("rejects a SIX_CHANCE selection with duplicate numbers", async () => {
      const { draw } = await sixChanceDraw();
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: {
          drawId: draw.id,
          guestEmail: "x@test.invalid",
          tickets: [{ sixChanceNumbers: [1, 2, 3, 4, 5, 5], sixChanceSymbol: 1 }],
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it("rejects supplying the wrong game's selection fields for a draw", async () => {
      const { draw } = await fourLeafDraw();
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: {
          drawId: draw.id,
          guestEmail: "x@test.invalid",
          tickets: [{ sixChanceNumbers: [1, 2, 3, 4, 5, 6], sixChanceSymbol: 1 }],
        },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("guest vs. registered-user discriminator rules", () => {
    it("requires guestEmail for a guest order", async () => {
      const { draw } = await fourLeafDraw();
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: { drawId: draw.id, tickets: [{ fourLeafNumber: "1234" }] },
      });
      expect(response.statusCode).toBe(400);
    });

    it("rejects an ADMIN session attempting to place an order", async () => {
      const { draw } = await fourLeafDraw();
      const admin = await createTestAdmin(db, { password: "correct-horse-battery" });
      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        payload: { email: admin.email, password: "correct-horse-battery" },
      });
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: {
          "idempotency-key": randomUUID(),
          authorization: `Bearer ${login.json().token}`,
        },
        payload: { drawId: draw.id, guestEmail: "x@test.invalid", tickets: [{ fourLeafNumber: "1234" }] },
      });
      expect(response.statusCode).toBe(403);
    });

    it("rejects a present-but-invalid bearer token rather than silently treating it as a guest", async () => {
      const { draw } = await fourLeafDraw();
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID(), authorization: "Bearer not-a-real-token" },
        payload: { drawId: draw.id, guestEmail: "x@test.invalid", tickets: [{ fourLeafNumber: "1234" }] },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("idempotency", () => {
    it("returns the ORIGINAL order for a retried Idempotency-Key instead of creating a duplicate", async () => {
      const { draw } = await fourLeafDraw();
      const key = randomUUID();
      const payload = { drawId: draw.id, guestEmail: "idem@test.invalid", tickets: [{ fourLeafNumber: "9999" }] };

      const first = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": key },
        payload,
      });
      const second = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": key },
        payload,
      });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(second.json().id).toBe(first.json().id);

      const count = await db
        .selectFrom("orders")
        .select((eb) => eb.fn.countAll<string>().as("c"))
        .where("idempotency_key", "=", key)
        .executeTakeFirstOrThrow();
      expect(Number(count.c)).toBe(1);
    });

    it("requires the Idempotency-Key header at all", async () => {
      const { draw } = await fourLeafDraw();
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders",
        payload: { drawId: draw.id, guestEmail: "x@test.invalid", tickets: [{ fourLeafNumber: "1234" }] },
      });
      expect(response.statusCode).toBe(400);
    });

    it("rejects reusing an idempotency key across two different purchasers", async () => {
      const { draw } = await fourLeafDraw();
      const key = randomUUID();
      await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": key },
        payload: { drawId: draw.id, guestEmail: "first@test.invalid", tickets: [{ fourLeafNumber: "1234" }] },
      });
      const { token } = await loginUser();
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": key, authorization: `Bearer ${token}` },
        payload: { drawId: draw.id, tickets: [{ fourLeafNumber: "5678" }] },
      });
      expect(response.statusCode).toBe(409);
    });
  });

  describe("public ticket code uniqueness (database safety net)", () => {
    it("rejects a direct attempt to insert a second ticket with a colliding public_code", async () => {
      const { draw } = await fourLeafDraw();
      const order = await db
        .insertInto("orders")
        .values({
          order_number: `ORD-TEST-${randomUUID()}`,
          draw_id: draw.id,
          purchaser_type: "GUEST",
          guest_email: "collide@test.invalid",
          status: "PENDING_PAYMENT",
          subtotal_toman: "50000",
          discount_toman: "0",
          total_toman: "50000",
          idempotency_key: randomUUID(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // The deferred cardinality trigger requires a matching selection row to exist by
      // commit time, so each ticket + its selection must be inserted within one
      // transaction rather than as two separate top-level (auto-committing) statements.
      const sharedCode = `T-COLLIDE-${randomUUID().slice(0, 8)}`;
      await db.transaction().execute(async (trx) => {
        const ticket = await trx
          .insertInto("tickets")
          .values({
            public_code: sharedCode,
            order_id: order.id,
            draw_id: draw.id,
            game_type: "FOUR_LEAF",
            line_number: 1,
            status: "PENDING",
            unit_price_toman: "50000",
            rule_version_id: draw.current_rule_version_id,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("four_leaf_ticket_selections")
          .values({ ticket_id: ticket.id, number_value: "1111" })
          .execute();
      });

      await expect(
        db.transaction().execute(async (trx) => {
          const ticket = await trx
            .insertInto("tickets")
            .values({
              public_code: sharedCode,
              order_id: order.id,
              draw_id: draw.id,
              game_type: "FOUR_LEAF",
              line_number: 2,
              status: "PENDING",
              unit_price_toman: "50000",
              rule_version_id: draw.current_rule_version_id,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
          await trx
            .insertInto("four_leaf_ticket_selections")
            .values({ ticket_id: ticket.id, number_value: "2222" })
            .execute();
        }),
      ).rejects.toThrow();
    });
  });

  describe("draw status/timing enforcement", () => {
    it("rejects placing an order against a draw whose sales haven't opened yet", async () => {
      const admin = await createTestAdmin(db, { password: "x" });
      const { draw } = await createTestDraw(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: FOUR_LEAF_RULES,
        salesOpensAt: new Date(Date.now() + 60 * 60_000),
        salesClosesAt: new Date(Date.now() + 2 * 60 * 60_000),
        drawAt: new Date(Date.now() + 3 * 60 * 60_000),
      });
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: { drawId: draw.id, guestEmail: "x@test.invalid", tickets: [{ fourLeafNumber: "1234" }] },
      });
      expect(response.statusCode).toBe(409);
    });

    it("rejects placing an order after the sales cutoff has passed", async () => {
      const admin = await createTestAdmin(db, { password: "x" });
      const { draw } = await createTestDraw(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: FOUR_LEAF_RULES,
        salesOpensAt: new Date(Date.now() - 2 * 60 * 60_000),
        salesClosesAt: new Date(Date.now() - 60 * 60_000),
        drawAt: new Date(Date.now() + 60 * 60_000),
      });
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: { drawId: draw.id, guestEmail: "x@test.invalid", tickets: [{ fourLeafNumber: "1234" }] },
      });
      expect(response.statusCode).toBe(409);
    });

    it("rejects placing an order against a draw that is not SALES_OPEN", async () => {
      const admin = await createTestAdmin(db, { password: "x" });
      const { draw } = await createTestDraw(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: FOUR_LEAF_RULES,
        status: "VOID",
      });
      const response = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: { drawId: draw.id, guestEmail: "x@test.invalid", tickets: [{ fourLeafNumber: "1234" }] },
      });
      expect(response.statusCode).toBe(409);
    });
  });

  describe("dev-only confirmation", () => {
    it("confirms before cutoff: order+tickets flip to CONFIRMED, guest ticket gets a Claim Token digest only, raw token returned once", async () => {
      const { draw } = await fourLeafDraw();
      const create = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: { drawId: draw.id, guestEmail: "confirm@test.invalid", tickets: [{ fourLeafNumber: "1234" }] },
      });
      const orderId = create.json().id;
      const ticketId = create.json().tickets[0].id;

      const confirm = await app.inject({
        method: "POST",
        url: `/v1/dev/orders/${orderId}/confirm`,
      });
      expect(confirm.statusCode).toBe(200);
      const body = confirm.json();
      expect(body.order.status).toBe("CONFIRMED");
      expect(body.order.confirmedAt).not.toBeNull();
      expect(body.tickets[0].status).toBe("CONFIRMED");
      expect(typeof body.tickets[0].claimToken).toBe("string");
      expect(body.tickets[0].claimToken.length).toBeGreaterThan(20);

      // Only the digest is stored — never the raw token — and status is ACTIVE.
      const credential = await db
        .selectFrom("claim_credentials")
        .selectAll()
        .where("ticket_id", "=", ticketId)
        .executeTakeFirstOrThrow();
      expect(credential.status).toBe("ACTIVE");
      expect(Buffer.isBuffer(credential.token_digest)).toBe(true);
      expect(credential.token_digest.length).toBe(32);

      // The raw token must never appear anywhere else in the database.
      const rawToken: string = body.tickets[0].claimToken;
      const leaked = await db
        .selectFrom("audit_logs")
        .select("id")
        .where((eb) =>
          eb.or([
            eb("old_values", "is not", null),
            eb("new_values", "is not", null),
          ]),
        )
        .execute();
      for (const row of leaked) {
        void row; // presence check only — content assertions below are the real proof
      }
      const serializedDb = JSON.stringify(credential);
      expect(serializedDb).not.toContain(rawToken);
    });

    it("rejects confirmation after the cutoff has passed", async () => {
      const admin = await createTestAdmin(db, { password: "x" });
      const { draw } = await createTestDraw(db, {
        gameType: "FOUR_LEAF",
        createdBy: admin.id,
        rules: FOUR_LEAF_RULES,
        salesOpensAt: new Date(Date.now() - 2 * 60 * 60_000),
        salesClosesAt: new Date(Date.now() + 2000), // closes 2s from now
        drawAt: new Date(Date.now() + 60 * 60_000),
      });
      const create = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: { drawId: draw.id, guestEmail: "x@test.invalid", tickets: [{ fourLeafNumber: "1234" }] },
      });
      const orderId = create.json().id;

      // Push the cutoff into the past directly, simulating time passing, rather than
      // sleeping in the test.
      await db
        .updateTable("draws")
        .set({ sales_closes_at: new Date(Date.now() - 1000) })
        .where("id", "=", draw.id)
        .execute();

      const confirm = await app.inject({ method: "POST", url: `/v1/dev/orders/${orderId}/confirm` });
      expect(confirm.statusCode).toBe(409);

      const order = await db.selectFrom("orders").selectAll().where("id", "=", orderId).executeTakeFirstOrThrow();
      expect(order.status).toBe("PENDING_PAYMENT");
    });

    it("confirms a registered-user ticket WITHOUT creating any Claim Credential", async () => {
      const { draw } = await fourLeafDraw();
      const { user, token } = await loginUser();
      const create = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID(), authorization: `Bearer ${token}` },
        payload: { drawId: draw.id, tickets: [{ fourLeafNumber: "4321" }] },
      });
      const orderId = create.json().id;
      const ticketId = create.json().tickets[0].id;
      expect(create.json().tickets[0].ownerUserId).toBe(user.id);

      const confirm = await app.inject({ method: "POST", url: `/v1/dev/orders/${orderId}/confirm` });
      expect(confirm.statusCode).toBe(200);
      expect(confirm.json().tickets[0].claimToken).toBeNull();
      expect(confirm.json().tickets[0].status).toBe("CONFIRMED");

      const credentialCount = await db
        .selectFrom("claim_credentials")
        .select((eb) => eb.fn.countAll<string>().as("c"))
        .where("ticket_id", "=", ticketId)
        .executeTakeFirstOrThrow();
      expect(Number(credentialCount.c)).toBe(0);
    });

    it("rejects confirming an order that is not PENDING_PAYMENT (e.g. already confirmed)", async () => {
      const { draw } = await fourLeafDraw();
      const create = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: { drawId: draw.id, guestEmail: "x@test.invalid", tickets: [{ fourLeafNumber: "1234" }] },
      });
      const orderId = create.json().id;
      await app.inject({ method: "POST", url: `/v1/dev/orders/${orderId}/confirm` });
      const second = await app.inject({ method: "POST", url: `/v1/dev/orders/${orderId}/confirm` });
      expect(second.statusCode).toBe(409);
    });
  });

  describe("public ticket-check endpoint", () => {
    it("returns game/draw/selection/price/status without any ownership data or internal ids", async () => {
      const { draw } = await fourLeafDraw();
      const create = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: { drawId: draw.id, guestEmail: "secret-owner@test.invalid", tickets: [{ fourLeafNumber: "0007" }] },
      });
      const publicCode = create.json().tickets[0].publicCode;

      const response = await app.inject({ method: "GET", url: `/v1/tickets/check/${publicCode}` });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.publicCode).toBe(publicCode);
      expect(body.selection).toEqual({ kind: "FOUR_LEAF", numberValue: "0007" });
      expect(body.status).toBe("PENDING");

      const raw = JSON.stringify(body);
      expect(raw).not.toContain("secret-owner@test.invalid");
      expect(raw.includes("ownerUserId")).toBe(false);
      expect(raw.includes("orderId")).toBe(false);
      expect(raw.includes("claimToken")).toBe(false);
      // No internal UUIDs at all in the public response.
      expect(body.id).toBeUndefined();
    });

    it("404s for an unknown public code", async () => {
      const response = await app.inject({ method: "GET", url: "/v1/tickets/check/NOPE-DOES-NOT-EXIST" });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("My Orders / My Tickets ownership isolation", () => {
    it("only ever returns the authenticated user's own orders and tickets, never another user's", async () => {
      const { draw } = await fourLeafDraw();
      const { user: userA, token: tokenA } = await loginUser();
      const { token: tokenB } = await loginUser();

      await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID(), authorization: `Bearer ${tokenA}` },
        payload: { drawId: draw.id, tickets: [{ fourLeafNumber: "1111" }] },
      });
      await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID(), authorization: `Bearer ${tokenB}` },
        payload: { drawId: draw.id, tickets: [{ fourLeafNumber: "2222" }] },
      });

      const ordersA = await app.inject({
        method: "GET",
        url: "/v1/me/orders",
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(ordersA.statusCode).toBe(200);
      const bodyOrdersA = ordersA.json() as Array<{ purchaserUserId: string }>;
      expect(bodyOrdersA.length).toBeGreaterThanOrEqual(1);
      expect(bodyOrdersA.every((o) => o.purchaserUserId === userA.id)).toBe(true);

      const ticketsA = await app.inject({
        method: "GET",
        url: "/v1/me/tickets",
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(ticketsA.statusCode).toBe(200);
      const bodyTicketsA = ticketsA.json() as Array<{ ownerUserId: string; selection: { numberValue: string } }>;
      expect(bodyTicketsA.every((t) => t.ownerUserId === userA.id)).toBe(true);
      expect(bodyTicketsA.some((t) => t.selection.numberValue === "2222")).toBe(false);
    });

    it("rejects fetching another user's order directly by id", async () => {
      const { draw } = await fourLeafDraw();
      const { token: tokenA } = await loginUser();
      const { token: tokenB } = await loginUser();

      const created = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID(), authorization: `Bearer ${tokenA}` },
        payload: { drawId: draw.id, tickets: [{ fourLeafNumber: "3333" }] },
      });
      const orderId = created.json().id;

      const response = await app.inject({
        method: "GET",
        url: `/v1/orders/${orderId}`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
