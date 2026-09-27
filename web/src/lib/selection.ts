import { combinationCount, linesOverlap, sixChanceLimits } from "./six-chance";
import type { FourLeafRules, SixChanceRules, TicketDraft } from "./types";

/** A validation failure as data — the UI turns it into text in the active language. */
export type SelectionError =
  | { kind: "fourLeafDigits" }
  | { kind: "sixTooFew"; required: number }
  | { kind: "sixTooMany"; max: number }
  | { kind: "symbolMissing" }
  | { kind: "symbolTooMany"; max: number }
  | { kind: "lineTooLarge"; count: number; max: number };

type SixDraft = Extract<TicketDraft, { kind: "SIX_CHANCE" }>;

export function validateFourLeafDraft(
  draft: Extract<TicketDraft, { kind: "FOUR_LEAF" }>,
): SelectionError | null {
  if (draft.isQuickPick) return null;
  if (!/^\d{4}$/.test(draft.fourLeafNumber)) return { kind: "fourLeafDigits" };
  return null;
}

export function validateSixChanceDraft(draft: SixDraft, rules: SixChanceRules): SelectionError | null {
  if (draft.isQuickPick) return null;
  const limits = sixChanceLimits(rules);
  if (draft.numbers.length < limits.requiredNumbers) return { kind: "sixTooFew", required: limits.requiredNumbers };
  if (draft.numbers.length > limits.maxNumbersPerLine) return { kind: "sixTooMany", max: limits.maxNumbersPerLine };
  if (draft.symbols.length === 0) return { kind: "symbolMissing" };
  if (draft.symbols.length > limits.maxSymbolsPerLine) return { kind: "symbolTooMany", max: limits.maxSymbolsPerLine };
  const count = draftCombinationCount(draft, rules);
  if (count > limits.maxCombinationsPerLine) {
    return { kind: "lineTooLarge", count, max: limits.maxCombinationsPerLine };
  }
  return null;
}

/** Combinations a draft line covers: 1 for Quick Pick / Four Leaf, C(n,6)×symbols for a
 * Six Chance line (0 while incomplete). */
export function draftCombinationCount(draft: TicketDraft, rules: FourLeafRules | SixChanceRules): number {
  if (draft.kind === "FOUR_LEAF" || draft.isQuickPick) return 1;
  return combinationCount(
    draft.numbers.length,
    draft.symbols.length,
    sixChanceLimits(rules as SixChanceRules).requiredNumbers,
  );
}

/** Indexes of draft lines that share at least one combination with another line — the same
 * rule the server uses for its duplicateInOrder flag (overlap is allowed, only warned). */
export function overlappingDraftIndexes(drafts: TicketDraft[]): Set<number> {
  const result = new Set<number>();
  const comparable = drafts.map((d) => {
    if (d.isQuickPick) return null;
    if (d.kind === "FOUR_LEAF") return /^\d{4}$/.test(d.fourLeafNumber) ? { four: d.fourLeafNumber } : null;
    return d.numbers.length >= 6 && d.symbols.length > 0 ? { numbers: d.numbers, symbols: d.symbols } : null;
  });
  for (let i = 0; i < comparable.length; i++) {
    for (let j = i + 1; j < comparable.length; j++) {
      const a = comparable[i];
      const b = comparable[j];
      if (!a || !b) continue;
      const overlap =
        "four" in a || "four" in b
          ? "four" in a && "four" in b && a.four === b.four
          : linesOverlap(a, b);
      if (overlap) {
        result.add(i);
        result.add(j);
      }
    }
  }
  return result;
}

/** The request body for one draft line. An exact Six Chance line uses the original
 * `sixChanceSymbol` field (accepted by every rule version); a system line sends the pools.
 * No counts or amounts are ever sent — the server derives them. */
export function draftToTicketRequest(d: TicketDraft) {
  if (d.isQuickPick) return { isQuickPick: true };
  if (d.kind === "FOUR_LEAF") return { isQuickPick: false, fourLeafNumber: d.fourLeafNumber };
  return d.numbers.length === 6 && d.symbols.length === 1
    ? { isQuickPick: false, sixChanceNumbers: d.numbers, sixChanceSymbol: d.symbols[0] }
    : { isQuickPick: false, sixChanceNumbers: d.numbers, sixChanceSymbols: d.symbols };
}

export function emptyFourLeafDraft(key: string): Extract<TicketDraft, { kind: "FOUR_LEAF" }> {
  return { kind: "FOUR_LEAF", key, isQuickPick: false, fourLeafNumber: "" };
}

export function emptySixChanceDraft(key: string): SixDraft {
  return { kind: "SIX_CHANCE", key, isQuickPick: false, numbers: [], symbols: [] };
}

export function ticketPriceToman(rules: FourLeafRules | SixChanceRules): number {
  return rules.ticket_price_toman;
}
