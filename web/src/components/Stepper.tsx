"use client";

import { useI18n } from "@/lib/i18n/locale-context";
import { CheckIcon } from "./icons";

export type PurchaseStep = "build" | "checkout" | "result";

const ORDER: PurchaseStep[] = ["build", "checkout", "result"];

/** Selection → review → confirmation progress, mirrored automatically in RTL. */
export function Stepper({ step }: { step: PurchaseStep }) {
  const { t, digits } = useI18n();
  const labels: Record<PurchaseStep, string> = {
    build: t.play.steps.select,
    checkout: t.play.steps.review,
    result: t.play.steps.confirm,
  };
  const current = ORDER.indexOf(step);

  return (
    <ol className="flex items-center gap-2 sm:gap-3">
      {ORDER.map((s, i) => {
        const done = i < current || step === "result";
        const active = i === current;
        return (
          <li key={s} className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3" aria-current={active ? "step" : undefined}>
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold transition-colors duration-300 ${
                done
                  ? "border-brand bg-brand text-brand-contrast"
                  : active
                    ? "border-brand bg-brand-50 text-brand shadow-[0_0_0_4px_rgb(11_107_79_/_0.12)]"
                    : "border-border-strong bg-surface text-muted"
              }`}
            >
              {done ? <CheckIcon className="h-4 w-4" /> : digits(i + 1)}
            </span>
            <span className={`truncate text-sm font-semibold ${active || done ? "text-foreground" : "text-muted"}`}>
              {labels[s]}
            </span>
            {i < ORDER.length - 1 && (
              <span
                aria-hidden="true"
                className={`hidden h-px flex-1 sm:block ${i < current ? "bg-brand" : "bg-border-strong"}`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
