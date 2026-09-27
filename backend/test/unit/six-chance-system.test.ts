import { describe, expect, it } from "vitest";
import type { SixChanceRules } from "../../src/modules/games/rules.schemas.js";
import { ValidationError } from "../../src/shared/errors.js";
import {
  binomial,
  sixChanceCombinationCount,
  sixChanceLimits,
  sixChanceLinesOverlap,
  validateSixChanceLine,
} from "../../src/modules/orders/selections.js";

const BASE = {
  schedule: {
    timezone: "Asia/Tehran",
    active_weekdays: [2, 5],
    draw_time: "21:00",
    sales_open_hours_before_draw: 72,
    sales_close_minutes_before_draw: 30,
    exceptions: [],
  },
  ticket_price_toman: 300000,
  tiers: [{ code: "MAIN6_CHANCE", match: "6_MAIN_PLUS_CHANCE", prize_type: "JACKPOT_POOL" as const }],
  minimum_jackpot_toman: 100000000,
  jackpot_contribution_bps: 6000,
  jackpot_net_sales_basis: "X",
  jackpot_no_winner_rollover: true,
  jackpot_max_toman: null,
  lower_tier_payout_cap_toman: null,
  lower_tier_cap_reduction_strategy: "X",
};
const MAIN = { count: 6 as const, min: 1 as const, max: 33 as const, distinct: true as const, order_matters: false as const };

const V1: SixChanceRules = {
  ...BASE,
  schema_version: 1,
  selection: { main_numbers: MAIN, chance_symbol: { min: 1, max: 5 } },
};

function v2(overrides: Partial<Record<string, number>> = {}): SixChanceRules {
  return {
    ...BASE,
    schema_version: 2,
    selection: {
      main_numbers: MAIN,
      chance_symbol: { min: 1, max: 5 },
      required_numbers_per_combination: 6,
      maximum_selected_numbers_per_line: 12,
      maximum_selected_symbols_per_line: 5,
      maximum_combinations_per_line: 1000,
      maximum_combinations_per_order: 5000,
      ...overrides,
    },
  } as SixChanceRules;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("Six Chance combination math", () => {
  it("binomial matches known values", () => {
    expect(binomial(6, 6)).toBe(1);
    expect(binomial(7, 6)).toBe(7);
    expect(binomial(8, 6)).toBe(28);
    expect(binomial(12, 6)).toBe(924);
    expect(binomial(33, 6)).toBe(1107568);
    expect(binomial(5, 6)).toBe(0);
  });

  it("combinationCount = C(numbers, 6) × symbols (spec examples)", () => {
    expect(sixChanceCombinationCount(6, 1)).toBe(1);
    expect(sixChanceCombinationCount(7, 2)).toBe(14);
    expect(sixChanceCombinationCount(8, 3)).toBe(84);
    expect(sixChanceCombinationCount(12, 5)).toBe(4620);
  });
});

describe("validateSixChanceLine", () => {
  it("normalizes an exact pick (6 × 1) to the EXACT form, sorted", () => {
    const line = validateSixChanceLine(v2(), [33, 1, 17, 4, 9, 22], 3, undefined);
    expect(line).toEqual({ kind: "EXACT", numbers: [1, 4, 9, 17, 22, 33], symbol: 3, combinationCount: 1 });
  });

  it("treats 6 numbers with a one-element symbol pool as an exact pick too", () => {
    expect(validateSixChanceLine(v2(), range(1, 6), undefined, [5]).kind).toBe("EXACT");
  });

  it("returns a SYSTEM line with a recomputed combination count", () => {
    expect(validateSixChanceLine(v2(), [7, 1, 2, 3, 4, 5, 6], undefined, [2, 1])).toEqual({
      kind: "SYSTEM",
      numbers: [1, 2, 3, 4, 5, 6, 7],
      symbols: [1, 2],
      combinationCount: 14,
    });
    expect(validateSixChanceLine(v2(), range(1, 8), undefined, [1, 3, 5]).combinationCount).toBe(84);
  });

  it.each([
    ["fewer than 6 numbers", range(1, 5), [1]],
    ["more numbers than the rule allows", range(1, 13), [1]],
    ["duplicate numbers", [1, 2, 3, 4, 5, 5, 6], [1]],
    ["a number out of range", [0, 2, 3, 4, 5, 6], [1]],
    ["duplicate symbols", range(1, 7), [1, 1]],
    ["a symbol out of range", range(1, 7), [6]],
    ["an empty symbol pool", range(1, 7), []],
    ["non-integer numbers", [1, 2, 3, 4, 5, 6.5], [1]],
  ])("rejects %s", (_label, numbers, symbols) => {
    expect(() => validateSixChanceLine(v2(), numbers, undefined, symbols)).toThrow(ValidationError);
  });

  it("enforces the per-line symbol limit from the snapshot", () => {
    expect(() => validateSixChanceLine(v2({ maximum_selected_symbols_per_line: 2 }), range(1, 7), undefined, [1, 2, 3])).toThrow(
      /at most 2 chance symbol/,
    );
  });

  it("enforces the per-line combination cap from the snapshot", () => {
    // 9 numbers × 1 symbol = 84 > 50
    expect(() =>
      validateSixChanceLine(v2({ maximum_combinations_per_line: 50 }), range(1, 9), undefined, [1]),
    ).toThrow(/84 combinations; the limit per line is 50/);
    expect(validateSixChanceLine(v2({ maximum_combinations_per_line: 84 }), range(1, 9), undefined, [1]).combinationCount).toBe(84);
  });

  it("rejects sixChanceSymbol and sixChanceSymbols together", () => {
    expect(() => validateSixChanceLine(v2(), range(1, 7), 1, [1, 2])).toThrow(/either/);
  });

  it("a schema_version 1 snapshot allows exact picks only", () => {
    expect(validateSixChanceLine(V1, range(1, 6), 2, undefined).kind).toBe("EXACT");
    expect(() => validateSixChanceLine(V1, range(1, 7), 2, undefined)).toThrow(/exactly 6/);
    expect(() => validateSixChanceLine(V1, range(1, 6), undefined, [1, 2])).toThrow(ValidationError);
    expect(sixChanceLimits(V1)).toEqual({
      requiredNumbers: 6,
      maxNumbersPerLine: 6,
      maxSymbolsPerLine: 1,
      maxCombinationsPerLine: 1,
      maxCombinationsPerOrder: null,
    });
  });
});

describe("sixChanceLinesOverlap", () => {
  it("identical exact picks overlap", () => {
    expect(sixChanceLinesOverlap({ numbers: range(1, 6), symbols: [1] }, { numbers: range(1, 6), symbols: [1] })).toBe(true);
  });
  it("a system pool containing an exact pick overlaps it", () => {
    expect(sixChanceLinesOverlap({ numbers: range(1, 8), symbols: [1, 2] }, { numbers: [2, 3, 4, 5, 6, 7], symbols: [2] })).toBe(true);
  });
  it("sharing 6+ numbers but no symbol does not overlap", () => {
    expect(sixChanceLinesOverlap({ numbers: range(1, 7), symbols: [1] }, { numbers: range(1, 7), symbols: [2] })).toBe(false);
  });
  it("sharing a symbol but only 5 numbers does not overlap", () => {
    expect(sixChanceLinesOverlap({ numbers: range(1, 7), symbols: [1] }, { numbers: [3, 4, 5, 6, 7, 20], symbols: [1] })).toBe(false);
  });
});
