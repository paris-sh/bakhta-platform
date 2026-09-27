import type { ReactNode } from "react";

/** Title block shared by the account and utility pages, with a faint clover-green wash. */
export function PageHeader({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: ReactNode }) {
  return (
    <div className="animate-fade-up flex items-start gap-4">
      {icon && (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand ring-1 ring-brand-100">
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-muted">{subtitle}</p>}
      </div>
    </div>
  );
}
