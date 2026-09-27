import { describe, expect, it } from "vitest";
import { calculatePrizes, type CalcTicket } from "../../src/modules/results/calculation.js";

const FOUR_LEAF_RULES = {
  schema_version: 1,
  fixed_prize_toman: 60_000_000,
  total_payout_cap_toman: 300_000_000,
  rounding_unit_toman: 1,
  remainder_destination: "PRIZE_RESERVE",
  ticket_price_toman: 50_000,
};

// Tier amounts chosen so the approved examples come out exactly: 15M + 3M + 2M = 20M.
const TIERS = [
  { code: "MAIN6_CHANCE", match: "6_MAIN_PLUS_CHANCE", prize_type: "JACKPOT_POOL" },
  { code: "MAIN6", match: "6_MAIN", prize_type: "CASH", payout_mode: "FIXED_AMOUNT", amount_toman: 15_000_000 },
  { code: "MAIN5_CHANCE", match: "5_MAIN_PLUS_CHANCE", prize_type: "CASH", payout_mode: "FIXED_AMOUNT", amount_toman: 3_000_000 },
  { code: "MAIN5", match: "5_MAIN", prize_type: "CASH", payout_mode: "FIXED_AMOUNT", amount_toman: 2_000_000 },
  { code: "MAIN4_CHANCE", match: "4_MAIN_PLUS_CHANCE", prize_type: "CASH", payout_mode: "FIXED_AMOUNT", amount_toman: 900_000 },
  { code: "MAIN4", match: "4_MAIN", prize_type: "CASH", payout_mode: "FIXED_AMOUNT", amount_toman: 600_000 },
  { code: "MAIN3_CHANCE", match: "3_MAIN_PLUS_CHANCE", prize_type: "FREE_TICKET", quantity: 1 },
];
const SIX_RULES = {
  schema_version: 3,
  ticket_price_toman: 300_000,
  tiers: TIERS,
  minimum_jackpot_toman: 100_000_000,
  jackpot_contribution_bps: 6000,
  jackpot_no_winner_rollover: true,
  jackpot_max_toman: null,
  lower_tier_payout_cap_toman: null,
  remainder_destination: "PRIZE_RESERVE",
  claim_period_days: 90,
};

const RV = "11111111-1111-1111-1111-111111111111";
const asOf = new Date("2026-10-01T18:00:00.000Z");
let seq = 0;
const id = () => `00000000-0000-0000-0000-${String(++seq).padStart(12, "0")}`;
function fl(numberValue: string): CalcTicket {
  const i = id();
  return { id: i, publicCode: `T-${i.slice(-4)}`, combinationCount: 1, ruleVersionId: RV, selection: { kind: "FOUR_LEAF", numberValue } };
}
function six(numbers: number[], symbols: number[], combinationCount = 1): CalcTicket {
  const i = id();
  return { id: i, publicCode: `T-${i.slice(-4)}`, combinationCount, ruleVersionId: RV, selection: { kind: "SIX_CHANCE", numbers, symbols } };
}
const sales = (amount: number) => ({ amountToman: BigInt(amount), source: "CONFIRMED_ORDER_TOTALS" as const });

const fourLeaf = (tickets: CalcTicket[], opts: { numberValue?: string; rules?: Record<string, unknown> } = {}) =>
  calculatePrizes({
    gameType: "FOUR_LEAF",
    ruleVersionId: RV,
    rules: opts.rules ?? FOUR_LEAF_RULES,
    openingJackpotToman: null,
    sales: sales(tickets.length * 50_000),
    result: { kind: "FOUR_LEAF", numberValue: opts.numberValue ?? "0427" },
    tickets,
    asOf,
  });
const sixChance = (
  tickets: CalcTicket[],
  opts: { rules?: Record<string, unknown>; jackpot?: bigint | null; sales?: number } = {},
) =>
  calculatePrizes({
    gameType: "SIX_CHANCE",
    ruleVersionId: RV,
    rules: opts.rules ?? SIX_RULES,
    openingJackpotToman: opts.jackpot === undefined ? 100_000_000n : opts.jackpot,
    sales: sales(opts.sales ?? 80_000_000),
    result: { kind: "SIX_CHANCE", drawOrder: [29, 3, 17, 33, 11, 24], symbol: 2 },
    tickets,
    asOf,
  });

