"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminAuth } from "@/lib/admin/auth-context";
import { useAdminI18n } from "@/lib/admin/i18n";
import { adminApi } from "@/lib/admin/api";
import type { AdminDashboard } from "@/lib/admin/types";
import { useAdminNav, useBreadcrumbs } from "@/components/admin/AdminShell";
import { AdminCard, AdminPageHeader, EmptyState, ErrorState, Pill, Skeleton, StatTile, td, th, TableWrap } from "@/components/admin/ui";
import { GameIcon } from "@/components/brand";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowIcon } from "@/components/icons";
import { AuditActor, CustomerCell, DrawAvailabilityPill, gameLabel } from "@/components/admin/cells";

export default function AdminDashboardPage() {
  const { can, run } = useAdminAuth();
  const { a, errorText } = useAdminI18n();
  const router = useRouter();
  const nav = useAdminNav();
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<unknown>(null);
  useBreadcrumbs([{ label: a.nav.dashboard }]);

  const allowed = can("dashboard.view");

  // An admin without dashboard access lands on the first section they can use.
  useEffect(() => {
    if (!allowed) {
      const first = nav.find((n) => n.href !== "/admin" && can(n.permission));
      if (first) router.replace(first.href);
    }
  }, [allowed, can, nav, router]);

  const load = useCallback(() => {
    setError(null);
    run((token) => adminApi.dashboard(token)).then(setData).catch(setError);
  }, [run]);

  useEffect(() => {
    if (allowed) void Promise.resolve().then(load);
  }, [allowed, load]);

  if (!allowed) return null;

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={a.dashboard.title}
        subtitle={a.dashboard.subtitle}
        actions={
          <button type="button" className="btn btn-secondary btn-sm" onClick={load}>
            {a.common.refresh}
          </button>
        }
      />
      {error !== null && (
        <AdminCard>
          <ErrorState message={errorText(error)} onRetry={load} />
        </AdminCard>
      )}
      {error === null && <DashboardBody data={data} />}
    </div>
  );
}

