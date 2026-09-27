"use client";

import { useI18n } from "@/lib/i18n/locale-context";
import { LogoMark } from "./brand";

export function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="mt-16 border-t border-border bg-surface/60">
      <div className="container-page flex flex-col items-center gap-3 py-8 text-center text-sm text-muted sm:flex-row sm:justify-between sm:text-start">
        <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1">
          <LogoMark size={26} />
          <span className="font-bold text-ink-soft">{t.brand.name}</span>
          <span aria-hidden="true">·</span>
          <span>{t.footer.demo}</span>
        </div>
        <p className="text-xs">{t.footer.timezone}</p>
      </div>
    </footer>
  );
}
