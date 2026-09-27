import type { FourLeafRules, SixChanceRules, TicketDraft } from "./types";

/** A validation failure as data — the UI turns it into text in the active language. */
export type SelectionError =
  | { kind: "fourLeafDigits" }
  | { kind: "sixCount"; count: number }
  | { kind: "sixRange"; min: number; max: number }
  | { kind: "sixDistinct" }
  | { kind: "symbolMissing" };

export function validateFourLeafDraft(
  draft: Extract<TicketDraft, { kind: "FOUR_LEAF" }>,
): SelectionError | null {
  if (draft.isQuickPick) return null;
  if (!/^\d{4}$/.test(draft.fourLeafNumber)) return { kind: "fourLeafDigits" };
  return null;
}

export function validateSixChanceDraft(
  draft: Extract<TicketDraft, { kind: "SIX_CHANCE" }>,
  rules: SixChanceRules,
): SelectionError | null {
  if (draft.isQuickPick) return null;
  const { min, max, count } = rules.selection.main_numbers;
  const symbolRange = rules.selection.chance_symbol;

  if (draft.numbers.length !== count || draft.numbers.some((n) => n === null)) {
    return { kind: "sixCount", count };
  }
  const numbers = draft.numbers as number[];
  if (numbers.some((n) => n < min || n > max)) return { kind: "sixRange", min, max };
  if (new Set(numbers).size !== count) return { kind: "sixDistinct" };
  if (draft.symbol === null || draft.symbol < symbolRange.min || draft.symbol > symbolRange.max) {
    return { kind: "symbolMissing" };
  }
  return null;
}

export function fourLeafSelectionKey(numberValue: string): string {
  return `FOUR_LEAF:${numberValue}`;
}

export function sixChanceSelectionKey(numbers: number[], symbol: number): string {
  return `SIX_CHANCE:${[...numbers].sort((a, b) => a - b).join(",")}:${symbol}`;
}

/** Mirrors the backend's duplicate-detection key for client-side "you already have this
 * combination" feedback before submission — the server's own flag on the order response
 * remains authoritative; this is purely earlier UX feedback. */
export function draftSelectionKey(draft: TicketDraft): string | null {
  if (draft.kind === "FOUR_LEAF") {
    return draft.isQuickPick ? null : fourLeafSelectionKey(draft.fourLeafNumber);
  }
  if (draft.isQuickPick || draft.numbers.some((n) => n === null) || draft.symbol === null) {
    return null;
  }
  return sixChanceSelectionKey(draft.numbers as number[], draft.symbol);
}

export function emptyFourLeafDraft(key: string): Extract<TicketDraft, { kind: "FOUR_LEAF" }> {
  return { kind: "FOUR_LEAF", key, isQuickPick: false, fourLeafNumber: "" };
}

export function emptySixChanceDraft(key: string): Extract<TicketDraft, { kind: "SIX_CHANCE" }> {
  return { kind: "SIX_CHANCE", key, isQuickPick: false, numbers: [null, null, null, null, null, null], symbol: null };
}

export function ticketPriceToman(rules: FourLeafRules | SixChanceRules): number {
  return rules.ticket_price_toman;
}
