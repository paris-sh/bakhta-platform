import type { Schedule } from "../games/rules.schemas.js";

/**
 * Converts a local wall-clock date+time in an IANA timezone to a UTC Date, correctly
 * accounting for that specific date's DST offset (not just the current offset). Standard
 * dependency-free technique: format a first guess in the target timezone, measure how far
 * the result drifted from the guess, and correct by that amount.
 */
export function zonedTimeToUtc(dateISO: string, timeHHMM: string, timeZone: string): Date {
  const [year, month, day] = dateISO.split("-").map(Number) as [number, number, number];
  const [hour, minute] = timeHHMM.split(":").map(Number) as [number, number];

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);

  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcGuess));
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
export function weekdayInZone(dateISO: string, timeZone: string): number {
  const noonUtc = zonedTimeToUtc(dateISO, "12:00", timeZone);
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" });
  const short = dtf.format(noonUtc);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[short] ?? -1;
}

function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export interface ScheduledOccurrence {
  dateISO: string;
  drawAt: Date;
  salesOpensAt: Date;
  salesClosesAt: Date;
}

/**
 * Computes every scheduled occurrence whose draw_at falls within
 * [fromDateISO, fromDateISO + horizonDays], skipping non-active weekdays and any exception
 * dated `SKIP`. Pure function — never touches the database; draws.service.ts is what turns
 * these into actual, persisted `draws` rows (see that file for why this distinction matters).
 */
export function computeScheduledOccurrences(
  schedule: Schedule,
  fromDateISO: string,
  horizonDays: number,
): ScheduledOccurrence[] {
  const skipDates = new Set(
    schedule.exceptions.filter((e) => e.action === "SKIP").map((e) => e.date),
  );
  const occurrences: ScheduledOccurrence[] = [];

  for (let i = 0; i <= horizonDays; i++) {
    const dateISO = addDaysISO(fromDateISO, i);
    if (skipDates.has(dateISO)) continue;
    if (!schedule.active_weekdays.includes(weekdayInZone(dateISO, schedule.timezone))) continue;

    const drawAt = zonedTimeToUtc(dateISO, schedule.draw_time, schedule.timezone);
    const salesClosesAt = new Date(
      drawAt.getTime() - schedule.sales_close_minutes_before_draw * 60_000,
    );
    const salesOpensAt = new Date(
      drawAt.getTime() - schedule.sales_open_hours_before_draw * 60 * 60_000,
    );
    occurrences.push({ dateISO, drawAt, salesOpensAt, salesClosesAt });
  }

  return occurrences;
}
