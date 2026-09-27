import { localizeDigits } from "./format";
import type { Locale, Messages } from "./i18n/messages";
import type { GameRules } from "./types";

/** The catalog's own localized name (nameEn / nameFa), with a static fallback. */
export function gameName(
  game: { nameEn?: string; nameFa?: string; gameType?: string; code?: string },
  locale: Locale,
  t: Messages,
): string {
  const fromApi = locale === "fa" ? game.nameFa : game.nameEn;
  return fromApi || t.gameNames[game.gameType ?? game.code ?? ""] || t.status.unknown;
}

/** "Draws daily at 21:00" / "Draws every Tuesday and Friday at 21:00", localized. */
export function scheduleText(rules: GameRules, t: Messages, locale: Locale): string {
  const time = localizeDigits(rules.schedule.draw_time, locale);
  const days = rules.schedule.active_weekdays;
  if (days.length === 7) return t.play.drawDaily(time);
  const list = new Intl.ListFormat(locale, { type: "conjunction" }).format(days.map((d) => t.weekdays[d] ?? ""));
  return t.play.drawDays(list, time);
}
