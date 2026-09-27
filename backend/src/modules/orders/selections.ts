import { randomInt } from "node:crypto";
import { ValidationError } from "../../shared/errors.js";
import type { FourLeafRulesV1, SixChanceRules } from "../games/rules.schemas.js";

// Every bound used here is read from the DRAW'S OWN snapshotted rule version
// (draw.current_rules_snapshot), never a hardcoded constant and never the game's current
// (possibly different) active rule version — this is what "validate every selection
// against the draw's snapshotted rule version" means concretely.

/** An exact Six Chance pick: one combination (6 numbers × 1 symbol). */
export interface SixChanceSelection {
  numbers: [number, number, number, number, number, number]; // strictly increasing
  symbol: number;
}

/** A normalized Six Chance line: exact (1 combination) or system (pools, >1 combination). */
export type SixChanceLine =
  | { kind: "EXACT"; numbers: SixChanceSelection["numbers"]; symbol: number; combinationCount: 1 }
  | { kind: "SYSTEM"; numbers: number[]; symbols: number[]; combinationCount: number };

/** System-play limits in force for a draw. A schema_version 1 snapshot predates system play
 * and allows exact picks only; schema_version 2+ carries the limits explicitly. */
export interface SixChanceLimits {
  requiredNumbers: number;
  maxNumbersPerLine: number;
  maxSymbolsPerLine: number;
  maxCombinationsPerLine: number;
  /** null = no order-level combination cap (v1: only the per-order ticket count applies). */
  maxCombinationsPerOrder: number | null;
}

export function sixChanceLimits(rules: SixChanceRules): SixChanceLimits {
  const required = rules.selection.main_numbers.count;
  if (rules.schema_version === 1) {
    return {
      requiredNumbers: required,
      maxNumbersPerLine: required,
      maxSymbolsPerLine: 1,
      maxCombinationsPerLine: 1,
      maxCombinationsPerOrder: null,
    };
  }
  const s = rules.selection;
  return {
    requiredNumbers: s.required_numbers_per_combination,
    maxNumbersPerLine: s.maximum_selected_numbers_per_line,
    maxSymbolsPerLine: s.maximum_selected_symbols_per_line,
    maxCombinationsPerLine: s.maximum_combinations_per_line,
    maxCombinationsPerOrder: s.maximum_combinations_per_order,
  };
}

/** n choose k, exact for every value this game can produce (C(33,6) = 1,107,568). */
export function binomial(n: number, k: number): number {
  if (k < 0 || n < k) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

/** combinationCount = C(numbers, required) × symbols — mirrors the database's
 * six_chance_combination_count() (migration 0037). */
export function sixChanceCombinationCount(numberCount: number, symbolCount: number, required = 6): number {
  if (numberCount < required || symbolCount < 1) return 0;
  return binomial(numberCount, required) * symbolCount;
}

export function validateFourLeafSelection(_rules: FourLeafRulesV1, raw: unknown): string {
  if (typeof raw !== "string" || !/^\d{4}$/.test(raw)) {
    throw new ValidationError("Four Leaf selection must be exactly four digit characters.");
  }
  return raw;
}

export function generateFourLeafQuickPick(): string {
  return String(randomInt(0, 10000)).padStart(4, "0");
}

function isIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((n) => typeof n === "number" && Number.isInteger(n));
}

/**
 * Validates one Six Chance line against the draw's snapshotted rules and returns its
 * canonical form. Symbols may arrive as `rawSymbols` (a pool) or `rawSymbol` (one symbol —
 * the original exact-pick field, still accepted unchanged). The combination count is always
 * recomputed here from the pools; nothing the client says about counts or prices is used.
 */
