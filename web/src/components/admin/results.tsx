"use client";

import { useAdminI18n } from "@/lib/admin/i18n";
import type { ResultDownstream, ResultIssue, ResultSummary, ResultTier, ResultWinner, WinningValue } from "@/lib/admin/types";
import { SelectionDisplay } from "@/components/SelectionDisplay";
import { Callout, EmptyState, Pill, TableWrap, td, th } from "./ui";

/** A winning result drawn like a ticket: digit tiles (Four Leaf) or balls + symbol (Six
 * Chance, in physical draw order). */
export function WinningValueView({ value, size = "md" }: { value: WinningValue; size?: "sm" | "md" }) {
  return value.kind === "FOUR_LEAF" ? (
    <SelectionDisplay selection={{ kind: "FOUR_LEAF", numberValue: value.numberValue }} size={size} />
  ) : (
    <SelectionDisplay selection={{ kind: "SIX_CHANCE", numbers: value.drawOrder, symbol: value.symbol }} size={size} />
  );
}

export function useTierLabel() {
  const { a } = useAdminI18n();
  return (tier: Pick<ResultTier, "code" | "match">) => {
    const m = /^([0-6])_MAIN(_PLUS_CHANCE)?$/.exec(tier.match);
    if (m) return a.results.tierLabel(Number(m[1]), m[2] !== undefined);
    if (tier.match === "EXACT_4_DIGITS") return a.results.fourLeafTier;
    return tier.code;
  };
}

export function IssueList({ issues, tone }: { issues: ResultIssue[]; tone: "danger" | "warning" }) {
  const { a, money } = useAdminI18n();
  const fmt = { money: (v: string | number | null | undefined) => (v === null || v === undefined ? "—" : money(v)) };
  if (issues.length === 0) return null;
  return (
    <Callout tone={tone}>
      <p className="font-semibold">{tone === "danger" ? a.results.blockers : a.results.warnings}</p>
      {tone === "danger" && <p className="mt-0.5 text-xs">{a.results.blockersHint}</p>}
      <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-sm">
        {issues.map((i, idx) => (
          <li key={`${i.code}-${idx}`}>{a.results.issues[i.code]?.(i.params ?? {}, fmt) ?? i.code}</li>
        ))}
      </ul>
    </Callout>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tabular mt-0.5 text-base font-bold text-foreground">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-muted">{hint}</dd>}
    </div>
  );
}

