"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAdminAuth } from "@/lib/admin/auth-context";
import { useAdminI18n } from "@/lib/admin/i18n";
import { adminApi } from "@/lib/admin/api";
import type { AdminDraw, AdminDrawListItem, AdminGame, Paged } from "@/lib/admin/types";
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
  Modal,
  Pagination,
  Pill,
  Skeleton,
  TableSkeleton,
  TableWrap,
  inputSm,
  td,
  th,
  useToast,
} from "@/components/admin/ui";
import { DrawAvailabilityPill, gameLabel } from "@/components/admin/cells";
import { ErrorMessage } from "@/components/StatusMessage";
import { RuleVersionForm } from "@/components/admin/RuleVersionForm";

// Availability filters apply the backend's sales-window rule; a raw SALES_OPEN filter is
// deliberately absent because it would mix saleable draws with ones that haven't opened.
const LIFECYCLE_STATUSES = [
  "DRAW_IN_PROGRESS",
  "RESULT_ENTERED",
  "PENDING_REVIEW",
  "PUBLISHED",
  "SETTLED",
  "CLOSED",
  "DELAYED",
  "CANCELLED",
  "VOID",
];

const PAGE_SIZE = 20;

export default function AdminDrawsPage() {
  const { can, run } = useAdminAuth();
  const { a, t, locale, dateTime, errorText } = useAdminI18n();
  const toast = useToast();
  const [games, setGames] = useState<AdminGame[]>([]);
  const [filters, setFilters] = useState({ gameId: "", state: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<AdminDrawListItem> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  useBreadcrumbs([{ label: a.nav.draws }]);

  useEffect(() => {
    adminApi.listGames().then(setGames).catch(() => setGames([]));
  }, []);

  const load = useCallback(() => {
    setError(null);
    setData(null);
    run((token) => adminApi.listDraws(token, { ...filters, page, pageSize: PAGE_SIZE }))
      .then(setData)
      .catch(setError);
  }, [run, filters, page]);

  useEffect(() => {
    if (can("draws.view")) void Promise.resolve().then(load);
  }, [can, load]);

  if (!can("draws.view")) return <Forbidden />;

  const setFilter = (key: keyof typeof filters, value: string) => {
    setPage(1);
    setFilters((f) => ({ ...f, [key]: value }));
  };
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title={a.draws.title}
        subtitle={a.draws.subtitle}
        actions={
          can("draws.create") && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setGenerating(true)}>
              {a.draws.generate}
            </button>
          )
        }
      />

      <AdminCard bodyClassName="">
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label={a.draws.game} htmlFor="f-game">
            <select id="f-game" className={inputSm} value={filters.gameId} onChange={(e) => setFilter("gameId", e.target.value)}>
              <option value="">{a.draws.allGames}</option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {gameLabel(g, locale)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={a.draws.status} htmlFor="f-status">
            <select id="f-status" className={inputSm} value={filters.state} onChange={(e) => setFilter("state", e.target.value)}>
              <option value="">{a.draws.allStatuses}</option>
              <option value="OPEN">{a.salesState.filterOpen}</option>
              <option value="UPCOMING">{a.salesState.filterUpcoming}</option>
              <option value="OPEN_OR_UPCOMING">{a.salesState.filterOpenOrUpcoming}</option>
              <option value="SALES_CLOSED">{a.salesState.filterClosed}</option>
              <optgroup label={a.draws.lifecycleGroup}>
                {LIFECYCLE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t.status.draw[s] ?? s}
                  </option>
                ))}
              </optgroup>
            </select>
          </Field>
          <Field label={a.draws.from} htmlFor="f-from">
            <input id="f-from" type="date" dir="ltr" className={inputSm} value={filters.from} onChange={(e) => setFilter("from", e.target.value)} />
          </Field>
          <Field label={a.draws.to} htmlFor="f-to">
            <input id="f-to" type="date" dir="ltr" className={inputSm} value={filters.to} onChange={(e) => setFilter("to", e.target.value)} />
          </Field>
          <div className="flex items-end">
            <button
              type="button"
              className="btn btn-ghost btn-sm w-full"
              disabled={!hasFilters}
              onClick={() => {
                setPage(1);
                setFilters({ gameId: "", state: "", from: "", to: "" });
              }}
            >
              {a.common.clear}
            </button>
          </div>
        </div>

        {error !== null ? (
          <ErrorState message={errorText(error)} onRetry={load} />
        ) : data === null ? (
          <TableSkeleton rows={8} cols={6} />
        ) : data.items.length === 0 ? (
          <EmptyState message={a.common.noResults} />
        ) : (
          <>
            <TableWrap>
              <table className="w-full min-w-[60rem]">
                <thead className="border-b border-border bg-surface-muted">
                  <tr>
                    <th className={th}>{a.draws.drawNo}</th>
                    <th className={th}>{a.draws.game}</th>
                    <th className={th}>{a.draws.status}</th>
                    <th className={th}>{a.draws.ruleVersion}</th>
                    <th className={th}>{a.draws.salesOpen}</th>
                    <th className={th}>{a.draws.salesClose}</th>
                    <th className={th}>{a.draws.drawTime}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.items.map((d) => (
                    <tr
                      key={d.id}
                      className={`cursor-pointer ${d.isNextForGame ? "bg-brand-50/60 hover:bg-brand-50" : "hover:bg-surface-muted"}`}
                      onClick={() => setOpenId(d.id)}
                    >
                      <td className={td}>
                        <button type="button" className="font-bold text-brand hover:underline" onClick={() => setOpenId(d.id)}>
                          #{d.drawNumber}
                        </button>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {d.isNextForGame && <Pill tone="gold">{a.draws.next}</Pill>}
                        </div>
                      </td>
                      <td className={`${td} font-semibold`}>{gameLabel(d.game, locale)}</td>
                      <td className={td}>
                        <DrawAvailabilityPill status={d.status} salesState={d.salesState} />
                      </td>
                      <td className={td}>
                        <span className="flex items-center gap-1.5">
                          <Pill tone="neutral">{a.common.version(d.ruleVersionNumber)}</Pill>
                          <span className="text-xs text-muted">{a.common.schema(d.rulesSchemaVersion)}</span>
                        </span>
                      </td>
                      <td className={`${td} text-xs text-ink-soft`}>{dateTime(d.salesOpensAt)}</td>
                      <td className={`${td} text-xs text-ink-soft`}>{dateTime(d.salesClosesAt)}</td>
                      <td className={`${td} text-xs font-semibold`}>{dateTime(d.drawAt)}</td>
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

      {openId && <DrawDetail id={openId} games={games} onClose={() => setOpenId(null)} />}
      {generating && (
        <GenerateModal
          games={games}
          onClose={() => setGenerating(false)}
          onDone={(n) => {
            setGenerating(false);
            toast("success", a.draws.generated(n));
            load();
          }}
        />
      )}
    </div>
  );
}

function DrawDetail({ id, games, onClose }: { id: string; games: AdminGame[]; onClose: () => void }) {
  const { run } = useAdminAuth();
  const { a, locale, money, dateTime, errorText } = useAdminI18n();
  const [draw, setDraw] = useState<AdminDraw | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    run((token) => adminApi.getDraw(token, id)).then(setDraw).catch(setError);
  }, [id, run]);

  const game = draw ? games.find((g) => g.id === draw.gameId) : undefined;

  return (
    <Drawer open title={draw ? a.draws.detailTitle(draw.drawNumber) : a.common.loading} onClose={onClose}>
      {error !== null ? (
        <ErrorState message={errorText(error)} />
      ) : !draw ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <AdminCard>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <Item label={a.draws.game} value={game ? gameLabel(game, locale) : a.common.none} />
              <Item label={a.draws.status} value={<DrawAvailabilityPill status={draw.status} salesState={draw.salesState} />} />
              <Item label={a.draws.lifecycleStatus} value={<span className="font-mono text-xs" dir="ltr">{draw.status}</span>} />
              <Item label={a.draws.salesOpen} value={dateTime(draw.salesOpensAt)} />
              <Item label={a.draws.salesClose} value={dateTime(draw.salesClosesAt)} />
              <Item label={a.draws.drawTime} value={dateTime(draw.drawAt)} />
              <Item label={a.draws.officialTz} value={<span dir="ltr">{draw.officialTimezone}</span>} />
              {draw.openingJackpotToman && <Item label={a.draws.jackpot} value={money(draw.openingJackpotToman)} />}
              <Item
                label={a.draws.ruleVersion}
                value={
                  <span className="font-mono text-xs" dir="ltr">
                    {draw.currentRuleVersionId}
                  </span>
                }
              />
            </dl>
          </AdminCard>
          <div>
            <h3 className="mb-1 text-sm font-bold">{a.draws.snapshot}</h3>
            <Callout>{a.draws.snapshotNote}</Callout>
          </div>
          {game && <RuleVersionForm gameType={game.gameType} rules={draw.currentRulesSnapshot} />}
          <details className="rounded-xl border border-border bg-surface">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-soft">{a.rules.json}</summary>
            <pre className="max-h-80 overflow-auto border-t border-border bg-surface-muted p-4 text-xs" dir="ltr">
              {JSON.stringify(draw.currentRulesSnapshot, null, 2)}
            </pre>
          </details>
          {game && (
            <Link href={`/admin/games/${game.id}`} className="btn btn-secondary btn-sm self-start">
              {a.draws.viewRules}
            </Link>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function GenerateModal({ games, onClose, onDone }: { games: AdminGame[]; onClose: () => void; onDone: (created: number) => void }) {
  const { run } = useAdminAuth();
  const { a, locale, errorText } = useAdminI18n();
  const [gameId, setGameId] = useState(games[0]?.id ?? "");
  const [horizon, setHorizon] = useState("14");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const horizonNum = Number(horizon);
  const valid = gameId !== "" && Number.isInteger(horizonNum) && horizonNum >= 0 && horizonNum <= 90;

  async function submit() {
    setWorking(true);
    setError(null);
    try {
      const created = await run((token) => adminApi.generateDraws(token, gameId, horizonNum));
      onDone(created.length);
    } catch (err) {
      setError(err);
      setWorking(false);
    }
  }

  return (
    <Modal
      open
      title={a.draws.generateTitle}
      onClose={working ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={working}>
            {a.common.cancel}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!valid || working} onClick={submit}>
            {working ? a.draws.generating : a.draws.generate.replace("…", "")}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Callout>{a.draws.generateBody}</Callout>
        <Field label={a.draws.game} htmlFor="gen-game">
          <select id="gen-game" className={inputSm} value={gameId} onChange={(e) => setGameId(e.target.value)} data-autofocus>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {gameLabel(g, locale)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={a.draws.horizon} htmlFor="gen-horizon" hint={a.draws.horizonHint} error={valid || horizon === "" ? undefined : a.rules.hints.wholeNumber(0, 90)}>
          <input id="gen-horizon" inputMode="numeric" dir="ltr" className={inputSm} value={horizon} onChange={(e) => setHorizon(e.target.value.replace(/\D/g, ""))} />
        </Field>
        {error !== null && <ErrorMessage message={errorText(error)} />}
      </div>
    </Modal>
  );
}
