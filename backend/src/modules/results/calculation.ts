// Prize calculation for one draw result. Pure and deterministic: the same inputs always
// produce the same awards, components, summary and hash. Only CONFIRMED tickets are passed
// in, and only the draw's own snapshotted rules (plus its snapshotted jackpot) are used.
//
// Approved business rules (Phase 6):
//   * Six Chance ordinary cash tiers pay their amount_toman; multiplier is display only.
//   * Claim deadline = publication + claim_period_days (90 when a historical rule lacks it).
//   * A jackpot win pays the complete advertised jackpot, split in whole Toman across the
//     jackpot-winning combinations; the next jackpot resets to minimum_jackpot_toman.
//   * No jackpot winner: the jackpot carries forward, plus floor(remaining sales × rollover
//     percentage) where remaining sales = confirmed sales − lower-tier cash prizes.
//   * Free rows have no sales value and are not cash expenses; they are recorded separately.
//   * A lower-tier cap scales cash prizes down proportionally (rounded down to one Toman).
// Anything the rules still leave undefined is reported as a BLOCKER, never estimated.
import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "../../shared/canonical-json.js";
import {
  bucketKey,
  fourLeafMatches,
  parseSixChanceTierMatch,
  sixChanceMatchCounts,
  type SixChanceTierPattern,
} from "./matching.js";

/** Approved default claim period, used only for historical rules that predate the field. */
export const DEFAULT_CLAIM_PERIOD_DAYS = 90;

export const FOUR_LEAF_TIER_CODE = "EXACT_4";

export type CalcSelection =
  | { kind: "FOUR_LEAF"; numberValue: string }
  | { kind: "SIX_CHANCE"; numbers: number[]; symbols: number[] };

export interface CalcTicket {
  id: string;
  publicCode: string;
  combinationCount: number;
  ruleVersionId: string;
  selection: CalcSelection;
}

export type WinningValue =
  | { kind: "FOUR_LEAF"; numberValue: string }
  | { kind: "SIX_CHANCE"; drawOrder: number[]; symbol: number };

/** Where the draw's sales figure comes from. Until the payment module exists this is the
 * stored total of CONFIRMED orders — confirmed sales, not settled payment revenue. */
export interface SalesInput {
  amountToman: bigint;
  source: "CONFIRMED_ORDER_TOTALS";
}

export interface CalcInput {
  gameType: "FOUR_LEAF" | "SIX_CHANCE";
  ruleVersionId: string;
  rules: Record<string, unknown>;
  /** Six Chance: the draw's snapshotted advertised jackpot (null = never recorded). */
  openingJackpotToman: bigint | null;
  sales: SalesInput;
  result: WinningValue;
  tickets: CalcTicket[];
  /** Publication instant used for claim deadlines (the preview uses "now"). */
  asOf: Date;
}

export interface Issue {
  code: string;
  params?: Record<string, string | number | null>;
}

export interface TierSummary {
  code: string;
  match: string;
  prizeType: "CASH" | "FREE_TICKET" | "JACKPOT_POOL";
  /** Winning combinations (a combination is one priced share; an exact pick is one). */
  winningCombinations: number;
  winningTickets: number;
  /** Cash per row as configured (before any cap). */
  configuredAmountPerCombinationToman: string | null;
  /** Cash per row actually paid (after the cap; jackpot: the base share). */
  amountPerCombinationToman: string | null;
  freeTicketsPerCombination: number | null;
  totalCashToman: string;
  totalFreeTickets: number;
  determined: boolean;
}

export interface CalcComponent {
  tierCode: string;
  componentType: "CASH" | "FREE_TICKET";
  amountToman: bigint | null;
  freeTicketQuantity: number | null;
  matchedCombinations: number;
  details: Record<string, unknown>;
}

export interface CalcAward {
  ticketId: string;
  publicCode: string;
  tierCode: string;
  awardType: "CASH" | "FREE_TICKET" | "MIXED";
  amountToman: bigint | null;
  freeTicketQuantity: number | null;
  details: Record<string, unknown>;
  components: CalcComponent[];
}

