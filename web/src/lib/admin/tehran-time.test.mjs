import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  addMonths,
  calendarForLocale,
  detectLocalTimeZone,
  formatInstantInZone,
  formatSlotTime,
  formatWallTime,
  fromGregorianDate,
  fromTehranInput,
  isLeapYear,
  monthGrid,
  monthLength,
  parseWallInput,
  resolveTehranInput,
  tehranInputFromNow,
  toGregorianDate,
  toTehranInput,
  weekdayOrder,
  zonedWallTimeToUtcMs,
} from "./tehran-time.ts";

const NICOSIA = "Europe/Nicosia";

/** Runs `fn` with the process (≈ browser) timezone set to `tz`, then restores it. */
function inProcessTimeZone(tz, fn) {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test("converts between UTC instants and Tehran wall time", () => {
  assert.equal(toTehranInput("2026-09-28T16:30:00.000Z"), "2026-09-28T20:00");
  assert.equal(fromTehranInput("2026-09-28T20:00"), "2026-09-28T16:30:00.000Z");
  assert.equal(fromTehranInput("2026-09-29T01:15"), "2026-09-28T21:45:00.000Z");
  assert.equal(fromTehranInput(toTehranInput("2026-12-31T22:59:00.000Z")), "2026-12-31T22:59:00.000Z");
});

test("uses the real Asia/Tehran rules, not a fixed offset (Tehran observed DST until 2022)", () => {
  assert.equal(fromTehranInput("2021-06-01T21:00"), "2021-06-01T16:30:00.000Z"); // +04:30
  assert.equal(fromTehranInput("2021-12-01T21:00"), "2021-12-01T17:30:00.000Z"); // +03:30
  assert.equal(toTehranInput("2021-06-01T16:30:00.000Z"), "2021-06-01T21:00");
});

test("rejects malformed or impossible input and builds relative defaults", () => {
  assert.equal(fromTehranInput(""), null);
  assert.equal(fromTehranInput("2026-09-28 20:00"), null);
  assert.equal(fromTehranInput("2026-02-30T10:00"), null);
  assert.equal(fromTehranInput("2026-09-30T24:00"), null);
  assert.equal(parseWallInput("2026-09-30T21:60"), null);
  assert.equal(tehranInputFromNow(1, Date.parse("2026-09-28T16:30:42.000Z")), "2026-09-28T21:00");
});

test("Persian: a Jalali selection becomes one Tehran wall time and one UTC instant", () => {
  // The admin picks 8 Mehr 1405 at 21:00 in the Jalali calendar.
  const g = toGregorianDate("jalali", { year: 1405, month: 7, day: 8 });
  assert.deepEqual(g, { year: 2026, month: 9, day: 30 });
  const wall = "2026-09-30T21:00";
  assert.equal(fromTehranInput(wall), "2026-09-30T17:30:00.000Z");
  assert.equal(formatWallTime(parseWallInput(wall), "fa"), "۸ مهر ۱۴۰۵، ساعت ۲۱:۰۰");
});

test("English: a Gregorian selection is shown in Gregorian, 24-hour, ASCII digits", () => {
  const wall = parseWallInput("2026-09-30T21:00");
  assert.equal(formatWallTime(wall, "en"), "30 Sep 2026, 21:00");
  assert.equal(formatWallTime(parseWallInput("2026-09-30T09:05"), "en"), "30 Sep 2026, 09:05");
  assert.doesNotMatch(formatWallTime(wall, "en"), /AM|PM/);
  assert.doesNotMatch(formatWallTime(wall, "fa"), /AM|PM|ق\.ظ|ب\.ظ/);
});

test("UTC → Tehran → Jalali round trip", () => {
  const wall = parseWallInput(toTehranInput("2026-09-30T17:30:00.000Z"));
  assert.deepEqual(fromGregorianDate("jalali", wall), { year: 1405, month: 7, day: 8 });
  assert.equal(formatInstantInZone("2026-09-30T17:30:00.000Z", "Asia/Tehran", "fa"), "۸ مهر ۱۴۰۵، ساعت ۲۱:۰۰");
});

test("Jalali → Gregorian → UTC → Tehran → Jalali round trips for every day of several years", () => {
  for (let year = 1399; year <= 1412; year++) {
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= monthLength("jalali", year, month); day++) {
        const g = toGregorianDate("jalali", { year, month, day });
        const wall = `${g.year}-${String(g.month).padStart(2, "0")}-${String(g.day).padStart(2, "0")}T21:00`;
        const back = parseWallInput(toTehranInput(fromTehranInput(wall)));
        assert.deepEqual(fromGregorianDate("jalali", back), { year, month, day });
      }
    }
  }
});

