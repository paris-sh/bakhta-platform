// Every calendar and timezone conversion the admin date/time fields use lives here, so it can
// be unit-tested without a browser (npm test runs it under several process time zones).
//
// Asia/Tehran is the only authoritative business timezone. The admin edits a Tehran *wall
// time* — the form state is the zone-less string "YYYY-MM-DDTHH:mm" (Gregorian digits, Tehran
// clock) — and it is converted to a UTC instant exactly once, by fromTehranInput(), when the
// request body is built. Nothing here ever reads the browser's own timezone except
// detectLocalTimeZone(), whose result is informational only.
//
// Jalali ⇄ Gregorian day conversion uses the maintained jalaali-js library; zone offsets come
// from the platform's IANA database via Intl, never from a hard-coded offset.

import { isLeapJalaaliYear, jalaaliMonthLength, toGregorian, toJalaali } from "jalaali-js";

export const TEHRAN_TIME_ZONE = "Asia/Tehran";

/** A clock reading in some timezone (Gregorian date, 24-hour time). */
export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

// ---------------------------------------------------------------- timezone conversion

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

/** The wall-clock reading of a UTC instant in `timeZone` (seconds are dropped). */
export function wallTimeInZone(epochMs: number, timeZone: string): WallTime {
  const parts: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(epochMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour! % 24, minute: parts.minute! };
}

/** Offset of `timeZone` from UTC at an instant, in minutes (Tehran: +210). */
function zoneOffsetMinutes(epochMs: number, timeZone: string): number {
  const w = wallTimeInZone(epochMs, timeZone);
  const seconds = new Date(epochMs).getUTCSeconds();
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, seconds);
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60_000);
}

/** The UTC instant at which `timeZone`'s clock shows `wall`. Correct across DST changes. */
export function zonedWallTimeToUtcMs(wall: WallTime, timeZone: string): number {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  let guess = naive - zoneOffsetMinutes(naive, timeZone) * 60_000;
  // A second pass settles instants whose offset differs from the naive guess's (DST edges).
  guess = naive - zoneOffsetMinutes(guess, timeZone) * 60_000;
  return guess;
}

// ---------------------------------------------------------------- Tehran wall-time strings

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function formatWallInput(w: WallTime): string {
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** "YYYY-MM-DDTHH:mm" → its parts, or null when malformed or not a real calendar date/time. */
export function parseWallInput(value: string): WallTime | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > gregorianMonthLength(year, month)) return null;
  if (hour > 23 || minute > 59) return null;
  return { year, month, day, hour, minute };
}

/** ISO instant → "YYYY-MM-DDTHH:mm" on the Tehran clock (the form's editable value). */
export function toTehranInput(iso: string): string {
  return formatWallInput(wallTimeInZone(Date.parse(iso), TEHRAN_TIME_ZONE));
}

/** "YYYY-MM-DDTHH:mm" (Tehran clock) → UTC ISO instant. The one and only conversion. */
export function fromTehranInput(value: string): string | null {
  const wall = parseWallInput(value);
  return wall ? new Date(zonedWallTimeToUtcMs(wall, TEHRAN_TIME_ZONE)).toISOString() : null;
}

/**
 * Like fromTehranInput, but a field the admin did not change keeps its original instant
 * exactly — a stored timestamp with seconds is never silently truncated to the minute.
 */
export function resolveTehranInput(value: string, originalIso: string | null | undefined): string | null {
  if (originalIso && value === toTehranInput(originalIso)) return new Date(Date.parse(originalIso)).toISOString();
  return fromTehranInput(value);
}

/** Now plus `hours`, rounded down to the minute, as a Tehran input value. */
export function tehranInputFromNow(hours: number, now = Date.now()): string {
  const ms = Math.floor((now + hours * 3_600_000) / 60_000) * 60_000;
  return toTehranInput(new Date(ms).toISOString());
}

/** The viewer's IANA timezone — for the informational "your local time" line only. */
export function detectLocalTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// ---------------------------------------------------------------- calendars

export type CalendarKind = "jalali" | "gregorian";
export type CalendarLocale = "fa" | "en";

/** A day in the given calendar (month is 1-based in both). */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export const calendarForLocale = (locale: CalendarLocale): CalendarKind => (locale === "fa" ? "jalali" : "gregorian");

