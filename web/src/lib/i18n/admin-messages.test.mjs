// Admin dictionary parity check (npm test). TypeScript already enforces that `fa` has every
// `en` key; this runtime check also catches type-compatible drift (e.g. a status map losing
// an entry, or a function becoming a plain string) and empty translations.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ADMIN_MESSAGES } from "./admin-messages.ts";

function shape(value, path = "") {
  if (typeof value === "function") return [`${path}:fn`];
  if (Array.isArray(value)) return [`${path}:array(${value.length})`];
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .flatMap((k) => shape(value[k], path ? `${path}.${k}` : k));
  }
  return [`${path}:${typeof value}`];
}

function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}

test("English and Persian admin dictionaries have identical structure", () => {
  assert.deepEqual(shape(ADMIN_MESSAGES.fa), shape(ADMIN_MESSAGES.en));
});

test("no admin translation is empty", () => {
  for (const locale of ["en", "fa"]) {
    for (const s of strings(ADMIN_MESSAGES[locale])) assert.ok(s.trim().length > 0, `empty string in ${locale}`);
  }
});

test("Persian admin copy is actually Persian and formats numbers in Persian digits", () => {
  const fa = ADMIN_MESSAGES.fa;
  assert.match(fa.nav.dashboard, /[؀-ۿ]/);
  assert.match(fa.common.showing(1, 20, 1234), /[۰-۹]/);
  assert.match(fa.rules.hints.maxPossible(12, 5, 4620), /۴٬?۶۲۰/);
  assert.equal(ADMIN_MESSAGES.en.rules.hints.maxPossible(12, 5, 4620), "Largest possible line: C(12, 6) × 5 = 4,620 combinations.");
});

test("reminder and Create Draw wording matches the approved Persian and English text", () => {
  const { en, fa } = ADMIN_MESSAGES;
  assert.equal(en.workflow.suggestionExplain, "According to the active game schedule, the next suggested draw is on this date.");
  assert.equal(fa.workflow.suggestionExplain, "طبق برنامه فعال این بازی، نوبت پیشنهادی بعدی برای این تاریخ است.");
  assert.equal(en.workflow.reminders.timeToCreate("Six Chance"), "It is time to create the next Six Chance draw.");
  assert.equal(fa.workflow.reminders.timeToCreate("شش‌شانس"), "زمان ساخت قرعه‌کشی بعدی شش‌شانس رسیده است.");
  for (const m of [en, fa]) {
    assert.deepEqual(Object.keys(m.workflow.reminders.state).sort(), ["MISSED", "OVERDUE", "UPCOMING"]);
    assert.deepEqual(Object.keys(m.workflow.edit.times).sort(), ["CLOSE_NOT_BEFORE_DRAW", "OPEN_NOT_BEFORE_CLOSE", "REQUIRED"]);
    assert.match(m.workflow.edit.reasonHint, /5|۵/);
  }
});
