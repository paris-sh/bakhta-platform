import type { Locale, Messages } from "./i18n/messages";

/** The catalog's own localized name (nameEn / nameFa), with a static fallback. */
export function gameName(
  game: { nameEn?: string; nameFa?: string; gameType?: string; code?: string },
  locale: Locale,
  t: Messages,
): string {
  const fromApi = locale === "fa" ? game.nameFa : game.nameEn;
  return fromApi || t.gameNames[game.gameType ?? game.code ?? ""] || t.status.unknown;
}

// Schedule wording lives in a dependency-free module so it can be unit-tested directly.
export { scheduleSlots, scheduleText, type ScheduleSlotView } from "./schedule-text";
