import { describe, expect, it } from "vitest";
import { drawSalesState, isDrawSaleable } from "../../src/modules/draws/sales-window.js";

const OPENS = new Date("2026-10-01T17:00:00.000Z");
const CLOSES = new Date("2026-10-02T16:30:00.000Z");
const at = (base: Date, deltaMs: number) => new Date(base.getTime() + deltaMs);
const draw = (status = "SALES_OPEN") => ({ status, sales_opens_at: OPENS, sales_closes_at: CLOSES });

describe("drawSalesState — the sales window [sales_opens_at, sales_closes_at)", () => {
  it("is UPCOMING before opening, even though the row says SALES_OPEN", () => {
    expect(drawSalesState(draw(), at(OPENS, -24 * 3600_000))).toBe("UPCOMING");
    expect(drawSalesState(draw(), at(OPENS, -1))).toBe("UPCOMING");
    expect(isDrawSaleable(draw(), at(OPENS, -1))).toBe(false);
  });

  it("opens exactly at sales_opens_at and stays open after it", () => {
    expect(drawSalesState(draw(), OPENS)).toBe("OPEN");
    expect(drawSalesState(draw(), at(OPENS, 1))).toBe("OPEN");
    expect(isDrawSaleable(draw(), OPENS)).toBe(true);
  });

  it("is still OPEN one millisecond before closing", () => {
    expect(drawSalesState(draw(), at(CLOSES, -1))).toBe("OPEN");
  });

  it("is CLOSED exactly at sales_closes_at and after it", () => {
    expect(drawSalesState(draw(), CLOSES)).toBe("CLOSED");
    expect(drawSalesState(draw(), at(CLOSES, 1))).toBe("CLOSED");
    expect(isDrawSaleable(draw(), CLOSES)).toBe(false);
  });

  it("never sells a draw whose status does not permit sales, inside the window or not", () => {
    const inside = at(OPENS, 60_000);
    expect(drawSalesState(draw("SALES_CLOSED"), inside)).toBe("CLOSED");
    for (const status of ["DRAW_IN_PROGRESS", "RESULT_ENTERED", "PUBLISHED", "SETTLED", "CANCELLED", "VOID"]) {
      expect(drawSalesState(draw(status), inside)).toBe("NOT_ON_SALE");
      expect(isDrawSaleable(draw(status), inside)).toBe(false);
    }
  });
});
