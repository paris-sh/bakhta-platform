"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/locale-context";
import { gameName } from "@/lib/game";
import type { PublicResultDetail } from "@/lib/types";
import { ErrorMessage, LoadingMessage } from "@/components/StatusMessage";
import { GameIcon, GamePattern, gameTheme } from "@/components/brand";
import { BackIcon, SearchIcon } from "@/components/icons";
import { PublicWinningView } from "@/components/results/PublicWinning";

export default function ResultDetailPage({ params }: { params: Promise<{ slug: string; drawNumber: string }> }) {
  const { slug, drawNumber } = use(params);
  const { t, locale, money, num, dateTime } = useI18n();
  const [result, setResult] = useState<PublicResultDetail | null>(null);
  const [error, setError] = useState<"notFound" | "failed" | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getResult(slug, drawNumber)
      .then((r) => active && setResult(r))
      .catch((err) => active && setError(err instanceof ApiError && err.status === 404 ? "notFound" : "failed"));
    return () => {
      active = false;
    };
  }, [slug, drawNumber]);

  const back = (
    <Link href="/results" className="focus-ring inline-flex w-fit items-center gap-1.5 rounded text-sm font-semibold text-muted hover:text-foreground">
      <BackIcon className="h-4 w-4 rtl:-scale-x-100" />
      {t.results.back}
    </Link>
  );

  if (error) {
    return (
      <div className="container-page flex max-w-3xl flex-col gap-4 py-10">
        {back}
        <ErrorMessage message={error === "notFound" ? t.results.notFound : t.results.loadError} />
      </div>
    );
  }
  if (!result) {
    return (
      <div className="container-page max-w-3xl py-10">
        <LoadingMessage />
      </div>
    );
  }

  const theme = gameTheme(result.game.gameType);
  const tierLabel = (match: string) => {
    const m = /^([0-6])_MAIN(_PLUS_CHANCE)?$/.exec(match);
    if (m) return t.results.tierLabel(Number(m[1]), m[2] !== undefined);
    return t.results.fourLeafTier;
  };

  return (
    <div className="container-page flex max-w-3xl flex-col gap-6 py-10">
      {back}

      <section className={`animate-fade-up relative isolate overflow-hidden rounded-2xl px-6 py-7 text-white shadow-lg sm:px-9 ${theme.header}`}>
        <GamePattern gameType={result.game.gameType} />
        <div className="flex items-center gap-3">
          <GameIcon gameType={result.game.gameType} size={44} />
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{gameName(result.game, locale, t)}</h1>
            <p className="text-sm text-white/75">{t.results.drawNumber(result.drawNumber)}</p>
          </div>
        </div>
        <div className="mt-6 rounded-xl bg-white/95 p-4 text-foreground sm:p-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
            {result.winning.kind === "FOUR_LEAF" ? t.results.winningNumber : t.results.winningNumbers}
          </p>
          <PublicWinningView winning={result.winning} />
          {result.winning.kind === "SIX_CHANCE" && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{t.results.drawOrder}:</span>
              <PublicWinningView winning={result.winning} size="sm" order="draw" />
            </div>
          )}
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-white/65">{t.results.drawnOn}</dt>
            <dd className="font-semibold">{dateTime(result.drawAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-white/65">{t.results.salesClosed}</dt>
            <dd className="font-semibold">{dateTime(result.salesClosedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-white/65">{t.results.publishedOn}</dt>
            <dd className="font-semibold">{dateTime(result.publishedAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="card card-pad flex flex-col gap-4" aria-labelledby="tiers-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="tiers-title" className="text-lg font-bold">
            {t.results.tiers}
          </h2>
          <p className="text-sm text-muted">
            {t.results.ticketsInDraw}: <span className="tabular font-semibold text-foreground">{num(result.confirmedTickets)}</span>
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="border-b border-border text-start text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pe-3 text-start font-semibold">{t.results.tier}</th>
                <th className="px-3 py-2 text-end font-semibold">{t.results.rows}</th>
                <th className="px-3 py-2 text-end font-semibold">{t.results.prizePerRow}</th>
                <th className="py-2 ps-3 text-end font-semibold">{t.results.total}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {result.tiers.map((tier) => (
                <tr key={tier.code} className={tier.winningRows === 0 ? "text-muted" : ""}>
                  <td className="py-2.5 pe-3 font-semibold">{tierLabel(tier.match)}</td>
                  <td className="tabular px-3 py-2.5 text-end">{num(tier.winningRows)}</td>
                  <td className="tabular px-3 py-2.5 text-end">
                    {tier.freeTicketsPerRow !== null
                      ? t.results.freeRows(tier.freeTicketsPerRow)
                      : tier.prizeType === "JACKPOT_POOL"
                        ? tier.prizePerRowToman
                          ? money(tier.prizePerRowToman)
                          : t.results.jackpotShare
                        : tier.prizePerRowToman
                          ? money(tier.prizePerRowToman)
                          : "—"}
                  </td>
                  <td className="tabular py-2.5 ps-3 text-end font-semibold">
                    {tier.freeTicketsPerRow !== null ? t.results.freeRows(tier.freeTicketsPerRow * tier.winningRows) : money(tier.totalPrizeToman)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border-strong">
                <td className="py-2.5 pe-3 font-bold" colSpan={3}>
                  {t.results.totalPrize}
                </td>
                <td className="tabular py-2.5 ps-3 text-end font-extrabold text-brand-700">{money(result.totalPrizeToman)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {result.jackpot && (
          <p className="rounded-lg bg-gold-50 px-3 py-2 text-sm">
            <span className="font-semibold">{t.results.jackpot}</span>
            {result.jackpot.amountToman && <span className="tabular"> · {money(result.jackpot.amountToman)}</span>}
            <span className="text-muted"> · {result.jackpot.won ? t.results.jackpotWon : t.results.jackpotCarried}</span>
            {result.jackpot.nextJackpotToman && (
              <span className="mt-1 block">
                {t.results.nextJackpot}: <span className="tabular font-semibold">{money(result.jackpot.nextJackpotToman)}</span>
              </span>
            )}
          </p>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        {result.evidence && (
          <a
            href={result.evidence.youtubeUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="card focus-ring flex flex-col gap-1 p-4 transition-shadow hover:shadow-md"
          >
            <span className="font-bold text-brand">{t.results.evidence} ↗</span>
            <span className="text-xs text-muted">{t.results.evidenceNote}</span>
          </a>
        )}
        <Link href="/tickets/check" className="card focus-ring flex items-center gap-3 p-4 transition-shadow hover:shadow-md">
          <SearchIcon className="h-5 w-5 text-brand" />
          <span className="font-bold">{t.results.checkTicket}</span>
        </Link>
      </div>
    </div>
  );
}
