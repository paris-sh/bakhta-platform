import { describe, expect, it } from "vitest";
import { slotOccurrences, weekdayInZone, zonedTimeToUtc } from "../../src/modules/draws/schedule.js";
import { normalizeSchedule, type LegacySchedule } from "../../src/modules/games/rules.schemas.js";

describe("zonedTimeToUtc", () => {
  it("converts a non-DST timezone (Asia/Tehran, UTC+3:30, no DST since 2022) correctly", () => {
    const result = zonedTimeToUtc("2026-01-15", "21:00", "Asia/Tehran");
    expect(result.toISOString()).toBe("2026-01-15T17:30:00.000Z");
  });

  it("converts a DST-observing timezone correctly in WINTER (America/New_York, EST = UTC-5)", () => {
    const result = zonedTimeToUtc("2026-01-15", "21:00", "America/New_York");
    // Verified independently: 12:00 UTC on 2026-01-15 is 07:00 in New York that day (UTC-5).
    expect(result.toISOString()).toBe("2026-01-16T02:00:00.000Z");
  });

  it("converts the SAME timezone correctly in SUMMER (America/New_York, EDT = UTC-4) — proves this is not just a fixed offset", () => {
    const result = zonedTimeToUtc("2026-07-15", "21:00", "America/New_York");
    // Verified independently: 12:00 UTC on 2026-07-15 is 08:00 in New York that day (UTC-4).
    expect(result.toISOString()).toBe("2026-07-16T01:00:00.000Z");
  });
});

describe("weekdayInZone", () => {
  it("matches the known real-world weekday for a fixed date (2026-01-15 is a Thursday)", () => {
    expect(weekdayInZone("2026-01-15", "UTC")).toBe(4);
    // Same calendar date in a different zone: still Thursday, since we evaluate at local
    // noon specifically to stay clear of the date boundary.
    expect(weekdayInZone("2026-01-15", "America/New_York")).toBe(4);
    expect(weekdayInZone("2026-01-15", "Asia/Tehran")).toBe(4);
  });
});

// A legacy single-time schedule is read as ONE slot ("default") with identical behavior.
describe("slotOccurrences on a legacy schedule (upgraded to one default slot)", () => {
  const dailyFourLeafSchedule: LegacySchedule = {
    timezone: "Asia/Tehran",
    active_weekdays: [0, 1, 2, 3, 4, 5, 6],
    draw_time: "21:00",
    sales_open_hours_before_draw: 24,
    sales_close_minutes_before_draw: 30,
    exceptions: [],
  };
  const occurrences = (legacy: LegacySchedule, from: string, days: number) => {
    const n = normalizeSchedule(legacy)!;
    expect(n.slots).toHaveLength(1);
    expect(n.slots[0]).toMatchObject({ slot_id: "default", enabled: true, weekdays: legacy.active_weekdays, draw_time: legacy.draw_time });
    return slotOccurrences(n, n.slots[0]!, from, days);
  };

  it("produces one occurrence per day for a daily schedule over a 4-day horizon", () => {
    const list = occurrences(dailyFourLeafSchedule, "2026-01-15", 3);
    expect(list.map((o) => o.localDate)).toEqual(["2026-01-15", "2026-01-16", "2026-01-17", "2026-01-18"]);
  });

  it("computes sales_closes_at and sales_opens_at as offsets from draw_at", () => {
    const [occurrence] = occurrences(dailyFourLeafSchedule, "2026-01-15", 0);
    const drawAt = occurrence!.drawAt.getTime();
    expect(occurrence!.salesClosesAt.getTime()).toBe(drawAt - 30 * 60_000);
    expect(occurrence!.salesOpensAt.getTime()).toBe(drawAt - 24 * 60 * 60_000);
  });

  it("only includes active weekdays (Six Chance: Tuesday=2 and Friday=5 only)", () => {
    // 2026-01-15 is a Thursday; the week ahead has Friday 01-16 and Tuesday 01-20.
    const list = occurrences({ ...dailyFourLeafSchedule, active_weekdays: [2, 5] }, "2026-01-15", 6);
    expect(list.map((o) => o.localDate)).toEqual(["2026-01-16", "2026-01-20"]);
  });

  it("skips a date listed as a SKIP exception even if its weekday is active", () => {
    const list = occurrences({ ...dailyFourLeafSchedule, exceptions: [{ date: "2026-01-16", action: "SKIP", reason: "Public holiday" }] }, "2026-01-15", 2);
    expect(list.map((o) => o.localDate)).toEqual(["2026-01-15", "2026-01-17"]);
  });
});
