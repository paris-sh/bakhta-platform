// Deterministic matching of tickets against a draw result. Pure functions only — no I/O —
// so every rule here is unit-testable against brute force.
//
// Six Chance system lines are NEVER expanded into their combinations. A line with a number
// pool N (|N| = n >= 6) and a symbol pool S (|S| = s >= 1) covers C(n,6) × s combinations.
// With k = |N ∩ W| (W = the six winning numbers) and h = 1 if the winning symbol is in S
// else 0, the number of covered combinations that match exactly m winning numbers is
//   C(k, m) × C(n − k, 6 − m)
// of which h × that have the winning symbol and (s − h) × that do not. An exact pick is the
// special case n = 6, s = 1.

/** n choose r as a bigint-safe integer (values here stay far below 2^53). */
export function choose(n: number, r: number): number {
  if (r < 0 || r > n) return 0;
  const k = Math.min(r, n - r);
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

// ------------------------------------------------------------------ tier patterns

/** A Six Chance tier's `match` code, e.g. "5_MAIN_PLUS_CHANCE" or "4_MAIN". */
export interface SixChanceTierPattern {
  mainNumbers: number;
  chance: boolean;
}

/**
 * Parses the rule JSON's tier `match` codes. "m_MAIN" means exactly m main numbers WITHOUT
 * the chance symbol; "m_MAIN_PLUS_CHANCE" means exactly m main numbers AND the symbol — the
 * spec lists them as separate, mutually exclusive tiers. Returns null for any other code so
 * the caller can block the calculation instead of guessing.
 */
export function parseSixChanceTierMatch(match: string): SixChanceTierPattern | null {
  const m = /^([0-6])_MAIN(_PLUS_CHANCE)?$/.exec(match);
  if (!m) return null;
  return { mainNumbers: Number(m[1]), chance: m[2] !== undefined };
}

// ------------------------------------------------------------------ Six Chance

export interface SixChanceWinning {
  /** The six winning main numbers (any order). */
  numbers: number[];
  symbol: number;
}

export interface SixChancePool {
  numbers: number[];
  symbols: number[];
}

/**
 * For one line (exact or system), how many of its combinations fall into each
 * (mainNumbers, chance) bucket. Keys are "m" / "m+C" for m = 0..6. The counts always sum to
 * C(n,6) × s — the line's combination_count — which callers assert.
 */
export function sixChanceMatchCounts(pool: SixChancePool, win: SixChanceWinning): Map<string, number> {
  const n = pool.numbers.length;
  const s = pool.symbols.length;
  const winning = new Set(win.numbers);
  const k = pool.numbers.filter((x) => winning.has(x)).length;
  const h = pool.symbols.includes(win.symbol) ? 1 : 0;
  const counts = new Map<string, number>();
  for (let m = 0; m <= 6; m++) {
    const numberCombos = choose(k, m) * choose(n - k, 6 - m);
    if (numberCombos === 0) continue;
    if (h > 0) counts.set(`${m}+C`, numberCombos * h);
    if (s - h > 0) counts.set(`${m}`, numberCombos * (s - h));
  }
  return counts;
}

export function bucketKey(p: SixChanceTierPattern): string {
  return p.chance ? `${p.mainNumbers}+C` : `${p.mainNumbers}`;
}

// ------------------------------------------------------------------ Four Leaf

/** Exact four-digit match: order matters, leading zeros are significant. */
export function fourLeafMatches(ticketNumber: string, winningNumber: string): boolean {
  return ticketNumber === winningNumber;
}
