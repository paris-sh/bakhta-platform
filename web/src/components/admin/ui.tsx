"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAdminI18n } from "@/lib/admin/i18n";
import { AlertIcon, CheckCircleIcon, CloseIcon, InfoIcon } from "@/components/icons";

// Admin UI primitives. Everything is built on the shared design tokens (globals.css) so the
// admin panel reads as part of Bakhta, with a denser, operational layout.

// ---------------------------------------------------------------- layout blocks

export function AdminPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function AdminCard({
  title,
  action,
  children,
  className = "",
  bodyClassName = "p-4 sm:p-5",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-surface shadow-xs ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          {title && <h2 className="text-sm font-bold text-foreground">{title}</h2>}
          {action}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
  accent = "brand",
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: "brand" | "gold" | "ocean" | "neutral";
  loading?: boolean;
}) {
  const bar = { brand: "bg-brand", gold: "bg-gold", ocean: "bg-ocean-500", neutral: "bg-border-strong" }[accent];
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface p-4 shadow-xs">
      <span className={`absolute inset-y-0 start-0 w-1 ${bar}`} aria-hidden="true" />
      <p className="text-xs font-semibold text-muted">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-24" />
      ) : (
        <p className="tabular mt-1.5 text-2xl font-extrabold tracking-tight text-foreground">{value}</p>
      )}
      {hint && !loading && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- feedback

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <span className={`block animate-pulse rounded-md bg-background-subtle motion-reduce:animate-none ${className}`} aria-hidden="true" />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  const { a } = useAdminI18n();
  return (
    <div className="flex flex-col gap-2.5 p-4" role="status" aria-label={a.common.loading}>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className="h-4" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-background-subtle text-muted">
        <InfoIcon className="h-5 w-5" />
      </span>
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { a } = useAdminI18n();
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center" role="alert">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-danger-bg text-danger">
        <AlertIcon className="h-5 w-5" />
      </span>
      <p className="max-w-md text-sm text-danger">{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          {a.common.retry}
        </button>
      )}
    </div>
  );
}

export function Forbidden() {
  const { a } = useAdminI18n();
  return (
    <AdminCard>
      <ErrorState message={a.common.forbidden} />
    </AdminCard>
  );
}

export function Callout({ tone = "info", children }: { tone?: "info" | "warning" | "danger"; children: ReactNode }) {
  const cls = {
    info: "border-brand-100 bg-brand-50 text-brand-800",
    warning: "border-warning-border bg-warning-bg text-warning",
    danger: "border-danger-border bg-danger-bg text-danger",
  }[tone];
  const Icon = tone === "info" ? InfoIcon : AlertIcon;
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${cls}`} role={tone === "danger" ? "alert" : undefined}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- badges

export type Tone = "success" | "warning" | "danger" | "neutral" | "gold" | "brand" | "ocean";

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  if (tone === "ocean") {
    return (
      <span className="badge border-ocean-300/60 bg-ocean-50 text-ocean-700" style={{ borderWidth: 1 }}>
        {children}
      </span>
    );
  }
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

// ---------------------------------------------------------------- tables & paging

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="relative overflow-x-auto">{children}</div>;
}

export const th = "whitespace-nowrap px-4 py-2.5 text-start text-xs font-semibold uppercase tracking-wide text-muted";
export const td = "px-4 py-3 align-middle text-sm";

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const { a } = useAdminI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm" aria-label={a.common.page(page, pages)}>
      <span className="tabular text-muted">{a.common.showing(from, to, total)}</span>
      <div className="flex items-center gap-2">
        <span className="tabular hidden text-muted sm:inline">{a.common.page(page, pages)}</span>
        <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {a.common.previous}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {a.common.next}
        </button>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------- form fields

export function Field({
  label,
  children,
  hint,
  error,
  htmlFor,
  className = "",
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold text-ink-soft">
        {label}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs font-medium text-danger">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export const inputSm = "input min-h-10 py-1.5 text-sm";

// ---------------------------------------------------------------- overlay helpers

function useFocusTrap(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    (focusables().find((el) => el.dataset.autofocus !== undefined) ?? focusables()[0])?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);
  return ref;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
}) {
  const { a } = useAdminI18n();
  const ref = useFocusTrap(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="animate-fade-in absolute inset-0 bg-foreground/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`animate-fade-up relative flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-border bg-surface shadow-lg sm:rounded-2xl ${
          size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg"
        }`}
        style={{ "--delay": "0ms" } as React.CSSProperties}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-base font-bold">
            {title}
          </h2>
          <button type="button" className="btn btn-ghost btn-sm px-2" onClick={onClose} aria-label={a.common.close}>
            <CloseIcon className="h-4 w-4" />
          </button>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Drawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { a } = useAdminI18n();
  const ref = useFocusTrap(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="animate-fade-in absolute inset-0 bg-foreground/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-y-0 end-0 flex w-full max-w-2xl flex-col border-s border-border bg-background shadow-lg"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-5 py-4">
          <h2 id={titleId} className="truncate text-base font-bold">
            {title}
          </h2>
          <button type="button" className="btn btn-ghost btn-sm px-2" onClick={onClose} aria-label={a.common.close}>
            <CloseIcon className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- toasts

type Toast = { id: number; tone: "success" | "error"; message: string };
const ToastContext = createContext<(tone: Toast["tone"], message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={`animate-fade-up pointer-events-auto flex max-w-md items-center gap-2.5 rounded-lg border px-4 py-3 text-sm font-medium shadow-md ${
              t.tone === "success" ? "border-success-border bg-success-bg text-success" : "border-danger-border bg-danger-bg text-danger"
            }`}
          >
            {t.tone === "success" ? <CheckCircleIcon className="h-5 w-5 shrink-0" /> : <AlertIcon className="h-5 w-5 shrink-0" />}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
