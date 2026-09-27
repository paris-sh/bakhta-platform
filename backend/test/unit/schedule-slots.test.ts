import { describe, expect, it } from "vitest";
import { localDateInZone, occurrenceKey, pendingOccurrences, slotOccurrences } from "../../src/modules/draws/schedule.js";
import { normalizeSchedule, slotScheduleSchema, type NormalizedSchedule, type ScheduleSlot } from "../../src/modules/games/rules.schemas.js";

// Asia/Tehran is a fixed UTC+03:30 (no DST since 2022): 14:00 = 10:30Z, 18:00 = 14:30Z,
// 21:00 = 17:30Z. 2026-09-28 is a Monday.
const slot = (id: string, draw_time: string, extra: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
  slot_id: id,
  enabled: true,
  label: null,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  draw_time,
  timezone: "Asia/Tehran",
  sales_open_hours_before_draw: 3,
  sales_close_minutes_before_draw: 30,
  ...extra,
});
const threeDaily: NormalizedSchedule = { slots: [slot("afternoon", "14:00"), slot("evening", "18:00"), slot("night", "21:00")], exceptions: [] };
const none = new Set<string>();
const at = (iso: string) => new Date(iso);
const summary = (list: { slotId: string; localDate: string; state: string }[]) => list.map((o) => `${o.slotId}@${o.localDate}:${o.state}`);

