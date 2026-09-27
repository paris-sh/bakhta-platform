import { describe, expect, it } from "vitest";
import {
  choose,
  fourLeafMatches,
  parseSixChanceTierMatch,
  sixChanceMatchCounts,
} from "../../src/modules/results/matching.js";

/** Brute force: expand every (6 numbers, 1 symbol) combination and bucket it. */
function bruteForce(numbers: number[], symbols: number[], win: { numbers: number[]; symbol: number }) {
  const counts = new Map<string, number>();
  const w = new Set(win.numbers);
  const combos: number[][] = [];
  const pick = (start: number, acc: number[]) => {
    if (acc.length === 6) return void combos.push([...acc]);
    for (let i = start; i < numbers.length; i++) pick(i + 1, [...acc, numbers[i]!]);
  };
  pick(0, []);
  for (const c of combos) {
    const m = c.filter((x) => w.has(x)).length;
    for (const s of symbols) {
      const key = s === win.symbol ? `${m}+C` : `${m}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

function sample(rand: () => number, from: number[], k: number) {
  const pool = [...from];
  const out: number[] = [];
  while (out.length < k) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
  return out;
}

const ALL = Array.from({ length: 33 }, (_, i) => i + 1);

describe("Six Chance matching without expansion", () => {
  it("matches brute-force expansion for exact picks and system pools of every size", () => {
    const rand = seeded(20260927);
    for (let trial = 0; trial < 250; trial++) {
      const n = 6 + (trial % 7); // pools of 6..12 numbers (C(12,6)=924 combos, cheap to expand)
      const s = 1 + (trial % 5);
      const win = { numbers: sample(rand, ALL, 6), symbol: 1 + Math.floor(rand() * 5) };
      // Bias half the pools toward the winning numbers so high tiers are exercised.
      const base = trial % 2 === 0 ? sample(rand, win.numbers, Math.min(6, 1 + (trial % 6))) : [];
      const rest = sample(rand, ALL.filter((x) => !base.includes(x)), n - base.length);
      const numbers = [...base, ...rest];
      const symbols = sample(rand, [1, 2, 3, 4, 5], s);
      const fast = sixChanceMatchCounts({ numbers, symbols }, win);
      expect(Object.fromEntries(fast)).toEqual(Object.fromEntries(bruteForce(numbers, symbols, win)));
      const total = [...fast.values()].reduce((a, b) => a + b, 0);
      expect(total).toBe(choose(n, 6) * s);
    }
  });

  it("counts the exact tiers of a known system line", () => {
    // Pool of 8 containing 5 winning numbers; symbols {1, 2}; winning symbol 2.
    const win = { numbers: [3, 11, 17, 24, 29, 33], symbol: 2 };
    const counts = sixChanceMatchCounts({ numbers: [3, 11, 17, 24, 29, 5, 6, 7], symbols: [1, 2] }, win);
    // 5 matched: C(5,5)·C(3,1)=3 combos per symbol; 4 matched: C(5,4)·C(3,2)=15; 3 matched: C(5,3)·C(3,3)=10.
    expect(Object.fromEntries(counts)).toEqual({ "5+C": 3, "5": 3, "4+C": 15, "4": 15, "3+C": 10, "3": 10 });
  });

  it("an exact pick is one combination in exactly one bucket", () => {
    const win = { numbers: [1, 2, 3, 4, 5, 6], symbol: 4 };
    expect(Object.fromEntries(sixChanceMatchCounts({ numbers: [6, 5, 4, 3, 2, 1], symbols: [4] }, win))).toEqual({ "6+C": 1 });
    expect(Object.fromEntries(sixChanceMatchCounts({ numbers: [1, 2, 3, 4, 5, 33], symbols: [1] }, win))).toEqual({ "5": 1 });
  });

  it("parses the rule's tier codes and rejects anything else", () => {
    expect(parseSixChanceTierMatch("6_MAIN_PLUS_CHANCE")).toEqual({ mainNumbers: 6, chance: true });
    expect(parseSixChanceTierMatch("4_MAIN")).toEqual({ mainNumbers: 4, chance: false });
    expect(parseSixChanceTierMatch("7_MAIN")).toBeNull();
    expect(parseSixChanceTierMatch("ANY_TWO")).toBeNull();
  });
});

describe("Four Leaf matching", () => {
  it("is an exact, order-sensitive, leading-zero-preserving match", () => {
    expect(fourLeafMatches("0427", "0427")).toBe(true);
    expect(fourLeafMatches("4270", "0427")).toBe(false);
    expect(fourLeafMatches("427", "0427")).toBe(false);
    expect(fourLeafMatches("7240", "0427")).toBe(false);
  });
});