export interface LowerTierCap {
  capToman: string;
  originalTotalToman: string;
  /** cap / original, as an exact ratio and a 6-decimal rendering. */
  scalingFactor: { numerator: string; denominator: string; decimal: string };
  roundedTotalToman: string;
  remainderToman: string;
  remainderDestination: string | null;
  tiers: { code: string; originalPerCombinationToman: string; scaledPerCombinationToman: string; combinations: number }[];
}

export interface Financials {
  formula: "JACKPOT_WON" | "NO_JACKPOT_WINNER" | "FIXED_PRIZE";
  revenueSource: SalesInput["source"];
  confirmedSalesToman: string;
  lowerTierCashOriginalToman: string;
  lowerTierCashToman: string;
  lowerTierCap: LowerTierCap | null;
  jackpotPaidToman: string;
  totalCashPrizesToman: string;
  /** JACKPOT_WON / FIXED_PRIZE: confirmed sales − total cash prizes. */
  drawNetToman: string | null;
  /** NO_JACKPOT_WINNER: confirmed sales − lower-tier cash prizes. */
  remainingSalesToman: string | null;
  rolloverPercentBps: number | null;
  rolloverAdditionToman: string;
  bakhtaRetainedToman: string;
  bakhtaFundingRequiredToman: string;
  nextJackpotToman: string | null;
  freeRowsAwarded: number;
}

export interface CalcOutput {
  summary: {
    gameType: "FOUR_LEAF" | "SIX_CHANCE";
    ruleVersionId: string;
    schemaVersion: number | null;
    winningValue: WinningValue;
    confirmedTickets: number;
    confirmedCombinations: number;
    confirmedSalesToman: string;
    winningTickets: number;
    tiers: TierSummary[];
    totalCashLiabilityToman: string;
    totalFreeTickets: number;
    fourLeaf: null | {
      fixedPrizeToman: string;
      totalPayoutCapToman: string;
      capApplied: boolean;
      perWinnerToman: string;
      roundingUnitToman: string;
      remainderToman: string;
      remainderDestination: string;
    };
    jackpot: null | {
      minimumJackpotToman: string | null;
      openingJackpotToman: string | null;
      winningCombinations: number;
      sharePerCombinationToman: string | null;
      /** Combinations that receive one extra Toman so the whole jackpot is paid. */
      extraOneTomanUnits: number;
      jackpotPaidToman: string;
      carriesOver: boolean;
      nextJackpotToman: string | null;
    };
    financials: Financials;
    claimPeriodDays: number;
    claimPeriodSource: "RULES" | "DEFAULT_FOR_HISTORICAL_RULES";
    claimDeadlineAt: string;
  };
  awards: CalcAward[];
  warnings: Issue[];
  blockers: Issue[];
  calculationHash: string;
}

const str = (v: bigint) => v.toString();
const maxZero = (v: bigint) => (v > 0n ? v : 0n);