describe("schedule slots", () => {
  it("gives every slot its own occurrence on the same day, with the slot's offsets", () => {
    const day = threeDaily.slots.map((s) => slotOccurrences(threeDaily, s, "2026-09-28", 0)[0]!);
    expect(day.map((o) => [o.slotId, o.localDate, o.drawAt.toISOString(), o.salesOpensAt.toISOString(), o.salesClosesAt.toISOString()])).toEqual([
      ["afternoon", "2026-09-28", "2026-09-28T10:30:00.000Z", "2026-09-28T07:30:00.000Z", "2026-09-28T10:00:00.000Z"],
      ["evening", "2026-09-28", "2026-09-28T14:30:00.000Z", "2026-09-28T11:30:00.000Z", "2026-09-28T14:00:00.000Z"],
      ["night", "2026-09-28", "2026-09-28T17:30:00.000Z", "2026-09-28T14:30:00.000Z", "2026-09-28T17:00:00.000Z"],
    ]);
    // Identity is (slot, local date): three distinct keys on one date.
    expect(new Set(day.map((o) => occurrenceKey(o.slotId, o.localDate))).size).toBe(3);
  });

  it("reminds independently per slot: claiming 14:00 leaves 18:00 and 21:00", () => {
    const now = at("2026-09-28T06:00:00Z"); // 09:30 Tehran
    const opts = { since: at("2026-09-28T00:00:00Z"), dismissed: none };
    expect(summary(pendingOccurrences(threeDaily, now, { ...opts, claimed: none }))).toEqual([
      "afternoon@2026-09-28:UPCOMING",
      "evening@2026-09-28:UPCOMING",
      "night@2026-09-28:UPCOMING",
    ]);
    const afterClaim = pendingOccurrences(threeDaily, now, { ...opts, claimed: new Set([occurrenceKey("afternoon", "2026-09-28")]) });
    expect(summary(afterClaim)).toEqual(["evening@2026-09-28:UPCOMING", "night@2026-09-28:UPCOMING", "afternoon@2026-09-29:UPCOMING"]);
  });

  it("marks overdue (sales should be open, draw ahead) — even after sales close — and missed (draw time passed)", () => {
    const now = at("2026-09-28T14:10:00Z"); // 17:40 Tehran: 18:00 sales closed at 17:30, draw ahead
    const list = pendingOccurrences(threeDaily, now, { since: at("2026-09-28T00:00:00Z"), claimed: none, dismissed: none });
    expect(summary(list)).toEqual([
      "afternoon@2026-09-28:MISSED", // 14:00 passed without a draw
      "evening@2026-09-28:OVERDUE", // sales closed at 17:30 but the draw is ahead: not skipped
      "night@2026-09-28:UPCOMING", // its sales open at 18:00
      "afternoon@2026-09-29:UPCOMING", // the missed slot still offers its next occurrence
    ]);
    expect(list.find((o) => o.slotId === "afternoon" && o.localDate === "2026-09-28")?.state).toBe("MISSED");
    expect(list.find((o) => o.slotId === "evening")?.state).toBe("OVERDUE");
    expect(list.find((o) => o.slotId === "night")?.state).toBe("UPCOMING"); // opens 18:00 Tehran
    // After the missed one, the slot's next occurrence is still offered.
    expect(list.find((o) => o.slotId === "afternoon" && o.localDate === "2026-09-29")?.state).toBe("UPCOMING");
  });

  it("never backfills before the settings took effect, and reports at most 7 days of missed draws", () => {
    const now = at("2026-09-28T06:00:00Z");
    // Clean reset: settings activated just now → nothing earlier is missed.
    const fresh = pendingOccurrences(threeDaily, now, { since: now, claimed: none, dismissed: none });
    expect(fresh.every((o) => o.state !== "MISSED")).toBe(true);
    // Settings active for months: only the last 7 days can be reported missed.
    const old = pendingOccurrences(threeDaily, now, { since: at("2026-01-01T00:00:00Z"), claimed: none, dismissed: none });
    const missedDates = old.filter((o) => o.state === "MISSED").map((o) => o.localDate).sort();
    expect(missedDates[0]! >= "2026-09-21").toBe(true);
  });

  it("dismissed occurrences disappear; the slot moves to its next occurrence", () => {
    const now = at("2026-09-28T11:00:00Z"); // 14:30 Tehran: 14:00 missed
    const since = at("2026-09-28T00:00:00Z");
    const before = pendingOccurrences(threeDaily, now, { since, claimed: none, dismissed: none });
    expect(before.some((o) => o.slotId === "afternoon" && o.state === "MISSED")).toBe(true);
    const after = pendingOccurrences(threeDaily, now, { since, claimed: none, dismissed: new Set([occurrenceKey("afternoon", "2026-09-28")]) });
    expect(after.filter((o) => o.slotId === "afternoon").map((o) => o.localDate)).toEqual(["2026-09-29"]);
  });

  it("honours SKIP dates for all slots or for one slot, and ignores disabled slots", () => {
    const s: NormalizedSchedule = {
      slots: [slot("a", "14:00"), slot("b", "18:00"), slot("off", "21:00", { enabled: false })],
      exceptions: [
        { date: "2026-09-28", action: "SKIP", reason: "Holiday" },
        { date: "2026-09-29", action: "SKIP", reason: "Studio closed", slot_id: "b" },
      ],
    };
    const list = pendingOccurrences(s, at("2026-09-28T00:00:00Z"), { since: at("2026-09-28T00:00:00Z"), claimed: none, dismissed: none });
    expect(summary(list)).toEqual(["a@2026-09-29:UPCOMING", "b@2026-09-30:UPCOMING"]);
  });

  it("uses each slot's own timezone, including DST changes", () => {
    const ny: NormalizedSchedule = { slots: [slot("ny", "21:00", { timezone: "America/New_York" })], exceptions: [] };
    // US DST starts 2026-03-08: 21:00 EST (UTC-5) on the 7th, 21:00 EDT (UTC-4) on the 8th.
    const [sat, sun] = slotOccurrences(ny, ny.slots[0]!, "2026-03-07", 1);
    expect(sat!.drawAt.toISOString()).toBe("2026-03-08T02:00:00.000Z");
    expect(sun!.drawAt.toISOString()).toBe("2026-03-09T01:00:00.000Z");
    // Local dates are counted in the slot's timezone, not UTC.
    expect(localDateInZone(at("2026-09-29T02:00:00Z"), "America/New_York")).toBe("2026-09-28");
    expect(localDateInZone(at("2026-09-28T21:00:00Z"), "Asia/Tehran")).toBe("2026-09-29");
  });
});

