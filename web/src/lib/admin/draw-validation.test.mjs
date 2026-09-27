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
