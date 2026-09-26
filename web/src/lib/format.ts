const tomanFormatter = new Intl.NumberFormat("fa-IR");

export function formatToman(value: string | number): string {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return "-";
  return `${tomanFormatter.format(numeric)} تومان`;
}

const persianDateTimeFormatter = new Intl.DateTimeFormat("fa-IR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tehran",
});

const persianDateFormatter = new Intl.DateTimeFormat("fa-IR", {
  dateStyle: "medium",
  timeZone: "Asia/Tehran",
});

/** Formats the exact server-provided instant for a Persian reader (Jalali calendar,
 * Persian digits, Tehran wall-clock). The ISO string itself remains the source of truth —
 * callers that need it verbatim (e.g. for a `title` tooltip) should keep it alongside. */
export function formatPersianDateTime(iso: string): string {
  return persianDateTimeFormatter.format(new Date(iso));
}

export function formatPersianDate(iso: string): string {
  return persianDateFormatter.format(new Date(iso));
}

const WEEKDAY_NAMES_FA = [
  "یکشنبه",
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنج‌شنبه",
  "جمعه",
  "شنبه",
];

export function weekdayNameFa(weekday: number): string {
  return WEEKDAY_NAMES_FA[weekday] ?? "";
}
