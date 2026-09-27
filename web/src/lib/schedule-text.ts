import type { Locale, Messages } from "./i18n/messages";
import type { GameRules } from "./types";

// Reads any stored draw schedule for display. Kept free of runtime imports so node --test can
// load it directly (see game.test.mjs).

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const localizeDigits = (text: string, locale: Locale) => (locale === "fa" ? text.replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]!) : text);

/** "A, B and C": Intl for English; conventional Persian «الف، ب و ج» (no serial comma or
 * invisible direction marks, which Intl adds for fa). */
function joinList(items: string[], locale: Locale): string {
  if (locale !== "fa") return new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join("، ")} و ${items[items.length - 1]}`;
}

/** One enabled draw time of a schedule, as the public pages need it. */
export interface ScheduleSlotView {
  weekdays: number[];
  drawTime: string;
}

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function slotView(raw: unknown): ScheduleSlotView | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const days = Array.isArray(r.weekdays) ? r.weekdays : Array.isArray(r.active_weekdays) ? r.active_weekdays : null;
  if (!days || typeof r.draw_time !== "string" || !HH_MM.test(r.draw_time)) return null;
  const weekdays = Array.from(new Set(days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))).sort((a, b) => a - b);
  return weekdays.length > 0 ? { weekdays, drawTime: r.draw_time } : null;
}

/**
 * The ENABLED draw times of any stored schedule: a slot schedule ({ slots: [...] }) or an older
 * single-time one ({ active_weekdays, draw_time }). Malformed entries are skipped; returns null
 * when the schedule itself is missing or unreadable. Never throws.
 */
export function scheduleSlots(schedule: unknown): ScheduleSlotView[] | null {
  if (!schedule || typeof schedule !== "object") return null;
  const s = schedule as Record<string, unknown>;
  if (Array.isArray(s.slots)) {
    return s.slots
      .filter((slot) => slot && typeof slot === "object" && (slot as Record<string, unknown>).enabled !== false)
      .map(slotView)
      .filter((v): v is ScheduleSlotView => v !== null);
  }
  const legacy = slotView(s);
  return legacy ? [legacy] : null;
}

/**
 * "Draws daily at 21:00" / "Draws every Tuesday and Friday at 21:00" / "Draws daily at 14:00,
 * 18:00, and 21:00", localized. Draw times sharing the same days are grouped, so several slots
 * on one day read as one phrase. Missing or malformed data yields a localized fallback.
 */
export function scheduleText(rules: Pick<GameRules, "schedule"> | null | undefined, t: Messages, locale: Locale): string {
  try {
    const slots = scheduleSlots(rules?.schedule);
    if (slots === null) return t.play.scheduleUnavailable;
    if (slots.length === 0) return t.play.noRegularDraws;
    const list = (items: string[]) => joinList(items, locale);
    const groups = new Map<string, { weekdays: number[]; times: Set<string> }>();
    for (const slot of slots) {
      const key = slot.weekdays.join(",");
      const g = groups.get(key) ?? { weekdays: slot.weekdays, times: new Set<string>() };
      g.times.add(slot.drawTime);
      groups.set(key, g);
    }
    // Daily groups first, then by first weekday.
    const ordered = [...groups.values()].sort((a, b) => (b.weekdays.length === 7 ? 1 : 0) - (a.weekdays.length === 7 ? 1 : 0) || a.weekdays[0]! - b.weekdays[0]!);
    const describe = (g: { weekdays: number[]; times: Set<string> }, whole: boolean) => {
      const times = list([...g.times].sort().map((x) => localizeDigits(x, locale)));
      const daily = g.weekdays.length === 7;
      const days = list(g.weekdays.map((d) => t.weekdays[d] ?? ""));
      if (whole) return daily ? t.play.drawDaily(times) : t.play.drawDays(days, times);
      return daily ? t.play.dailyPart(times) : t.play.daysPart(days, times);
    };
    if (ordered.length === 1) return describe(ordered[0]!, true);
    // Groups are separated by a semicolon so each keeps its own "A, B and C" list readable.
    return t.play.drawGroups(ordered.map((g) => describe(g, false)).join(locale === "fa" ? "؛ " : "; "));
  } catch {
    return t.play.scheduleUnavailable;
  }
}