/** Totals, tier table, financial result and settlement facts for one calculation. */
export function CalculationSummary({ summary, downstream }: { summary: ResultSummary; downstream?: ResultDownstream | null }) {
  const { a, money, num, dateTime } = useAdminI18n();
  const tierLabel = useTierLabel();
  const capped = summary.financials?.lowerTierCap ?? null;
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Stat label={a.results.confirmedTickets} value={num(summary.confirmedTickets)} hint={`${a.results.combinations}: ${num(summary.confirmedCombinations)}`} />
        <Stat label={a.results.winningTickets} value={num(summary.winningTickets)} />
        <Stat
          label={a.results.finance.totalCash}
          value={money(summary.totalCashLiabilityToman)}
          hint={summary.totalFreeTickets > 0 ? `${a.results.finance.freeRows}: ${num(summary.totalFreeTickets)}` : undefined}
        />
        <Stat label={a.results.claimDeadline} value={dateTime(summary.claimDeadlineAt)} hint={a.results.claimDays(summary.claimPeriodDays)} />
      </dl>

      <TableWrap>
        <table className="w-full min-w-[34rem]">
          <thead className="border-b border-border bg-surface-muted">
            <tr>
              <th className={th}>{a.results.tier}</th>
              <th className={`${th} text-end`}>{a.results.winningRows}</th>
              <th className={`${th} text-end`}>{a.results.winningTicketsCol}</th>
              <th className={`${th} text-end`}>{a.results.prizePerRow}</th>
              <th className={`${th} text-end`}>{a.results.tierTotal}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {summary.tiers.map((t) => (
              <tr key={t.code} className={t.winningCombinations > 0 ? "" : "text-muted"}>
                <td className={td}>
                  <span className="font-semibold text-foreground">{tierLabel(t)}</span>
                  <span className="ms-2 font-mono text-[0.7rem] text-muted" dir="ltr">
                    {t.code}
                  </span>
                </td>
                <td className={`${td} tabular text-end font-semibold`}>{num(t.winningCombinations)}</td>
                <td className={`${td} tabular text-end`}>{num(t.winningTickets)}</td>
                <td className={`${td} tabular text-end`}>
                  {!t.determined ? (
                    <Pill tone="danger">{a.results.notDetermined}</Pill>
                  ) : t.freeTicketsPerCombination !== null ? (
                    a.results.freeRows(t.freeTicketsPerCombination)
                  ) : t.amountPerCombinationToman !== null ? (
                    <>
                      {t.prizeType === "CASH" && t.configuredAmountPerCombinationToman !== t.amountPerCombinationToman && (
                        <span className="me-1.5 text-xs text-muted line-through">{money(t.configuredAmountPerCombinationToman ?? "0")}</span>
                      )}
                      {money(t.amountPerCombinationToman)}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={`${td} tabular text-end font-semibold`}>
                  {!t.determined ? "—" : t.freeTicketsPerCombination !== null ? a.results.freeRows(t.totalFreeTickets) : money(t.totalCashToman)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      {summary.fourLeaf && (
        <dl className="grid gap-2.5 text-sm sm:grid-cols-2">
          <Stat
            label={summary.fourLeaf.capApplied ? a.results.capApplied : a.results.perWinner}
            value={money(summary.fourLeaf.perWinnerToman)}
            hint={summary.fourLeaf.capApplied ? a.results.remainder(money(summary.fourLeaf.remainderToman), summary.fourLeaf.remainderDestination) : undefined}
          />
        </dl>
      )}

      {capped && (
        <Callout tone="warning">
          <p className="font-semibold">{a.results.finance.cap}</p>
          <p className="mt-0.5 text-sm">
            {a.results.finance.capDetail(capped.scalingFactor.decimal, money(capped.originalTotalToman), money(capped.roundedTotalToman))}{" "}
            {a.results.finance.capRemainder(money(capped.remainderToman), capped.remainderDestination ?? "—")}
          </p>
        </Callout>
      )}

      {summary.financials && <FinancialBreakdown summary={summary} downstream={downstream ?? null} />}
    </div>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "danger" | "success" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className={`tabular text-sm ${strong ? "font-bold text-foreground" : "font-semibold"} ${tone === "danger" ? "text-danger" : tone === "success" ? "text-brand-700" : ""}`}>{value}</dd>
    </div>
  );
}

/** The draw's accounting result with every formula input and output (approved Phase 6 rules). */
export function FinancialBreakdown({ summary, downstream }: { summary: ResultSummary; downstream: ResultDownstream | null }) {
  const { a, money, num } = useAdminI18n();
  const f = summary.financials;
  const fin = a.results.finance;
  const jackpot = summary.jackpot;
  const percent = f.rolloverPercentBps === null ? "" : num(f.rolloverPercentBps / 100);
  return (
    <section className="rounded-lg border border-border bg-surface-muted/60 p-4" aria-labelledby="fin-title">
      <h3 id="fin-title" className="text-sm font-bold">
        {fin.title}
      </h3>
      <p className="mt-0.5 text-xs text-muted">{fin.hint}</p>
      {f.formula !== "FIXED_PRIZE" && <p className="mt-2 text-xs text-ink-soft">{f.formula === "JACKPOT_WON" ? fin.formulaWon : fin.formulaNotWon}</p>}
      <dl className="mt-3 divide-y divide-border">
        <Row label={fin.confirmedSales} value={money(f.confirmedSalesToman)} />
        {jackpot && (
          <>
            <Row label={fin.minimumJackpot} value={jackpot.minimumJackpotToman ? money(jackpot.minimumJackpotToman) : "—"} />
            <Row label={fin.advertisedJackpot} value={jackpot.openingJackpotToman ? money(jackpot.openingJackpotToman) : a.results.jackpotMissing} />
          </>
        )}
        {f.formula === "JACKPOT_WON" && jackpot && (
          <Row label={fin.jackpotPaid} value={`${money(f.jackpotPaidToman)}${jackpot.sharePerCombinationToman ? ` · ${fin.jackpotSplit(money(jackpot.sharePerCombinationToman), jackpot.extraOneTomanUnits)}` : ""}`} />
        )}
        <Row label={fin.lowerTierCash} value={money(f.lowerTierCashToman)} />
        <Row label={fin.totalCash} value={money(f.totalCashPrizesToman)} strong />
        {f.formula === "NO_JACKPOT_WINNER" && f.remainingSalesToman !== null && <Row label={fin.remainingSales} value={money(f.remainingSalesToman)} />}
        {f.formula === "NO_JACKPOT_WINNER" && <Row label={fin.rollover(percent)} value={money(f.rolloverAdditionToman)} />}
        <Row label={fin.retained} value={money(f.bakhtaRetainedToman)} tone="success" />
        <Row label={fin.funding} value={money(f.bakhtaFundingRequiredToman)} tone={f.bakhtaFundingRequiredToman !== "0" ? "danger" : undefined} />
        {f.nextJackpotToman !== null && <Row label={fin.nextJackpot} value={money(f.nextJackpotToman)} strong />}
        {f.freeRowsAwarded > 0 && <Row label={fin.freeRows} value={num(f.freeRowsAwarded)} />}
      </dl>
      <p className="mt-2 text-xs text-muted">{fin.confirmedSalesNote}</p>
      {downstream && (
        <p className={`mt-2 text-xs ${downstream.action === "REQUIRES_MANUAL_RECONCILIATION" ? "font-semibold text-danger" : "text-ink-soft"}`}>
          {fin.downstream}: {fin.downstreamAction[downstream.action]?.(downstream.drawNumber ?? "", money(downstream.nextJackpotToman))}
        </p>
      )}
    </section>
  );
}

export function WinnersTable({ winners, total }: { winners: ResultWinner[]; total: number }) {
  const { a, money, num } = useAdminI18n();
  if (winners.length === 0) return <EmptyState message={a.results.noWinners} />;
  const award = (w: ResultWinner) =>
    w.awardType === "FREE_TICKET"
      ? a.results.freeRows(w.freeTicketQuantity ?? 0)
      : w.awardType === "MIXED"
        ? a.results.finance.mixed(money(w.amountToman ?? "0"), a.results.freeRows(w.freeTicketQuantity ?? 0))
        : money(w.amountToman ?? "0");
  return (
    <div className="flex flex-col gap-2">
      <TableWrap>
        <table className="w-full min-w-[28rem]">
          <thead className="border-b border-border bg-surface-muted">
            <tr>
              <th className={th}>{a.results.ticket}</th>
              <th className={th}>{a.results.tier}</th>
              <th className={`${th} text-end`}>{a.results.award}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {winners.map((w) => (
              <tr key={w.publicCode} className="align-top">
                <td className={`${td} font-mono text-xs`} dir="ltr">
                  {w.publicCode}
                </td>
                <td className={td}>
                  <span className="font-mono text-xs" dir="ltr">
                    {w.tierCode}
                  </span>
                  {w.components.length > 1 && (
                    <ul className="mt-1 flex flex-col gap-0.5 text-[0.7rem] text-muted" aria-label={a.results.finance.components}>
                      {w.components.map((c) => (
                        <li key={c.tierCode} className="flex gap-2">
                          <span className="font-mono" dir="ltr">
                            {c.tierCode}
                          </span>
                          <span className="tabular">
                            ×{num(c.matchedCombinations)} ={" "}
                            {c.componentType === "FREE_TICKET" ? a.results.freeRows(c.freeTicketQuantity ?? 0) : money(c.amountToman ?? "0")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className={`${td} tabular text-end font-semibold`}>{award(w)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {total > winners.length && <p className="text-xs text-muted">{a.results.winnersShown(winners.length, total)}</p>}
    </div>
  );
}
