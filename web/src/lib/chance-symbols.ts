import type { Locale } from "./i18n/messages";

// The single source of truth for Six Chance's visual chance symbols. The API and database
// store the symbol as the integer 1–5; this maps each integer to its identity. Nothing else
// in the app may hardcode a symbol number, name or colour.

export type ChanceSymbolId = 1 | 2 | 3 | 4 | 5;
export type ChanceSymbolKey = "sun" | "moon" | "star" | "diamond" | "crown";

export interface ChanceSymbol {
  id: ChanceSymbolId;
  key: ChanceSymbolKey;
  label: Record<Locale, string>;
  /** Icon colour (strong) and its tile tint (soft), used by every symbol rendering. */
  color: string;
  tint: string;
}

export const CHANCE_SYMBOLS: readonly ChanceSymbol[] = [
  { id: 1, key: "sun", label: { en: "Sun", fa: "خورشید" }, color: "#d98a06", tint: "#fff4dc" },
  { id: 2, key: "moon", label: { en: "Moon", fa: "ماه" }, color: "#4c5bd4", tint: "#eceffe" },
  { id: 3, key: "star", label: { en: "Star", fa: "ستاره" }, color: "#7a52d1", tint: "#f2edfd" },
  { id: 4, key: "diamond", label: { en: "Diamond", fa: "الماس" }, color: "#0f8fb8", tint: "#e5f5fb" },
  { id: 5, key: "crown", label: { en: "Crown", fa: "تاج" }, color: "#c03f6a", tint: "#fdecf2" },
] as const;

const BY_ID = new Map<number, ChanceSymbol>(CHANCE_SYMBOLS.map((s) => [s.id, s]));

/** The symbol for a stored integer, or undefined for a value outside the known set. */
export function chanceSymbol(id: number): ChanceSymbol | undefined {
  return BY_ID.get(id);
}

/** Symbols valid under a draw's rules (its `chance_symbol` min/max), in id order. */
export function symbolsInRange(min: number, max: number): ChanceSymbol[] {
  return CHANCE_SYMBOLS.filter((s) => s.id >= min && s.id <= max);
}