// Winning numbers 3 11 17 24 29 33, symbol 2.
const jackpotTicket = () => six([3, 11, 17, 24, 29, 33], [2]);
const lowerTierTickets = () => [
  six([3, 11, 17, 24, 29, 33], [4]), // MAIN6            15,000,000
  six([3, 11, 17, 24, 29, 1], [2]), //  MAIN5_CHANCE      3,000,000
  six([3, 11, 17, 24, 29, 1], [4]), //  MAIN5             2,000,000   → 20,000,000 in total
];

describe("Four Leaf (unchanged behaviour)", () => {
  it("pays the fixed prize per exact winner below the cap", () => {
    const out = fourLeaf([fl("0427"), fl("0427"), fl("4270"), fl("1234")]);
    expect(out.blockers).toEqual([]);
    expect(out.awards.every((a) => a.amountToman === 60_000_000n && a.awardType === "CASH")).toBe(true);
    expect(out.awards[0]!.components).toEqual([expect.objectContaining({ tierCode: "EXACT_4", componentType: "CASH", amountToman: 60_000_000n, matchedCombinations: 1 })]);
    expect(out.summary.totalCashLiabilityToman).toBe("120000000");
  });

  it("splits the cap equally, rounding down to the rule unit and reporting the remainder", () => {
    const out = fourLeaf(Array.from({ length: 7 }, () => fl("0427")));
    expect(out.awards.every((a) => a.amountToman === 42_857_142n)).toBe(true);
    expect(out.summary.fourLeaf).toMatchObject({ capApplied: true, remainderToman: "6", remainderDestination: "PRIZE_RESERVE" });
  });
});

describe("claim period", () => {
  it("applies the 90-day default to historical rules without claim_period_days, and records it", () => {
    const out = fourLeaf([fl("0427")]);
    expect(out.summary).toMatchObject({ claimPeriodDays: 90, claimPeriodSource: "DEFAULT_FOR_HISTORICAL_RULES", claimDeadlineAt: "2026-12-30T18:00:00.000Z" });
    expect(out.warnings.map((w) => w.code)).toContain("CLAIM_PERIOD_DEFAULT_APPLIED");
  });

  it("uses the rule's claim_period_days when present", () => {
    const out = fourLeaf([fl("0427")], { rules: { ...FOUR_LEAF_RULES, schema_version: 2, claim_period_days: 30 } });
    expect(out.summary).toMatchObject({ claimPeriodDays: 30, claimPeriodSource: "RULES", claimDeadlineAt: "2026-10-31T18:00:00.000Z" });
    expect(out.warnings.map((w) => w.code)).not.toContain("CLAIM_PERIOD_DEFAULT_APPLIED");
  });
});

describe("Six Chance ordinary tiers", () => {
  it("pays amount_toman even when a legacy multiplier disagrees, without blocking", () => {
    const legacy = TIERS.map((t) => (t.code === "MAIN4" ? { code: t.code, match: t.match, prize_type: "CASH", multiplier: 2, amount_toman: 600_000 } : t));
    const out = sixChance([six([3, 11, 17, 24, 1, 2], [5])], { rules: { ...SIX_RULES, schema_version: 2, ticket_price_toman: 100_000, tiers: legacy } });
    expect(out.blockers).toEqual([]);
    expect(out.awards[0]).toMatchObject({ tierCode: "MAIN4", amountToman: 600_000n });
    expect(out.warnings).toContainEqual(expect.objectContaining({ code: "TIER_MULTIPLIER_IGNORED", params: expect.objectContaining({ tier: "MAIN4", multipliedToman: "200000" }) }));
  });
});

