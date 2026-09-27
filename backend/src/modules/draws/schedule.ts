import type { NormalizedSchedule, ScheduleSlot } from "../games/rules.schemas.js";

/**
 * Converts a local wall-clock date+time in an IANA timezone to a UTC Date, correctly
 * accounting for that specific date's DST offset (not just the current offset). Standard
 * dependency-free technique: format a first guess in the target timezone, measure how far
 * the result drifted from the guess, and correct by that amount.
 */
// Intl formatters are expensive to build; reminders compute many occurrences, so cache them.
const formatters = new Map<string, Intl.DateTimeFormat>();
function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

export function zonedTimeToUtc(dateISO: string, timeHHMM: string, timeZone: string): Date {
  const [year, month, day] = dateISO.split("-").map(Number) as [number, number, number];
  const [hour, minute] = timeHHMM.split(":").map(Number) as [number, number];

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);

  const parts = zoneFormatter(timeZone).formatToParts(new Date(utcGuess));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);

  const guessInterpretedAsThatZone = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  const offset = guessInterpretedAsThatZone - utcGuess;
  return new Date(utcGuess - offset);
}

/** The day-of-week (0=Sunday..6=Saturday) that `dateISO` falls on, evaluated in `timeZone`
 * — not the server's own local time zone. */
// A calendar date names the same weekday in every timezone, so this is plain arithmetic;
// `timeZone` is kept for call-site clarity.
export function weekdayInZone(dateISO: string, _timeZone: string): number {
  const [y, m, d] = dateISO.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** The calendar date ("YYYY-MM-DD") an instant falls on in `timeZone`. */
export function localDateInZone(instant: Date, timeZone: string): string {
  let f = dateFormatters.get(timeZone);
  if (!f) {
    // en-CA formats as YYYY-MM-DD.
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dateFormatters.set(timeZone, f);
  }
  return f.format(instant);
}

/**
 * One expected scheduled occurrence. Its identity is (game, slotId, localDate): stable no
 * matter how the eventual draw's times are edited, and independent of every other slot —
 * three slots on one day are three occurrences.
 */
export interface ScheduledOccurrence {
  slotId: string;
  slotLabel: string | null;
  /** The intended local date in the slot's timezone. */
  localDate: string;
  timezone: string;
  drawAt: Date;
  salesOpensAt: Date;
  salesClosesAt: Date;
}

export const occurrenceKey = (slotId: string, localDate: string) => `${slotId}|${localDate}`;

function isSkipped(schedule: NormalizedSchedule, slotId: string, localDate: string): boolean {
  return schedule.exceptions.some((e) => e.action === "SKIP" && e.date === localDate && (e.slot_id === undefined || e.slot_id === slotId));
}

/** The occurrence of `slot` on `localDate`, or null when the slot does not run that day. */
export function occurrenceOn(schedule: NormalizedSchedule, slot: ScheduleSlot, localDate: string): ScheduledOccurrence | null {
  if (!slot.weekdays.includes(weekdayInZone(localDate, slot.timezone))) return null;
  if (isSkipped(schedule, slot.slot_id, localDate)) return null;
  const drawAt = zonedTimeToUtc(localDate, slot.draw_time, slot.timezone);
  return {
    slotId: slot.slot_id,
    slotLabel: slot.label ?? null,
    localDate,
    timezone: slot.timezone,
    drawAt,
    salesClosesAt: new Date(drawAt.getTime() - slot.sales_close_minutes_before_draw * 60_000),
    salesOpensAt: new Date(drawAt.getTime() - slot.sales_open_hours_before_draw * 3_600_000),
  };
}

/** Every occurrence of one slot whose local date is within [fromDateISO, fromDateISO + days]. */
export function slotOccurrences(schedule: NormalizedSchedule, slot: ScheduleSlot, fromDateISO: string, days: number): ScheduledOccurrence[] {
  const out: ScheduledOccurrence[] = [];
  for (let i = 0; i <= days; i++) {
    const o = occurrenceOn(schedule, slot, addDaysISO(fromDateISO, i));
    if (o) out.push(o);
  }
  return out;
}

export type OccurrenceState = "UPCOMING" | "OVERDUE" | "MISSED";

export interface PendingOccurrence extends ScheduledOccurrence {
  /** UPCOMING: sales have not opened yet; OVERDUE: sales should already be open but the draw
   * time has not passed; MISSED: the draw time passed without a draw claiming it. */
  state: OccurrenceState;
}

export function occurrenceState(o: ScheduledOccurrence, now: Date): OccurrenceState {
  if (o.drawAt.getTime() <= now.getTime()) return "MISSED";
  if (o.salesOpensAt.getTime() <= now.getTime()) return "OVERDUE";
  return "UPCOMING";
}

/** How far back a missed occurrence is still reported; older ones are never backfilled. */
export const MISSED_LOOKBACK_DAYS = 7;
const MAX_MISSED_PER_SLOT = 10;
const SEARCH_DAYS = 400;

/**
 * Reminders for one game: per ENABLED slot, every missed occurrence since `since` (capped to
 * MISSED_LOOKBACK_DAYS) plus the next occurrence whose draw time is still ahead — each unless
 * a draw already claims it or it was dismissed. `since` is when the active settings took
 * effect, so after a clean reset nothing before "now" is backfilled. Pure: never writes.
 */
export function pendingOccurrences(
  schedule: NormalizedSchedule,
  now: Date,
  opts: { since: Date; claimed: ReadonlySet<string>; dismissed: ReadonlySet<string> },
): PendingOccurrence[] {
  const floor = Math.max(opts.since.getTime(), now.getTime() - MISSED_LOOKBACK_DAYS * 86_400_000);
  const out: PendingOccurrence[] = [];
  for (const slot of schedule.slots) {
    if (!slot.enabled) continue;
    const start = localDateInZone(new Date(floor), slot.timezone);
    let missed = 0;
    for (let i = 0; i <= SEARCH_DAYS; i++) {
      const o = occurrenceOn(schedule, slot, addDaysISO(start, i));
      if (!o) continue;
      if (o.drawAt.getTime() <= floor) continue;
      const key = occurrenceKey(o.slotId, o.localDate);
      if (opts.claimed.has(key) || opts.dismissed.has(key)) continue;
      const state = occurrenceState(o, now);
      if (state === "MISSED") {
        if (missed++ < MAX_MISSED_PER_SLOT) out.push({ ...o, state });
        continue;
      }
      out.push({ ...o, state });
      break; // only the next one per slot
    }
  }
  return out.sort((a, b) => a.drawAt.getTime() - b.drawAt.getTime());
}