function DashboardBody({ data }: { data: AdminDashboard | null }) {
  const { a, money, num, dateTime, locale, sep } = useAdminI18n();
  const loading = data === null;
  const sales = data?.sales ?? null;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={a.dashboard.activeGames} value={data ? num(data.activeGames) : ""} loading={loading} />
        <StatTile
          label={a.dashboard.openDraws}
          value={data ? num(data.openDraws) : ""}
          hint={a.dashboard.openDrawsNote}
          loading={loading}
          accent="ocean"
        />
        {(loading || sales) && (
          <>
            <StatTile
              label={a.dashboard.confirmedOrders}
              value={sales ? num(sales.confirmedOrders) : ""}
              hint={sales ? a.dashboard.pending(sales.pendingPaymentOrders) : undefined}
              loading={loading}
              accent="neutral"
            />
            <StatTile
              label={a.dashboard.confirmedValue}
              value={sales ? money(sales.confirmedValueToman) : ""}
              hint={a.dashboard.confirmedValueNote}
              loading={loading}
              accent="gold"
            />
          </>
        )}
      </div>

      {sales && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-3">
          <StatTile
            label={a.dashboard.tickets}
            value={num(sales.confirmedTickets)}
            hint={a.dashboard.ticketsSplit(sales.fourLeafTickets, sales.sixChanceTickets)}
            accent="neutral"
          />
          <StatTile label={a.dashboard.chances} value={num(sales.sixChanceCombinations)} hint={a.dashboard.chancesNote} accent="ocean" />
          <PurchaserSplit sales={sales} />
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <AdminCard title={a.dashboard.nextDraws}>
          {loading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.games.map((g) => (
                <li key={g.id} className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${g.gameType === "SIX_CHANCE" ? "bg-ocean-700" : "bg-brand-700"}`}>
                    <GameIcon gameType={g.gameType} size={32} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-bold">
                      {gameLabel(g, locale)}
                      <Pill tone={g.status === "ACTIVE" ? "success" : "neutral"}>{a.status.game[g.status] ?? g.status}</Pill>
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {a.dashboard.activeRule}{" "}
                      <span className="font-semibold text-ink-soft">
                        {g.activeRuleVersionNumber ? a.common.version(g.activeRuleVersionNumber) : a.common.none}
                      </span>
                      {sep}
                      {a.dashboard.price}{" "}
                      <span className="tabular font-semibold text-ink-soft">
                        {g.activeTicketPriceToman ? money(g.activeTicketPriceToman) : a.common.none}
                      </span>
                    </p>
                  </div>
                  {g.nextDraw ? (
                    <div className="text-sm sm:text-end">
                      <p className="flex flex-wrap items-center gap-1.5 font-semibold sm:justify-end">
                        #{g.nextDraw.drawNumber}
                        <Pill tone="neutral">{a.common.version(g.nextDraw.ruleVersionNumber)}</Pill>
                        <DrawAvailabilityPill status="SALES_OPEN" salesState={g.nextDraw.salesState} />
                      </p>
                      {g.nextDraw.salesState === "UPCOMING" ? (
                        <p className="mt-0.5 text-xs text-muted">
                          {a.dashboard.opensAt}: <span className="font-semibold text-ink-soft">{dateTime(g.nextDraw.salesOpensAt)}</span>
                        </p>
                      ) : (
                        <p className="mt-0.5 text-xs text-muted">
                          {a.dashboard.salesClose}: <span className="text-ink-soft">{dateTime(g.nextDraw.salesClosesAt)}</span>
                        </p>
                      )}
                      <p className="text-xs text-muted">
                        {a.dashboard.drawTime}: <span className="text-ink-soft">{dateTime(g.nextDraw.drawAt)}</span>
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted">{a.dashboard.noNextDraw}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </AdminCard>

        {(loading || sales) && (
          <AdminCard title={a.dashboard.trend}>
            {loading || !sales ? <Skeleton className="h-44" /> : <TrendChart trend={sales.trend} />}
          </AdminCard>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
        {data?.recentOrders && (
          <AdminCard
            title={a.dashboard.recentOrders}
            bodyClassName=""
            action={
              <Link href="/admin/orders" className="flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                {a.dashboard.viewAll}
                <ArrowIcon className="h-3.5 w-3.5" />
              </Link>
            }
          >
            {data.recentOrders.length === 0 ? (
              <EmptyState message={a.dashboard.noOrders} />
            ) : (
              <TableWrap>
                <table className="w-full min-w-[34rem]">
                  <thead className="border-b border-border bg-surface-muted">
                    <tr>
                      <th className={th}>{a.orders.order}</th>
                      <th className={th}>{a.orders.customer}</th>
                      <th className={th}>{a.orders.total}</th>
                      <th className={th}>{a.orders.status}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.recentOrders.map((o) => (
                      <tr key={o.id} className="hover:bg-surface-muted">
                        <td className={td}>
                          <Link href={`/admin/orders?order=${o.id}`} className="font-mono text-xs font-bold text-brand hover:underline" dir="ltr">
                            {o.orderNumber}
                          </Link>
                          <p className="text-xs text-muted">{dateTime(o.createdAt)}</p>
                        </td>
                        <td className={td}>
                          <CustomerCell customer={o.customer} />
                        </td>
                        <td className={`${td} tabular font-semibold`}>{money(o.totalToman)}</td>
                        <td className={td}>
                          <StatusBadge kind="order" value={o.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </AdminCard>
        )}

        {data?.recentAudit && (
          <AdminCard
            title={a.dashboard.recentActivity}
            action={
              <Link href="/admin/audit" className="flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                {a.dashboard.viewAll}
                <ArrowIcon className="h-3.5 w-3.5" />
              </Link>
            }
          >
            {data.recentAudit.length === 0 ? (
              <EmptyState message={a.dashboard.noActivity} />
            ) : (
              <ol className="flex flex-col">
                {data.recentAudit.map((e) => (
                  <li key={e.id} className="flex gap-3 border-b border-border py-2.5 last:border-0">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs font-semibold text-foreground" dir="ltr">
                        {e.action}
                      </p>
                      <p className="truncate text-xs text-muted">
                        <AuditActor actor={e.actor} />
                        {sep}
                        {dateTime(e.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </AdminCard>
        )}
      </div>

      {data && (
        <p className="text-xs text-muted">
          {a.dashboard.updated}: {dateTime(data.generatedAt)}
          {sep}
          {a.common.tehranTime}
        </p>
      )}
    </>
  );
}

function PurchaserSplit({ sales }: { sales: NonNullable<AdminDashboard["sales"]> }) {
  const { a, num, money, sep } = useAdminI18n();
  const total = sales.guest.orders + sales.registered.orders;
  const guestPct = total === 0 ? 0 : Math.round((sales.guest.orders / total) * 100);
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-xs">
      <p className="text-xs font-semibold text-muted">{a.dashboard.purchasers}</p>
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-background-subtle" role="img" aria-label={`${a.dashboard.guest} ${guestPct}% · ${a.dashboard.registered} ${100 - guestPct}%`}>
        {total > 0 && (
          <>
            <span className="h-full bg-gold" style={{ width: `${guestPct}%` }} />
            <span className="h-full border-s-2 border-surface bg-brand" style={{ width: `${100 - guestPct}%` }} />
          </>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="flex items-center gap-1.5 text-muted">
            <span className="h-2 w-2 rounded-sm bg-gold" aria-hidden="true" />
            {a.dashboard.guest}
          </dt>
          <dd className="tabular mt-0.5 font-bold text-foreground">
            {num(sales.guest.orders)}{sep}{money(sales.guest.valueToman)}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-muted">
            <span className="h-2 w-2 rounded-sm bg-brand" aria-hidden="true" />
            {a.dashboard.registered}
          </dt>
          <dd className="tabular mt-0.5 font-bold text-foreground">
            {num(sales.registered.orders)}{sep}{money(sales.registered.valueToman)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Confirmed orders per Tehran day (14 days). One series, one hue, one axis; hover/focus a
 * bar for orders, tickets and value. A visually hidden table carries the same data. */
function TrendChart({ trend }: { trend: NonNullable<AdminDashboard["sales"]>["trend"] }) {
  const { a, num, money, locale, sep } = useAdminI18n();
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...trend.map((d) => d.orders));
  const hasData = trend.some((d) => d.orders > 0);
  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
      new Date(`${day}T00:00:00Z`),
    );

  if (!hasData) return <EmptyState message={a.dashboard.trendEmpty} />;

  const shown = active ?? trend.length - 1;
  const point = trend[shown];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm" aria-live="polite">
        <span className="font-semibold text-foreground">{dayLabel(point.day)}</span>
        <span className="tabular text-muted">
          <span className="font-bold text-foreground">{num(point.orders)}</span> {a.dashboard.trendOrders}
          {sep}
          <span className="font-bold text-foreground">{num(point.tickets)}</span> {a.dashboard.trendTickets}
          {sep}
          {money(point.valueToman)}
        </span>
      </div>
      <div className="relative flex h-36 items-end gap-[2px] border-b border-border" onMouseLeave={() => setActive(null)}>
        {trend.map((d, i) => {
          const h = d.orders === 0 ? 0 : Math.max(4, Math.round((d.orders / max) * 100));
          return (
            <button
              key={d.day}
              type="button"
              className="group relative flex h-full flex-1 items-end justify-center focus-visible:outline-2 focus-visible:outline-offset-2"
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              aria-label={`${dayLabel(d.day)}: ${num(d.orders)} ${a.dashboard.trendOrders}, ${num(d.tickets)} ${a.dashboard.trendTickets}`}
            >
              <span
                className={`block w-full max-w-7 rounded-t-[4px] transition-colors ${i === shown ? "bg-brand" : "bg-brand-300 group-hover:bg-brand-500"}`}
                style={{ height: `${h}%` }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[0.68rem] text-muted" aria-hidden="true">
        <span>{dayLabel(trend[0].day)}</span>
        <span>{dayLabel(trend[trend.length - 1].day)}</span>
      </div>
      <table className="sr-only">
        <caption>{a.dashboard.trend}</caption>
        <thead>
          <tr>
            <th>{a.dashboard.day}</th>
            <th>{a.dashboard.trendOrders}</th>
            <th>{a.dashboard.trendTickets}</th>
          </tr>
        </thead>
        <tbody>
          {trend.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>{d.orders}</td>
              <td>{d.tickets}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
