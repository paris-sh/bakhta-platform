import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import { createDb, type Database } from "../../src/db/client.js";
import { createAdminRepository } from "../../src/modules/admin/admin.repository.js";
import { createAdminService } from "../../src/modules/admin/admin.service.js";
import { createOrdersRepository } from "../../src/modules/orders/orders.repository.js";
import { createOrdersService } from "../../src/modules/orders/orders.service.js";
import { SalesClosedError, SalesNotOpenYetError } from "../../src/shared/errors.js";
import { createTestAdmin, createTestDraw } from "../helpers/fixtures.js";

// The sales window is [sales_opens_at, sales_closes_at): opening inclusive, closing
// exclusive. Order creation and confirmation are driven through the real service and
// repository (row lock + checks in one transaction) with an injected clock, so each boundary
// is tested at the exact instant rather than approximated with sleeps.

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

describe("draw sales window — end to end", () => {
  let app: FastifyInstance;
  let db: Database;

  // A window well in the future so the real clock never falls inside it.
  const OPENS = new Date(Date.now() + 10 * 24 * 3600_000);
  const CLOSES = new Date(OPENS.getTime() + 23.5 * 3600_000);
  const DRAW_AT = new Date(CLOSES.getTime() + 30 * 60_000);
  const at = (base: Date, deltaMs: number) => new Date(base.getTime() + deltaMs);

  beforeAll(() => {
    const env = loadEnv();
    db = createDb(env);
    app = buildApp(env, db);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  async function futureDraw(opens = OPENS, closes = CLOSES, drawAt = DRAW_AT) {
    const admin = await createTestAdmin(db, { password: "x" });
    const { draw, game } = await createTestDraw(db, {
      gameType: "FOUR_LEAF",
      createdBy: admin.id,
      rules: FOUR_LEAF_RULES,
      salesOpensAt: opens,
      salesClosesAt: closes,
      drawAt,
    });
    return { draw, game };
  }

  /** The production service over a repository whose clock is frozen at `now`. */
  function servicesAt(now: Date) {
    return createOrdersService(createOrdersRepository(db, () => now));
  }

  function place(now: Date, drawId: string) {
    return servicesAt(now).createOrder(
      { drawId, guestEmail: "window@test.invalid", tickets: [{ isQuickPick: false, fourLeafNumber: "1234" }] },
      { type: "GUEST" },
      randomUUID(),
    );
  }

  async function orderCount(drawId: string) {
    const rows = await db.selectFrom("orders").select("id").where("draw_id", "=", drawId).execute();
    return rows.length;
  }

  describe("order creation", () => {
    it("rejects before opening with SALES_NOT_OPEN_YET and writes nothing", async () => {
      const { draw } = await futureDraw();
      for (const now of [at(OPENS, -24 * 3600_000), at(OPENS, -1)]) {
        const attempt = place(now, draw.id);
        await expect(attempt).rejects.toBeInstanceOf(SalesNotOpenYetError);
        await expect(attempt).rejects.toMatchObject({
          code: "SALES_NOT_OPEN_YET",
          details: { salesOpensAt: OPENS.toISOString() },
        });
      }
      expect(await orderCount(draw.id)).toBe(0);
    });

    it("accepts exactly at opening and after it", async () => {
      const { draw } = await futureDraw();
      expect((await place(OPENS, draw.id)).status).toBe("PENDING_PAYMENT");
      expect((await place(at(OPENS, 1), draw.id)).status).toBe("PENDING_PAYMENT");
    });

    it("accepts one millisecond before closing", async () => {
      const { draw } = await futureDraw();
      expect((await place(at(CLOSES, -1), draw.id)).status).toBe("PENDING_PAYMENT");
    });

    it("rejects exactly at closing and after it with SALES_CLOSED", async () => {
      const { draw } = await futureDraw();
      for (const now of [CLOSES, at(CLOSES, 1)]) {
        const attempt = place(now, draw.id);
        await expect(attempt).rejects.toBeInstanceOf(SalesClosedError);
        await expect(attempt).rejects.toMatchObject({ code: "SALES_CLOSED" });
      }
      expect(await orderCount(draw.id)).toBe(0);
    });
  });

  describe("order confirmation", () => {
    it("confirms one millisecond before closing but not exactly at closing", async () => {
      const { draw } = await futureDraw();
      const late = await place(at(OPENS, 1000), draw.id);
      await expect(servicesAt(CLOSES).confirmOrderDevOnly(late.id)).rejects.toMatchObject({ code: "SALES_CLOSED" });
      const pending = await db.selectFrom("orders").select("status").where("id", "=", late.id).executeTakeFirstOrThrow();
      expect(pending.status).toBe("PENDING_PAYMENT");

      const inTime = await place(at(OPENS, 2000), draw.id);
      const confirmed = await servicesAt(at(CLOSES, -1)).confirmOrderDevOnly(inTime.id);
      expect(confirmed.order.status).toBe("CONFIRMED");
    });

    it("refuses to confirm while sales have not opened (e.g. a draw pushed back after ordering)", async () => {
      const { draw } = await futureDraw();
      const order = await place(OPENS, draw.id);
      await expect(servicesAt(at(OPENS, -1)).confirmOrderDevOnly(order.id)).rejects.toMatchObject({
        code: "SALES_NOT_OPEN_YET",
      });
    });

    it("refuses to confirm once the draw has left SALES_OPEN", async () => {
      const { draw } = await futureDraw();
      const order = await place(OPENS, draw.id);
      await db.updateTable("draws").set({ status: "SALES_CLOSED" }).where("id", "=", draw.id).execute();
      await expect(servicesAt(at(OPENS, 60_000)).confirmOrderDevOnly(order.id)).rejects.toMatchObject({
        code: "SALES_CLOSED",
      });
    });
  });

  describe("read models", () => {
    it("the public next-draw endpoint reports a future SALES_OPEN row as UPCOMING", async () => {
      const { game } = await futureDraw();
      const res = await app.inject({ method: "GET", url: `/v1/games/${game.slug}/draws/next` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: "SALES_OPEN", salesState: "UPCOMING", salesOpensAt: OPENS.toISOString() });
    });

    it("the HTTP API rejects a purchase before opening with a clear code and message", async () => {
      const { draw } = await futureDraw();
      const res = await app.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: { drawId: draw.id, guestEmail: "x@test.invalid", tickets: [{ fourLeafNumber: "1234" }] },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatchObject({
        code: "SALES_NOT_OPEN_YET",
        message: "Sales have not opened yet for this draw.",
        details: { salesOpensAt: OPENS.toISOString() },
      });
    });

    it("admin views classify draws by the window and count only saleable draws as open", async () => {
      // A window unique to this test, so the other draws created in this file (all opening at
      // OPENS, i.e. earlier) are open at both compared instants and cancel out of the count.
      const opens = at(OPENS, 7 * 60_000);
      const closes = at(CLOSES, 7 * 60_000);
      const { draw, game } = await futureDraw(opens, closes, at(DRAW_AT, 7 * 60_000));
      const admin = createAdminService(createAdminRepository(db), createOrdersRepository(db));

      const stateAt = async (now: Date) => {
        const list = await admin.listDraws({ page: 1, pageSize: 100, gameId: game.id }, now);
        return list.items.find((d) => d.id === draw.id)?.salesState;
      };
      expect(await stateAt(at(opens, -1))).toBe("UPCOMING");
      expect(await stateAt(opens)).toBe("OPEN");
      expect(await stateAt(closes)).toBe("CLOSED");

      const inState = async (state: "UPCOMING" | "OPEN" | "OPEN_OR_UPCOMING" | "SALES_CLOSED", now: Date) =>
        (await admin.listDraws({ page: 1, pageSize: 100, gameId: game.id, state }, now)).items.map((d) => d.id);
      expect(await inState("UPCOMING", at(opens, -1))).toEqual([draw.id]);
      expect(await inState("OPEN", at(opens, -1))).toEqual([]);
      expect(await inState("OPEN", opens)).toEqual([draw.id]);
      expect(await inState("SALES_CLOSED", closes)).toEqual([draw.id]);
      expect(await inState("OPEN_OR_UPCOMING", at(opens, -1))).toEqual([draw.id]);
      expect(await inState("OPEN_OR_UPCOMING", opens)).toEqual([draw.id]);
      expect(await inState("OPEN_OR_UPCOMING", closes)).toEqual([]);

      const openBefore = (await admin.getDashboard([], at(opens, -1))).openDraws;
      const openDuring = (await admin.getDashboard([], opens)).openDraws;
      expect(openDuring - openBefore).toBe(1);
      const dashGame = (await admin.getDashboard([], at(opens, -1))).games.find((g) => g.id === game.id);
      expect(dashGame?.nextDraw?.salesState).toBe("UPCOMING");
    });
  });
});
