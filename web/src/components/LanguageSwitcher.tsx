"use client";

import { useI18n } from "@/lib/i18n/locale-context";
import { LOCALES, MESSAGES } from "@/lib/i18n/messages";

/** Compact "EN | فا" segmented control. Each option is labelled in its own language so a
 * visitor can always find theirs, whichever language is active. */
export function LanguageSwitcher({ tone = "light" }: { tone?: "light" | "dark" }) {
  const { locale, setLocale, t } = useI18n();
  const base =
    tone === "dark"
      ? "border-white/25 bg-white/10"
      : "border-border-strong bg-surface-muted";
  return (
    <div role="group" aria-label={t.language.label} className={`inline-flex rounded-full border p-0.5 ${base}`}>
      {LOCALES.map((code) => {
        const active = code === locale;
        return (
          <button
            key={code}
            type="button"
            lang={code}
            onClick={() => setLocale(code)}
            aria-pressed={active}
            aria-label={MESSAGES[code].language[code === "en" ? "enFull" : "faFull"]}
            className={`min-h-8 min-w-10 rounded-full px-2.5 text-xs font-bold transition-colors duration-200 ${
              active
                ? "bg-brand text-brand-contrast shadow-xs"
                : tone === "dark"
                  ? "text-white/80 hover:text-white"
                  : "text-ink-soft hover:text-brand"
            }`}
          >
            {MESSAGES[code].language[code]}
          </button>
        );
      })}
    </div>
  );
}