describe("slot schedule validation", () => {
  const base = { slots: [slot("a", "14:00")], exceptions: [] };
  it("accepts several slots and rejects ambiguous or impossible ones", () => {
    expect(slotScheduleSchema.safeParse(threeDaily).success).toBe(true);
    expect(slotScheduleSchema.safeParse({ ...base, slots: [slot("a", "14:00"), slot("a", "18:00")] }).success).toBe(false); // duplicate id
    expect(slotScheduleSchema.safeParse({ ...base, slots: [slot("a", "14:00"), slot("b", "14:00")] }).success).toBe(false); // same day+time
    expect(slotScheduleSchema.safeParse({ ...base, slots: [slot("a", "14:00"), slot("b", "14:00", { enabled: false })] }).success).toBe(true);
    expect(slotScheduleSchema.safeParse({ ...base, slots: [slot("a", "14:00", { timezone: "Mars/Olympus" })] }).success).toBe(false);
    expect(slotScheduleSchema.safeParse({ ...base, slots: [slot("a", "14:00", { sales_open_hours_before_draw: 0.25, sales_close_minutes_before_draw: 30 })] }).success).toBe(false);
    expect(slotScheduleSchema.safeParse({ ...base, slots: [slot("a", "14:00", { sales_close_minutes_before_draw: 0 })] }).success).toBe(false);
    expect(slotScheduleSchema.safeParse({ ...base, exceptions: [{ date: "2026-09-28", action: "SKIP", reason: "x", slot_id: "zzz" }] }).success).toBe(false);
  });

  it("reads a legacy single-time schedule as one default slot", () => {
    const n = normalizeSchedule({ timezone: "Asia/Tehran", active_weekdays: [2, 5], draw_time: "21:00", sales_open_hours_before_draw: 72, sales_close_minutes_before_draw: 30, exceptions: [] });
    expect(n?.slots).toEqual([
      { slot_id: "default", enabled: true, label: null, weekdays: [2, 5], draw_time: "21:00", timezone: "Asia/Tehran", sales_open_hours_before_draw: 72, sales_close_minutes_before_draw: 30 },
    ]);
    expect(normalizeSchedule({ nonsense: true })).toBeNull();
  });
});

describe("occurrence identity is (slot_id, local date), not the displayed time", () => {
  it("changing a slot's time after a draw claimed it does not bring the occurrence back", () => {
    const now = at("2026-09-28T06:00:00Z");
    const opts = { since: at("2026-09-28T00:00:00Z"), dismissed: none, claimed: new Set([occurrenceKey("evening", "2026-09-28")]) };
    const moved: NormalizedSchedule = { slots: [slot("afternoon", "14:00"), slot("evening", "19:15"), slot("night", "21:00")], exceptions: [] };
    const list = pendingOccurrences(moved, now, opts);
    expect(list.filter((o) => o.slotId === "evening").map((o) => o.localDate)).toEqual(["2026-09-29"]);
    expect(list.find((o) => o.slotId === "evening")!.drawAt.toISOString()).toBe("2026-09-29T15:45:00.000Z"); // 19:15 Tehran
  });

  it("a new slot at a previously used time is a different occurrence", () => {
    const now = at("2026-09-28T06:00:00Z");
    const claimed = new Set([occurrenceKey("evening", "2026-09-28")]);
    const renamed: NormalizedSchedule = { slots: [slot("evening-2", "18:00")], exceptions: [] };
    const list = pendingOccurrences(renamed, now, { since: at("2026-09-28T00:00:00Z"), dismissed: none, claimed });
    expect(summary(list)).toEqual(["evening-2@2026-09-28:UPCOMING"]);
  });
});
