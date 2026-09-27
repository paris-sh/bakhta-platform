"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError } from "../api-client";
import { formatDateTime, formatNumber, formatToman, localizeDigits } from "../format";
import { LOCALE_COOKIE, MESSAGES, localeDir, type Locale, type Messages } from "./messages";

interface I18nValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  t: Messages;
  setLocale: (locale: Locale) => void;
  money: (value: string | number) => string;
  dateTime: (iso: string) => string;
  num: (value: number) => string;
  digits: (value: string | number) => string;
  /** User-facing text for any thrown value — never the backend's raw message. */
  errorText: (err: unknown) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // Switching only swaps the dictionary: no navigation or refresh, so in-progress page state
  // (e.g. a half-built ticket selection) is untouched. The cookie lets the server render the
  // right lang/dir on the next full load; it holds nothing but "en" or "fa".
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
  }, []);

  // The document's lang/dir/title always follow this tab's active language — including if a
  // server re-render ever stamps different attributes (e.g. another tab changed the cookie).
  useEffect(() => {
    const root = document.documentElement;
    const dir = localeDir(locale);
    const apply = () => {
      if (root.lang !== locale) root.lang = locale;
      if (root.dir !== dir) root.dir = dir;
    };
    apply();
    // The admin panel keeps its own document title.
    if (!window.location.pathname.startsWith("/admin")) document.title = MESSAGES[locale].meta.title;
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["lang", "dir"] });
    return () => observer.disconnect();
  }, [locale]);

  const value = useMemo<I18nValue>(() => {
    const t = MESSAGES[locale];
    return {
      locale,
      dir: localeDir(locale),
      t,
      setLocale,
      money: (v) => formatToman(v, locale),
      dateTime: (iso) => formatDateTime(iso, locale),
      num: (v) => formatNumber(v, locale),
      digits: (v) => localizeDigits(v, locale),
      errorText: (err) => (err instanceof ApiError ? t.errors[err.reason] : t.errors.unknown),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within LocaleProvider");
  return ctx;
}
