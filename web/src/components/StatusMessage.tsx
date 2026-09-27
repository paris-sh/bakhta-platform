"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/locale-context";
import { AlertIcon, CheckCircleIcon, InfoIcon, TicketIcon } from "./icons";

export function LoadingMessage({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-muted" role="status" aria-live="polite">
      <span className="relative flex h-5 w-5">
        <span className="absolute inset-0 rounded-full border-2 border-brand-100" />
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-brand border-t-transparent motion-reduce:animate-none" />
      </span>
      <span className="text-sm font-medium">{label ?? t.common.loading}</span>
    </div>
  );
}

export function EmptyMessage({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong bg-surface/70 px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand">
        <TicketIcon className="h-6 w-6" />
      </span>
      <p className="max-w-sm text-muted">{label}</p>
      {action}
    </div>
  );
}

const TONES = {
  danger: { box: "border-danger-border bg-danger-bg text-danger", Icon: AlertIcon },
  warning: { box: "border-warning-border bg-warning-bg text-warning", Icon: AlertIcon },
  success: { box: "border-success-border bg-success-bg text-success", Icon: CheckCircleIcon },
  info: { box: "border-brand-100 bg-brand-50 text-brand-700", Icon: InfoIcon },
} as const;

export function Notice({
  tone,
  children,
  title,
  action,
}: {
  tone: keyof typeof TONES;
  children: ReactNode;
  title?: string;
  action?: ReactNode;
}) {
  const { box, Icon } = TONES[tone];
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border px-4 py-3.5 text-sm ${box}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title && <p className="font-bold">{title}</p>}
        <div className="leading-relaxed">{children}</div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

export function ErrorMessage({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <Notice tone="danger" action={action}>
      {message}
    </Notice>
  );
}
