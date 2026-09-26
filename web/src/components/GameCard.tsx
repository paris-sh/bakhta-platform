import Link from "next/link";
import { Countdown } from "./Countdown";
import { formatPersianDateTime, formatToman } from "@/lib/format";
import type { Draw, FourLeafRules, Game, SixChanceRules } from "@/lib/types";

export function GameCard({ game, draw }: { game: Game; draw: Draw | null }) {
  const rules = game.activeRules;
  const isSixChance = game.gameType === "SIX_CHANCE";

  const price = rules ? formatToman(rules.ticket_price_toman) : "-";
  const prizeLabel = isSixChance ? "جکپات فعلی" : "جایزه ثابت";
  const prizeValue = (() => {
    if (!rules) return "-";
    if (isSixChance) {
      const jackpot = draw?.openingJackpotToman ?? String((rules as SixChanceRules).minimum_jackpot_toman);
      return formatToman(jackpot);
    }
    return formatToman((rules as FourLeafRules).fixed_prize_toman);
  })();

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition hover:shadow-md">
      <div
        className={`px-6 py-5 text-brand-contrast ${isSixChance ? "bg-brand" : "bg-gold-dark"}`}
      >
        <p className="text-sm opacity-90">بازی</p>
        <h2 className="text-2xl font-extrabold">{game.nameFa}</h2>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-6">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-muted">قیمت هر بلیط</dt>
            <dd className="text-lg font-bold">{price}</dd>
          </div>
          <div>
            <dt className="text-muted">{prizeLabel}</dt>
            <dd className="text-lg font-bold text-gold-dark">{prizeValue}</dd>
          </div>
        </dl>

        {draw ? (
          <div className="flex items-center justify-between rounded-xl bg-background p-4">
            <div>
              <p className="text-xs text-muted">قرعه‌کشی بعدی</p>
              <p className="font-semibold" title={draw.drawAt}>
                {formatPersianDateTime(draw.drawAt)}
              </p>
            </div>
            <Countdown targetIso={draw.drawAt} label="تا قرعه‌کشی" />
          </div>
        ) : (
          <div className="rounded-xl bg-background p-4 text-center text-sm text-muted">
            قرعه‌کشی بعدی هنوز اعلام نشده است.
          </div>
        )}

        <Link
          href={`/games/${game.slug}`}
          className="focus-ring mt-auto inline-flex items-center justify-center rounded-lg bg-brand px-4 py-3 font-bold text-brand-contrast hover:bg-brand-dark"
        >
          بازی کنید
        </Link>
      </div>
    </div>
  );
}
