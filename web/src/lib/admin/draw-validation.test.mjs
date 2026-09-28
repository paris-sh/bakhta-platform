import assert from "node:assert/strict";
import { test } from "node:test";
import { MIN_REASON_LENGTH, reasonState, saveBlockers, validateDrawTimes } from "./draw-validation.ts";

const t = (h) => new Date(Date.UTC(2026, 9, 1, h)).toISOString();

test("requires sales opening < sales closing < draw time", () => {
  assert.deepEqual(validateDrawTimes({ open: t(10), close: t(20), draw: t(21) }), []);
  assert.deepEqual(validateDrawTimes({ open: t(20), close: t(20), draw: t(21) }), [{ field: "close", code: "OPEN_NOT_BEFORE_CLOSE" }]);
  assert.deepEqual(validateDrawTimes({ open: t(10), close: t(21), draw: t(21) }), [{ field: "draw", code: "CLOSE_NOT_BEFORE_DRAW" }]);
  assert.deepEqual(validateDrawTimes({ open: t(22), close: t(20), draw: t(19) }), [
    { field: "close", code: "OPEN_NOT_BEFORE_CLOSE" },
    { field: "draw", code: "CLOSE_NOT_BEFORE_DRAW" },
  ]);
  assert.deepEqual(validateDrawTimes({ open: null, close: t(20), draw: "" }), [
    { field: "open", code: "REQUIRED" },
    { field: "draw", code: "REQUIRED" },
  ]);
});

test("reason feedback: at least 5 characters, only when required or started", () => {
  assert.equal(MIN_REASON_LENGTH, 5);
  assert.equal(reasonState("", false), "NOT_NEEDED");
  assert.equal(reasonState("", true), "MISSING");
  assert.equal(reasonState(" abc ", true), "TOO_SHORT");
  assert.equal(reasonState("abcd", false), "TOO_SHORT");
  assert.equal(reasonState("Board ok", true), "OK");
});

test("explains why saving is disabled", () => {
  const ok = validateDrawTimes({ open: t(10), close: t(20), draw: t(21) });
  assert.deepEqual(saveBlockers({ timeIssues: ok, reason: "", reasonRequired: false }), []);
  assert.deepEqual(saveBlockers({ timeIssues: ok, reason: "no", reasonRequired: true }), ["REASON"]);
  const bad = validateDrawTimes({ open: t(20), close: t(10), draw: t(21) });
  assert.deepEqual(saveBlockers({ timeIssues: bad, reason: "", reasonRequired: true, checking: true }), ["TIMES", "REASON", "CHECKING"]);
});

test("chronology is checked on the Tehran times after their single UTC conversion", async () => {
  const { fromTehranInput } = await import("./tehran-time.ts");
  const { ADMIN_MESSAGES } = await import("../i18n/admin-messages.ts");
  const times = (open, close, draw) => ({ open: fromTehranInput(open), close: fromTehranInput(close), draw: fromTehranInput(draw) });
  // Across Tehran midnight (a different calendar day in Cyprus) the order still holds.
  assert.deepEqual(validateDrawTimes(times("2026-09-29T21:00", "2026-09-30T23:30", "2026-10-01T00:15")), []);
  const issues = validateDrawTimes(times("2026-09-30T21:00", "2026-09-30T20:30", "2026-09-30T20:30"));
  assert.deepEqual(issues, [
    { field: "close", code: "OPEN_NOT_BEFORE_CLOSE" },
    { field: "draw", code: "CLOSE_NOT_BEFORE_DRAW" },
  ]);
  // An impossible date blocks saving instead of being guessed.
  assert.deepEqual(validateDrawTimes(times("2026-02-30T10:00", "2026-03-01T10:00", "2026-03-01T11:00")), [{ field: "open", code: "REQUIRED" }]);
  // Each issue has a message in both languages, and the rule itself is stated in both.
  for (const locale of ["en", "fa"]) {
    const m = ADMIN_MESSAGES[locale].workflow;
    for (const issue of issues) assert.ok(m.edit.times[issue.code].length > 0);
    assert.match(m.picker.chronology, /<.*</);
  }
  assert.match(ADMIN_MESSAGES.fa.workflow.edit.times.OPEN_NOT_BEFORE_CLOSE, /[؀-ۿ]/);
});
