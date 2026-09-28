"use client";

import { useI18n } from "@/lib/i18n/locale-context";
import { isDeadlinePassed, prizeHeadline, tierLabel } from "@/lib/prize";
import type { TicketClaimState, TicketPrize } from "@/lib/types";
import { SparkleIcon } from "@/components/icons";

/** "Jackpot winner" / tier badge for a winning ticket. */
export function PrizeBadge({ prize }: { prize: TicketPrize }) {
  const { t } = useI18n();
  return (
    <span className={`badge ${prize.isJackpot ? "badge-gold" : "badge-success"}`}>
      {prize.isJackpot ? t.prize.jackpotWinner : `${t.prize.winner} · ${tierLabel(prize.tierMatch, t)}`}
    </span>
  );
}

/**
 * The authoritative award of one ticket, exactly as the server returned it: total cash, free
 * rows, the per-tier breakdown and the claim deadline. `claim` is passed only on the owner's
 * own pages (My Tickets, winner banner) — the public ticket check never has it.
 */
export function PrizeDetails({
  prize,
  claim,
  showClaim = false,
  compact = false,
}: {
  prize: TicketPrize;
  claim?: TicketClaimState | null;
  showClaim?: boolean;
  compact?: boolean;
}) {
  const { t, money, dateTime } = useI18n();
  const hasCash = prize.totalCashToman !== "0";
  const passed = isDeadlinePassed(prize.claimDeadlineAt);
  const showBreakdown = prize.components.length > 1 || prize.components.some((c) => c.matchedCombinations > 1);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted">{t.prize.tier}</p>
          <p className="font-bold text-foreground">{prizeHeadline(prize, t)}</p>
        </div>
        <div className="text-end">
          <p className="text-xs font-semibold text-muted">{t.prize.totalCash}</p>
          {hasCash && <p className={`tabular font-extrabold prize-text ${compact ? "text-lg" : "text-2xl"}`}>{money(prize.totalCashToman)}</p>}
          {prize.freeTicketQuantity > 0 && (
            <p className="flex items-center justify-end gap-1 text-sm font-semibold text-brand-700">
              <SparkleIcon className="h-4 w-4" />
              {t.prize.freeRows(prize.freeTicketQuantity)}
            </p>
          )}
          {!hasCash && prize.freeTicketQuantity === 0 && <p className="tabular font-bold">{money(0)}</p>}
        </div>
      </div>

      {showBreakdown && (
        <div>
          <p className="mb-1 text-xs font-semibold text-muted">{t.prize.breakdown}</p>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border text-sm">
            {prize.components.map((c) => (
              <li key={c.tierCode} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-2">
                <span className="min-w-0">
                  <span className="font-semibold">{c.isJackpot ? t.results.jackpot : tierLabel(c.tierMatch, t)}</span>
                  <span className="ms-1.5 text-xs text-muted">{t.prize.combinations(c.matchedCombinations)}</span>
                </span>
                <span className="tabular font-bold">
                  {c.componentType === "FREE_TICKET" ? t.prize.freeRows(c.freeTicketQuantity ?? 0) : money(c.amountToman ?? "0")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold text-muted">{t.prize.claimDeadline}</dt>
          <dd className="font-semibold" title={prize.claimDeadlineAt}>
            {dateTime(prize.claimDeadlineAt)}
            {passed && <span className="block text-xs font-normal text-danger">{t.prize.deadlinePassed}</span>}
          </dd>
        </div>
        {showClaim && (
          <div>
            <dt className="text-xs font-semibold text-muted">{t.prize.claimStatus}</dt>
            <dd className="font-semibold">
              {claim ? (
                <>
                  {t.prize.claimStatuses[claim.status] ?? t.status.unknown}
                  {claim.paidAt && <span className="block text-xs font-normal text-muted">{t.prize.paidOn(dateTime(claim.paidAt))}</span>}
                </>
              ) : (
                <span className="font-normal text-muted">{t.prize.notClaimed}</span>
              )}
            </dd>
          </div>
        )}
      </dl>
      {showClaim && claim?.requiresManualReconciliation && (
        <p className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning" role="status">
          {t.prize.reconciliation}
        </p>
      )}
    </div>
  );
}