export function validateSixChanceLine(
  rules: SixChanceRules,
  rawNumbers: unknown,
  rawSymbol: unknown,
  rawSymbols: unknown,
): SixChanceLine {
  const { min, max } = rules.selection.main_numbers;
  const symbolRange = rules.selection.chance_symbol;
  const limits = sixChanceLimits(rules);

  if (rawSymbol !== undefined && rawSymbols !== undefined) {
    throw new ValidationError("Provide either sixChanceSymbol or sixChanceSymbols, not both.");
  }

  if (!isIntegerArray(rawNumbers) || !rawNumbers.every((n) => n >= min && n <= max)) {
    throw new ValidationError(`Six Chance main numbers must be integers between ${min} and ${max}.`);
  }
  const numberSet = new Set(rawNumbers);
  if (numberSet.size !== rawNumbers.length) {
    throw new ValidationError("Six Chance main numbers must all be distinct.");
  }
  if (numberSet.size < limits.requiredNumbers || numberSet.size > limits.maxNumbersPerLine) {
    throw new ValidationError(
      limits.maxNumbersPerLine === limits.requiredNumbers
        ? `Six Chance selection must be exactly ${limits.requiredNumbers} distinct integers between ${min} and ${max}.`
        : `A Six Chance line must select between ${limits.requiredNumbers} and ${limits.maxNumbersPerLine} numbers.`,
    );
  }

  const symbolList = rawSymbols !== undefined ? rawSymbols : rawSymbol === undefined ? undefined : [rawSymbol];
  if (
    !isIntegerArray(symbolList) ||
    symbolList.length === 0 ||
    !symbolList.every((s) => s >= symbolRange.min && s <= symbolRange.max)
  ) {
    throw new ValidationError(
      `Six Chance chance symbol must be an integer between ${symbolRange.min} and ${symbolRange.max}.`,
    );
  }
  const symbolSet = new Set(symbolList);
  if (symbolSet.size !== symbolList.length) {
    throw new ValidationError("Six Chance chance symbols must all be distinct.");
  }
  if (symbolSet.size > limits.maxSymbolsPerLine) {
    throw new ValidationError(`A Six Chance line may select at most ${limits.maxSymbolsPerLine} chance symbol(s).`);
  }

  const numbers = [...numberSet].sort((a, b) => a - b);
  const symbols = [...symbolSet].sort((a, b) => a - b);
  const combinationCount = sixChanceCombinationCount(numbers.length, symbols.length, limits.requiredNumbers);
  if (combinationCount > limits.maxCombinationsPerLine) {
    throw new ValidationError(
      `This Six Chance line covers ${combinationCount} combinations; the limit per line is ${limits.maxCombinationsPerLine}.`,
    );
  }

  if (combinationCount === 1) {
    return {
      kind: "EXACT",
      numbers: numbers as SixChanceSelection["numbers"],
      symbol: symbols[0] as number,
      combinationCount: 1,
    };
  }
  return { kind: "SYSTEM", numbers, symbols, combinationCount };
}

/** Quick Pick stays an exact pick: 6 random distinct numbers + 1 random symbol. */
export function generateSixChanceQuickPick(rules: SixChanceRules): SixChanceSelection {
  const { count, min, max } = rules.selection.main_numbers;
  const symbolRange = rules.selection.chance_symbol;

  const pool: number[] = [];
  for (let n = min; n <= max; n++) pool.push(n);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [pool[i], pool[j]] = [pool[j] as number, pool[i] as number];
  }
  const numbers = pool.slice(0, count).sort((a, b) => a - b) as SixChanceSelection["numbers"];
  const symbol = randomInt(symbolRange.min, symbolRange.max + 1);
  return { numbers, symbol };
}

/** A stable string key for Four Leaf duplicate detection within an order. */
export function fourLeafSelectionKey(numberValue: string): string {
  return `FOUR_LEAF:${numberValue}`;
}

/** Two Six Chance lines overlap when they cover at least one identical (6 numbers, symbol)
 * combination: they share a symbol AND at least `required` numbers. Identical exact picks are
 * the simplest case. Overlap is allowed by policy (spec: duplicates allowed with a warning). */
export function sixChanceLinesOverlap(
  a: { numbers: number[]; symbols: number[] },
  b: { numbers: number[]; symbols: number[] },
  required = 6,
): boolean {
  if (!a.symbols.some((s) => b.symbols.includes(s))) return false;
  let shared = 0;
  for (const n of a.numbers) if (b.numbers.includes(n)) shared += 1;
  return shared >= required;
}