test("UTC → Tehran → UTC is lossless for every hour of a year", () => {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  for (let h = 0; h < 366 * 24; h++) {
    const iso = new Date(start + h * 3_600_000 + 17 * 60_000).toISOString();
    assert.equal(fromTehranInput(toTehranInput(iso)), iso);
  }
});

test("Tehran input is never interpreted in the browser timezone (Europe/Nicosia)", () => {
  inProcessTimeZone(NICOSIA, () => {
    // ICU may report the canonical alias (Asia/Nicosia) for Europe/Nicosia.
    assert.match(detectLocalTimeZone(), /^(Europe|Asia)\/Nicosia$/);
    // The process clock really is in Cyprus now…
    assert.equal(new Date("2026-09-30T17:30:00.000Z").getHours(), 20);
    // …yet 21:00 still means 21:00 in Tehran.
    assert.equal(fromTehranInput("2026-09-30T21:00"), "2026-09-30T17:30:00.000Z");
    assert.equal(toTehranInput("2026-09-30T17:30:00.000Z"), "2026-09-30T21:00");
    assert.equal(tehranInputFromNow(0, Date.parse("2026-09-30T17:30:00.000Z")), "2026-09-30T21:00");
    // The informational local line.
    assert.equal(formatInstantInZone("2026-09-30T17:30:00.000Z", NICOSIA, "en"), "30 Sep 2026, 20:30");
    assert.equal(formatInstantInZone("2026-09-30T17:30:00.000Z", NICOSIA, "fa"), "۸ مهر ۱۴۰۵، ساعت ۲۰:۳۰");
  });
});

test("Europe/Nicosia daylight-saving boundaries", () => {
  // DST starts 2026-03-29 01:00 UTC (+02:00 → +03:00).
  assert.equal(formatInstantInZone(fromTehranInput("2026-03-29T04:00"), NICOSIA, "en"), "29 Mar 2026, 02:30");
  assert.equal(formatInstantInZone(fromTehranInput("2026-03-29T05:00"), NICOSIA, "en"), "29 Mar 2026, 04:30");
  // DST ends 2026-10-25 01:00 UTC: two different Tehran times read 03:30 in Cyprus.
  assert.equal(formatInstantInZone(fromTehranInput("2026-10-25T04:00"), NICOSIA, "en"), "25 Oct 2026, 03:30");
  assert.equal(formatInstantInZone(fromTehranInput("2026-10-25T05:00"), NICOSIA, "en"), "25 Oct 2026, 03:30");
  // Converting a Cyprus wall time settles on the correct side of each boundary.
  const w = (y, mo, d, h, mi) => ({ year: y, month: mo, day: d, hour: h, minute: mi });
  assert.equal(new Date(zonedWallTimeToUtcMs(w(2026, 3, 29, 2, 30), NICOSIA)).toISOString(), "2026-03-29T00:30:00.000Z");
  assert.equal(new Date(zonedWallTimeToUtcMs(w(2026, 3, 29, 4, 30), NICOSIA)).toISOString(), "2026-03-29T01:30:00.000Z");
  assert.equal(new Date(zonedWallTimeToUtcMs(w(2026, 10, 25, 5, 0), NICOSIA)).toISOString(), "2026-10-25T03:00:00.000Z");
  // Tehran conversion is identical whichever side of the Cyprus boundary the browser is on.
  inProcessTimeZone(NICOSIA, () => {
    assert.equal(fromTehranInput("2026-10-25T04:00"), "2026-10-25T00:30:00.000Z");
    assert.equal(fromTehranInput("2026-10-25T05:00"), "2026-10-25T01:30:00.000Z");
  });
});