function ratioDecimal(num: bigint, den: bigint): string {
  const scaled = (num * 1_000_000n) / den; // floor, 6 decimals
  const whole = scaled / 1_000_000n;
  const frac = (scaled % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${frac}`;
}

export function calculatePrizes(input: CalcInput): CalcOutput {
  const warnings: Issue[] = [];
  const blockers: Issue[] = [];
  const schemaVersion = typeof input.rules.schema_version === "number" ? input.rules.schema_version : null;

  const ruleClaimDays = input.rules.claim_period_days;
  const claimPeriodDays = typeof ruleClaimDays === "number" && ruleClaimDays > 0 ? ruleClaimDays : DEFAULT_CLAIM_PERIOD_DAYS;
  const claimPeriodSource = typeof ruleClaimDays === "number" && ruleClaimDays > 0 ? "RULES" : "DEFAULT_FOR_HISTORICAL_RULES";
  if (claimPeriodSource === "DEFAULT_FOR_HISTORICAL_RULES") {
    warnings.push({ code: "CLAIM_PERIOD_DEFAULT_APPLIED", params: { days: DEFAULT_CLAIM_PERIOD_DAYS } });
  }
  const claimDeadline = new Date(input.asOf.getTime() + claimPeriodDays * 86_400_000);

  if (input.tickets.length === 0) warnings.push({ code: "NO_CONFIRMED_TICKETS" });
  const otherVersion = input.tickets.filter((t) => t.ruleVersionId !== input.ruleVersionId).length;
  if (otherVersion > 0) warnings.push({ code: "TICKET_RULE_VERSION_DIFFERS", params: { tickets: otherVersion } });

  const confirmedCombinations = input.tickets.reduce((n, t) => n + t.combinationCount, 0);

  const core =
    input.gameType === "FOUR_LEAF"
      ? calculateFourLeaf(input, warnings, blockers)
      : calculateSixChance(input, warnings, blockers);

  const awards = core.awards
    .map((a) => ({ ...a, details: { ...a.details, claimPeriodDays } }))
    .sort((a, b) => (a.ticketId < b.ticketId ? -1 : a.ticketId > b.ticketId ? 1 : 0));
  const totalCash = awards.reduce((n, a) => n + (a.amountToman ?? 0n), 0n);
  const totalFree = awards.reduce((n, a) => n + (a.freeTicketQuantity ?? 0), 0);

  const summary: CalcOutput["summary"] = {
    gameType: input.gameType,
    ruleVersionId: input.ruleVersionId,
    schemaVersion,
    winningValue: input.result,
    confirmedTickets: input.tickets.length,
    confirmedCombinations,
    confirmedSalesToman: str(input.sales.amountToman),
    winningTickets: awards.length,
    tiers: core.tiers,
    totalCashLiabilityToman: str(totalCash),
    totalFreeTickets: totalFree,
    fourLeaf: core.fourLeaf,
    jackpot: core.jackpot,
    financials: core.financials,
    claimPeriodDays,
    claimPeriodSource,
    claimDeadlineAt: claimDeadline.toISOString(),
  };

  // The hash fingerprints every input and output that matters, but not the preview instant,
  // so a preview and the publication of the same inputs produce the same hash.
  const calculationHash = createHash("sha256")
    .update(
      canonicalJsonStringify({
        inputs: {
          gameType: input.gameType,
          ruleVersionId: input.ruleVersionId,
          rules: input.rules,
          openingJackpotToman: input.openingJackpotToman === null ? null : str(input.openingJackpotToman),
          sales: { amountToman: str(input.sales.amountToman), source: input.sales.source },
          result: input.result,
          tickets: [...input.tickets]
            .sort((a, b) => (a.id < b.id ? -1 : 1))
            .map((t) => ({ id: t.id, combinations: t.combinationCount, selection: t.selection })),
        },
        outputs: {
          awards: awards.map((a) => ({
            ticketId: a.ticketId,
            tierCode: a.tierCode,
            awardType: a.awardType,
            amountToman: a.amountToman === null ? null : str(a.amountToman),
            freeTicketQuantity: a.freeTicketQuantity,
            components: a.components.map((c) => ({
              tierCode: c.tierCode,
              componentType: c.componentType,
              amountToman: c.amountToman === null ? null : str(c.amountToman),
              freeTicketQuantity: c.freeTicketQuantity,
              matchedCombinations: c.matchedCombinations,
            })),
          })),
          tiers: core.tiers,
          financials: core.financials,
          claimPeriodDays,
          blockers,
        },
      }),
    )
    .digest("hex");

  return { summary, awards, warnings, blockers, calculationHash };
}

// ------------------------------------------------------------------ Four Leaf

function calculateFourLeaf(input: CalcInput, warnings: Issue[], blockers: Issue[]) {
  const r = input.rules as {
    fixed_prize_toman?: number;
    total_payout_cap_toman?: number;
    rounding_unit_toman?: number;
    remainder_destination?: string;
  };
  if (input.result.kind !== "FOUR_LEAF") throw new Error("Four Leaf draw with a non-Four-Leaf result");
  const winning = input.result.numberValue;
  const sales = input.sales.amountToman;
  if (
    typeof r.fixed_prize_toman !== "number" ||
    typeof r.total_payout_cap_toman !== "number" ||
    typeof r.rounding_unit_toman !== "number" ||
    typeof r.remainder_destination !== "string"
  ) {
    blockers.push({ code: "UNSUPPORTED_RULES", params: { gameType: "FOUR_LEAF" } });
    return { awards: [] as CalcAward[], tiers: [] as TierSummary[], fourLeaf: null, jackpot: null, financials: fixedPrizeFinancials(input, 0n) };
  }

  const winners = input.tickets.filter(
    (t) => t.selection.kind === "FOUR_LEAF" && fourLeafMatches(t.selection.numberValue, winning),
  );
  const fixed = BigInt(r.fixed_prize_toman);
  const cap = BigInt(r.total_payout_cap_toman);
  const unit = BigInt(r.rounding_unit_toman);
  const n = BigInt(winners.length);

  // Spec: if the fixed prizes exceed the cap, the cap is divided equally among all winning
  // rows. Each share is rounded DOWN to the rule's rounding unit (rounding up or to nearest
  // could exceed the cap); what is left goes to the rule's remainder_destination.
  const capApplied = n > 0n && n * fixed > cap;
  const perWinner = n === 0n ? fixed : capApplied ? ((cap / n) / unit) * unit : fixed;
  const remainder = capApplied ? cap - perWinner * n : 0n;
  if (capApplied) {
    warnings.push({
      code: "FOUR_LEAF_CAP_APPLIED",
      params: { winners: winners.length, perWinnerToman: str(perWinner), remainderToman: str(remainder) },
    });
  }

  const details = { fixedPrizeToman: str(fixed), capApplied, totalPayoutCapToman: str(cap), winningRows: winners.length, roundingUnitToman: str(unit) };
  const awards: CalcAward[] = winners.map((t) => ({
    ticketId: t.id,
    publicCode: t.publicCode,
    tierCode: FOUR_LEAF_TIER_CODE,
    awardType: "CASH",
    amountToman: perWinner,
    freeTicketQuantity: null,
    details,
    components: [
      { tierCode: FOUR_LEAF_TIER_CODE, componentType: "CASH", amountToman: perWinner, freeTicketQuantity: null, matchedCombinations: 1, details },
    ],
  }));

  const tiers: TierSummary[] = [
    {
      code: FOUR_LEAF_TIER_CODE,
      match: "EXACT_4_DIGITS",
      prizeType: "CASH",
      winningCombinations: winners.length,
      winningTickets: winners.length,
      configuredAmountPerCombinationToman: str(fixed),
      amountPerCombinationToman: str(perWinner),
      freeTicketsPerCombination: null,
      totalCashToman: str(perWinner * n),
      totalFreeTickets: 0,
      determined: true,
    },
  ];
  return {
    awards,
    tiers,
    fourLeaf: {
      fixedPrizeToman: str(fixed),
      totalPayoutCapToman: str(cap),
      capApplied,
      perWinnerToman: str(perWinner),
      roundingUnitToman: str(unit),
      remainderToman: str(remainder),
      remainderDestination: r.remainder_destination,
    },
    jackpot: null,
    financials: fixedPrizeFinancials({ ...input, sales: { ...input.sales, amountToman: sales } }, perWinner * n),
  };
}

function fixedPrizeFinancials(input: CalcInput, totalCash: bigint): Financials {
  const net = input.sales.amountToman - totalCash;
  return {
    formula: "FIXED_PRIZE",
    revenueSource: input.sales.source,
    confirmedSalesToman: str(input.sales.amountToman),
    lowerTierCashOriginalToman: str(totalCash),
    lowerTierCashToman: str(totalCash),
    lowerTierCap: null,
    jackpotPaidToman: "0",
    totalCashPrizesToman: str(totalCash),
    drawNetToman: str(net),
    remainingSalesToman: null,
    rolloverPercentBps: null,
    rolloverAdditionToman: "0",
    bakhtaRetainedToman: str(maxZero(net)),
    bakhtaFundingRequiredToman: str(maxZero(-net)),
    nextJackpotToman: null,
    freeRowsAwarded: 0,
  };
}

// ------------------------------------------------------------------ Six Chance

type RuleTier =
  | { code: string; match: string; prize_type: "JACKPOT_POOL" }
  | { code: string; match: string; prize_type: "CASH"; amount_toman: number; multiplier?: number; payout_mode?: string }
  | { code: string; match: string; prize_type: "FREE_TICKET"; quantity: number };

function calculateSixChance(input: CalcInput, warnings: Issue[], blockers: Issue[]) {
  const r = input.rules as {
    tiers?: RuleTier[];
    ticket_price_toman?: number;
    minimum_jackpot_toman?: number;
    jackpot_contribution_bps?: number;
    jackpot_no_winner_rollover?: boolean;
    jackpot_max_toman?: number | null;
    lower_tier_payout_cap_toman?: number | null;
    remainder_destination?: string;
  };
  if (input.result.kind !== "SIX_CHANCE") throw new Error("Six Chance draw with a non-Six-Chance result");
  const win = { numbers: input.result.drawOrder, symbol: input.result.symbol };
  const sales = input.sales.amountToman;
  if (
    !Array.isArray(r.tiers) ||
    typeof r.ticket_price_toman !== "number" ||
    typeof r.minimum_jackpot_toman !== "number" ||
    typeof r.jackpot_contribution_bps !== "number"
  ) {
    blockers.push({ code: "UNSUPPORTED_RULES", params: { gameType: "SIX_CHANCE" } });
    return { awards: [] as CalcAward[], tiers: [] as TierSummary[], fourLeaf: null, jackpot: null, financials: fixedPrizeFinancials(input, 0n) };
  }
  const price = BigInt(r.ticket_price_toman);
  const minimumJackpot = BigInt(r.minimum_jackpot_toman);
  const rolloverBps = BigInt(r.jackpot_contribution_bps);
  const currentJackpot = input.openingJackpotToman;
  if (currentJackpot === null) {
    // Every Six Chance draw snapshots its advertised jackpot. A historical draw without one
    // needs an audited SUPER_ADMIN entry; it is never guessed.
    blockers.push({ code: "JACKPOT_VALUE_MISSING", params: { minimumJackpotToman: str(minimumJackpot) } });
  }
  if (r.jackpot_no_winner_rollover !== true) {
    blockers.push({ code: "ROLLOVER_DISABLED_UNDEFINED" });
  }

  // Tier patterns, in rule order (the rule lists tiers best first).
  const tiers = r.tiers.map((tier) => ({ tier, pattern: parseSixChanceTierMatch(tier.match) }));
  for (const { tier, pattern } of tiers) {
    if (!pattern) blockers.push({ code: "UNKNOWN_TIER_MATCH", params: { tier: tier.code, match: tier.match } });
    if (tier.prize_type === "CASH" && tier.multiplier !== undefined) {
      const multiplied = BigInt(Math.round(tier.multiplier * r.ticket_price_toman));
      if (multiplied !== BigInt(tier.amount_toman)) {
        // amount_toman is authoritative; the legacy multiplier is shown for information only.
        warnings.push({
          code: "TIER_MULTIPLIER_IGNORED",
          params: { tier: tier.code, amountToman: String(tier.amount_toman), multiplier: tier.multiplier, multipliedToman: str(multiplied) },
        });
      }
    }
  }

  // Per ticket: winning combinations per tier (no expansion — see matching.ts).
  const perTicket = [...input.tickets]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((t) => {
      if (t.selection.kind !== "SIX_CHANCE") throw new Error("Six Chance draw with a non-Six-Chance ticket");
      const counts = sixChanceMatchCounts(t.selection, win);
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      if (total !== t.combinationCount) {
        blockers.push({ code: "COMBINATION_COUNT_MISMATCH", params: { ticket: t.publicCode, stored: t.combinationCount, computed: total } });
      }
      const byTier = new Map<string, number>();
      for (const { tier, pattern } of tiers) {
        if (!pattern) continue;
        const c = counts.get(bucketKey(pattern as SixChanceTierPattern)) ?? 0;
        if (c > 0) byTier.set(tier.code, c);
      }
      return { ticket: t, byTier };
    });

  const combosOf = (code: string) => perTicket.reduce((n, p) => n + (p.byTier.get(code) ?? 0), 0);
  const ticketsOf = (code: string) => perTicket.filter((p) => p.byTier.has(code)).length;

  // ---- lower-tier cash, with the optional cap -----------------------------------------
  const cashTiers = tiers.filter(({ tier }) => tier.prize_type === "CASH").map(({ tier }) => tier as Extract<RuleTier, { prize_type: "CASH" }>);
  const originalPerRow = new Map(cashTiers.map((t) => [t.code, BigInt(t.amount_toman)]));
  const lowerOriginal = cashTiers.reduce((n, t) => n + BigInt(t.amount_toman) * BigInt(combosOf(t.code)), 0n);
  const paidPerRow = new Map(originalPerRow);
  let lowerTierCap: LowerTierCap | null = null;
  const cap = r.lower_tier_payout_cap_toman;
  if (typeof cap === "number" && lowerOriginal > BigInt(cap)) {
    // Proportional reduction: every cash tier's per-row prize is scaled by cap / original
    // and rounded down to one Toman. Scaling one per-row amount at a time keeps tier order
    // (a larger prize never becomes smaller than a lesser tier's) and never exceeds the cap.
    const capT = BigInt(cap);
    for (const t of cashTiers) paidPerRow.set(t.code, (BigInt(t.amount_toman) * capT) / lowerOriginal);
    const rounded = cashTiers.reduce((n, t) => n + paidPerRow.get(t.code)! * BigInt(combosOf(t.code)), 0n);
    if (typeof r.remainder_destination !== "string") {
      blockers.push({ code: "CAP_REMAINDER_DESTINATION_MISSING" });
    }
    lowerTierCap = {
      capToman: str(capT),
      originalTotalToman: str(lowerOriginal),
      scalingFactor: { numerator: str(capT), denominator: str(lowerOriginal), decimal: ratioDecimal(capT, lowerOriginal) },
      roundedTotalToman: str(rounded),
      remainderToman: str(capT - rounded),
      remainderDestination: r.remainder_destination ?? null,
      tiers: cashTiers.map((t) => ({
        code: t.code,
        originalPerCombinationToman: str(BigInt(t.amount_toman)),
        scaledPerCombinationToman: str(paidPerRow.get(t.code)!),
        combinations: combosOf(t.code),
      })),
    };
    warnings.push({ code: "LOWER_TIER_CAP_APPLIED", params: { capToman: str(capT), originalTotalToman: str(lowerOriginal), remainderToman: str(capT - rounded) } });
  }
  const lowerFinal = cashTiers.reduce((n, t) => n + paidPerRow.get(t.code)! * BigInt(combosOf(t.code)), 0n);

  // ---- jackpot -----------------------------------------------------------------------
  const jackpotTier = tiers.find(({ tier }) => tier.prize_type === "JACKPOT_POOL")?.tier;
  const jackpotCombos = jackpotTier ? combosOf(jackpotTier.code) : 0;
  const jackpotWon = jackpotCombos > 0;
  // The complete advertised jackpot is paid: base share per winning combination, and the
  // indivisible remainder as one extra Toman to the first combinations in ticket-id order.
  const jackpotShareByTicket = new Map<string, bigint>();
  let baseShare: bigint | null = null;
  let extraUnits = 0;
  if (jackpotWon && jackpotTier && currentJackpot !== null) {
    baseShare = currentJackpot / BigInt(jackpotCombos);
    extraUnits = Number(currentJackpot % BigInt(jackpotCombos));
    let assignedExtra = 0;
    for (const { ticket, byTier } of perTicket) {
      const combos = byTier.get(jackpotTier.code) ?? 0;
      let share = 0n;
      for (let i = 0; i < combos; i++) {
        share += baseShare + (assignedExtra < extraUnits ? 1n : 0n);
        if (assignedExtra < extraUnits) assignedExtra++;
      }
      if (combos > 0) jackpotShareByTicket.set(ticket.id, share);
    }
  }
  const jackpotPaid = jackpotWon && currentJackpot !== null ? currentJackpot : 0n;

  // ---- draw financial result ------------------------------------------------------------
  const freeRows = tiers
    .filter(({ tier }) => tier.prize_type === "FREE_TICKET")
    .reduce((n, { tier }) => n + (tier as { quantity: number }).quantity * combosOf(tier.code), 0);
  const totalCashPrizes = jackpotPaid + lowerFinal;
  let financials: Financials;
  if (jackpotWon) {
    const net = sales - totalCashPrizes;
    financials = {
      formula: "JACKPOT_WON",
      revenueSource: input.sales.source,
      confirmedSalesToman: str(sales),
      lowerTierCashOriginalToman: str(lowerOriginal),
      lowerTierCashToman: str(lowerFinal),
      lowerTierCap,
      jackpotPaidToman: str(jackpotPaid),
      totalCashPrizesToman: str(totalCashPrizes),
      drawNetToman: str(net),
      remainingSalesToman: null,
      rolloverPercentBps: Number(rolloverBps),
      rolloverAdditionToman: "0",
      bakhtaRetainedToman: str(maxZero(net)),
      bakhtaFundingRequiredToman: str(maxZero(-net)),
      nextJackpotToman: str(minimumJackpot),
      freeRowsAwarded: freeRows,
    };
  } else {
    const remaining = sales - lowerFinal;
    const addition = remaining >= 0n ? (remaining * rolloverBps) / 10_000n : 0n;
    financials = {
      formula: "NO_JACKPOT_WINNER",
      revenueSource: input.sales.source,
      confirmedSalesToman: str(sales),
      lowerTierCashOriginalToman: str(lowerOriginal),
      lowerTierCashToman: str(lowerFinal),
      lowerTierCap,
      jackpotPaidToman: "0",
      totalCashPrizesToman: str(totalCashPrizes),
      drawNetToman: null,
      remainingSalesToman: str(remaining),
      rolloverPercentBps: Number(rolloverBps),
      rolloverAdditionToman: str(addition),
      bakhtaRetainedToman: str(remaining >= 0n ? remaining - addition : 0n),
      bakhtaFundingRequiredToman: str(maxZero(-remaining)),
      nextJackpotToman: currentJackpot === null ? null : str(currentJackpot + addition),
      freeRowsAwarded: freeRows,
    };
  }
  const max = r.jackpot_max_toman;
  if (typeof max === "number" && financials.nextJackpotToman !== null && BigInt(financials.nextJackpotToman) > BigInt(max)) {
    blockers.push({ code: "JACKPOT_MAX_UNDEFINED", params: { maxToman: String(max), nextJackpotToman: financials.nextJackpotToman } });
  }

  // ---- tier summaries -------------------------------------------------------------------
  const tierSummaries: TierSummary[] = tiers.map(({ tier }) => {
    const combos = combosOf(tier.code);
    let configured: string | null = null;
    let perRow: string | null = null;
    let free: number | null = null;
    let total = 0n;
    let determined = true;
    if (tier.prize_type === "CASH") {
      configured = str(originalPerRow.get(tier.code)!);
      perRow = str(paidPerRow.get(tier.code)!);
      total = paidPerRow.get(tier.code)! * BigInt(combos);
    } else if (tier.prize_type === "FREE_TICKET") {
      free = tier.quantity;
    } else {
      configured = currentJackpot === null ? null : str(currentJackpot);
      perRow = baseShare === null ? null : str(baseShare);
      total = jackpotPaid;
      determined = !jackpotWon || currentJackpot !== null;
    }
    return {
      code: tier.code,
      match: tier.match,
      prizeType: tier.prize_type,
      winningCombinations: combos,
      winningTickets: ticketsOf(tier.code),
      configuredAmountPerCombinationToman: configured,
      amountPerCombinationToman: perRow,
      freeTicketsPerCombination: free,
      totalCashToman: str(total),
      totalFreeTickets: free === null ? 0 : free * combos,
      determined,
    };
  });

  // ---- one parent award per ticket, with one component per winning tier ----------------
  const awards: CalcAward[] = [];
  let multiTier = 0;
  for (const { ticket, byTier } of perTicket) {
    if (byTier.size === 0) continue;
    const components: CalcComponent[] = [];
    for (const { tier } of tiers) {
      const combos = byTier.get(tier.code);
      if (!combos) continue;
      if (tier.prize_type === "FREE_TICKET") {
        components.push({
          tierCode: tier.code,
          componentType: "FREE_TICKET",
          amountToman: null,
          freeTicketQuantity: tier.quantity * combos,
          matchedCombinations: combos,
          details: { freeTicketsPerCombination: tier.quantity },
        });
      } else if (tier.prize_type === "CASH") {
        const perRow = paidPerRow.get(tier.code)!;
        components.push({
          tierCode: tier.code,
          componentType: "CASH",
          amountToman: perRow * BigInt(combos),
          freeTicketQuantity: null,
          matchedCombinations: combos,
          details: {
            configuredPerCombinationToman: str(originalPerRow.get(tier.code)!),
            paidPerCombinationToman: str(perRow),
            capApplied: lowerTierCap !== null,
          },
        });
      } else {
        const share = jackpotShareByTicket.get(ticket.id) ?? null;
        components.push({
          tierCode: tier.code,
          componentType: "CASH",
          amountToman: share ?? 0n,
          freeTicketQuantity: null,
          matchedCombinations: combos,
          details: {
            jackpotToman: currentJackpot === null ? null : str(currentJackpot),
            jackpotWinningCombinations: jackpotCombos,
            baseShareToman: baseShare === null ? null : str(baseShare),
          },
        });
      }
    }
    if (components.length > 1) multiTier++;
    const cash = components.reduce((n, c) => n + (c.amountToman ?? 0n), 0n);
    const free = components.reduce((n, c) => n + (c.freeTicketQuantity ?? 0), 0);
    const hasCash = components.some((c) => c.componentType === "CASH");
    const awardType: CalcAward["awardType"] = hasCash && free > 0 && cash > 0n ? "MIXED" : free > 0 && cash === 0n ? "FREE_TICKET" : "CASH";
    awards.push({
      ticketId: ticket.id,
      publicCode: ticket.publicCode,
      tierCode: components[0]!.tierCode, // components follow rule order: the first is the best tier
      awardType,
      amountToman: awardType === "FREE_TICKET" ? null : cash,
      freeTicketQuantity: awardType === "CASH" ? null : free,
      details: { combinationCount: ticket.combinationCount, ticketPriceToman: str(price), tiers: components.length },
      components,
    });
  }
  if (multiTier > 0) warnings.push({ code: "MULTI_TIER_TICKETS", params: { tickets: multiTier } });

  return {
    awards,
    tiers: tierSummaries,
    fourLeaf: null,
    jackpot: {
      minimumJackpotToman: str(minimumJackpot),
      openingJackpotToman: currentJackpot === null ? null : str(currentJackpot),
      winningCombinations: jackpotCombos,
      sharePerCombinationToman: baseShare === null ? null : str(baseShare),
      extraOneTomanUnits: extraUnits,
      jackpotPaidToman: str(jackpotPaid),
      carriesOver: !jackpotWon,
      nextJackpotToman: financials.nextJackpotToman,
    },
    financials,
  };
}
