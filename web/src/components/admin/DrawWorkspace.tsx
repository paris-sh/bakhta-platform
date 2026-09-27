"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/admin/auth-context";
import { useAdminI18n } from "@/lib/admin/i18n";
import { adminApi } from "@/lib/admin/api";
import type { AdminAuditItem, AdminDraw, DraftInput, DrawWarning, ResultDetail, ResultPreview } from "@/lib/admin/types";
import { fromTehranInput, toTehranInput } from "@/lib/admin/tehran-time";
import { MIN_REASON_LENGTH, reasonState, saveBlockers, validateDrawTimes, type TimeField, type TimeIssue } from "@/lib/admin/draw-validation";
import { symbolsInRange } from "@/lib/chance-symbols";
import { youtubeVideoId } from "@/lib/youtube";
import { useBreadcrumbs } from "@/components/admin/AdminShell";
import {
  AdminCard,
  Callout,
  ErrorState,
  Field,
  Forbidden,
  Modal,
  Pill,
  Skeleton,
  inputSm,
  useToast,
} from "@/components/admin/ui";
import { DrawAvailabilityPill, gameLabel } from "@/components/admin/cells";
import { CalculationSummary, IssueList, WinnersTable, WinningValueView } from "@/components/admin/results";
import { RuleVersionForm } from "@/components/admin/RuleVersionForm";
import { ChanceSymbolPicker } from "@/components/ChanceSymbol";
import { ErrorMessage } from "@/components/StatusMessage";

/**
 * One page per draw: edit the draw, enter/preview/publish its result, the advertised jackpot,
 * the YouTube link and the history. The main action (enter → check → publish) stays on top.
 */
