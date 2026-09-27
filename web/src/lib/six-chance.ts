// Six Chance system-play math and limits — a pure mirror of the backend's
// modules/orders/selections.ts, used for live feedback only. The server independently
// re-validates every line and recomputes every count and amount; nothing computed here is
// ever sent as a price.

/** The subset of a Six Chance rules snapshot this module reads. */
export interface SixChanceRuleShape {
  schema_version: number;
  ticket_price_toman: number;
  selection: {
    main_numbers: { count: number; min: number; max: number };
    chance_symbol: { min: number; max: number };
    required_numbers_per_combination?: number;
    maximum_selected_numbers_per_line?: number;
    maximum_selected_symbols_per_line?: number;
    maximum_combinations_per_line?: number;
    maximum_combinations_per_order?: number;
  };
}

export interface SixChanceLimits {
  requiredNumbers: number;
  maxNumbersPerLine: number;
  maxSymbolsPerLine: number;
  maxCombinationsPerLine: number;
  /** null = no order-level combination cap. */
  maxCombinationsPerOrder: number | null;
}

/** Limits in force for a draw. A schema_version 1 snapshot predates system play: exact
 * picks only (6 numbers × 1 symbol). */
export function sixChanceLimits(rules: SixChanceRuleShape): SixChanceLimits {
  const s = rules.selection;
  const required = s.main_numbers.count;
  if (rules.schema_version < 2) {
    return {
      requiredNumbers: required,
      maxNumbersPerLine: required,
      maxSymbolsPerLine: 1,
      maxCombinationsPerLine: 1,
      maxCombinationsPerOrder: null,
    };
  }
  return {
    requiredNumbers: s.required_numbers_per_combination ?? required,
    maxNumbersPerLine: s.maximum_selected_numbers_per_line ?? required,
    maxSymbolsPerLine: s.maximum_selected_symbols_per_line ?? 1,
    maxCombinationsPerLine: s.maximum_combinations_per_line ?? 1,
    maxCombinationsPerOrder: s.maximum_combinations_per_order ?? null,
  };
}

/** True when the draw allows lines bigger than one combination. */
export function systemPlayEnabled(limits: SixChanceLimits): boolean {
  return limits.maxNumbersPerLine > limits.requiredNumbers || limits.maxSymbolsPerLine > 1;
}

export function binomial(n: number, k: number): number {
  if (k < 0 || n < k) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

/** combinationCount = C(numbers, required) × symbols. 0 while the line is incomplete. */
export function combinationCount(numberCount: number, symbolCount: number, required = 6): number {
  if (numberCount < required || symbolCount < 1) return 0;
  return binomial(numberCount, required) * symbolCount;
}

/** Two lines overlap when they cover at least one identical (6 numbers, symbol)
 * combination: a shared symbol AND at least `required` shared numbers. */
export function linesOverlap(
  a: { numbers: readonly number[]; symbols: readonly number[] },
  b: { numbers: readonly number[]; symbols: readonly number[] },
  required = 6,
): boolean {
  if (!a.symbols.some((s) => b.symbols.includes(s))) return false;
  let shared = 0;
  for (const n of a.numbers) if (b.numbers.includes(n)) shared += 1;
  return shared >= required;
}
