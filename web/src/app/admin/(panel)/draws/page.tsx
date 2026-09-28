"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/admin/auth-context";
import { useAdminI18n } from "@/lib/admin/i18n";
import { adminApi } from "@/lib/admin/api";
import type { AdminDrawListItem, AdminGame, DrawWarning, GameReminders, ManualDrawResult, Paged, ScheduledOccurrence } from "@/lib/admin/types";
import { saveBlockers, validateDrawTimes } from "@/lib/admin/draw-validation";
import { formatSlotTime, fromTehranInput, tehranInputFromNow, toTehranInput } from "@/lib/admin/tehran-time";
import { useBreadcrumbs } from "@/components/admin/AdminShell";
import {
  AdminCard,
  AdminPageHeader,
  Callout,
  EmptyState,
  ErrorState,
  Field,
  Forbidden,
  Modal,
  Pagination,
  Pill,
  TableSkeleton,
  TableWrap,
  inputSm,
  td,
  th,
  useToast,
} from "@/components/admin/ui";
import { DrawAvailabilityPill, gameLabel } from "@/components/admin/cells";
import { DrawWarnings, ReasonField, SaveBlockers, TimeFields } from "@/components/admin/DrawWorkspace";
import { ErrorMessage } from "@/components/StatusMessage";

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
  const { can, run, me } = useAdminAuth();
  const { a, t, locale, dateTime, errorText } = useAdminI18n();
  const toast = useToast();
  const router = useRouter();
  const isSuper = me?.roles.includes("SUPER_ADMIN") ?? false;
  const [games, setGames] = useState<AdminGame[]>([]);
  const [filters, setFilters] = useState({ gameId: "", state: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<AdminDrawListItem> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  const [createFrom, setCreateFrom] = useState({ gameId: "", occurrence: "", replace: false });
  useBreadcrumbs([{ label: a.nav.draws }]);

  // The dashboard reminder links here with ?create=<gameId> to open the same prefilled form.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("create");
    if (!requested) return;
    void Promise.resolve().then(() => {
      setCreateFrom({ gameId: requested, occurrence: params.get("occurrence") ?? "", replace: params.get("mode") === "replace" });
      setCreating(true);
      router.replace("/admin/draws");
    });
  }, [router]);

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
    <div className="flex flex-col gap-4">
      <AdminPageHeader
        title={a.draws.title}
        subtitle={a.draws.subtitle}
        actions={
          can("draws.create") && (
            <div className="flex flex-wrap items-center gap-2">
              {isSuper && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
                  + {a.workflow.createDraw}
                </button>
              )}
            </div>
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
              <table className="w-full min-w-[48rem]">
                <thead className="border-b border-border bg-surface-muted">
                  <tr>
                    <th className={th}>{a.draws.drawNo}</th>
                    <th className={th}>{a.draws.game}</th>
                    <th className={th}>{a.draws.status}</th>
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
                      onClick={() => router.push(`/admin/draws/${d.id}`)}
                    >
                      <td className={td}>
                        <Link href={`/admin/draws/${d.id}`} className="font-bold text-brand hover:underline" onClick={(e) => e.stopPropagation()}>
                          #{d.drawNumber}
                        </Link>
                        {d.isNextForGame && (
                          <span className="ms-2">
                            <Pill tone="gold">{a.draws.next}</Pill>
                          </span>
                        )}
                      </td>
                      <td className={`${td} font-semibold`}>{gameLabel(d.game, locale)}</td>
                      <td className={td}>
                        <DrawAvailabilityPill status={d.status} salesState={d.salesState} />
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

      {creating && isSuper && games.length > 0 && (
        <CreateDrawModal
          games={games}
          initialGameId={createFrom.gameId || filters.gameId}
          initialOccurrenceKey={createFrom.occurrence}
          initialReplace={createFrom.replace}
          onClose={() => {
            setCreating(false);
            setCreateFrom({ gameId: "", occurrence: "", replace: false });
          }}
          onCreated={(res) => {
            setCreating(false);
            toast("success", a.workflow.created(res.drawNumber));
            if (res.draw) router.push(`/admin/draws/${res.draw.id}`);
            else load();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- manual draw

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const asciiDigits = (v: string) => v.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d))).replace(/\D/g, "");

type Kind = "SCHEDULED" | "SPECIAL";
type Times = { open: string; close: string; draw: string };

const occurrenceTimes = (o: ScheduledOccurrence): Times => ({ open: toTehranInput(o.salesOpensAt), close: toTehranInput(o.salesClosesAt), draw: toTehranInput(o.drawAt) });
/** A replacement keeps the occurrence's durations but starts selling now. */
function replacementTimes(o: ScheduledOccurrence): Times {
  const now = Math.ceil(Date.now() / 60_000) * 60_000;
  const sell = Date.parse(o.salesClosesAt) - Date.parse(o.salesOpensAt);
  const gap = Date.parse(o.drawAt) - Date.parse(o.salesClosesAt);
  const iso = (ms: number) => toTehranInput(new Date(ms).toISOString());
  return { open: iso(now), close: iso(now + sell), draw: iso(now + sell + gap) };
}

/**
 * "Create draw" — the ONLY way a draw is inserted. Prefilled from the game's next scheduled
 * occurrence (or the one chosen from a reminder). Loading reminders and the live checks are
 * read-only. A special draw claims no occurrence unless the SUPER_ADMIN explicitly marks it
 * as replacing one.
 */
function CreateDrawModal({
  games,
  initialGameId,
  initialOccurrenceKey,
  initialReplace,
  onClose,
  onCreated,
}: {
  games: AdminGame[];
  initialGameId: string;
  initialOccurrenceKey: string;
  initialReplace: boolean;
  onClose: () => void;
  onCreated: (res: ManualDrawResult) => void;
}) {
  const { run } = useAdminAuth();
  const { a, locale, money, dateTime, errorText } = useAdminI18n();
  const w = a.workflow;
  const [gameId, setGameId] = useState(initialGameId || games[0]?.id || "");
  const [reloadKey, setReloadKey] = useState(0);
  const requestKey = `${gameId}#${reloadKey}`;
  const [loaded, setLoaded] = useState<{ key: string; data: GameReminders | null; error: unknown } | null>(null);
  const loading = loaded?.key !== requestKey;
  const rem = loading ? null : (loaded?.data ?? null);
  const [kind, setKind] = useState<Kind>("SCHEDULED");
  const [occKey, setOccKey] = useState("");
  const [replaces, setReplaces] = useState(false);
  const [times, setTimes] = useState<Times>({ open: "", close: "", draw: "" });
  const [jackpot, setJackpot] = useState("");
  const [touched, setTouched] = useState(false);
  const [reason, setReason] = useState("");
  const [check, setCheck] = useState<ManualDrawResult | null>(null);
  const [warnings, setWarnings] = useState<DrawWarning[]>([]);
  const [checking, setChecking] = useState(false);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const firstLoad = useRef(true);
  const game = games.find((g) => g.id === gameId);
  const isSix = game?.gameType === "SIX_CHANCE";

  // Reminders for the selected game (read-only) → prefill everything.
  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    run((token) => adminApi.gameReminders(token, gameId))
      .then((r) => {
        if (cancelled) return;
        const wanted = firstLoad.current ? r.occurrences.find((o) => o.key === initialOccurrenceKey) : undefined;
        const replace = firstLoad.current && initialReplace && wanted !== undefined;
        firstLoad.current = false;
        const chosen = wanted ?? r.next ?? null;
        if (chosen) {
          setKind(replace ? "SPECIAL" : "SCHEDULED");
          setReplaces(replace);
          setOccKey(chosen.key);
          setTimes(replace ? replacementTimes(chosen) : occurrenceTimes(chosen));
        } else {
          setKind("SPECIAL");
          setReplaces(false);
          setOccKey("");
          setTimes({ open: tehranInputFromNow(0), close: tehranInputFromNow(24), draw: tehranInputFromNow(25) });
        }
        setJackpot(r.suggestedJackpotToman ?? "");
        setTouched(false);
        setLoaded({ key: requestKey, data: r, error: null });
      })
      .catch((e) => {
        if (cancelled) return;
        setTimes({ open: tehranInputFromNow(0), close: tehranInputFromNow(24), draw: tehranInputFromNow(25) });
        setKind("SPECIAL");
        setLoaded({ key: requestKey, data: null, error: e });
      });
    return () => {
      cancelled = true;
    };
  }, [run, gameId, requestKey, initialOccurrenceKey, initialReplace]);

  const occurrences = rem?.occurrences ?? [];
  const occ = occurrences.find((o) => o.key === occKey) ?? null;
  const claimOcc = kind === "SCHEDULED" ? occ : replaces ? occ : null;
  const iso = { open: fromTehranInput(times.open), close: fromTehranInput(times.close), draw: fromTehranInput(times.draw) };
  const timeIssues = loading ? [] : validateDrawTimes(iso);
  const jackpotValid = !isSix || /^[1-9]\d{0,17}$/.test(jackpot);
  const occurrenceBody = claimOcc ? { slotId: claimOcc.slotId, localDate: claimOcc.localDate, claim: (kind === "SCHEDULED" ? "SCHEDULED" : "REPLACEMENT") as "SCHEDULED" | "REPLACEMENT" } : undefined;
  const body = {
    salesOpensAt: iso.open ?? "",
    salesClosesAt: iso.close ?? "",
    drawAt: iso.draw ?? "",
    ...(rem ? { ruleVersionId: rem.ruleVersion.id } : {}),
    ...(occurrenceBody ? { occurrence: occurrenceBody } : {}),
  };
  const bodyKey = JSON.stringify(body);

  // Live check (a dry run: nothing is written).
  useEffect(() => {
    if (loading || !gameId || timeIssues.length > 0) return;
    const timer = setTimeout(() => {
      setChecking(true);
      run((token) => adminApi.createDraw(token, gameId, { ...JSON.parse(bodyKey), dryRun: true }))
        .then((res) => {
          setCheck(res);
          setWarnings(res.warnings);
          setErr(null);
        })
        .catch((e) => {
          setCheck(null);
          setWarnings([]);
          setErr(e);
          if (e instanceof ApiError && e.code === "SETTINGS_CHANGED") setReloadKey((k) => k + 1);
        })
        .finally(() => setChecking(false));
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, loading, gameId, bodyKey]);

  const reasonRequired = warnings.length > 0;
  const blockers = saveBlockers({ timeIssues, reason, reasonRequired, checking });
  const valid = !loading && blockers.length === 0 && jackpotValid && check !== null;

  async function submit() {
    setWorking(true);
    setErr(null);
    try {
      const res = await run((token) =>
        adminApi.createDraw(token, gameId, {
          ...body,
          ...(isSix && jackpot ? { openingJackpotToman: jackpot } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      );
      onCreated(res);
    } catch (e) {
      if (e instanceof ApiError && e.code === "REASON_REQUIRED") {
        const d = e.details as { warnings?: DrawWarning[] } | undefined;
        if (d?.warnings) setWarnings(d.warnings);
      }
      if (e instanceof ApiError && (e.code === "SETTINGS_CHANGED" || e.code === "OCCURRENCE_TAKEN")) setReloadKey((k) => k + 1);
      setErr(e);
      setWorking(false);
    }
  }

  const slotName = (o: ScheduledOccurrence) => {
    const slotTime = rem?.slots.find((s) => s.slotId === o.slotId)?.drawTime;
    return o.slotLabel ?? (slotTime ? formatSlotTime(slotTime, locale) : o.slotId);
  };
  const occLabel = (o: ScheduledOccurrence) => `${slotName(o)} — ${dateTime(o.drawAt)} (${w.reminders.state[o.state]})`;
  const differs = occ !== null && JSON.stringify(times) !== JSON.stringify(occurrenceTimes(occ));

  return (
    <Modal
      open
      size="lg"
      title={w.createTitle}
      onClose={working ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={working}>
            {a.common.cancel}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!valid || working} aria-describedby="create-blockers" onClick={() => void submit()}>
            {working ? w.creating : w.create}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {loading ? (
          <Callout>{w.loadingSuggestion}</Callout>
        ) : kind === "SCHEDULED" && occ ? (
          <Callout tone={occ.state === "UPCOMING" ? "info" : "warning"}>
            <p>{w.suggestionExplain}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-base font-bold text-foreground">
              {dateTime(occ.drawAt)}
              {occ.state !== "UPCOMING" && <Pill tone="warning">{w.reminders.state[occ.state]}</Pill>}
            </p>
            <p className="mt-0.5 text-xs">
              {w.form.slot}: {slotName(occ)} · {w.form.timezone}: <span dir="ltr">{occ.timezone}</span>
            </p>
            {occ.state === "OVERDUE" && <p className="mt-1 text-xs">{w.form.overdue(dateTime(occ.salesOpensAt))}</p>}
            {occ.state === "MISSED" && <p className="mt-1 text-xs">{w.form.missed}</p>}
          </Callout>
        ) : (
          <Callout tone={loaded?.error ? "warning" : "info"}>
            {loaded?.error ? (loaded.error instanceof ApiError && w.errors[loaded.error.code]) || errorText(loaded.error) : occurrences.length === 0 ? w.form.noOccurrences : w.form.specialHint}
          </Callout>
        )}

        <Field label={w.game} htmlFor="cd-game">
          <select
            id="cd-game"
            className={inputSm}
            value={gameId}
            onChange={(e) => {
              setCheck(null);
              setErr(null);
              setReason("");
              setGameId(e.target.value);
            }}
            data-autofocus
          >
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {gameLabel(g, locale)}
              </option>
            ))}
          </select>
        </Field>

        {!loading && (
          <>
            <fieldset className="flex flex-wrap gap-2" aria-label={w.form.kind}>
              {(["SCHEDULED", "SPECIAL"] as const).map((k) => (
                <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 ${kind === k ? "border-brand bg-brand-50" : "border-border"} ${k === "SCHEDULED" && occurrences.length === 0 ? "opacity-50" : ""}`}>
                  <input
                    type="radio"
                    name="cd-kind"
                    checked={kind === k}
                    disabled={k === "SCHEDULED" && occurrences.length === 0}
                    onChange={() => {
                      setKind(k);
                      setReplaces(false);
                      if (k === "SCHEDULED") {
                        const o = occ ?? rem?.next ?? occurrences[0];
                        if (o) {
                          setOccKey(o.key);
                          setTimes(occurrenceTimes(o));
                        }
                      }
                    }}
                    className="accent-[var(--brand)]"
                  />
                  {k === "SCHEDULED" ? w.form.scheduled : w.form.special}
                </label>
              ))}
            </fieldset>

            {kind === "SPECIAL" && (
              <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <p className="text-xs text-muted">{w.form.specialHint}</p>
                <label className="flex items-center gap-2 font-semibold">
                  <input
                    type="checkbox"
                    checked={replaces}
                    disabled={occurrences.length === 0}
                    onChange={(e) => {
                      setReplaces(e.target.checked);
                      if (e.target.checked && !occKey && occurrences[0]) setOccKey(occurrences[0].key);
                    }}
                    className="h-4 w-4 accent-[var(--brand)]"
                  />
                  {w.form.replaces}
                </label>
                {replaces && <p className="text-xs text-muted">{w.form.replacesHint}</p>}
              </div>
            )}

            {(kind === "SCHEDULED" || replaces) && occurrences.length > 0 && (
              <Field label={w.form.occurrence} htmlFor="cd-occ">
                <select
                  id="cd-occ"
                  className={inputSm}
                  value={occKey}
                  onChange={(e) => {
                    setOccKey(e.target.value);
                    const o = occurrences.find((x) => x.key === e.target.value);
                    if (o && kind === "SCHEDULED") setTimes(occurrenceTimes(o));
                  }}
                >
                  {occurrences.map((o) => (
                    <option key={o.key} value={o.key}>
                      {occLabel(o)}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <TimeFields
              open={times.open}
              close={times.close}
              drawAt={times.draw}
              setOpen={(v) => setTimes((t) => ({ ...t, open: v }))}
              setClose={(v) => setTimes((t) => ({ ...t, close: v }))}
              setDrawAt={(v) => setTimes((t) => ({ ...t, draw: v }))}
              issues={timeIssues}
            />
            {occ && kind === "SCHEDULED" && differs && (
              <button type="button" className="btn btn-ghost btn-sm self-start" onClick={() => setTimes(occurrenceTimes(occ))}>
                ↺ {w.form.restore}
              </button>
            )}
            {isSix && (
              <Field
                label={w.jackpot}
                htmlFor="cd-jackpot"
                error={jackpotValid ? undefined : a.rules.hints.wholeNumber(1)}
                hint={!touched ? w.jackpotCarried : jackpot ? money(jackpot) : undefined}
              >
                <input
                  id="cd-jackpot"
                  className={`${inputSm} tabular`}
                  dir="ltr"
                  inputMode="numeric"
                  value={jackpot}
                  aria-invalid={jackpotValid ? undefined : true}
                  onChange={(e) => {
                    setTouched(true);
                    setJackpot(asciiDigits(e.target.value));
                  }}
                />
              </Field>
            )}
            {rem && <p className="text-xs text-muted">{w.settingsUsed(rem.ruleVersion.versionNumber)}</p>}
            <DrawWarnings warnings={warnings} />
            {(reasonRequired || reason.length > 0) && <ReasonField id="cd-reason" value={reason} onChange={setReason} required={reasonRequired} />}
          </>
        )}
        {err !== null && <ErrorMessage message={(err instanceof ApiError && w.errors[err.code]) || errorText(err)} />}
        <SaveBlockers id="create-blockers" blockers={blockers} />
      </div>
    </Modal>
  );
}