describe("Six Chance draw with jackpot winner(s)", () => {
  it("approved example: sales 80M, jackpot 100M, lower tiers 20M → Bakhta funds 40M, next jackpot = minimum", () => {
    const out = sixChance([jackpotTicket(), ...lowerTierTickets()], { sales: 80_000_000 });
    expect(out.blockers).toEqual([]);
    expect(out.summary.financials).toMatchObject({
      formula: "JACKPOT_WON",
      confirmedSalesToman: "80000000",
      jackpotPaidToman: "100000000",
      lowerTierCashToman: "20000000",
      totalCashPrizesToman: "120000000",
      drawNetToman: "-40000000",
      bakhtaRetainedToman: "0",
      bakhtaFundingRequiredToman: "40000000",
      rolloverAdditionToman: "0",
      nextJackpotToman: "100000000",
    });
    expect(out.summary.totalCashLiabilityToman).toBe("120000000");
  });

  it("keeps a positive result as Bakhta's retained amount", () => {
    const f = sixChance([jackpotTicket(), ...lowerTierTickets()], { sales: 150_000_000 }).summary.financials;
    expect(f).toMatchObject({ drawNetToman: "30000000", bakhtaRetainedToman: "30000000", bakhtaFundingRequiredToman: "0" });
  });

  it("pays the full accumulated jackpot, splitting indivisible Toman deterministically", () => {
    const winners = [jackpotTicket(), jackpotTicket(), jackpotTicket()];
    const out = sixChance(winners, { jackpot: 160_000_000n });
    const shares = out.awards.map((a) => a.amountToman!);
    expect(shares).toEqual([53_333_334n, 53_333_333n, 53_333_333n]); // first in ticket-id order gets the extra Toman
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(160_000_000n);
    expect(out.summary.jackpot).toMatchObject({ openingJackpotToman: "160000000", jackpotPaidToman: "160000000", extraOneTomanUnits: 1, sharePerCombinationToman: "53333333" });
    // After a win the next jackpot resets to exactly the rule's minimum, not to the 160M.
    expect(out.summary.financials.nextJackpotToman).toBe("100000000");
    expect(sixChance(winners, { jackpot: 160_000_000n }).calculationHash).toBe(out.calculationHash);
  });

  it("reads the minimum jackpot from the rules, never a constant", () => {
    const out = sixChance([jackpotTicket()], { rules: { ...SIX_RULES, minimum_jackpot_toman: 250_000_000 } });
    expect(out.summary.financials.nextJackpotToman).toBe("250000000");
    expect(out.summary.jackpot?.minimumJackpotToman).toBe("250000000");
  });
});

describe("Six Chance draw without a jackpot winner", () => {
  it("approved example: 100M jackpot, sales 80M, lower 20M → 36M to next jackpot, 24M retained, next 136M", () => {
    const out = sixChance(lowerTierTickets(), { sales: 80_000_000 });
    expect(out.summary.financials).toMatchObject({
      formula: "NO_JACKPOT_WINNER",
      jackpotPaidToman: "0",
      lowerTierCashToman: "20000000",
      remainingSalesToman: "60000000",
      rolloverPercentBps: 6000,
      rolloverAdditionToman: "36000000",
      bakhtaRetainedToman: "24000000",
      bakhtaFundingRequiredToman: "0",
      nextJackpotToman: "136000000",
    });
    expect(out.summary.jackpot?.carriesOver).toBe(true);
  });

  it("uses the configured rollover percentage and floors to whole Toman", () => {
    const f = sixChance([], { sales: 1_000_001, rules: { ...SIX_RULES, jackpot_contribution_bps: 2500 } }).summary.financials;
    expect(f).toMatchObject({ remainingSalesToman: "1000001", rolloverAdditionToman: "250000", bakhtaRetainedToman: "750001", nextJackpotToman: "100250000" });
  });

  it("funds a lower-prize deficit from Bakhta and carries the jackpot unchanged", () => {
    const f = sixChance(lowerTierTickets(), { sales: 10_000_000, jackpot: 136_000_000n }).summary.financials;
    expect(f).toMatchObject({
      remainingSalesToman: "-10000000",
      rolloverAdditionToman: "0",
      bakhtaRetainedToman: "0",
      bakhtaFundingRequiredToman: "10000000",
      nextJackpotToman: "136000000",
    });
  });

  it("excludes free rows from cash prizes (and the caller excludes them from sales)", () => {
    const out = sixChance([six([3, 11, 17, 1, 2, 4], [2])], { sales: 300_000 }); // 3 + symbol → free row only
    expect(out.awards[0]).toMatchObject({ awardType: "FREE_TICKET", amountToman: null, freeTicketQuantity: 1 });
    expect(out.summary.financials).toMatchObject({ lowerTierCashToman: "0", totalCashPrizesToman: "0", freeRowsAwarded: 1, remainingSalesToman: "300000" });
    expect(out.summary.totalCashLiabilityToman).toBe("0");
  });

  it("blocks when the draw has no snapshotted jackpot instead of guessing", () => {
    expect(sixChance(lowerTierTickets(), { jackpot: null }).blockers.map((b) => b.code)).toEqual(["JACKPOT_VALUE_MISSING"]);
  });
});

