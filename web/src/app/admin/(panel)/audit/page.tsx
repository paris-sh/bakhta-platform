"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useAdminAuth } from "@/lib/admin/auth-context";
import { useAdminI18n } from "@/lib/admin/i18n";
import { adminApi } from "@/lib/admin/api";
import type { AdminAuditItem, Paged } from "@/lib/admin/types";
import { useBreadcrumbs } from "@/components/admin/AdminShell";
import {
  AdminCard,
  AdminPageHeader,
  EmptyState,
  ErrorState,
  Field,
  Forbidden,
  Pagination,
  Pill,
  TableSkeleton,
  TableWrap,
  inputSm,
  td,
  th,
} from "@/components/admin/ui";
import { AuditActor } from "@/components/admin/cells";

const PAGE_SIZE = 25;
const EMPTY = { actor: "", action: "", entityType: "", entityId: "", from: "", to: "" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AdminAuditPage() {
  const { can, run } = useAdminAuth();
  const { a, dateTime, errorText } = useAdminI18n();
  const [draft, setDraft] = useState(EMPTY);
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<(Paged<AdminAuditItem> & { entityTypes: string[] }) | null>(null);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  useBreadcrumbs([{ label: a.nav.audit }]);

  // Free-text filters apply after a short pause; selects and dates apply immediately.
  useEffect(() => {
    const id = setTimeout(() => {
      setPage(1);
      setFilters({ ...draft, entityId: UUID.test(draft.entityId.trim()) ? draft.entityId.trim() : "" });
    }, 300);
    return () => clearTimeout(id);
  }, [draft]);

  const load = useCallback(() => {
    setError(null);
    setData(null);
    run((token) => adminApi.listAudit(token, { ...filters, page, pageSize: PAGE_SIZE }))
      .then((res) => {
        setData(res);
        setEntityTypes(res.entityTypes);
      })
      .catch(setError);
  }, [run, filters, page]);

  useEffect(() => {
    if (can("audit.view")) void Promise.resolve().then(load);
  }, [can, load]);

  if (!can("audit.view")) return <Forbidden />;

  const set = (key: keyof typeof EMPTY, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const hasFilters = Object.values(draft).some(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title={a.audit.title} subtitle={a.audit.subtitle} />
      <AdminCard bodyClassName="">
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Field label={a.audit.actor} htmlFor="a-actor">
            <input id="a-actor" dir="ltr" className={inputSm} placeholder={a.audit.actorPlaceholder} value={draft.actor} onChange={(e) => set("actor", e.target.value)} />
          </Field>
          <Field label={a.audit.action} htmlFor="a-action">
            <input id="a-action" dir="ltr" className={`${inputSm} font-mono`} placeholder={a.audit.actionPlaceholder} value={draft.action} onChange={(e) => set("action", e.target.value)} />
          </Field>
          <Field label={a.audit.entity} htmlFor="a-entity">
            <select id="a-entity" className={inputSm} value={draft.entityType} onChange={(e) => set("entityType", e.target.value)}>
              <option value="">{a.audit.allEntities}</option>
              {entityTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label={a.audit.entityId} htmlFor="a-entity-id">
            <input id="a-entity-id" dir="ltr" className={`${inputSm} font-mono text-xs`} value={draft.entityId} onChange={(e) => set("entityId", e.target.value)} />
          </Field>
          <Field label={a.audit.from} htmlFor="a-from">
            <input id="a-from" type="date" dir="ltr" className={inputSm} value={draft.from} onChange={(e) => set("from", e.target.value)} />
          </Field>
          <Field label={a.audit.to} htmlFor="a-to">
            <input id="a-to" type="date" dir="ltr" className={inputSm} value={draft.to} onChange={(e) => set("to", e.target.value)} />
          </Field>
        </div>
        {hasFilters && (
          <div className="flex justify-end border-b border-border px-4 py-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(EMPTY)}>
              {a.common.clear}
            </button>
          </div>
        )}

        {error !== null ? (
          <ErrorState message={errorText(error)} onRetry={load} />
        ) : data === null ? (
          <TableSkeleton rows={10} cols={5} />
        ) : data.items.length === 0 ? (
          <EmptyState message={a.common.noResults} />
        ) : (
          <>
            <TableWrap>
              <table className="w-full min-w-[60rem]">
                <thead className="border-b border-border bg-surface-muted">
                  <tr>
                    <th className={th}>{a.audit.time}</th>
                    <th className={th}>{a.audit.actor}</th>
                    <th className={th}>{a.audit.action}</th>
                    <th className={th}>{a.audit.entity}</th>
                    <th className={th}>{a.audit.reason}</th>
                    <th className={th}>
                      <span className="sr-only">{a.common.details}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.items.map((e) => {
                    const open = expanded === e.id;
                    return (
                      <Fragment key={e.id}>
                        <tr className={open ? "bg-brand-50/50" : "hover:bg-surface-muted"}>
                          <td className={`${td} whitespace-nowrap text-xs text-ink-soft`}>{dateTime(e.createdAt)}</td>
                          <td className={`${td} max-w-56 truncate text-xs`}>
                            <AuditActor actor={e.actor} />
                          </td>
                          <td className={td}>
                            <span className="font-mono text-xs font-semibold" dir="ltr">
                              {e.action}
                            </span>
                            {e.severity !== "INFO" && (
                              <span className="ms-2">
                                <Pill tone="warning">{e.severity}</Pill>
                              </span>
                            )}
                          </td>
                          <td className={td}>
                            <p className="font-mono text-xs" dir="ltr">
                              {e.entityType}
                            </p>
                            <p className="font-mono text-[0.68rem] text-muted" dir="ltr" title={e.entityId}>
                              {e.entityId.slice(0, 8)}…
                            </p>
                          </td>
                          <td className={`${td} text-xs`} title={e.reason ?? undefined}>
                            <span className="block max-w-[16rem] truncate">{e.reason ?? a.common.none}</span>
                          </td>
                          <td className={`${td} text-end`}>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              aria-expanded={open}
                              aria-controls={`audit-${e.id}`}
                              onClick={() => setExpanded(open ? null : e.id)}
                            >
                              {open ? a.audit.collapse : a.audit.expand}
                            </button>
                          </td>
                        </tr>
                        {open && (
                          <tr id={`audit-${e.id}`} className="bg-surface-muted/60">
                            <td colSpan={6} className="px-4 py-4">
                              <AuditDetail entry={e} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </AdminCard>
      <p className="text-xs text-muted">{a.common.tehranTime}</p>
    </div>
  );
}

function AuditDetail({ entry }: { entry: AdminAuditItem }) {
  const { a } = useAdminI18n();
  const blocks: [string, unknown][] = [
    [a.audit.before, entry.oldValues],
    [a.audit.after, entry.newValues],
    [a.audit.evidence, entry.evidence],
  ];
  const present = blocks.filter(([, v]) => v !== null && v !== undefined);
  return (
    <div className="flex flex-col gap-3 text-xs">
      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-muted">{a.audit.entityId}</dt>
          <dd className="mt-0.5 break-all font-mono" dir="ltr">
            {entry.entityId}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{a.audit.requestId}</dt>
          <dd className="mt-0.5 break-all font-mono" dir="ltr">
            {entry.requestId ?? a.common.none}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{a.audit.changed}</dt>
          <dd className="mt-0.5 font-mono" dir="ltr">
            {entry.changedFields.length ? entry.changedFields.join(", ") : a.common.none}
          </dd>
        </div>
      </dl>
      {entry.reason && (
        <p>
          <span className="text-muted">{a.audit.reason}: </span>
          {entry.reason}
        </p>
      )}
      {present.length === 0 ? (
        <p className="text-muted">{a.audit.noDetails}</p>
      ) : (
        <div className={`grid gap-3 ${present.length > 1 ? "lg:grid-cols-2" : ""}`}>
          {present.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <p className="mb-1 font-semibold text-ink-soft">{label}</p>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-surface p-3 leading-relaxed" dir="ltr">
                {JSON.stringify(value, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
