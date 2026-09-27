"use client";

import Link from "next/link";
import { Countdown } from "./Countdown";
import { GLOW, GameIcon, GamePattern, Glow, gameTheme } from "./brand";
import { ArrowIcon, CalendarIcon } from "./icons";
import { useI18n } from "@/lib/i18n/locale-context";
import { gameName } from "@/lib/game";
import type { Draw, FourLeafRules, Game, SixChanceRules } from "@/lib/types";

export function GameCard({ game, draw, index = 0 }: { game: Game; draw: Draw | null; index?: number }) {
  const { t, locale, money, dateTime } = useI18n();
  // Prefer the upcoming draw's snapshotted rules — that is what a purchase will be priced at.
  const rules = draw?.currentRulesSnapshot ?? game.activeRules;
  const isSixChance = game.gameType === "SIX_CHANCE";
  const theme = gameTheme(game.gameType);
  const name = gameName(game, locale, t);

  const price = rules ? money(rules.ticket_price_toman) : "-";
  const prizeLabel = isSixChance ? t.gameCard.jackpot : t.gameCard.fixedPrize;
  const prizeValue = (() => {
    if (!rules) return "-";
    if (isSixChance) {
      return money(draw?.openingJackpotToman ?? (rules as SixChanceRules).minimum_jackpot_toman);
    }
    return money((rules as FourLeafRules).fixed_prize_toman);
  })();

  return (
    <article
      className={`group lift animate-fade-up flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-md ${theme.ring}`}
      style={{ "--delay": `${150 + index * 110}ms` } as React.CSSProperties}
    >
      <div className={`relative isolate overflow-hidden px-6 pb-6 pt-5 text-white ${theme.header}`}>
        <GamePattern gameType={game.gameType} />
        <Glow className="-end-24 -top-32 h-80 w-80" color={isSixChance ? GLOW.ocean : GLOW.gold} />
        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-2xl font-extrabold tracking-tight">{name}</h3>
            <p className="mt-1 text-sm text-white/75">{t.gameCard.taglines[game.gameType]}</p>
          </div>
          <span className="shrink-0 transition-transform duration-500 ease-out-soft group-hover:-translate-y-0.5 group-hover:rotate-6 motion-reduce:transform-none">
            <GameIcon gameType={game.gameType} size={48} />
          </span>
        </div>
        <div className="relative mt-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/65">{prizeLabel}</p>
          <p className="prize-text-on-dark tabular mt-1 text-3xl font-extrabold sm:text-[2rem]">{prizeValue}</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-5 p-6">
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-xs font-semibold text-muted">{t.gameCard.ticketPrice}</dt>
            <dd className="tabular mt-1 text-lg font-bold text-foreground">{price}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted">{t.gameCard.nextDraw}</dt>
            <dd className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-foreground" title={draw?.drawAt}>
              {draw ? (
                <>
                  <CalendarIcon className="h-4 w-4 shrink-0 text-muted" />
                  <span>{dateTime(draw.drawAt)}</span>
                </>
              ) : (
                "-"
              )}
            </dd>
          </div>
        </dl>

        {draw ? (
          <div className="rounded-lg bg-background p-3.5">
            <Countdown targetIso={draw.drawAt} label={t.gameCard.drawIn} size="sm" />
          </div>
        ) : (
          <div className="rounded-lg bg-background p-4 text-center text-sm text-muted">{t.gameCard.noDraw}</div>
        )}

        <Link href={`/games/${game.slug}`} className="btn btn-primary btn-lg mt-auto w-full">
          {t.gameCard.play}
          <ArrowIcon className="h-5 w-5 transition-transform duration-200 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
        </Link>
      </div>
    </article>
  );
}