export function DrawWorkspace({ drawId }: { drawId: string }) {
  const { can, run, me } = useAdminAuth();
  const { a, locale, dateTime, errorText } = useAdminI18n();
  const toast = useToast();
  const w = a.workflow;
  const [detail, setDetail] = useState<ResultDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [preview, setPreview] = useState<ResultPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [drawInfo, setDrawInfo] = useState<AdminDraw | null>(null);
  const isSuper = me?.roles.includes("SUPER_ADMIN") ?? false;

  const game = detail ? gameLabel(detail.draw.game, locale) : "";
  useBreadcrumbs([
    { label: a.nav.draws, href: "/admin/draws" },
    { label: detail ? a.results.detailTitle(game, detail.draw.drawNumber) : "…" },
  ]);

  const load = useCallback(() => {
    setError(null);
    setHistoryKey((k) => k + 1);
    run((token) => adminApi.getDraw(token, drawId))
      .then(setDrawInfo)
      .catch(() => setDrawInfo(null));
    return run((token) => adminApi.getResult(token, drawId))
      .then(setDetail)
      .catch(setError);
  }, [run, drawId]);

  const runPreview = useCallback(() => {
    setPreviewing(true);
    setPreviewError(null);
    return run((token) => adminApi.previewResult(token, drawId))
      .then(setPreview)
      .catch((err) => {
        setPreview(null);
        setPreviewError(err);
      })
      .finally(() => setPreviewing(false));
  }, [run, drawId]);

  useEffect(() => {
    if (!can("results.view")) return;
    void Promise.resolve().then(async () => {
      await load();
    });
  }, [can, load]);

  // Show the calculation for an existing draft straight away.
  const draftId = detail?.draft?.id;
  useEffect(() => {
    if (draftId) void Promise.resolve().then(runPreview);
    else void Promise.resolve().then(() => setPreview(null));
  }, [draftId, runPreview]);

  if (!can("results.view")) return <Forbidden />;
  if (error !== null) return <ErrorState message={errorText(error)} onRetry={() => void load()} />;
  if (!detail) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  const resultErr = (err: unknown) => (err instanceof ApiError && (a.results.errors[err.code] ?? w.errors[err.code])) || errorText(err);
  const canEnter = can("results.enter") && detail.eligibleForEntry && (!detail.early || isSuper) && (!detail.hasPublishedResult || isSuper);
  // A SUPER_ADMIN may correct a draw at any time (reason required; see EditDrawModal).
  const canEdit = isSuper && can("draws.create");
  const claim = drawInfo?.scheduledOccurrence ?? null;
  const publicHref = `/results/${detail.draw.game.slug}/${detail.draw.drawNumber}`;

  return (
    <div className="flex flex-col gap-4">
      {/* Compact header: identity, times, status and the draw-level actions */}
      <header className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-extrabold tracking-tight">{a.results.detailTitle(game, detail.draw.drawNumber)}</h1>
            <DrawAvailabilityPill status={detail.draw.status} salesState={salesStateOf(detail)} />
          </div>
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
            <div className="flex gap-1">
              <dt>{w.salesOpen}:</dt>
              <dd className="text-ink-soft">{dateTime(detail.draw.salesOpensAt)}</dd>
            </div>
            <div className="flex gap-1">
              <dt>{w.salesClose}:</dt>
              <dd className="text-ink-soft">{dateTime(detail.draw.salesClosesAt)}</dd>
            </div>
            <div className="flex gap-1">
              <dt>{w.drawTime}:</dt>
              <dd className="font-semibold text-foreground">{dateTime(detail.draw.drawAt)}</dd>
            </div>
          </dl>
          {drawInfo && (
            <p className="mt-1 text-xs text-muted">
              {claim
                ? `${w.edit.scheduled(dateTime(claim.scheduledDrawAt), claim.timezone)}${claim.claim === "REPLACEMENT" ? ` (${w.edit.replacement})` : ""}`
                : w.edit.special}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
              {w.editDraw}
            </button>
          )}
          {detail.hasPublishedResult && (
            <Link href={publicHref} target="_blank" className="btn btn-secondary btn-sm">
              {a.results.viewPublic} <span aria-hidden="true">↗</span>
            </Link>
          )}
        </div>
      </header>

      {detail.early && detail.eligibleForEntry && !detail.hasPublishedResult && (
        <Callout tone={isSuper ? "danger" : "warning"}>{isSuper ? w.earlyBanner : w.earlyNotSuper}</Callout>
      )}
      {!detail.eligibleForEntry && <Callout tone="warning">{a.results.notResultable}</Callout>}
      {detail.hasPublishedResult && detail.eligibleForEntry && isSuper && <Callout>{a.results.correctionNote}</Callout>}
      {detail.hasPublishedResult && !isSuper && <Callout tone="warning">{a.results.superAdminOnly}</Callout>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {canEnter && (
            <EntryForm
              key={detail.draft?.id ?? "new"}
              detail={detail}
              onSaved={async (n) => {
                toast("success", a.results.draftSavedToast);
                await load();
                if (n && n === detail.draft?.versionNumber) await runPreview();
              }}
            />
          )}

          <AdminCard
            title={a.results.previewTitle}
            action={
              detail.draft && (
                <div className="flex gap-2">
                  {can("results.enter") && (!detail.hasPublishedResult || isSuper) && (
                    <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => setDiscarding(true)}>
                      {w.discardDraft}
                    </button>
                  )}
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void runPreview()} disabled={previewing}>
                    {previewing ? a.results.previewing : a.results.refreshPreview}
                  </button>
                </div>
              )
            }
          >
            {!detail.draft ? (
              <p className="text-sm text-muted">{a.results.noPreview}</p>
            ) : previewError !== null ? (
              <ErrorMessage message={resultErr(previewError)} />
            ) : !preview ? (
              <Skeleton className="h-56" />
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Pill tone="warning">{a.results.currentDraft(preview.versionNumber)}</Pill>
                  <WinningValueView value={preview.summary.winningValue} />
                </div>
                {can("results.publish") && isSuper && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2">
                    <p className="text-xs text-ink-soft">{a.results.previewHint}</p>
                    <button type="button" className="btn btn-primary btn-sm" disabled={!preview.canPublish || previewing} onClick={() => setPublishing(true)}>
                      {preview.isCorrection ? a.results.publishCorrection : a.results.publish}
                    </button>
                  </div>
                )}
                <IssueList issues={preview.blockers} tone="danger" />
                <IssueList issues={preview.warnings} tone="warning" />
                <CalculationSummary summary={preview.summary} downstream={preview.downstream} />
                <div>
                  <h3 className="mb-2 text-sm font-bold">{a.results.winners}</h3>
                  <WinnersTable winners={preview.winners} total={preview.winnersTotal} />
                </div>
              </div>
            )}
          </AdminCard>

          {detail.published && (
            <AdminCard title={a.results.currentPublic}>
              <div className="flex flex-col gap-4">
                <WinningValueView value={detail.versions.find((v) => v.isPublicCurrent)!.value} />
                <CalculationSummary summary={detail.published.summary} />
                <WinnersTable winners={detail.published.winners} total={detail.published.summary.winningTickets} />
              </div>
            </AdminCard>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {detail.jackpot && (
            <JackpotCard
              detail={detail}
              canOverride={isSuper && can("results.publish")}
              onChanged={async () => {
                await load();
                if (detail.draft) await runPreview();
              }}
            />
          )}
          <EvidenceCard detail={detail} onSaved={() => void load()} />
          <DrawHistory key={historyKey} entityIds={[drawId, ...detail.versions.map((v) => v.id)]} />
          <HistoryCard detail={detail} />
          <details className="rounded-xl border border-border bg-surface shadow-xs">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-soft">{w.rules}</summary>
            <div className="border-t border-border p-3">
              <RuleVersionForm gameType={detail.draw.game.gameType} rules={detail.draw.rulesSnapshot} />
            </div>
          </details>
        </div>
      </div>

      {preview && (
        <PublishModal
          open={publishing}
          preview={preview}
          early={detail.early}
          onClose={() => setPublishing(false)}
          onDone={async (message) => {
            setPublishing(false);
            toast("success", message);
            setPreview(null);
            await load();
          }}
          onOutdated={async () => {
            setPublishing(false);
            await runPreview();
          }}
          drawId={drawId}
        />
      )}
      {discarding && (
        <ReasonModal
          title={w.discardTitle}
          body={w.discardBody}
          confirmLabel={w.discardDraft}
          danger
          onClose={() => setDiscarding(false)}
          onConfirm={async (reason) => {
            await run((token) => adminApi.discardResultDraft(token, drawId, reason));
            setDiscarding(false);
            toast("success", w.discarded);
            await load();
          }}
        />
      )}
      {editing && (
        <EditDrawModal
          detail={detail}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            toast("success", w.saved);
            await load();
          }}
        />
      )}
    </div>
  );
}