test("near midnight Tehran and Cyprus show different calendar dates", () => {
  const iso = fromTehranInput("2026-09-30T00:15");
  assert.equal(iso, "2026-09-29T20:45:00.000Z");
  assert.equal(formatInstantInZone(iso, "Asia/Tehran", "fa"), "۸ مهر ۱۴۰۵، ساعت ۰۰:۱۵");
  assert.equal(formatInstantInZone(iso, NICOSIA, "fa"), "۷ مهر ۱۴۰۵، ساعت ۲۳:۴۵");
  assert.equal(formatInstantInZone(iso, NICOSIA, "en"), "29 Sep 2026, 23:45");
});

test("Persian calendar leap years", () => {
  assert.equal(isLeapYear("jalali", 1403), true);
  assert.equal(isLeapYear("jalali", 1404), false);
  assert.equal(isLeapYear("jalali", 1408), true);
  assert.equal(monthLength("jalali", 1403, 12), 30);
  assert.equal(monthLength("jalali", 1404, 12), 29);
  assert.deepEqual(toGregorianDate("jalali", { year: 1403, month: 12, day: 30 }), { year: 2025, month: 3, day: 20 });
  assert.equal(fromTehranInput("2025-03-20T21:00"), "2025-03-20T17:30:00.000Z");
  assert.deepEqual(addDays("jalali", { year: 1403, month: 12, day: 30 }, 1), { year: 1404, month: 1, day: 1 });
  // Moving a month clamps Esfand 30 of a leap year into the next month's length.
  assert.deepEqual(addMonths("jalali", { year: 1403, month: 11, day: 30 }, 1), { year: 1403, month: 12, day: 30 });
  assert.deepEqual(addMonths("jalali", { year: 1404, month: 11, day: 30 }, 1), { year: 1404, month: 12, day: 29 });
  assert.equal(isLeapYear("gregorian", 2028), true);
  assert.equal(monthLength("gregorian", 2026, 2), 28);
});

test("month grids start on Saturday (Persian) and Monday (English)", () => {
  assert.equal(calendarForLocale("fa"), "jalali");
  assert.equal(calendarForLocale("en"), "gregorian");
  assert.deepEqual(weekdayOrder("jalali"), [6, 0, 1, 2, 3, 4, 5]);
  assert.deepEqual(weekdayOrder("gregorian"), [1, 2, 3, 4, 5, 6, 0]);
  // 1 Mehr 1405 = Wednesday 23 Sep 2026: Sat, Sun, Mon, Tue are padding.
  const mehr = monthGrid("jalali", 1405, 7);
  assert.deepEqual(mehr[0].slice(0, 4), [null, null, null, null]);
  assert.deepEqual(mehr[0][4], { year: 1405, month: 7, day: 1 });
  assert.equal(mehr.flat().filter(Boolean).length, 30);
  // 1 September 2026 is a Tuesday.
  const sep = monthGrid("gregorian", 2026, 9);
  assert.equal(sep[0][0], null);
  assert.deepEqual(sep[0][1], { year: 2026, month: 9, day: 1 });
  assert.equal(sep.flat().filter(Boolean).length, 30);
});

test("an unchanged field keeps its original instant exactly (no truncation, no re-conversion)", () => {
  const stored = "2026-09-30T17:30:42.123Z";
  assert.equal(resolveTehranInput(toTehranInput(stored), stored), stored);
  assert.equal(resolveTehranInput("2026-09-30T22:00", stored), "2026-09-30T18:30:00.000Z");
  assert.equal(resolveTehranInput("2026-09-30T21:00", null), "2026-09-30T17:30:00.000Z");
  // Loading then saving is a no-op even with a browser in Cyprus.
  inProcessTimeZone(NICOSIA, () => {
    assert.equal(resolveTehranInput(toTehranInput(stored), stored), stored);
  });
});

test("schedule slot times are 24-hour and use Persian digits in Persian", () => {
  assert.equal(formatSlotTime("21:00", "fa"), "۲۱:۰۰");
  assert.equal(formatSlotTime("09:30", "en"), "09:30");
  assert.equal(formatSlotTime("7:05", "fa"), "۰۷:۰۵");
});