function gregorianMonthLength(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthLength(kind: CalendarKind, year: number, month: number): number {
  return kind === "jalali" ? jalaaliMonthLength(year, month) : gregorianMonthLength(year, month);
}

export function isLeapYear(kind: CalendarKind, year: number): boolean {
  return kind === "jalali" ? isLeapJalaaliYear(year) : (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Gregorian date → the same day in `kind`. */
export function fromGregorianDate(kind: CalendarKind, g: CalendarDate): CalendarDate {
  if (kind === "gregorian") return { ...g };
  const j = toJalaali(g.year, g.month, g.day);
  return { year: j.jy, month: j.jm, day: j.jd };
}

/** A day in `kind` → the same Gregorian date. */
export function toGregorianDate(kind: CalendarKind, d: CalendarDate): CalendarDate {
  if (kind === "gregorian") return { ...d };
  const g = toGregorian(d.year, d.month, d.day);
  return { year: g.gy, month: g.gm, day: g.gd };
}

/** Day of week of a Gregorian date: 0 = Sunday … 6 = Saturday. */
export function gregorianWeekday(g: CalendarDate): number {
  return new Date(Date.UTC(g.year, g.month - 1, g.day)).getUTCDay();
}

/** The Persian week starts on Saturday; the English calendar on Monday. */
export const weekStartsOn = (kind: CalendarKind): number => (kind === "jalali" ? 6 : 1);

export function addDays(kind: CalendarKind, d: CalendarDate, days: number): CalendarDate {
  const g = toGregorianDate(kind, d);
  const next = new Date(Date.UTC(g.year, g.month - 1, g.day + days));
  return fromGregorianDate(kind, { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() });
}

/** Shifts by whole months, clamping the day to the target month's length. */
export function addMonths(kind: CalendarKind, d: CalendarDate, months: number): CalendarDate {
  const index = d.year * 12 + (d.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { year, month, day: Math.min(d.day, monthLength(kind, year, month)) };
}

export const sameDate = (a: CalendarDate | null, b: CalendarDate | null) =>
  a !== null && b !== null && a.year === b.year && a.month === b.month && a.day === b.day;

/** The month laid out in weeks (rows of 7, starting on the calendar's first weekday);
 * `null` pads the days outside the month. */
export function monthGrid(kind: CalendarKind, year: number, month: number): (CalendarDate | null)[][] {
  const first = toGregorianDate(kind, { year, month, day: 1 });
  const lead = (gregorianWeekday(first) - weekStartsOn(kind) + 7) % 7;
  const cells: (CalendarDate | null)[] = Array.from({ length: lead }, () => null);
  const length = monthLength(kind, year, month);
  for (let day = 1; day <= length; day++) cells.push({ year, month, day });
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (CalendarDate | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Weekday indices (0 = Sunday) in display order. */
export function weekdayOrder(kind: CalendarKind): number[] {
  const start = weekStartsOn(kind);
  return Array.from({ length: 7 }, (_, i) => (start + i) % 7);
}

// ---------------------------------------------------------------- display names and formatting

export const JALALI_MONTHS_FA = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
export const GREGORIAN_MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const GREGORIAN_MONTHS_EN_SHORT = GREGORIAN_MONTHS_EN.map((m) => m.slice(0, 3));
/** Indexed by weekday, 0 = Sunday. */
export const WEEKDAYS_FA = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];
export const WEEKDAYS_FA_SHORT = ["ی", "د", "س", "چ", "پ", "ج", "ش"];
export const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAYS_EN_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** ASCII digits → the locale's digits (Persian for fa). Display only. */
export function localeDigits(value: string | number, locale: CalendarLocale): string {
  const text = String(value);
  return locale === "fa" ? text.replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]!) : text;
}

export function monthName(locale: CalendarLocale, month: number, short = false): string {
  if (locale === "fa") return JALALI_MONTHS_FA[month - 1]!;
  return (short ? GREGORIAN_MONTHS_EN_SHORT : GREGORIAN_MONTHS_EN)[month - 1]!;
}

/** "HH:mm", 24-hour, in the locale's digits. */
export function formatClock(hour: number, minute: number, locale: CalendarLocale): string {
  return localeDigits(`${pad(hour)}:${pad(minute)}`, locale);
}

/** A day in the locale's own calendar: "۸ مهر ۱۴۰۵" / "30 Sep 2026". */
export function formatCalendarDate(d: CalendarDate, locale: CalendarLocale): string {
  return localeDigits(`${d.day} ${monthName(locale, d.month, true)} ${d.year}`, locale);
}

/** A wall time in the locale's calendar: "۸ مهر ۱۴۰۵، ساعت ۲۱:۰۰" / "30 Sep 2026, 21:00". */
export function formatWallTime(w: WallTime, locale: CalendarLocale): string {
  const day = formatCalendarDate(fromGregorianDate(calendarForLocale(locale), w), locale);
  const clock = formatClock(w.hour, w.minute, locale);
  return locale === "fa" ? `${day}، ساعت ${clock}` : `${day}, ${clock}`;
}

/** A UTC instant as read on `timeZone`'s clock, in the locale's calendar. */
export function formatInstantInZone(iso: string, timeZone: string, locale: CalendarLocale): string {
  return formatWallTime(wallTimeInZone(Date.parse(iso), timeZone), locale);
}

/** "HH:mm" (a schedule slot's Tehran draw time) → 24-hour display in the locale's digits. */
export function formatSlotTime(value: string, locale: CalendarLocale): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  return m ? formatClock(Number(m[1]), Number(m[2]), locale) : localeDigits(value, locale);
}
