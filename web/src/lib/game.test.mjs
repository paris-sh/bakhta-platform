import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduleSlots, scheduleText } from "./schedule-text.ts";
import { MESSAGES } from "./i18n/messages.ts";

const en = MESSAGES.en;
const fa = MESSAGES.fa;
const slot = (id, draw_time, weekdays, extra = {}) => ({
  slot_id: id,
  enabled: true,
  label: null,
  weekdays,
  draw_time,
  timezone: "Asia/Tehran",
  sales_open_hours_before_draw: 24,
  sales_close_minutes_before_draw: 30,
  ...extra,
});
const DAILY = [0, 1, 2, 3, 4, 5, 6];
const legacy = (active_weekdays, draw_time) => ({
  schedule: { timezone: "Asia/Tehran", active_weekdays, draw_time, sales_open_hours_before_draw: 24, sales_close_minutes_before_draw: 30, exceptions: [] },
});
const slots = (...list) => ({ schedule: { slots: list, exceptions: [] } });

test("old single-time schedules read exactly as before", () => {
  assert.equal(scheduleText(legacy(DAILY, "21:00"), en, "en"), "Draws daily at 21:00");
  assert.equal(scheduleText(legacy([2, 5], "21:00"), en, "en"), "Draws every Tuesday and Friday at 21:00");
  assert.deepEqual(scheduleSlots(legacy([5, 2], "21:00").schedule), [{ weekdays: [2, 5], drawTime: "21:00" }]);
});

test("a new single-slot schedule reads like the old one", () => {
  assert.equal(scheduleText(slots(slot("default", "21:00", DAILY)), en, "en"), "Draws daily at 21:00");
  assert.equal(scheduleText(slots(slot("default", "21:00", [2, 5])), en, "en"), "Draws every Tuesday and Friday at 21:00");
});

test("several slots on the same day are grouped into one phrase", () => {
  const three = slots(slot("a", "21:00", DAILY), slot("b", "14:00", DAILY), slot("c", "18:00", DAILY));
  assert.equal(scheduleText(three, en, "en"), "Draws daily at 14:00, 18:00, and 21:00");
  assert.equal(scheduleText(three, fa, "fa"), "قرعه‌کشی هر روز ساعت ۱۴:۰۰، ۱۸:۰۰ و ۲۱:۰۰");
});

test("slots on different weekdays are listed per group; paused slots are ignored", () => {
  const mixed = slots(slot("daily", "14:00", DAILY), slot("tf", "21:00", [5, 2]), slot("off", "09:00", DAILY, { enabled: false }));
  assert.equal(scheduleText(mixed, en, "en"), "Draws daily at 14:00; every Tuesday and Friday at 21:00");
  assert.equal(scheduleText(mixed, fa, "fa"), "قرعه‌کشی: هر روز ساعت ۱۴:۰۰؛ سه‌شنبه و جمعه ساعت ۲۱:۰۰");
  assert.equal(scheduleText(slots(slot("off", "09:00", DAILY, { enabled: false })), en, "en"), en.play.noRegularDraws);
});

test("missing or malformed schedule data never throws and shows a localized fallback", () => {
  for (const bad of [undefined, null, {}, { schedule: null }, { schedule: "daily" }, { schedule: { draw_time: "21:00" } }, legacy("x", "21:00"), legacy([2], "9pm")]) {
    assert.equal(scheduleText(bad, en, "en"), en.play.scheduleUnavailable);
    assert.equal(scheduleText(bad, fa, "fa"), fa.play.scheduleUnavailable);
  }
  // Malformed slots are skipped, valid ones still shown.
  const partly = slots(slot("ok", "21:00", DAILY), { slot_id: "bad", enabled: true, weekdays: [9], draw_time: "25:00" }, null);
  assert.equal(scheduleText(partly, en, "en"), "Draws daily at 21:00");
  assert.equal(scheduleText({ schedule: { slots: [null, 5] } }, en, "en"), en.play.noRegularDraws);
});

test("Persian output uses Persian digits and weekday names", () => {
  assert.equal(scheduleText(legacy(DAILY, "21:00"), fa, "fa"), "قرعه‌کشی هر روز ساعت ۲۱:۰۰");
  assert.equal(scheduleText(slots(slot("default", "21:00", [2, 5])), fa, "fa"), "قرعه‌کشی: سه‌شنبه و جمعه — ساعت ۲۱:۰۰");
});
