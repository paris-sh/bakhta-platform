export function LoadingMessage({ label = "در حال بارگذاری..." }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-muted" role="status" aria-live="polite">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyMessage({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center text-muted">
      {label}
    </div>
  );
}

export function ErrorMessage({ message }: { message: string }) {
  return (
    <div
      className="rounded-lg border border-danger/30 bg-danger-bg p-4 text-danger"
      role="alert"
    >
      {message}
    </div>
  );
}