describe("lower-tier cap", () => {
  it("scales cash prizes proportionally, rounds down, keeps tier order and reports the remainder", () => {
    const out = sixChance(lowerTierTickets(), { rules: { ...SIX_RULES, lower_tier_payout_cap_toman: 10_000_001 } });
    expect(out.blockers).toEqual([]);
    const cap = out.summary.financials.lowerTierCap!;
    expect(cap).toMatchObject({ capToman: "10000001", originalTotalToman: "20000000", roundedTotalToman: "10000000", remainderToman: "1", remainderDestination: "PRIZE_RESERVE" });
    expect(cap.scalingFactor.decimal).toBe("0.500000");
    const perRow = Object.fromEntries(cap.tiers.map((t) => [t.code, t.scaledPerCombinationToman]));
    expect(perRow).toMatchObject({ MAIN6: "7500000", MAIN5_CHANCE: "1500000", MAIN5: "1000000" });
    expect(BigInt(perRow.MAIN6!)).toBeGreaterThan(BigInt(perRow.MAIN5_CHANCE!));
    expect(out.summary.financials.lowerTierCashToman).toBe("10000000");
    // The financial result uses the capped amount.
    expect(out.summary.financials.remainingSalesToman).toBe("70000000");
  });
});

describe("system tickets", () => {
  it("one parent award with a component per tier when a line wins cash and free rows", () => {
    // Pool of 8 with 5 winning numbers, symbols {1, 2} (winning symbol 2):
    // 5+C: 3, 5: 3, 4+C: 15, 4: 15, 3+C: 10 free rows.
    const out = sixChance([six([3, 11, 17, 24, 29, 5, 6, 7], [1, 2], 56)]);
    expect(out.blockers).toEqual([]);
    expect(out.awards).toHaveLength(1);
    const award = out.awards[0]!;
    const cash = 3n * 3_000_000n + 3n * 2_000_000n + 15n * 900_000n + 15n * 600_000n;
    expect(award).toMatchObject({ awardType: "MIXED", tierCode: "MAIN5_CHANCE", amountToman: cash, freeTicketQuantity: 10 });
    expect(award.components.map((c) => [c.tierCode, c.componentType, c.matchedCombinations, c.amountToman, c.freeTicketQuantity])).toEqual([
      ["MAIN5_CHANCE", "CASH", 3, 9_000_000n, null],
      ["MAIN5", "CASH", 3, 6_000_000n, null],
      ["MAIN4_CHANCE", "CASH", 15, 13_500_000n, null],
      ["MAIN4", "CASH", 15, 9_000_000n, null],
      ["MAIN3_CHANCE", "FREE_TICKET", 10, null, 10],
    ]);
    expect(out.summary.financials.freeRowsAwarded).toBe(10);
    expect(out.summary.financials.lowerTierCashToman).toBe(String(cash));
  });
});
