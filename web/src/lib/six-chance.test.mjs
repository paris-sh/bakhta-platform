// Frontend check for the Six Chance system-play mirror (lib/six-chance.ts). Runs with Node's
// built-in test runner and native TypeScript type-stripping — no extra dependency:
//   npm test
// The server remains authoritative; this guards the live UI calculation against drifting
// from the backend's formula (backend/src/modules/orders/selections.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { binomial, combinationCount, linesOverlap, sixChanceLimits, systemPlayEnabled } from "./six-chance.ts";

const base = {
  ticket_price_toman: 300000,
  selection: { main_numbers: { count: 6, min: 1, max: 33 }, chance_symbol: { min: 1, max: 5 } },
};

test("combinationCount follows C(n, 6) × symbols (spec examples)", () => {
  assert.equal(combinationCount(6, 1), 1);
  assert.equal(combinationCount(7, 2), 14);
  assert.equal(combinationCount(8, 3), 84);
  assert.equal(combinationCount(12, 5), 4620);
  assert.equal(combinationCount(5, 1), 0);
  assert.equal(combinationCount(7, 0), 0);
  assert.equal(binomial(33, 6), 1107568);
});

test("schema_version 1 snapshots are exact-pick only", () => {
  const limits = sixChanceLimits({ ...base, schema_version: 1 });
  assert.deepEqual(limits, {
    requiredNumbers: 6,
    maxNumbersPerLine: 6,
    maxSymbolsPerLine: 1,
    maxCombinationsPerLine: 1,
    maxCombinationsPerOrder: null,
  });
  assert.equal(systemPlayEnabled(limits), false);
});

test("schema_version 2 limits come from the snapshot", () => {
  const limits = sixChanceLimits({
    ...base,
    schema_version: 2,
    selection: {
      ...base.selection,
      required_numbers_per_combination: 6,
      maximum_selected_numbers_per_line: 12,
      maximum_selected_symbols_per_line: 5,
      maximum_combinations_per_line: 1000,
      maximum_combinations_per_order: 5000,
    },
  });
  assert.equal(limits.maxNumbersPerLine, 12);
  assert.equal(limits.maxCombinationsPerOrder, 5000);
  assert.equal(systemPlayEnabled(limits), true);
});

test("overlap needs a shared symbol and at least 6 shared numbers", () => {
  const r = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  assert.equal(linesOverlap({ numbers: r(1, 8), symbols: [1, 2] }, { numbers: [2, 3, 4, 5, 6, 7], symbols: [2] }), true);
  assert.equal(linesOverlap({ numbers: r(1, 7), symbols: [1] }, { numbers: r(1, 7), symbols: [2] }), false);
  assert.equal(linesOverlap({ numbers: r(1, 7), symbols: [1] }, { numbers: [3, 4, 5, 6, 7, 20], symbols: [1] }), false);
});
