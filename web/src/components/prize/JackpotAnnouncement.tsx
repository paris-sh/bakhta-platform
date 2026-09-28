"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/locale-context";
import { gameName } from "@/lib/game";
import type { Game, JackpotAnnouncement as Announcement } from "@/lib/types";
import { GLOW, GameIcon, GamePattern, Glow, gameTheme } from "@/components/brand";
import { ArrowIcon } from "@/components/icons";

/**
 * Public "this draw had a jackpot winner" news, per Six Chance game. The server only answers
 * from the game's latest CURRENT published result and returns counts and amounts — never a
 * ticket code, owner, order, claim or correction detail — so nothing private can render here.
 */
export function JackpotAnnouncements({ games }: { games: Game[] }) {
  const { t } = useI18n();
  const [items, setItems] = useState<Announcement[]>([]);
  const slugs = games.filter((g) => g.gameType === "SIX_CHANCE").map((g) => g.slug).join(",");

  useEffect(() => {
    if (!slugs) return;
    let cancelled = false;
    Promise.all(
      slugs.split(",").map((slug) =>
        api
          .jackpotAnnouncement(slug)
          .then((r) => r.announcement)
          .catch(() => null),
      ),
    ).then((list) => {
      if (!cancelled) setItems(list.filter((a): a is Announcement => a !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [slugs]);

  if (items.length === 0) return null;
  return (
    <section className="container-page flex flex-col gap-4" aria-label={t.jackpotNews.headline}>
      {items.map((a) => (
        <JackpotCard key={`${a.game.slug}-${a.drawNumber}`} a={a} />
      ))}
    </section>
  );
}

function JackpotCard({ a }: { a: Announcement }) {
  const { t, locale, money, num, dateTime } = useI18n();
  const theme = gameTheme(a.game.gameType);
  const headingId = `jackpot-${a.game.slug}`;
  const split = a.winningTickets > 1;
  return (
    <article
      className={`animate-fade-up relative isolate overflow-hidden rounded-2xl px-5 py-6 text-white shadow-lg sm:px-8 sm:py-7 ${theme.header}`}
      aria-labelledby={headingId}
    >
      <GamePattern gameType={a.game.gameType} />
      <Glow className="-end-28 -top-36 h-[28rem] w-[28rem]" color={GLOW.gold} />
      <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-start gap-3.5">
          <GameIcon gameType={a.game.gameType} size={48} />
          <div className="min-w-0">
            <h2 id={headingId} className="text-xl font-extrabold tracking-tight sm:text-2xl">
              {t.jackpotNews.headline}
            </h2>
            <p className="mt-1 text-sm text-white/75">
              {t.jackpotNews.drawOf(gameName(a.game, locale, t), a.drawNumber)} · <span title={a.drawAt}>{dateTime(a.drawAt)}</span>
            </p>
          </div>
        </div>
        <Link href={`/results/${a.game.slug}/${a.drawNumber}`} className="btn btn-gold w-full sm:w-auto">
          {t.jackpotNews.viewResult}
          <ArrowIcon className="h-4 w-4" />
        </Link>
      </div>
      <dl className="relative mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-gold-300/40 bg-black/15 px-4 py-3 backdrop-blur-sm">
          <dt className="text-[0.7rem] font-semibold uppercase tracking-wider text-white/65">{t.jackpotNews.totalJackpot}</dt>
          <dd className="prize-text-on-dark tabular text-2xl font-extrabold">{money(a.jackpotToman)}</dd>
        </div>
        <div className="rounded-lg border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
          <dt className="text-[0.7rem] font-semibold uppercase tracking-wider text-white/65">{t.jackpotNews.winningTickets}</dt>
          <dd className="tabular text-2xl font-extrabold">{num(a.winningTickets)}</dd>
        </div>
        <div className="rounded-lg border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
          <dt className="text-[0.7rem] font-semibold uppercase tracking-wider text-white/65">{t.jackpotNews.perTicket}</dt>
          <dd className="tabular font-extrabold">
            {a.sharesPerTicket.length === 1 ? (
              <span className="text-2xl">{money(a.sharesPerTicket[0]!.amountToman)}</span>
            ) : (
              <ul className="flex flex-col text-sm">
                {a.sharesPerTicket.map((s) => (
                  <li key={s.amountToman}>{t.jackpotNews.shareLine(money(s.amountToman), s.tickets)}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
      {split && <p className="relative mt-3 text-xs text-white/75">{t.jackpotNews.split(a.winningTickets)}</p>}
    </article>
  );
}
