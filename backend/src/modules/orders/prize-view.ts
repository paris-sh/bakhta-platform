// Read-only presentation of a ticket's CURRENT prize award. Every amount comes straight from
// the stored award and its components (written by the published calculation run) — nothing
// is recalculated here, and nothing here is ever sent anywhere but an HTTP response.

export interface TierMeta {
  match: string | null;
  prizeType: string | null;
  order: number;
}

/** Tier code → match pattern / prize type / rule order, from a draw's rules snapshot. */
export function tierMetaFromSnapshot(snapshot: unknown): Map<string, TierMeta> {
  const map = new Map<string, TierMeta>();
  const tiers = (snapshot as { tiers?: unknown } | null)?.tiers;
  if (Array.isArray(tiers)) {
    tiers.forEach((t, order) => {
      const tier = t as { code?: unknown; match?: unknown; prize_type?: unknown };
      if (typeof tier.code === "string") {
        map.set(tier.code, {
          match: typeof tier.match === "string" ? tier.match : null,
          prizeType: typeof tier.prize_type === "string" ? tier.prize_type : null,
          order,
        });
      }
    });
  }
  return map;
}

export interface AwardRow {
  id: string;
  ticket_id: string;
  tier_code: string;
  award_type: string;
  amount_toman: string | null;
  free_ticket_quantity: number | null;
  claim_deadline_at: Date;
}

export interface ComponentRow {
  award_id: string;
  tier_code: string;
  component_type: string;
  amount_toman: string | null;
  free_ticket_quantity: number | null;
  matched_combinations: number;
}

export interface ClaimRow {
  ticket_id: string;
  status: string;
  requires_manual_reconciliation: boolean;
  paid_at: Date | null;
}

const isJackpotTier = (meta: TierMeta | undefined) => meta?.prizeType === "JACKPOT_POOL";

/** The public part of a current award: tier, amounts, components and claim deadline. No
 * award/ticket id, owner, claim or credential data — safe for the public ticket check. */
export function toPrizeView(award: AwardRow, components: ComponentRow[], tiers: Map<string, TierMeta>) {
  const own = components
    .filter((c) => c.award_id === award.id)
    .sort((a, b) => (tiers.get(a.tier_code)?.order ?? 99) - (tiers.get(b.tier_code)?.order ?? 99));
  const shaped = own.map((c) => ({
    tierCode: c.tier_code,
    tierMatch: tiers.get(c.tier_code)?.match ?? null,
    isJackpot: isJackpotTier(tiers.get(c.tier_code)),
    componentType: c.component_type,
    amountToman: c.amount_toman,
    freeTicketQuantity: c.free_ticket_quantity,
    matchedCombinations: c.matched_combinations,
  }));
  return {
    tierCode: award.tier_code,
    tierMatch: tiers.get(award.tier_code)?.match ?? null,
    isJackpot: isJackpotTier(tiers.get(award.tier_code)) || shaped.some((c) => c.isJackpot),
    awardType: award.award_type,
    totalCashToman: award.amount_toman ?? "0",
    freeTicketQuantity: award.free_ticket_quantity ?? 0,
    components: shaped,
    claimDeadlineAt: award.claim_deadline_at.toISOString(),
  };
}

/** Owner-only claim/payment state of a ticket's claim record. */
export function toClaimView(claim: ClaimRow) {
  return {
    status: claim.status,
    requiresManualReconciliation: claim.requires_manual_reconciliation,
    paidAt: claim.paid_at ? claim.paid_at.toISOString() : null,
  };
}
