import { randomInt } from "node:crypto";
import { ValidationError } from "../../shared/errors.js";
import type { FourLeafRulesV1, SixChanceRulesV1 } from "../games/rules.schemas.js";

// Every bound used here is read from the DRAW'S OWN snapshotted rule version
// (draw.current_rules_snapshot), never a hardcoded constant and never the game's current
// (possibly different) active rule version — this is what "validate every selection
// against the draw's snapshotted rule version" means concretely. Today's schema_version 1
// happens to fix these bounds as literals (6 numbers 1-33, symbol 1-5, etc.), but reading
// them from the snapshot rather than hardcoding is what keeps this correct if a future
// schema_version ever makes them vary.

export interface SixChanceSelection {
  numbers: [number, number, number, number, number, number]; // strictly increasing
  symbol: number;
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

export function validateSixChanceSelection(
  rules: SixChanceRulesV1,
  rawNumbers: unknown,
  rawSymbol: unknown,
): SixChanceSelection {
  const { count, min, max } = rules.selection.main_numbers;
  const symbolRange = rules.selection.chance_symbol;

  if (
    !Array.isArray(rawNumbers) ||
    rawNumbers.length !== count ||
    !rawNumbers.every((n) => typeof n === "number" && Number.isInteger(n) && n >= min && n <= max)
  ) {
    throw new ValidationError(
      `Six Chance selection must be exactly ${count} distinct integers between ${min} and ${max}.`,
    );
  }
  const distinct = new Set(rawNumbers as number[]);
  if (distinct.size !== count) {
    throw new ValidationError("Six Chance main numbers must all be distinct.");
  }
  if (
    typeof rawSymbol !== "number" ||
    !Number.isInteger(rawSymbol) ||
    rawSymbol < symbolRange.min ||
    rawSymbol > symbolRange.max
  ) {
    throw new ValidationError(
      `Six Chance chance symbol must be an integer between ${symbolRange.min} and ${symbolRange.max}.`,
    );
  }

  // Main-number order does not affect matching; the database stores them strictly
  // increasing regardless of the order the caller supplied.
  const sorted = [...distinct].sort((a, b) => a - b) as SixChanceSelection["numbers"];
  return { numbers: sorted, symbol: rawSymbol };
}

export function generateSixChanceQuickPick(rules: SixChanceRulesV1): SixChanceSelection {
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

/** A stable string key for detecting duplicate selections within the same order (spec:
 * "Duplicate selections are allowed... but the user receives a warning"). */
export function fourLeafSelectionKey(numberValue: string): string {
  return `FOUR_LEAF:${numberValue}`;
}
export function sixChanceSelectionKey(selection: SixChanceSelection): string {
  return `SIX_CHANCE:${selection.numbers.join(",")}:${selection.symbol}`;
}
