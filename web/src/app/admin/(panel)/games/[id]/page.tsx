"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/admin/auth-context";
import { useAdminI18n } from "@/lib/admin/i18n";
import { adminApi } from "@/lib/admin/api";
import type { AdminDrawListItem, AdminGame, RuleVersion } from "@/lib/admin/types";
import { useBreadcrumbs } from "@/components/admin/AdminShell";
import {
  AdminCard,
  AdminPageHeader,
  Callout,
  ErrorState,
  Field,
  Forbidden,
  Modal,
  Pill,
  Skeleton,
  TableWrap,
  td,
  th,
  useToast,
} from "@/components/admin/ui";
import { DrawAvailabilityPill, GameStatusPill, RuleStatusPill, gameLabel } from "@/components/admin/cells";
import { EditGameModal } from "@/components/admin/EditGameModal";
import { RuleVersionForm, validateRules } from "@/components/admin/RuleVersionForm";
import { GameIcon } from "@/components/brand";
import { ErrorMessage } from "@/components/StatusMessage";
import { BackIcon, PlusIcon } from "@/components/icons";

export default function AdminGameDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can, run } = useAdminAuth();
  const { a, locale, money, dateTime, errorText } = useAdminI18n();
  const toast = useToast();

  const [game, setGame] = useState<AdminGame | null>(null);
  const [versions, setVersions] = useState<RuleVersion[] | null>(null);
  const [upcoming, setUpcoming] = useState<AdminDrawListItem[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftRules, setDraftRules] = useState<Record<string, unknown> | null>(null);
  const [draftReason, setDraftReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [editingGame, setEditingGame] = useState(false);
  const [activating, setActivating] = useState(false);

  useBreadcrumbs([
    { label: a.nav.games, href: "/admin/games" },
    { label: game ? gameLabel(game, locale) : a.common.loading },
  ]);

  const load = useCallback(
    async (focusId?: string) => {
      setError(null);
      try {
        const [g, vs] = await Promise.all([
          run((token) => adminApi.getGame(token, id)),
          run((token) => adminApi.listRuleVersions(token, id)),
        ]);
        setGame(g);
        setVersions(vs);
        const draft = vs.find((v) => v.status === "DRAFT");
        const active = vs.find((v) => v.status === "ACTIVE");
        const target = vs.find((v) => v.id === focusId) ?? draft ?? active ?? vs[0] ?? null;
        setSelectedId(target?.id ?? null);
        setDraftRules(target?.status === "DRAFT" ? target.rules : null);
        setDraftReason(target?.status === "DRAFT" ? target.changeReason : "");
      } catch (err) {
        setError(err);
      }
      if (can("draws.view")) {
        run((token) => adminApi.listDraws(token, { gameId: id, state: "OPEN_OR_UPCOMING", pageSize: 3 }))
          .then((res) => setUpcoming(res.items))
          .catch(() => setUpcoming([]));
      }
    },
    [id, run, can],
  );

  useEffect(() => {
    if (can("games.view")) void Promise.resolve().then(() => load());
  }, [can, load]);

  const selected = useMemo(() => versions?.find((v) => v.id === selectedId) ?? null, [versions, selectedId]);
  const active = versions?.find((v) => v.status === "ACTIVE") ?? null;
  const existingDraft = versions?.find((v) => v.status === "DRAFT") ?? null;
  const editable = selected?.status === "DRAFT" && can("games.edit");
  const dirty =
    selected?.status === "DRAFT" &&
    draftRules !== null &&
    (JSON.stringify(draftRules) !== JSON.stringify(selected.rules) || draftReason !== selected.changeReason);
  const formErrors = game && draftRules ? validateRules(game.gameType, draftRules, a) : {};
  const formValid = Object.keys(formErrors).length === 0 && draftReason.trim().length > 0;

  if (!can("games.view")) return <Forbidden />;

  if (error !== null) {
    return (
      <AdminCard>
        <ErrorState message={error instanceof ApiError && error.status === 404 ? a.common.noResults : errorText(error)} onRetry={() => void load()} />
      </AdminCard>
    );
  }

  if (!game || !versions) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-48" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  function selectVersion(v: RuleVersion) {
    setSelectedId(v.id);
    setActionError(null);
    setDraftRules(v.status === "DRAFT" ? v.rules : null);
    setDraftReason(v.status === "DRAFT" ? v.changeReason : "");
  }

  async function createDraft() {
    if (!active) return;
    setBusy(true);
    setActionError(null);
    try {
      const created = await run((token) =>
        adminApi.createRuleVersion(token, id, { rules: active.rules, changeReason: `Draft cloned from v${active.versionNumber}` }),
      );
      toast("success", a.rules.draftCreated(created.versionNumber));
      await load(created.id);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(): Promise<boolean> {
    if (!selected || !draftRules) return false;
    setBusy(true);
    setActionError(null);
    try {
      const saved = await run((token) =>
        adminApi.updateRuleVersion(token, selected.id, { rules: draftRules, changeReason: draftReason.trim() }),
      );
      setVersions((vs) => vs?.map((v) => (v.id === saved.id ? saved : v)) ?? null);
      setDraftRules(saved.rules);
      setDraftReason(saved.changeReason);
      return true;
    } catch (err) {
      setActionError(err);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link href="/admin/games" className="flex w-fit items-center gap-1.5 text-sm font-semibold text-muted hover:text-foreground">
          <BackIcon className="h-4 w-4" />
          {a.rules.back}
        </Link>
        <AdminPageHeader
          title={gameLabel(game, locale)}
          subtitle={`${locale === "fa" ? game.nameEn : game.nameFa} · ${game.code}`}
          actions={
            <>
              <GameStatusPill status={game.status} />
              {can("games.edit") && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingGame(true)}>
                  {a.games.edit}
                </button>
              )}
            </>
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <AdminCard title={a.rules.activeRules} className="lg:col-span-2">
          {active ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${game.gameType === "SIX_CHANCE" ? "bg-ocean-700" : "bg-brand-700"}`}>
                <GameIcon gameType={game.gameType} size={36} />
              </span>
              <Stat label={a.rules.version} value={<Pill tone="success">{a.common.version(active.versionNumber)}</Pill>} />
              <Stat label={a.games.price} value={money(Number(active.rules.ticket_price_toman))} />
              <Stat label={a.rules.activatedAt} value={active.activatedAt ? dateTime(active.activatedAt) : a.common.none} />
              <Stat label={a.common.schema(Number(active.rules.schema_version ?? 1))} value="" />
            </div>
          ) : (
            <p className="text-sm text-muted">{a.rules.noActive}</p>
          )}
        </AdminCard>
        <AdminCard title={a.games.nextDraw}>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted">{a.dashboard.noNextDraw}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {upcoming.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-semibold">
                    #{d.drawNumber}
                    <Pill tone="neutral">{a.common.version(d.ruleVersionNumber)}</Pill>
                    <DrawAvailabilityPill status={d.status} salesState={d.salesState} />
                    {d.isNextForGame && <Pill tone="gold">{a.draws.next}</Pill>}
                  </span>
                  <span className="text-xs text-muted">{dateTime(d.drawAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>
      </div>

      <Callout>{a.rules.snapshotNote}</Callout>

      <AdminCard
        title={a.rules.history}
        bodyClassName=""
        action={
          can("games.edit") && (
            <button type="button" className="btn btn-primary btn-sm" onClick={createDraft} disabled={busy || !active || existingDraft !== null} title={existingDraft ? a.rules.draftExists : undefined}>
              <PlusIcon className="h-4 w-4" />
              {a.rules.newDraft}
            </button>
          )
        }
      >
        {existingDraft && can("games.edit") && (
          <p className="border-b border-border bg-warning-bg px-4 py-2 text-xs text-warning">{a.rules.draftExists}</p>
        )}
        <TableWrap>
          <table className="w-full min-w-[48rem]">
            <thead className="border-b border-border bg-surface-muted">
              <tr>
                <th className={th}>{a.rules.version}</th>
                <th className={th}>{a.games.status}</th>
                <th className={th}>{a.games.price}</th>
                <th className={th}>{a.rules.created}</th>
                <th className={th}>{a.rules.activatedAt}</th>
                <th className={th}>{a.rules.retired}</th>
                <th className={th}>{a.rules.reason}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {versions.map((v) => (
                <tr
                  key={v.id}
                  className={`cursor-pointer ${v.id === selectedId ? "bg-brand-50/70" : "hover:bg-surface-muted"}`}
                  onClick={() => selectVersion(v)}
                >
                  <td className={td}>
                    <button type="button" className="font-bold text-brand hover:underline" onClick={() => selectVersion(v)} aria-pressed={v.id === selectedId}>
                      {a.common.version(v.versionNumber)}
                    </button>
                  </td>
                  <td className={td}>
                    <RuleStatusPill status={v.status} />
                  </td>
                  <td className={`${td} tabular`}>{money(Number(v.rules.ticket_price_toman))}</td>
                  <td className={`${td} text-xs text-muted`}>{dateTime(v.createdAt)}</td>
                  <td className={`${td} text-xs text-muted`}>{v.activatedAt ? dateTime(v.activatedAt) : a.common.none}</td>
                  <td className={`${td} text-xs text-muted`}>{v.retiredAt ? dateTime(v.retiredAt) : a.common.none}</td>
                  <td className={`${td} max-w-xs truncate text-xs`} title={v.changeReason}>
                    {v.changeReason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </AdminCard>

      {selected && (
        <section className="flex flex-col gap-4" aria-labelledby="rule-editor-title">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="rule-editor-title" className="text-lg font-extrabold">
                {editable ? a.rules.editing(selected.versionNumber) : a.rules.viewing(selected.versionNumber)}
              </h2>
              <RuleStatusPill status={selected.status} />
              {dirty && <Pill tone="warning">{a.rules.unsaved}</Pill>}
            </div>
            {selected.status === "DRAFT" && (
              <div className="flex flex-wrap gap-2">
                {editable && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!dirty || !formValid || busy}
                    onClick={async () => {
                      if (await saveDraft()) toast("success", a.rules.draftSaved);
                    }}
                  >
                    {busy ? a.common.saving : a.rules.saveDraft}
                  </button>
                )}
                {can("games.activate_rule_version") && (
                  <button type="button" className="btn btn-primary btn-sm" disabled={!formValid || busy} onClick={() => setActivating(true)}>
                    {a.rules.activate}
                  </button>
                )}
              </div>
            )}
          </div>

          {!editable && <Callout>{a.rules.readOnly}</Callout>}
          {actionError !== null && <ErrorMessage message={errorText(actionError)} />}

          {editable && (
            <AdminCard>
              <Field label={a.rules.reason} htmlFor="draft-reason" error={draftReason.trim() ? undefined : a.rules.hints.reason}>
                <input id="draft-reason" className="input min-h-10 py-1.5 text-sm" value={draftReason} onChange={(e) => setDraftReason(e.target.value)} />
              </Field>
            </AdminCard>
          )}

          <RuleVersionForm
            gameType={game.gameType}
            rules={editable && draftRules ? draftRules : selected.rules}
            onChange={editable ? setDraftRules : undefined}
          />

          <details className="rounded-xl border border-border bg-surface shadow-xs">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-soft">{a.rules.json}</summary>
            <pre className="max-h-96 overflow-auto border-t border-border bg-surface-muted p-4 text-xs leading-relaxed" dir="ltr">
              {JSON.stringify(editable && draftRules ? draftRules : selected.rules, null, 2)}
            </pre>
          </details>
        </section>
      )}

      {editingGame && (
        <EditGameModal
          game={game}
          onClose={() => setEditingGame(false)}
          onSaved={() => {
            setEditingGame(false);
            toast("success", a.games.saved);
            void load(selectedId ?? undefined);
          }}
        />
      )}

      {activating && selected && (
        <ActivateModal
          versionNumber={selected.versionNumber}
          initialReason={draftReason}
          onClose={() => setActivating(false)}
          onConfirm={async (reason) => {
            setDraftReason(reason);
            // Persist edits and the audit reason on the draft first, then activate it.
            if (draftRules) {
              setBusy(true);
              try {
                await run((token) => adminApi.updateRuleVersion(token, selected.id, { rules: draftRules, changeReason: reason }));
                const activated = await run((token) => adminApi.activateRuleVersion(token, selected.id));
                setActivating(false);
                toast("success", a.rules.activated(activated.versionNumber));
                await load(activated.id);
              } finally {
                setBusy(false);
              }
            }
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      {value !== "" && <div className="tabular mt-0.5 text-sm font-bold text-foreground">{value}</div>}
    </div>
  );
}

function ActivateModal({
  versionNumber,
  initialReason,
  onClose,
  onConfirm,
}: {
  versionNumber: number;
  initialReason: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const { a, errorText } = useAdminI18n();
  const [reason, setReason] = useState(initialReason);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal
      open
      title={a.rules.activateTitle(versionNumber)}
      onClose={working ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={working}>
            {a.common.cancel}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={working || reason.trim().length === 0}
            onClick={async () => {
              setWorking(true);
              setError(null);
              try {
                await onConfirm(reason.trim());
              } catch (err) {
                setError(err);
                setWorking(false);
              }
            }}
          >
            {working ? a.rules.activating : a.rules.confirmActivate}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Callout tone="warning">{a.rules.activateBody}</Callout>
        <Field label={a.rules.activateReason} htmlFor="activate-reason" hint={a.rules.reasonHint}>
          <textarea id="activate-reason" className="input min-h-20 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />
        </Field>
        {error !== null && <ErrorMessage message={errorText(error)} />}
      </div>
    </Modal>
  );
}
