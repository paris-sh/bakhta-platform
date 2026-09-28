"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { gameName } from "@/lib/game";
import { bannerWinnings, drawTicketsHref } from "@/lib/prize";
import type { MyTicket } from "@/lib/types";
import { GLOW, Glow } from "@/components/brand";
import { ArrowIcon, SparkleIcon } from "@/components/icons";
import { SelectionDisplay } from "@/components/SelectionDisplay";
import { PrizeDetails } from "./PrizeDetails";

/**
 * The signed-in user's personal congratulations. Data comes only from /v1/me/winnings, which
 * the server scopes to the caller's own tickets — a losing user, a guest or anyone who does
 * not own the winning ticket simply gets an empty list and sees nothing here.
 */
export function WinnerBanner() {
  const { token } = useAuth();
  const { t, locale, dateTime } = useI18n();
  const [winnings, setWinnings] = useState<MyTicket[] | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api
      .myWinnings(token)
      .then((list) => !cancelled && setWinnings(list))
      .catch(() => !cancelled && setWinnings([]));
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token || !winnings) return null;
  const shown = bannerWinnings(winnings);
  if (shown.length === 0) return null;
  const [top, ...rest] = shown;
  const title = top!.prize.isJackpot ? t.winnerBanner.jackpotTitle : shown.length > 1 ? t.winnerBanner.titleMany(shown.length) : t.winnerBanner.title;

  return (
    <section className="container-page pt-6 sm:pt-8" aria-labelledby="winner-title">
      <div className="animate-fade-up relative isolate overflow-hidden rounded-2xl border-2 border-gold bg-[linear-gradient(135deg,var(--gold-50)_0%,#fffdf7_55%,var(--brand-50)_100%)] p-5 shadow-gold sm:p-8">
        <Glow className="-end-24 -top-32 h-[26rem] w-[26rem]" color={GLOW.gold} />
        <div className="relative flex flex-col gap-5">
          <div className="flex items-start gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gold text-gold-900 shadow-sm">
              <SparkleIcon className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h2 id="winner-title" className="prize-sheen rounded-md text-xl font-extrabold tracking-tight text-gold-900 sm:text-2xl">
                {title}
              </h2>
              <p className="mt-1 text-sm text-gold-900/80">
                {t.winnerBanner.drawOf(gameName(top!.draw.game, locale, t), top!.draw.drawNumber)} · <span title={top!.draw.drawAt}>{dateTime(top!.draw.drawAt)}</span>
              </p>
            </div>
          </div>

          <div className="grid gap-4 rounded-xl border border-gold-100 bg-surface/90 p-4 sm:p-5 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-xs font-semibold text-muted">{t.winnerBanner.ticket}</p>
              <p className="tabular font-mono text-sm font-bold" dir="ltr">
                {top!.publicCode}
              </p>
              <SelectionDisplay selection={top!.selection} size="sm" combinationCount={top!.combinationCount} />
            </div>
            <PrizeDetails prize={top!.prize} claim={top!.claim} showClaim />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {rest.length > 0 ? <p className="text-sm font-semibold text-gold-900/80">{t.winnerBanner.more(rest.length)}</p> : <span />}
            <Link href={`${drawTicketsHref(top!.draw.id)}#ticket-${top!.publicCode}`} className="btn btn-gold">
              {t.winnerBanner.viewDetails}
              <ArrowIcon className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
