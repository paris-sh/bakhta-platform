import type { Locale } from "./i18n/messages";

/** Maps Persian (۰-۹) and Arabic-Indic (٠-٩) digits to ASCII 0-9 and leaves every other
 * character untouched — a string transform, so leading zeroes are preserved. */
export function toAsciiDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** Normalizes Persian/Arabic digits, then drops anything that isn't an ASCII digit. */
export function digitsOnly(value: string): string {
  return toAsciiDigits(value).replace(/[^0-9]/g, "");
}

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Display-only: renders the ASCII digits of an already-normalized value in the locale's
 * digit set (Persian digits for fa). Never used on values sent to the API. */
export function localizeDigits(value: string | number, locale: Locale): string {
  const text = String(value);
  return locale === "fa" ? text.replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]) : text;
}

const numberFormatters: Record<Locale, Intl.NumberFormat> = {
  en: new Intl.NumberFormat("en-US"),
  fa: new Intl.NumberFormat("fa-IR"),
};

export function formatNumber(value: number, locale: Locale): string {
  return numberFormatters[locale].format(value);
}

/** "50,000 Toman" / "۵۰٬۰۰۰ تومان". */
export function formatToman(value: string | number, locale: Locale): string {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return "-";
  return `${numberFormatters[locale].format(numeric)} ${locale === "fa" ? "تومان" : "Toman"}`;
}

// Draw instants are shown in the official Tehran timezone in both languages: Gregorian for
// English readers, Jalali with Persian digits for Persian readers. The ISO string from the
// server stays the source of truth (callers keep it in a `title` tooltip).
const dateTimeFormatters: Record<Locale, Intl.DateTimeFormat> = {
  en: new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Tehran",
  }),
  fa: new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tehran",
  }),
};

export function formatDateTime(iso: string, locale: Locale): string {
  return dateTimeFormatters[locale].format(new Date(iso));
}