function salesStateOf(detail: ResultDetail) {
  const now = Date.now();
  if (detail.draw.status !== "SALES_OPEN") return detail.draw.status === "SALES_CLOSED" ? "CLOSED" : "NOT_ON_SALE";
  if (now < Date.parse(detail.draw.salesOpensAt)) return "UPCOMING";
  if (now >= Date.parse(detail.draw.salesClosesAt)) return "CLOSED";
  return "OPEN";
}

// ---------------------------------------------------------------- shared reason modal

/** Confirmation with a mandatory reason (≥ 5 characters). */
export function ReasonModal({
  title,
  body,
  confirmLabel,
  danger,
  onClose,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const { a, errorText } = useAdminI18n();
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  return (
    <Modal
      open
      title={title}
      onClose={working ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={working}>
            {a.common.cancel}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${danger ? "btn-primary !bg-danger !border-danger" : "btn-primary"}`}
            disabled={reason.trim().length < 5 || working}
            onClick={async () => {
              setWorking(true);
              setErr(null);
              try {
                await onConfirm(reason.trim());
              } catch (e) {
                setErr(e);
                setWorking(false);
              }
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p>{body}</p>
        <Field label={a.workflow.reason} htmlFor="reason-modal" hint={a.workflow.reasonHint}>
          <textarea id="reason-modal" className="input min-h-20 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} data-autofocus />
        </Field>
        {err !== null && <ErrorMessage message={(err instanceof ApiError && (a.workflow.errors[err.code] ?? a.results.errors[err.code])) || errorText(err)} />}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- warnings list

export function DrawWarnings({ warnings }: { warnings: DrawWarning[] }) {
  const { a } = useAdminI18n();
  if (warnings.length === 0) return null;
  return (
    <Callout tone="warning">
      <p className="font-semibold">{a.workflow.warningsTitle}</p>
      <ul className="mt-1 list-disc ps-5 text-sm">
        {warnings.map((wn, i) => (
          <li key={`${wn.code}-${i}`}>{a.workflow.warnings[wn.code]?.(wn.params ?? {}) ?? wn.code}</li>
        ))}
      </ul>
    </Callout>
  );
}

// ---------------------------------------------------------------- edit draw

function EditDrawModal({ detail, onClose, onSaved }: { detail: ResultDetail; onClose: () => void; onSaved: () => Promise<void> }) {
  const { run } = useAdminAuth();
  const { a, errorText } = useAdminI18n();
  const w = a.workflow;
  const [open, setOpen] = useState(toTehranInput(detail.draw.salesOpensAt));
  const [close, setClose] = useState(toTehranInput(detail.draw.salesClosesAt));
  const [drawAt, setDrawAt] = useState(toTehranInput(detail.draw.drawAt));
  const [reason, setReason] = useState("");
  const [warnings, setWarnings] = useState<DrawWarning[]>([]);
  const [checking, setChecking] = useState(false);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const iso = { open: fromTehranInput(open), close: fromTehranInput(close), draw: fromTehranInput(drawAt) };
  const timeIssues = validateDrawTimes(iso);
  const body = { salesOpensAt: iso.open ?? undefined, salesClosesAt: iso.close ?? undefined, drawAt: iso.draw ?? undefined };
  // Editing a draw always needs a reason (≥ 5 characters), warnings or not.
  const blockers = saveBlockers({ timeIssues, reason, reasonRequired: true, checking });

  useEffect(() => {
    if (timeIssues.length > 0) return;
    const t = setTimeout(() => {
      setChecking(true);
      run((token) => adminApi.updateDraw(token, detail.draw.id, { ...body, dryRun: true }))
        .then((res) => {
          setWarnings(res.warnings);
          setErr(null);
        })
        .catch((e) => setErr(e))
        .finally(() => setChecking(false));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close, drawAt]);

  return (
    <Modal
      open
      size="lg"
      title={w.editTitle}
      onClose={working ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={working}>
            {a.common.cancel}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={blockers.length > 0 || working}
            aria-describedby="edit-blockers"
            onClick={async () => {
              setWorking(true);
              setErr(null);
              try {
                await run((token) => adminApi.updateDraw(token, detail.draw.id, { ...body, reason: reason.trim() }));
                await onSaved();
              } catch (e) {
                setErr(e);
                setWorking(false);
              }
            }}
          >
            {working ? w.saving : w.save}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {detail.hasPublishedResult && <Callout tone="warning">{w.edit.publishedNote}</Callout>}
        <TimeFields open={open} close={close} drawAt={drawAt} setOpen={setOpen} setClose={setClose} setDrawAt={setDrawAt} issues={timeIssues} />
        <DrawWarnings warnings={warnings} />
        <ReasonField id="edit-reason" value={reason} onChange={setReason} required />
        {err !== null && <ErrorMessage message={(err instanceof ApiError && w.errors[err.code]) || errorText(err)} />}
        <SaveBlockers id="edit-blockers" blockers={blockers} />
      </div>
    </Modal>
  );
}

/** Sales opening, closing and draw time (Tehran), one per row so full values never clip. */
export function TimeFields({
  open,
  close,
  drawAt,
  setOpen,
  setClose,
  setDrawAt,
  issues = [],
}: {
  open: string;
  close: string;
  drawAt: string;
  setOpen: (v: string) => void;
  setClose: (v: string) => void;
  setDrawAt: (v: string) => void;
  issues?: TimeIssue[];
}) {
  const { a } = useAdminI18n();
  const w = a.workflow;
  const errorFor = (field: TimeField) => {
    const issue = issues.find((i) => i.field === field);
    return issue ? w.edit.times[issue.code] : undefined;
  };
  const field = (key: TimeField, id: string, label: string, value: string, set: (v: string) => void) => (
    <Field label={label} htmlFor={id} error={errorFor(key)}>
      <input id={id} type="datetime-local" dir="ltr" className={`${inputSm} w-full min-w-0`} value={value} onChange={(e) => set(e.target.value)} aria-invalid={errorFor(key) ? true : undefined} />
    </Field>
  );
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-xs text-muted">{w.tehranTime}</legend>
      {field("open", "t-open", w.salesOpen, open, setOpen)}
      {field("close", "t-close", w.salesClose, close, setClose)}
      {field("draw", "t-draw", w.drawTime, drawAt, setDrawAt)}
    </fieldset>
  );
}

/** A reason textarea that states the 5-character minimum and counts as you type. */
export function ReasonField({ id, value, onChange, required }: { id: string; value: string; onChange: (v: string) => void; required: boolean }) {
  const { a } = useAdminI18n();
  const w = a.workflow;
  const state = reasonState(value, required);
  const n = value.trim().length;
  return (
    <Field label={w.reason} htmlFor={id} error={state === "TOO_SHORT" || (state === "MISSING" && value.length > 0) ? w.edit.blocked.REASON : undefined} hint={w.edit.reasonHint}>
      <div className="flex flex-col gap-1">
        <textarea id={id} className="input min-h-16 text-sm" value={value} onChange={(e) => onChange(e.target.value)} maxLength={2000} aria-invalid={state === "TOO_SHORT" ? true : undefined} />
        <span className={`self-end text-[0.7rem] tabular ${n >= MIN_REASON_LENGTH ? "text-success" : "text-muted"}`}>{w.edit.reasonCount(Math.min(n, MIN_REASON_LENGTH))}</span>
      </div>
    </Field>
  );
}

/** Explains why the save button is disabled. */
export function SaveBlockers({ id, blockers }: { id: string; blockers: string[] }) {
  const { a } = useAdminI18n();
  if (blockers.length === 0) return <span id={id} hidden />;
  return (
    <ul id={id} className="flex flex-col gap-0.5 rounded-lg bg-surface-muted px-3 py-2 text-xs text-ink-soft" aria-live="polite">
      {blockers.map((b) => (
        <li key={b}>• {a.workflow.edit.blocked[b]}</li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- draw history

/** Audit entries for the draw itself and for each of its result versions, newest first. */
function DrawHistory({ entityIds }: { entityIds: string[] }) {
  const { can, run } = useAdminAuth();
  const { a, dateTime } = useAdminI18n();
  const w = a.workflow;
  const [items, setItems] = useState<AdminAuditItem[] | null>(null);
  useEffect(() => {
    if (!can("audit.view")) return;
    Promise.all(entityIds.map((entityId) => run((token) => adminApi.listAudit(token, { entityId, pageSize: 20 }))))
      .then((pages) => setItems(pages.flatMap((p) => p.items).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 30)))
      .catch(() => setItems([]));
    // The parent remounts this card (key) whenever the draw reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can, run]);
  if (!can("audit.view")) return null;
  return (
    <AdminCard title={w.history}>
      {items === null ? (
        <Skeleton className="h-16" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">{w.noHistory}</p>
      ) : (
        <ol className="flex flex-col gap-2 text-xs">
          {items.map((it) => (
            <li key={it.id} className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-0 last:pb-0">
              <span className="font-semibold text-foreground">{w.actions[it.action] ?? it.action}</span>
              {it.reason && <span className="text-ink-soft">{it.reason}</span>}
              <span className="text-muted">
                <span dir="ltr">{it.actor.adminEmail ?? it.actor.adminNumber ?? it.actor.type}</span> · {dateTime(it.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </AdminCard>
  );
}

// ---------------------------------------------------------------- entry form

function EntryForm({ detail, onSaved }: { detail: ResultDetail; onSaved: (versionNumber: number | null) => Promise<void> }) {
  const { run } = useAdminAuth();
  const { a, errorText } = useAdminI18n();
  const isFour = detail.draw.game.gameType === "FOUR_LEAF";
  const selection = (detail.draw.rulesSnapshot.selection ?? {}) as {
    main_numbers?: { count?: number; min?: number; max?: number };
    chance_symbol?: { min?: number; max?: number };
  };
  const count = selection.main_numbers?.count ?? 6;
  const min = selection.main_numbers?.min ?? 1;
  const max = selection.main_numbers?.max ?? 33;
  const symbols = symbolsInRange(selection.chance_symbol?.min ?? 1, selection.chance_symbol?.max ?? 5);

  // A draft resumes where it was left; a new correction starts from the current public
  // result so only the wrong values need changing.
  const draft = detail.draft?.value ?? detail.versions.find((v) => v.isPublicCurrent)?.value;
  const [four, setFour] = useState(draft?.kind === "FOUR_LEAF" ? draft.numberValue : "");
  const [balls, setBalls] = useState<string[]>(draft?.kind === "SIX_CHANCE" ? draft.drawOrder.map(String) : Array(count).fill(""));
  const [symbol, setSymbol] = useState<number[]>(draft?.kind === "SIX_CHANCE" ? [draft.symbol] : []);
  const [reason, setReason] = useState(detail.draft?.correctionReason ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  const nums = balls.map((b) => Number(b));
  const ballError = (i: number) => {
    const b = balls[i]!;
    if (b === "") return false;
    const n = Number(b);
    return !Number.isInteger(n) || n < min || n > max || nums.filter((x) => x === n).length > 1;
  };
  const sixValid = balls.every((b, i) => b !== "" && !ballError(i)) && symbol.length === 1;
  const fourValid = /^\d{4}$/.test(four);
  const needsReason = detail.hasPublishedResult;
  const [earlyReason, setEarlyReason] = useState("");
  const reasonValid = (!needsReason || reason.trim().length >= 5) && (!detail.early || earlyReason.trim().length >= 5);
  const valid = (isFour ? fourValid : sixValid) && reasonValid;

  async function save() {
    setSaving(true);
    setErr(null);
    const body: DraftInput = isFour ? { fourLeaf: { numberValue: four } } : { sixChance: { drawOrder: nums, symbol: symbol[0]! } };
    if (needsReason) body.correctionReason = reason.trim();
    if (detail.early) body.earlyReason = earlyReason.trim();
    try {
      const res = await run((token) => adminApi.saveResultDraft(token, detail.draw.id, body));
      await onSaved(res.versionNumber);
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminCard title={needsReason ? a.results.correctionEntry : a.results.entry}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void save();
        }}
      >
        {isFour ? (
          <Field label={a.results.fourLeafNumber} htmlFor="r-four" hint={a.results.fourLeafHint}>
            <input
              id="r-four"
              className={`${inputSm} tabular max-w-40 text-center text-lg tracking-[0.4em]`}
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={four}
              aria-invalid={four !== "" && !fourValid ? true : undefined}
              onChange={(e) => setFour(e.target.value.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/\D/g, "").slice(0, 4))}
            />
          </Field>
        ) : (
          <>
            <fieldset>
              <legend className="field-label">{a.results.drawOrder}</legend>
              <div className="flex flex-wrap gap-2" dir="ltr">
                {balls.map((b, i) => (
                  <input
                    key={i}
                    aria-label={a.results.ball(i + 1)}
                    className={`${inputSm} tabular w-14 text-center font-bold`}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={2}
                    value={b}
                    aria-invalid={ballError(i) || undefined}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/\D/g, "").slice(0, 2);
                      setBalls((prev) => prev.map((x, j) => (j === i ? v : x)));
                    }}
                  />
                ))}
              </div>
              <p className="mt-1 text-xs text-muted">{a.results.drawOrderHint(count, min, max)}</p>
            </fieldset>
            <div>
              <p id="r-symbol" className="field-label">
                {a.results.symbol}
              </p>
              <ChanceSymbolPicker symbols={symbols} values={symbol} max={1} onChange={setSymbol} labelledBy="r-symbol" />
            </div>
          </>
        )}
        {needsReason && (
          <Field label={a.results.correctionReason} htmlFor="r-reason" hint={a.results.correctionReasonHint}>
            <textarea id="r-reason" className="input min-h-20 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
          </Field>
        )}
        {detail.early && (
          <Field label={a.workflow.earlyReason} htmlFor="r-early" hint={a.workflow.reasonHint}>
            <textarea id="r-early" className="input min-h-16 text-sm" value={earlyReason} onChange={(e) => setEarlyReason(e.target.value)} maxLength={2000} />
          </Field>
        )}
        {err !== null && <ErrorMessage message={(err instanceof ApiError && (a.results.errors[err.code] ?? a.workflow.errors[err.code])) || errorText(err)} />}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {!detail.hasPublishedResult && !detail.draft && <span className="text-xs text-muted">{a.workflow.entryStopsSales}</span>}
          <button type="submit" className="btn btn-primary btn-sm" disabled={!valid || saving}>
            {saving ? a.results.saving : a.results.saveDraft}
          </button>
        </div>
      </form>
    </AdminCard>
  );
}

// ---------------------------------------------------------------- publish

function PublishModal({
  open,
  preview,
  early,
  drawId,
  onClose,
  onDone,
  onOutdated,
}: {
  open: boolean;
  preview: ResultPreview;
  early: boolean;
  drawId: string;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
  onOutdated: () => Promise<void>;
}) {
  const { run } = useAdminAuth();
  const { a, money, num, errorText } = useAdminI18n();
  const [reason, setReason] = useState("");
  const [earlyReason, setEarlyReason] = useState("");
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const valid = reason.trim().length >= 5 && (!early || earlyReason.trim().length >= 5);

  async function publish() {
    setWorking(true);
    setErr(null);
    try {
      const res = await run((token) =>
        adminApi.publishResult(token, drawId, { resultId: preview.resultId, calculationHash: preview.calculationHash, reason: reason.trim(), ...(early ? { earlyReason: earlyReason.trim() } : {}) }),
      );
      await onDone(res.alreadyPublished ? a.results.alreadyPublished : res.isCorrection ? a.results.correctionPublished : a.results.publishedToast);
    } catch (e) {
      if (e instanceof ApiError && e.code === "PREVIEW_OUTDATED") {
        setErr(e);
        await onOutdated();
      } else {
        setErr(e);
      }
    } finally {
      setWorking(false);
    }
  }

  return (
    <Modal
      open={open}
      title={preview.isCorrection ? a.results.publishCorrectionTitle : a.results.publishTitle}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={working}>
            {a.common.cancel}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!valid || working} onClick={() => void publish()}>
            {working ? a.results.publishing : preview.isCorrection ? a.results.publishCorrection.replace("…", "") : a.results.publish.replace("…", "")}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        {early && <Callout tone="danger">{a.workflow.earlyBanner}</Callout>}
        <p>{a.results.publishBody}</p>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-muted p-3">
          <WinningValueView value={preview.summary.winningValue} />
          <span className="text-muted">
            {a.results.winningTickets}: <strong className="tabular text-foreground">{num(preview.summary.winningTickets)}</strong>
          </span>
          <span className="text-muted">
            {a.results.totalCash}: <strong className="tabular text-foreground">{money(preview.summary.totalCashLiabilityToman)}</strong>
          </span>
        </div>
        <Field label={a.results.publishReason} htmlFor="p-reason" hint={a.results.publishReasonHint}>
          <textarea id="p-reason" className="input min-h-20 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
        </Field>
        {early && (
          <Field label={a.workflow.earlyReason} htmlFor="p-early" hint={a.workflow.reasonHint}>
            <textarea id="p-early" className="input min-h-16 text-sm" value={earlyReason} onChange={(e) => setEarlyReason(e.target.value)} maxLength={2000} />
          </Field>
        )}
        {err !== null && <ErrorMessage message={(err instanceof ApiError && (a.results.errors[err.code] ?? a.workflow.errors[err.code])) || errorText(err)} />}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- advertised jackpot

/** The draw's advertised jackpot: latest value, append-only override history and, for a
 * SUPER_ADMIN, a change form (mandatory reason). A published draw is corrected, not mutated. */
function JackpotCard({ detail, canOverride, onChanged }: { detail: ResultDetail; canOverride: boolean; onChanged: () => Promise<void> }) {
  const { run } = useAdminAuth();
  const { a, money, dateTime, errorText } = useAdminI18n();
  const toast = useToast();
  const fin = a.results.finance;
  const jackpot = detail.jackpot!;
  const [editing, setEditing] = useState(jackpot.currentToman === null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const valid = /^[1-9]\d{0,17}$/.test(amount) && reason.trim().length >= 5;

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await run((token) => adminApi.recordJackpot(token, detail.draw.id, { amountToman: amount, reason: reason.trim() }));
      toast("success", res.correctionDraftVersion ? fin.correctionOpened(res.correctionDraftVersion) : fin.recorded);
      setAmount("");
      setReason("");
      setEditing(false);
      await onChanged();
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminCard
      title={fin.jackpotCard}
      action={
        canOverride && !editing && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
            {fin.change}
          </button>
        )
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p className="tabular text-xl font-extrabold">{jackpot.currentToman ? money(jackpot.currentToman) : a.results.jackpotMissing}</p>
        {canOverride && editing && (
          <form
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted/60 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) void save();
            }}
          >
            <p className="text-xs text-muted">{detail.hasPublishedResult ? fin.overridePublishedHint : fin.overrideHint}</p>
            <Field label={fin.recordAmount} htmlFor="jp-amount">
              <input
                id="jp-amount"
                className={`${inputSm} tabular`}
                dir="ltr"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/\D/g, ""))}
              />
            </Field>
            <Field label={fin.recordReason} htmlFor="jp-reason">
              <input id="jp-reason" className={inputSm} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
            </Field>
            {err !== null && <ErrorMessage message={(err instanceof ApiError && a.results.errors[err.code]) || errorText(err)} />}
            <div className="flex justify-end gap-2">
              {jackpot.currentToman !== null && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)} disabled={saving}>
                  {a.common.cancel}
                </button>
              )}
              <button type="submit" className="btn btn-primary btn-sm" disabled={!valid || saving}>
                {fin.recordSave}
              </button>
            </div>
          </form>
        )}
        {jackpot.history.length > 0 && (
          <div className="border-t border-border pt-3">
            <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">{fin.history}</h3>
            <ol className="flex flex-col gap-2 text-xs">
              {jackpot.history.map((h) => (
                <li key={h.id} className="flex flex-col gap-0.5">
                  <span className="tabular font-semibold text-foreground">
                    {h.previousToman ? money(h.previousToman) : a.results.jackpotMissing} → {h.newToman ? money(h.newToman) : "—"}
                  </span>
                  <span className="text-ink-soft">{h.reason}</span>
                  <span className="text-muted">
                    <span dir="ltr">{h.actor}</span> · {dateTime(h.at)}
                    {h.correctionDraftVersion ? ` · ${fin.correctionOpened(h.correctionDraftVersion)}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </AdminCard>
  );
}

// ---------------------------------------------------------------- evidence

function EvidenceCard({ detail, onSaved }: { detail: ResultDetail; onSaved: () => void }) {
  const { can, run } = useAdminAuth();
  const { a, errorText } = useAdminI18n();
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const videoId = youtubeVideoId(url);

  async function save() {
    if (!videoId) return;
    setSaving(true);
    setErr(null);
    try {
      await run((token) => adminApi.recordEvidence(token, detail.draw.id, { youtubeLiveUrl: url.trim(), youtubeVideoId: videoId }));
      toast("success", a.results.evidenceSaved);
      onSaved();
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminCard title={a.results.evidence}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-xs text-muted">{a.results.evidenceHint}</p>
        {detail.evidence ? (
          <a href={detail.evidence.archiveUrl ?? detail.evidence.youtubeLiveUrl} target="_blank" rel="noreferrer noopener" className="break-all font-semibold text-brand hover:underline" dir="ltr">
            {detail.evidence.archiveUrl ?? detail.evidence.youtubeLiveUrl}
          </a>
        ) : can("draws.manage_evidence") ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field label={a.results.evidenceUrl} htmlFor="ev-url" error={url && !videoId ? a.results.evidenceInvalid : undefined}>
              <input id="ev-url" className={inputSm} dir="ltr" type="url" placeholder="https://www.youtube.com/live/…" value={url} onChange={(e) => setUrl(e.target.value)} />
            </Field>
            {err !== null && <ErrorMessage message={errorText(err)} />}
            <div className="flex justify-end">
              <button type="submit" className="btn btn-secondary btn-sm" disabled={!videoId || saving}>
                {a.results.evidenceSave}
              </button>
            </div>
          </form>
        ) : (
          <p className="text-muted">{a.results.evidenceNone}</p>
        )}
      </div>
    </AdminCard>
  );
}

// ---------------------------------------------------------------- history

function HistoryCard({ detail }: { detail: ResultDetail }) {
  const { a, dateTime, money, num } = useAdminI18n();
  if (detail.versions.length === 0) return null;
  const tone = (s: string) => (s === "PUBLISHED" ? "success" : s === "ENTERED" ? "warning" : "neutral");
  return (
    <details className="rounded-xl border border-border bg-surface shadow-xs">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-soft">
        {a.results.history} ({num(detail.versions.length)})
      </summary>
      <div className="flex flex-col gap-3 border-t border-border p-4">
        <p className="text-xs text-muted">{a.results.historyHint}</p>
        <ol className="flex flex-col divide-y divide-border">
          {detail.versions.map((v) => (
            <li key={v.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold">{a.results.version(v.versionNumber)}</span>
                <Pill tone={tone(v.status)}>{a.results.versionStatus[v.status] ?? v.status}</Pill>
                {v.isPublicCurrent && <Pill tone="brand">{a.results.currentPublic}</Pill>}
              </div>
              <WinningValueView value={v.value} size="sm" />
              <dl className="grid gap-x-3 gap-y-0.5 text-xs text-muted sm:grid-cols-[auto_1fr]">
                <dt>{a.results.enteredBy}</dt>
                <dd className="text-ink-soft" dir="ltr">
                  {v.enteredBy ?? "—"} · {dateTime(v.enteredAt)}
                </dd>
                {v.publishedAt && (
                  <>
                    <dt>{a.results.publishedAt}</dt>
                    <dd className="text-ink-soft">
                      {dateTime(v.publishedAt)} · <span dir="ltr">{v.publishedBy}</span>
                    </dd>
                  </>
                )}
                {v.correctionReason && (
                  <>
                    <dt>{a.results.correctionReason}</dt>
                    <dd className="text-ink-soft">{v.correctionReason}</dd>
                  </>
                )}
                {v.publicationReason && (
                  <>
                    <dt>{a.results.publishReason}</dt>
                    <dd className="text-ink-soft">{v.publicationReason}</dd>
                  </>
                )}
              </dl>
            </li>
          ))}
        </ol>
        {detail.runs.length > 0 && (
          <div className="border-t border-border pt-3">
            <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">{a.results.runs}</h3>
            <ul className="flex flex-col gap-1 text-xs">
              {detail.runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {a.results.run(r.runNumber, r.resultVersion)} <Pill tone={r.status === "PUBLISHED" ? "success" : "neutral"}>{a.results.versionStatus[r.status] ?? r.status}</Pill>
                  </span>
                  <span className="tabular text-muted">
                    {num(r.winningTickets)} · {money(r.totalCashLiabilityToman)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
