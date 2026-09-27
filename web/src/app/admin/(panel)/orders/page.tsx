"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAdminAuth } from "@/lib/admin/auth-context";
import { useAdminI18n } from "@/lib/admin/i18n";
import { adminApi } from "@/lib/admin/api";
import type { AdminDrawListItem, AdminGame, AdminOrderDetail, AdminOrderListItem, Paged } from "@/lib/admin/types";
import { useBreadcrumbs } from "@/components/admin/AdminShell";
import {
  AdminCard,
  AdminPageHeader,
  Callout,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  Forbidden,
  Pagination,
  Pill,
  Skeleton,
  TableSkeleton,
  TableWrap,
  inputSm,
  td,
  th,
} from "@/components/admin/ui";
import { CustomerCell, gameLabel } from "@/components/admin/cells";
import { StatusBadge } from "@/components/StatusBadge";
import { SelectionDisplay } from "@/components/SelectionDisplay";

const ORDER_STATUSES = ["DRAFT", "PENDING_PAYMENT", "CONFIRMED", "EXPIRED", "CANCELLED", "REFUNDED"];
const PAGE_SIZE = 20;
const EMPTY = { gameId: "", drawId: "", purchaserType: "", status: "", from: "", to: "", orderNumber: "" };

function OrdersView() {
  const { can, run } = useAdminAuth();
  const { a, t, locale, money, num, dateTime, errorText } = useAdminI18n();
  const params = useSearchParams();
  const [games, setGames] = useState<AdminGame[]>([]);
  const [draws, setDraws] = useState<AdminDrawListItem[]>([]);
  const [filters, setFilters] = useState(EMPTY);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<AdminOrderListItem> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [openId, setOpenId] = useState<string | null>(params.get("order"));
  useBreadcrumbs([{ label: a.nav.orders }]);

  useEffect(() => {
    adminApi.listGames().then(setGames).catch(() => setGames([]));
  }, []);

  // Draw choices follow the selected game (server-side list, newest first is fine to page).
  useEffect(() => {
    if (!filters.gameId || !can("draws.view")) {
      Promise.resolve().then(() => setDraws([]));
      return;
    }
    run((token) => adminApi.listDraws(token, { gameId: filters.gameId, pageSize: 100 }))
      .then((res) => setDraws(res.items))
      .catch(() => setDraws([]));
  }, [filters.gameId, can, run]);

  // Debounce the order-number search.
  useEffect(() => {
    const id = setTimeout(() => {
      setPage(1);
      setFilters((f) => ({ ...f, orderNumber: search.trim() }));
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(() => {
    setError(null);
    setData(null);
    run((token) => adminApi.listOrders(token, { ...filters, page, pageSize: PAGE_SIZE }))
      .then(setData)
      .catch(setError);
  }, [run, filters, page]);

  useEffect(() => {
    if (can("orders.view")) void Promise.resolve().then(load);
  }, [can, load]);

  if (!can("orders.view")) return <Forbidden />;

  const setFilter = (key: keyof typeof EMPTY, value: string) => {
    setPage(1);
    setFilters((f) => ({ ...f, [key]: value, ...(key === "gameId" ? { drawId: "" } : {}) }));
  };
  const hasFilters = Object.values(filters).some(Boolean) || search !== "";

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title={a.orders.title} subtitle={a.orders.subtitle} />

      <AdminCard bodyClassName="">
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <Field label={a.orders.search} htmlFor="o-search" className="xl:col-span-2">
            <input
              id="o-search"
              type="search"
              dir="ltr"
              className={`${inputSm} font-mono`}
              placeholder={a.orders.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          <Field label={a.draws.game} htmlFor="o-game">
            <select id="o-game" className={inputSm} value={filters.gameId} onChange={(e) => setFilter("gameId", e.target.value)}>
              <option value="">{a.draws.allGames}</option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {gameLabel(g, locale)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={a.orders.draw} htmlFor="o-draw">
            <select
              id="o-draw"
              className={inputSm}
              value={filters.drawId}
              disabled={!filters.gameId}
              onChange={(e) => setFilter("drawId", e.target.value)}
              title={filters.gameId ? undefined : a.orders.selectGameFirst}
            >
              <option value="">{filters.gameId ? a.orders.allDraws : a.orders.selectGameFirst}</option>
              {draws.map((d) => (
                <option key={d.id} value={d.id}>
                  #{d.drawNumber}
                </option>
              ))}
            </select>
          </Field>
          <Field label={a.orders.purchaser} htmlFor="o-purchaser">
            <select id="o-purchaser" className={inputSm} value={filters.purchaserType} onChange={(e) => setFilter("purchaserType", e.target.value)}>
              <option value="">{a.common.all}</option>
              <option value="GUEST">{a.status.purchaser.GUEST}</option>
              <option value="USER">{a.status.purchaser.USER}</option>
            </select>
          </Field>
          <Field label={a.orders.status} htmlFor="o-status">
            <select id="o-status" className={inputSm} value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
              <option value="">{a.common.all}</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t.status.order[s] ?? s}
                </option>
              ))}
            </select>
          </Field>
          <Field label={a.orders.from} htmlFor="o-from">
            <input id="o-from" type="date" dir="ltr" className={inputSm} value={filters.from} onChange={(e) => setFilter("from", e.target.value)} />
          </Field>
          <Field label={a.orders.to} htmlFor="o-to">
            <input id="o-to" type="date" dir="ltr" className={inputSm} value={filters.to} onChange={(e) => setFilter("to", e.target.value)} />
          </Field>
        </div>
        {hasFilters && (
          <div className="flex justify-end border-b border-border px-4 py-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setPage(1);
                setSearch("");
                setFilters(EMPTY);
              }}
            >
              {a.common.clear}
            </button>
          </div>
        )}

        {error !== null ? (
          <ErrorState message={errorText(error)} onRetry={load} />
        ) : data === null ? (
          <TableSkeleton rows={8} cols={7} />
        ) : data.items.length === 0 ? (
          <EmptyState message={a.common.noResults} />
        ) : (
          <>
            <TableWrap>
              <table className="w-full min-w-[64rem]">
                <thead className="border-b border-border bg-surface-muted">
                  <tr>
                    <th className={th}>{a.orders.order}</th>
                    <th className={th}>{a.draws.game}</th>
                    <th className={th}>{a.orders.customer}</th>
                    <th className={`${th} text-end`}>{a.orders.tickets}</th>
                    <th className={`${th} text-end`}>{a.orders.chances}</th>
                    <th className={`${th} text-end`}>{a.orders.total}</th>
                    <th className={th}>{a.orders.status}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.items.map((o) => (
                    <tr key={o.id} className="cursor-pointer hover:bg-surface-muted" onClick={() => setOpenId(o.id)}>
                      <td className={td}>
                        <button type="button" className="font-mono text-xs font-bold text-brand hover:underline" dir="ltr" onClick={() => setOpenId(o.id)}>
                          {o.orderNumber}
                        </button>
                        <p className="text-xs text-muted">{dateTime(o.createdAt)}</p>
                      </td>
                      <td className={td}>
                        <p className="font-semibold">{gameLabel(o.game, locale)}</p>
                        <p className="text-xs text-muted">#{o.drawNumber}</p>
                      </td>
                      <td className={td}>
                        <CustomerCell customer={o.customer} />
                      </td>
                      <td className={`${td} tabular text-end`}>{num(o.ticketCount)}</td>
                      <td className={`${td} tabular text-end`}>{num(o.combinationCount)}</td>
                      <td className={`${td} tabular text-end font-semibold`}>{money(o.totalToman)}</td>
                      <td className={td}>
                        <StatusBadge kind="order" value={o.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </AdminCard>
      <p className="text-xs text-muted">{a.common.tehranTime}</p>

      {openId && <OrderDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function OrderDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { run } = useAdminAuth();
  const { a, locale, money, num, dateTime, errorText, sep } = useAdminI18n();
  const [order, setOrder] = useState<AdminOrderDetail | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    run((token) => adminApi.getOrder(token, id)).then(setOrder).catch(setError);
  }, [id, run]);

  return (
    <Drawer open title={order ? a.orders.detailTitle(order.orderNumber) : a.common.loading} onClose={onClose}>
      {error !== null ? (
        <ErrorState message={errorText(error)} />
      ) : !order ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <AdminCard>
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <Item label={a.orders.status} value={<StatusBadge kind="order" value={order.status} />} />
              <Item label={a.orders.customer} value={<CustomerCell customer={order.customer} />} />
              <Item label={a.draws.game} value={`${gameLabel(order.game, locale)}${sep}#${order.drawNumber}`} />
              <Item label={a.orders.created} value={dateTime(order.createdAt)} />
              <Item label={a.orders.confirmed} value={order.confirmedAt ? dateTime(order.confirmedAt) : a.common.none} />
              <Item label={a.draws.drawTime} value={dateTime(order.drawAt)} />
            </dl>
            <dl className="mt-4 grid gap-2 border-t border-border pt-4 text-sm sm:grid-cols-4">
              <Item label={a.orders.tickets} value={num(order.ticketCount)} />
              <Item label={a.orders.chances} value={num(order.combinationCount)} />
              <Item label={a.orders.subtotal} value={money(order.subtotalToman)} />
              <Item label={a.orders.total} value={<span className="text-brand">{money(order.totalToman)}</span>} />
            </dl>
          </AdminCard>

          <h3 className="text-sm font-bold">{a.orders.ticketsTitle}</h3>
          <ul className="flex flex-col gap-3">
            {order.tickets.map((tk) => {
              const system = tk.selection.kind === "SIX_CHANCE_SYSTEM";
              return (
                <li key={tk.id} className="rounded-xl border border-border bg-surface p-4 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-muted">{a.orders.line(tk.lineNumber)}</span>
                      <span className="font-mono text-sm font-bold" dir="ltr">
                        {tk.publicCode}
                      </span>
                      {tk.selection.kind !== "FOUR_LEAF" && <Pill tone={system ? "ocean" : "neutral"}>{system ? a.orders.system : a.orders.exact}</Pill>}
                      {tk.isQuickPick && <Pill tone="gold">{a.orders.quickPick}</Pill>}
                    </span>
                    <StatusBadge kind="ticket" value={tk.status} />
                  </div>
                  <div className="mt-3">
                    <SelectionDisplay selection={tk.selection} size="sm" combinationCount={tk.combinationCount} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-border-strong pt-3 text-sm">
                    <span className="text-xs text-muted">
                      {a.orders.owner}: {tk.ownedByAccount ? a.orders.account : a.orders.guestClaim}
                    </span>
                    <span className="tabular">
                      {tk.combinationCount > 1 && (
                        <span className="text-xs text-muted">
                          {num(tk.combinationCount)} × {money(tk.unitPriceToman)} ={" "}
                        </span>
                      )}
                      <span className="font-bold">{money(tk.lineTotalToman)}</span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          <Callout>{a.orders.noClaim}</Callout>
        </div>
      )}
    </Drawer>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tabular mt-0.5 font-semibold text-foreground">{value}</dd>
    </div>
  );
}

export default function AdminOrdersPage() {
  return (
    <Suspense fallback={null}>
      <OrdersView />
    </Suspense>
  );
}
