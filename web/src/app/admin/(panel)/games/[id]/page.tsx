"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/admin/auth-context";
import { useAdminI18n } from "@/lib/admin/i18n";
import { adminApi } from "@/lib/admin/api";
import { upgradeRulesForNewVersion } from "@/lib/admin/rules-upgrade";
import type { AdminDrawListItem, AdminGame, RuleVersion } from "@/lib/admin/types";
import { useBreadcrumbs } from "@/components/admin/AdminShell";
import { AdminCard, AdminPageHeader, Callout, ErrorState, Forbidden, Pill, Skeleton, TableWrap, td, th, useToast } from "@/components/admin/ui";
import { DrawAvailabilityPill, GameStatusPill, RuleStatusPill, gameLabel } from "@/components/admin/cells";
import { EditGameModal } from "@/components/admin/EditGameModal";
import { ReasonModal } from "@/components/admin/DrawWorkspace";
import { RuleVersionForm, validateRules } from "@/components/admin/RuleVersionForm";
import { GameIcon } from "@/components/brand";
import { BackIcon } from "@/components/icons";

/**
 * One "current game settings" form. Saving creates and activates a new rule version in one
 * step (the previous one is retired); versions stay available under "Advanced history".
 */
export default function AdminGameDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can, run, me } = useAdminAuth();
  const { a, locale, money, dateTime, errorText } = useAdminI18n();
  const toast = useToast();
  const s = a.workflow.settings;
  const isSuper = me?.roles.includes("SUPER_ADMIN") ?? false;
  const canSave = isSuper && can("games.edit") && can("games.activate_rule_version");

  const [game, setGame] = useState<AdminGame | null>(null);
  const [versions, setVersions] = useState<RuleVersion[] | null>(null);
  const [upcoming, setUpcoming] = useState<AdminDrawListItem[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [baseRules, setBaseRules] = useState<Record<string, unknown> | null>(null);
  const [rules, setRules] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState<RuleVersion | null>(null);
  const [editingGame, setEditingGame] = useState(false);

  useBreadcrumbs([
    { label: a.nav.games, href: "/admin/games" },
    { label: game ? gameLabel(game, locale) : a.common.loading },
  ]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [g, vs] = await Promise.all([run((token) => adminApi.getGame(token, id)), run((token) => adminApi.listRuleVersions(token, id))]);
      setGame(g);
      setVersions(vs);
      const active = vs.find((v) => v.status === "ACTIVE");
      // The form starts from the active settings in the current rule format.
      const start = active ? upgradeRulesForNewVersion(g.gameType === "SIX_CHANCE" ? "SIX_CHANCE" : "FOUR_LEAF", active.rules) : null;
      setBaseRules(start);
      setRules(start);
    } catch (err) {
      setError(err);
    }
    if (can("draws.view")) {
      run((token) => adminApi.listDraws(token, { gameId: id, state: "OPEN_OR_UPCOMING", pageSize: 3 }))
        .then((res) => setUpcoming(res.items))
        .catch(() => setUpcoming([]));
    }
  }, [id, run, can]);

  useEffect(() => {
    if (can("games.view")) void Promise.resolve().then(load);
  }, [can, load]);

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
        <Skeleton className="h-72" />
      </div>
    );
  }

  const active = versions.find((v) => v.status === "ACTIVE") ?? null;
  const dirty = rules !== null && JSON.stringify(rules) !== JSON.stringify(baseRules);
  const formErrors = rules ? validateRules(game.gameType, rules, a) : {};
  const formValid = Object.keys(formErrors).length === 0;

  return (
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

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="settings-title">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${game.gameType === "SIX_CHANCE" ? "bg-ocean-700" : "bg-brand-700"}`}>
              <GameIcon gameType={game.gameType} size={26} />
            </span>
            <div className="min-w-0">
              <h2 id="settings-title" className="text-lg font-extrabold">
                {s.title}
              </h2>
              <p className="text-xs text-muted">{s.subtitle}</p>
            </div>
          </div>
          {!active || !rules ? (
            <Callout tone="warning">{a.rules.noActive}</Callout>
          ) : (
            <>
              {!canSave && <Callout>{s.readOnly}</Callout>}
              <RuleVersionForm gameType={game.gameType} rules={rules} onChange={canSave ? setRules : undefined} />
              {canSave && (
                <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-border bg-surface/95 px-3 py-2 shadow-lg backdrop-blur [padding-bottom:calc(0.5rem+env(safe-area-inset-bottom,0px))]">
                  {dirty && <Pill tone="warning">{s.unsaved}</Pill>}
                  <span className="flex-1" />
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!dirty} onClick={() => setRules(baseRules)}>
                    {s.reset}
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || !formValid} onClick={() => setSaving(true)}>
                    {s.save}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <AdminCard title={s.recentDraws}>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted">{a.dashboard.noNextDraw}</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {upcoming.map((d) => (
                  <li key={d.id}>
                    <Link href={`/admin/draws/${d.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md hover:bg-surface-muted">
                      <span className="flex items-center gap-1.5 font-semibold">
                        #{d.drawNumber}
                        <DrawAvailabilityPill status={d.status} salesState={d.salesState} />
                      </span>
                      <span className="text-xs text-muted">{dateTime(d.drawAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>

          <details className="rounded-xl border border-border bg-surface shadow-xs">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-soft">{s.advanced}</summary>
            <div className="flex flex-col gap-2 border-t border-border py-3">
              <p className="px-4 text-xs text-muted">{s.advancedHint}</p>
              <TableWrap>
                <table className="w-full min-w-[26rem] text-xs">
                  <thead className="border-b border-border bg-surface-muted">
                    <tr>
                      <th className={th}>{a.rules.version}</th>
                      <th className={th}>{a.games.price}</th>
                      <th className={th}>{a.rules.reason}</th>
                      <th className={th}>
                        <span className="sr-only">{a.common.actions}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {versions.map((v) => (
                      <tr key={v.id}>
                        <td className={td}>
                          <div className="flex flex-col gap-1">
                            <span className="font-bold">{s.version(v.versionNumber)}</span>
                            <RuleStatusPill status={v.status} />
                            <span className="text-muted">{s.schema(Number(v.rules.schema_version ?? 1))}</span>
                          </div>
                        </td>
                        <td className={`${td} tabular`}>{money(Number(v.rules.ticket_price_toman))}</td>
                        <td className={td}>
                          <p className="line-clamp-2" title={v.changeReason}>
                            {v.changeReason}
                          </p>
                          <p className="mt-0.5 text-muted">{dateTime(v.activatedAt ?? v.createdAt)}</p>
                        </td>
                        <td className={td}>
                          {v.status === "DRAFT" && isSuper && can("games.edit") && (
                            <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => setDiscarding(v)}>
                              {s.discard}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          </details>
        </aside>
      </div>

      {saving && rules && (
        <ReasonModal
          title={s.saveTitle}
          body={s.saveBody}
          confirmLabel={s.save}
          onClose={() => setSaving(false)}
          onConfirm={async (reason) => {
            const saved = await run((token) => adminApi.saveGameSettings(token, id, { rules, reason }));
            setSaving(false);
            toast("success", `${s.saved} ${s.version(saved.versionNumber)}`);
            await load();
          }}
        />
      )}
      {discarding && (
        <ReasonModal
          title={s.discardTitle}
          body={s.discardBody}
          confirmLabel={s.discard}
          danger
          onClose={() => setDiscarding(null)}
          onConfirm={async (reason) => {
            await run((token) => adminApi.discardRuleVersion(token, discarding.id, reason));
            setDiscarding(null);
            toast("success", s.discarded);
            await load();
          }}
        />
      )}
      {editingGame && (
        <EditGameModal
          game={game}
          onClose={() => setEditingGame(false)}
          onSaved={() => {
            setEditingGame(false);
            toast("success", a.games.saved);
            void load();
          }}
        />
      )}
    </div>
  );
}
