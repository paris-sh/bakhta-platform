import assert from "node:assert/strict";
import { test } from "node:test";
import { fromTehranInput, tehranInputFromNow, toTehranInput } from "./tehran-time.ts";

test("converts between UTC instants and Tehran wall time (+03:30)", () => {
  assert.equal(toTehranInput("2026-09-28T16:30:00.000Z"), "2026-09-28T20:00");
  assert.equal(fromTehranInput("2026-09-28T20:00"), "2026-09-28T16:30:00.000Z");
  assert.equal(fromTehranInput("2026-09-29T01:15"), "2026-09-28T21:45:00.000Z");
  assert.equal(fromTehranInput(toTehranInput("2026-12-31T22:59:00.000Z")), "2026-12-31T22:59:00.000Z");
});

test("rejects malformed input and builds relative defaults", () => {
  assert.equal(fromTehranInput(""), null);
  assert.equal(fromTehranInput("2026-09-28 20:00"), null);
  assert.equal(tehranInputFromNow(1, Date.parse("2026-09-28T16:30:42.000Z")), "2026-09-28T21:00");
});
