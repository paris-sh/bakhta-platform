import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import type { Database } from "../../db/client.js";
import type { DB, DrawStatusEnum } from "../../db/types.js";
import type { CalcAward, CalcOutput, CalcTicket, SalesInput, WinningValue } from "./calculation.js";
import { confirmedSalesForDraw } from "./revenue-source.js";

// Draw statuses from which a first result may be entered (the physical draw has happened
// once draw_at has passed; nothing moves draws out of SALES_OPEN on a timer, so a past
// SALES_OPEN draw is legitimately awaiting its result).
export const RESULT_ENTRY_STATUSES: DrawStatusEnum[] = [
  "SALES_OPEN",
  "SALES_CLOSED",
  "DRAW_IN_PROGRESS",
  "RESULT_ENTERED",
  "PENDING_REVIEW",
  "DELAYED",
];

type Trx = Transaction<DB>;

export const JACKPOT_OVERRIDE_ACTION = "draws.opening_jackpot_override";

export interface AuditRow {
  adminId: string;
  action: string;
  entityType: string;
  entityId: string;
  changedFields?: string[];
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  reason?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  severity?: string;
}

async function insertAudit(trx: Trx, a: AuditRow) {
  await trx
    .insertInto("audit_logs")
    .values({
      actor_type: "ADMIN",
      actor_admin_id: a.adminId,
      action: a.action,
      entity_type: a.entityType,
      entity_id: a.entityId,
      changed_fields: a.changedFields ?? null,
      old_values: a.oldValues ? JSON.stringify(a.oldValues) : null,
      new_values: a.newValues ? JSON.stringify(a.newValues) : null,
      reason: a.reason ?? null,
      request_id: a.requestId ?? null,
      ip_address: a.ipAddress ?? null,
      user_agent: a.userAgent ?? null,
      ...(a.severity ? { severity: a.severity } : {}),
    })
    .execute();
}

async function changeDrawStatus(trx: Trx, drawId: string, from: string, to: DrawStatusEnum, adminId: string, reason: string | null) {
  if (from === to) return;
  await trx.updateTable("draws").set({ status: to }).where("id", "=", drawId).execute();
  await trx
    .insertInto("draw_status_history")
    .values({ draw_id: drawId, from_status: from, to_status: to, reason, actor_type: "ADMIN", actor_admin_id: adminId })
    .execute();
}

function drawBase(db: Database | Trx) {
  return db
    .selectFrom("draws as d")
    .innerJoin("games as g", "g.id", "d.game_id")
    .select([
      "d.id",
      "d.game_id",
      "d.game_type",
      "d.draw_number",
      "d.status",
      "d.sales_opens_at",
      "d.sales_closes_at",
      "d.draw_at",
      "d.official_timezone",
      "d.current_rule_version_id",
      "d.current_rules_snapshot",
      "d.opening_jackpot_toman",
      "d.youtube_live_url",
      "d.published_at",
      "g.code as game_code",
      "g.slug as game_slug",
      "g.name_en",
      "g.name_fa",
    ]);
}

export type DrawRow = Awaited<ReturnType<ReturnType<typeof drawBase>["executeTakeFirstOrThrow"]>>;

/** A result version with its value, as stored. */
async function loadResultVersions(db: Database | Trx, drawId: string) {
  return db
    .selectFrom("results as r")
    .leftJoin("four_leaf_results as fl", "fl.result_id", "r.id")
    .leftJoin("six_chance_results as sc", "sc.result_id", "r.id")
    .leftJoin("admin_accounts as ea", "ea.id", "r.entered_by")
    .leftJoin("admin_accounts as pa", "pa.id", "r.published_by")
    .select([
      "r.id",
      "r.draw_id",
      "r.game_type",
      "r.version_number",
      "r.status",
      "r.is_public_current",
      "r.correction_reason",
      "r.publication_reason",
      "r.entered_at",
      "r.published_at",
      "r.draw_evidence_id",
      "ea.email as entered_by_email",
      "pa.email as published_by_email",
      "fl.number_value",
      "sc.draw_order_values",
      "sc.symbol",
    ])
    .where("r.draw_id", "=", drawId)
    .orderBy("r.version_number", "desc")
    .execute();
}

export type ResultVersionRow = Awaited<ReturnType<typeof loadResultVersions>>[number];

export function toWinningValue(row: { game_type: string; number_value: string | null; draw_order_values: number[] | null; symbol: number | null }): WinningValue {
  if (row.game_type === "FOUR_LEAF") return { kind: "FOUR_LEAF", numberValue: row.number_value!.trim() };
  return { kind: "SIX_CHANCE", drawOrder: row.draw_order_values!.map(Number), symbol: Number(row.symbol) };
}

/** CONFIRMED tickets of a draw with their selections, shaped for the calculator. */
async function loadConfirmedTickets(db: Database | Trx, drawId: string): Promise<CalcTicket[]> {
  const rows = await db
    .selectFrom("tickets as t")
    .leftJoin("four_leaf_ticket_selections as fl", "fl.ticket_id", "t.id")
    .leftJoin("six_chance_ticket_selections as sc", "sc.ticket_id", "t.id")
    .leftJoin("six_chance_system_ticket_selections as sys", "sys.ticket_id", "t.id")
    .select([
      "t.id",
      "t.public_code",
      "t.game_type",
      "t.combination_count",
      "t.rule_version_id",
      "fl.number_value",
      "sc.n1",
      "sc.n2",
      "sc.n3",
      "sc.n4",
      "sc.n5",
      "sc.n6",
      "sc.symbol",
      "sys.numbers as sys_numbers",
      "sys.symbols as sys_symbols",
    ])
    .where("t.draw_id", "=", drawId)
    .where("t.status", "=", "CONFIRMED")
    .orderBy("t.id")
    .execute();
  return rows.map((r) => {
    let selection: CalcTicket["selection"];
    if (r.game_type === "FOUR_LEAF") {
      selection = { kind: "FOUR_LEAF", numberValue: r.number_value!.trim() };
    } else if (r.sys_numbers) {
      selection = { kind: "SIX_CHANCE", numbers: r.sys_numbers.map(Number), symbols: r.sys_symbols!.map(Number) };
    } else {
      selection = {
        kind: "SIX_CHANCE",
        numbers: [r.n1, r.n2, r.n3, r.n4, r.n5, r.n6].map(Number),
        symbols: [Number(r.symbol)],
      };
    }
    return {
      id: r.id,
      publicCode: r.public_code,
      combinationCount: r.combination_count,
      ruleVersionId: r.rule_version_id,
      selection,
    };
  });
}

export function createResultsRepository(db: Database) {
  return {
    findDraw(drawId: string) {
      return drawBase(db).where("d.id", "=", drawId).executeTakeFirst();
    },

    findPublicDraw(slug: string, drawNumber: string) {
      return drawBase(db).where("g.slug", "=", slug).where("d.draw_number", "=", drawNumber).executeTakeFirst();
    },

    resultVersions(drawId: string) {
      return loadResultVersions(db, drawId);
    },

    confirmedTickets(drawId: string) {
      return loadConfirmedTickets(db, drawId);
    },

    latestEvidence(drawId: string) {
      return db
        .selectFrom("draw_evidence")
        .select(["id", "youtube_live_url", "youtube_video_id", "archive_url", "status", "scheduled_at"])
        .where("draw_id", "=", drawId)
        .orderBy("created_at", "desc")
        .executeTakeFirst();
    },

    /** The PUBLISHED calculation run of the current public result, if any. */
    currentPublishedRun(drawId: string) {
      return db
        .selectFrom("prize_calculation_runs as pr")
        .innerJoin("results as r", "r.id", "pr.result_id")
        .select(["pr.id", "pr.run_number", "pr.summary", "pr.calculation_hash", "pr.approved_at", "r.version_number"])
        .where("pr.draw_id", "=", drawId)
        .where("pr.status", "=", "PUBLISHED")
        .where("r.is_public_current", "=", true)
        .executeTakeFirst();
    },

    /** Every calculation run of the draw, newest first (internal history). */
    runs(drawId: string) {
      return db
        .selectFrom("prize_calculation_runs as pr")
        .innerJoin("results as r", "r.id", "pr.result_id")
        .select(["pr.id", "pr.status", "pr.run_number", "pr.approved_at", "pr.summary", "r.version_number"])
        .where("pr.draw_id", "=", drawId)
        .orderBy("pr.created_at", "desc")
        .execute();
    },

    currentWinners(drawId: string, limit: number) {
      return db
        .selectFrom("prize_awards as a")
        .innerJoin("tickets as t", "t.id", "a.ticket_id")
        .select(["a.id", "t.public_code", "a.tier_code", "a.award_type", "a.amount_toman", "a.free_ticket_quantity", "t.combination_count"])
        .where("a.draw_id", "=", drawId)
        .where("a.is_current", "=", true)
        .orderBy("a.amount_toman", "desc")
        .orderBy("t.public_code")
        .limit(limit)
        .execute();
    },

    // ---------------------------------------------------------------- lists

    async listAwaiting(opts: { gameId?: string | undefined; page: number; pageSize: number }, now: Date) {
      let q = drawBase(db)
        .where("d.status", "in", RESULT_ENTRY_STATUSES)
        .where((eb) =>
          eb.or([
            eb.and([eb("d.draw_at", "<=", now), eb("d.sales_closes_at", "<=", now)]),
            eb.exists(eb.selectFrom("results as r2").select("r2.id").whereRef("r2.draw_id", "=", "d.id").where("r2.status", "=", "ENTERED")),
          ]),
        )
        .where((eb) =>
          eb.not(eb.exists(eb.selectFrom("results as r").select("r.id").whereRef("r.draw_id", "=", "d.id").where("r.is_public_current", "=", true))),
        );
      if (opts.gameId) q = q.where("d.game_id", "=", opts.gameId);
      const total = await db
        .selectFrom(q.as("x"))
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .executeTakeFirstOrThrow();
      const items = await q
        .select((eb) => [
          eb
            .selectFrom("results as r")
            .select("r.version_number")
            .whereRef("r.draw_id", "=", "d.id")
            .where("r.status", "=", "ENTERED")
            .limit(1)
            .as("draft_version"),
          eb
            .selectFrom("tickets as t")
            .select((e) => e.fn.countAll<string>().as("n"))
            .whereRef("t.draw_id", "=", "d.id")
            .where("t.status", "=", "CONFIRMED")
            .as("confirmed_tickets"),
        ])
        .orderBy("d.draw_at", "asc")
        .limit(opts.pageSize)
        .offset((opts.page - 1) * opts.pageSize)
        .execute();
      return { items, total: Number(total.n) };
    },

    async listPublished(opts: { gameId?: string | undefined; slug?: string | undefined; page: number; pageSize: number }) {
      let q = drawBase(db)
        .innerJoin("results as r", (j) => j.onRef("r.draw_id", "=", "d.id").on("r.is_public_current", "=", true))
        .leftJoin("four_leaf_results as fl", "fl.result_id", "r.id")
        .leftJoin("six_chance_results as sc", "sc.result_id", "r.id")
        .innerJoin("prize_calculation_runs as pr", (j) => j.onRef("pr.result_id", "=", "r.id").on("pr.status", "=", "PUBLISHED"));
      if (opts.gameId) q = q.where("d.game_id", "=", opts.gameId);
      if (opts.slug) q = q.where("g.slug", "=", opts.slug);
      const total = await db
        .selectFrom(q.select("d.id as draw_id_x").as("x"))
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .executeTakeFirstOrThrow();
      const items = await q
        .select([
          "r.id as result_id",
          "r.version_number",
          "r.published_at as result_published_at",
          "r.game_type as result_game_type",
          "fl.number_value",
          "sc.draw_order_values",
          "sc.symbol",
          "pr.summary",
        ])
        .orderBy("d.draw_at", "desc")
        .limit(opts.pageSize)
        .offset((opts.page - 1) * opts.pageSize)
        .execute();
      return { items, total: Number(total.n) };
    },

    // ---------------------------------------------------------------- drafts

    /**
     * Creates or updates the draw's single ENTERED draft (one transaction, draw row locked).
     * A correction draft (the draw already has a public result) records its reason.
     */
    async saveDraft(input: {
      drawId: string;
      value: WinningValue;
      correctionReason: string | null;
      adminId: string;
      early?: { reason: string; drawAt: Date; salesClosesAt: Date } | null;
      audit: Omit<AuditRow, "adminId" | "action" | "entityType" | "entityId">;
    }) {
      return db.transaction().execute(async (trx) => {
        const draw = await trx.selectFrom("draws").select(["id", "status", "game_type"]).where("id", "=", input.drawId).forUpdate().executeTakeFirstOrThrow();
        const draft = await trx
          .selectFrom("results")
          .select(["id", "version_number"])
          .where("draw_id", "=", input.drawId)
          .where("status", "=", "ENTERED")
          .forUpdate()
          .executeTakeFirst();

        let resultId: string;
        let versionNumber: number;
        let oldValue: WinningValue | null = null;
        if (draft) {
          resultId = draft.id;
          versionNumber = draft.version_number;
          const prev = (await loadResultVersions(trx, input.drawId)).find((v) => v.id === draft.id)!;
          oldValue = toWinningValue(prev);
          if (input.value.kind === "FOUR_LEAF") {
            await trx.updateTable("four_leaf_results").set({ number_value: input.value.numberValue }).where("result_id", "=", draft.id).execute();
          } else {
            const sorted = [...input.value.drawOrder].sort((a, b) => a - b);
            await trx
              .updateTable("six_chance_results")
              .set({
                draw_order_values: input.value.drawOrder,
                normalized_n1: sorted[0]!,
                normalized_n2: sorted[1]!,
                normalized_n3: sorted[2]!,
                normalized_n4: sorted[3]!,
                normalized_n5: sorted[4]!,
                normalized_n6: sorted[5]!,
                symbol: input.value.symbol,
              })
              .where("result_id", "=", draft.id)
              .execute();
          }
          await trx
            .updateTable("results")
            .set({ entered_by: input.adminId, entered_at: new Date(), ...(input.correctionReason ? { correction_reason: input.correctionReason } : {}) })
            .where("id", "=", draft.id)
            .execute();
        } else {
          const max = await trx
            .selectFrom("results")
            .select((eb) => eb.fn.max("version_number").as("v"))
            .where("draw_id", "=", input.drawId)
            .executeTakeFirst();
          versionNumber = Number(max?.v ?? 0) + 1;
          const created = await trx
            .insertInto("results")
            .values({
              draw_id: input.drawId,
              game_type: draw.game_type,
              version_number: versionNumber,
              status: "ENTERED",
              // Every version after the first needs a reason (DB check); a re-entry after a
              // discarded draft that is not a correction records why a new version exists.
              correction_reason: versionNumber > 1 ? (input.correctionReason ?? "Re-entered after a discarded draft") : null,
              entered_by: input.adminId,
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          resultId = created.id;
          if (input.value.kind === "FOUR_LEAF") {
            await trx.insertInto("four_leaf_results").values({ result_id: resultId, number_value: input.value.numberValue }).execute();
          } else {
            const sorted = [...input.value.drawOrder].sort((a, b) => a - b);
            await trx
              .insertInto("six_chance_results")
              .values({
                result_id: resultId,
                draw_order_values: input.value.drawOrder,
                normalized_n1: sorted[0]!,
                normalized_n2: sorted[1]!,
                normalized_n3: sorted[2]!,
                normalized_n4: sorted[3]!,
                normalized_n5: sorted[4]!,
                normalized_n6: sorted[5]!,
                symbol: input.value.symbol,
              })
              .execute();
          }
          if (["SALES_OPEN", "SALES_CLOSED", "DRAW_IN_PROGRESS", "DELAYED"].includes(draw.status)) {
            await changeDrawStatus(trx, input.drawId, draw.status, "RESULT_ENTERED", input.adminId, null);
          }
        }

        await insertAudit(trx, {
          ...input.audit,
          adminId: input.adminId,
          action: draft ? "results.draft_update" : input.correctionReason ? "results.correction_draft_create" : "results.draft_create",
          entityType: "results",
          entityId: resultId,
          changedFields: ["value"],
          oldValues: oldValue ? { value: oldValue } : null,
          newValues: { value: input.value, version_number: versionNumber },
          reason: input.correctionReason,
        });
        if (input.early) {
          await insertAudit(trx, {
            ...input.audit,
            adminId: input.adminId,
            action: "results.early_entry",
            entityType: "results",
            entityId: resultId,
            newValues: { draw_at: input.early.drawAt.toISOString(), sales_closes_at: input.early.salesClosesAt.toISOString(), entered_at: new Date().toISOString() },
            reason: input.early.reason,
            severity: "WARNING",
          });
        }
        return { resultId, versionNumber };
      });
    },

    awardComponents(awardIds: string[]) {
      if (awardIds.length === 0) return Promise.resolve([]);
      return db
        .selectFrom("prize_award_components")
        .select(["award_id", "tier_code", "component_type", "amount_toman", "free_ticket_quantity", "matched_combinations"])
        .where("award_id", "in", awardIds)
        .orderBy("created_at")
        .execute();
    },

    // ---------------------------------------------------------------- sales & jackpots

    confirmedSales(drawId: string) {
      return confirmedSalesForDraw(db, drawId);
    },

    /** The next chronological draw of the same game (not cancelled/void), if any. */
    nextDraw(drawId: string) {
      return nextChronologicalDraw(db, drawId);
    },

    /** Append-only history of a draw's advertised-jackpot overrides, newest first. */
    jackpotHistory(drawId: string) {
      return db
        .selectFrom("admin_overrides as o")
        .innerJoin("admin_accounts as a", "a.id", "o.admin_id")
        .select(["o.id", "o.before_snapshot", "o.after_snapshot", "o.impact_snapshot", "o.reason", "o.effective_at", "a.email as actor_email"])
        .where("o.entity_type", "=", "draws")
        .where("o.entity_id", "=", drawId)
        .where("o.action_type", "=", JACKPOT_OVERRIDE_ACTION)
        .orderBy("o.created_at", "desc")
        .execute();
    },

    /**
     * SUPER_ADMIN override of a Six Chance draw's advertised jackpot, allowed at any time
     * (including after sales started) with a mandatory reason. The draw keeps only the latest
     * effective value; every change is an append-only admin_overrides row (previous value,
     * new value, reason, actor, time) plus an audit entry — nothing is overwritten or deleted.
     *
     * The value is a calculation input, so any preview fingerprint taken before the change no
     * longer matches (publication then reports PREVIEW_OUTDATED). A published result is never
     * mutated here: a correction draft (same winning values) is opened instead, so the change
     * reaches awards, claims and downstream jackpots only through the correction workflow.
     */
    async overrideOpeningJackpot(input: {
      drawId: string;
      amountToman: bigint;
      reason: string;
      adminId: string;
      audit: Omit<AuditRow, "adminId" | "action" | "entityType" | "entityId">;
    }) {
      return db.transaction().execute(async (trx) => {
        const draw = await trx
          .selectFrom("draws")
          .select(["id", "game_type", "status", "opening_jackpot_toman"])
          .where("id", "=", input.drawId)
          .forUpdate()
          .executeTakeFirst();
        if (!draw) return { outcome: "not_found" as const };
        if (draw.game_type !== "SIX_CHANCE") return { outcome: "not_six_chance" as const };
        const next = input.amountToman.toString();
        if (draw.opening_jackpot_toman === next) return { outcome: "unchanged" as const };

        const versions = await loadResultVersions(trx, input.drawId);
        const current = versions.find((v) => v.is_public_current);
        const draft = versions.find((v) => v.status === "ENTERED");

        await trx.updateTable("draws").set({ opening_jackpot_toman: next }).where("id", "=", input.drawId).execute();

        // A published result needs a correction to reflect the new jackpot. Open one (same
        // winning values) unless a draft is already in progress.
        let correctionDraftVersion: number | null = null;
        if (current && !draft) {
          correctionDraftVersion = Math.max(...versions.map((v) => v.version_number)) + 1;
          const correctionReason = `Advertised jackpot changed from ${draw.opening_jackpot_toman ?? "none"} to ${next}: ${input.reason}`;
          const created = await trx
            .insertInto("results")
            .values({
              draw_id: input.drawId,
              game_type: "SIX_CHANCE",
              version_number: correctionDraftVersion,
              status: "ENTERED",
              correction_reason: correctionReason,
              entered_by: input.adminId,
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          const value = toWinningValue(current);
          if (value.kind !== "SIX_CHANCE") throw new Error("Six Chance draw with a non-Six-Chance result");
          const sorted = [...value.drawOrder].sort((a, b) => a - b);
          await trx
            .insertInto("six_chance_results")
            .values({
              result_id: created.id,
              draw_order_values: value.drawOrder,
              normalized_n1: sorted[0]!,
              normalized_n2: sorted[1]!,
              normalized_n3: sorted[2]!,
              normalized_n4: sorted[3]!,
              normalized_n5: sorted[4]!,
              normalized_n6: sorted[5]!,
              symbol: value.symbol,
            })
            .execute();
          await insertAudit(trx, {
            ...input.audit,
            adminId: input.adminId,
            action: "results.correction_draft_create",
            entityType: "results",
            entityId: created.id,
            newValues: { value, version_number: correctionDraftVersion, cause: "opening_jackpot_override" },
            reason: correctionReason,
          });
        }

        const impact = {
          draw_status: draw.status,
          has_published_result: current !== undefined,
          existing_draft_version: draft?.version_number ?? null,
          correction_draft_version: correctionDraftVersion,
          invalidates_preview_fingerprint: true,
        };
        await trx
          .insertInto("admin_overrides")
          .values({
            admin_id: input.adminId,
            entity_type: "draws",
            entity_id: input.drawId,
            action_type: JACKPOT_OVERRIDE_ACTION,
            scope: "SPECIFIC_RECORD",
            reason: input.reason,
            before_snapshot: JSON.stringify({ opening_jackpot_toman: draw.opening_jackpot_toman }),
            after_snapshot: JSON.stringify({ opening_jackpot_toman: next }),
            impact_snapshot: JSON.stringify(impact),
            // No confirmation code exists in this phase; the reason is mandatory instead.
            confirmation_method: "REASON_ONLY",
            effective_at: new Date(),
            request_id: input.audit.requestId ?? randomUUID(),
          })
          .execute();
        await insertAudit(trx, {
          ...input.audit,
          adminId: input.adminId,
          action: JACKPOT_OVERRIDE_ACTION,
          entityType: "draws",
          entityId: input.drawId,
          changedFields: ["opening_jackpot_toman"],
          oldValues: { opening_jackpot_toman: draw.opening_jackpot_toman },
          newValues: { opening_jackpot_toman: next, ...impact },
          reason: input.reason,
          severity: "WARNING",
        });
        return {
          outcome: "overridden" as const,
          previousToman: draw.opening_jackpot_toman,
          hasPublishedResult: current !== undefined,
          correctionDraftVersion,
          existingDraftVersion: draft?.version_number ?? null,
        };
      });
    },

    /**
     * Discards the draw's unpublished draft: the result row is kept and marked VOID (results
     * are never deleted), and a draw moved to RESULT_ENTERED by that draft returns to the
     * status it had before. Published results cannot be discarded — they use corrections.
     */
    async discardDraft(input: { drawId: string; adminId: string; reason: string; audit: Omit<AuditRow, "adminId" | "action" | "entityType" | "entityId"> }) {
      return db.transaction().execute(async (trx) => {
        const draw = await trx.selectFrom("draws").select(["id", "status"]).where("id", "=", input.drawId).forUpdate().executeTakeFirst();
        if (!draw) return { outcome: "not_found" as const };
        const draft = await trx
          .selectFrom("results")
          .select(["id", "version_number"])
          .where("draw_id", "=", input.drawId)
          .where("status", "=", "ENTERED")
          .forUpdate()
          .executeTakeFirst();
        if (!draft) return { outcome: "no_draft" as const };
        await trx.updateTable("results").set({ status: "VOID" }).where("id", "=", draft.id).execute();
        const hasPublic = await trx.selectFrom("results").select("id").where("draw_id", "=", input.drawId).where("is_public_current", "=", true).executeTakeFirst();
        let restoredStatus: string | null = null;
        if (!hasPublic && draw.status === "RESULT_ENTERED") {
          const entered = await trx
            .selectFrom("draw_status_history")
            .select("from_status")
            .where("draw_id", "=", input.drawId)
            .where("to_status", "=", "RESULT_ENTERED")
            .orderBy("created_at", "desc")
            .executeTakeFirst();
          restoredStatus = entered?.from_status ?? "SALES_CLOSED";
          await changeDrawStatus(trx, input.drawId, draw.status, restoredStatus as DrawStatusEnum, input.adminId, input.reason);
        }
        await insertAudit(trx, {
          ...input.audit,
          adminId: input.adminId,
          action: "results.draft_discard",
          entityType: "results",
          entityId: draft.id,
          changedFields: ["status"],
          oldValues: { status: "ENTERED", version_number: draft.version_number },
          newValues: { status: "VOID", draw_status_restored_to: restoredStatus },
          reason: input.reason,
          severity: "WARNING",
        });
        return { outcome: "discarded" as const, versionNumber: draft.version_number, restoredStatus, wasCorrection: hasPublic !== undefined };
      });
    },

    // ---------------------------------------------------------------- publication

    /**
     * Atomic, idempotent publication of the draw's ENTERED draft (initial or correction).
     * `calculate` runs inside the transaction on the locked draw, draft, confirmed tickets and
     * confirmed sales, so what is published is exactly what was calculated.
     */
    async publish(input: {
      drawId: string;
      resultId: string;
      adminId: string;
      reason: string;
      calculate: (args: { draw: DrawRow; value: WinningValue; tickets: CalcTicket[]; sales: SalesInput; asOf: Date }) => CalcOutput;
      expectedHash: string;
      early?: { reason: string } | null;
      audit: Omit<AuditRow, "adminId" | "action" | "entityType" | "entityId">;
    }): Promise<
      | { outcome: "published"; resultId: string; versionNumber: number; runId: string; isCorrection: boolean; calc: CalcOutput; downstream: DownstreamJackpot | null; claimsFlagged: number }
      | { outcome: "already_published"; resultId: string; versionNumber: number }
      | { outcome: "not_draft"; status: string }
      | { outcome: "not_found" }
      | { outcome: "blocked"; calc: CalcOutput }
      | { outcome: "hash_mismatch"; calc: CalcOutput }
    > {
      return db.transaction().execute(async (trx) => {
        // Lock order: draw, then its results, then awards, then claims, then the next draw.
        const lockedDraw = await trx.selectFrom("draws").select(["id", "status", "published_at"]).where("id", "=", input.drawId).forUpdate().executeTakeFirst();
        if (!lockedDraw) return { outcome: "not_found" as const };
        const draw = await drawBase(trx).where("d.id", "=", input.drawId).executeTakeFirstOrThrow();

        const target = await trx
          .selectFrom("results")
          .select(["id", "status", "version_number", "is_public_current"])
          .where("id", "=", input.resultId)
          .where("draw_id", "=", input.drawId)
          .forUpdate()
          .executeTakeFirst();
        if (!target) return { outcome: "not_found" as const };
        if (target.status === "PUBLISHED" && target.is_public_current) {
          return { outcome: "already_published" as const, resultId: target.id, versionNumber: target.version_number };
        }
        if (target.status !== "ENTERED") return { outcome: "not_draft" as const, status: target.status };

        const previous = await trx
          .selectFrom("results")
          .select(["id", "version_number"])
          .where("draw_id", "=", input.drawId)
          .where("is_public_current", "=", true)
          .forUpdate()
          .executeTakeFirst();

        const versions = await loadResultVersions(trx, input.drawId);
        const value = toWinningValue(versions.find((v) => v.id === target.id)!);
        const tickets = await loadConfirmedTickets(trx, input.drawId);
        const sales = await confirmedSalesForDraw(trx, input.drawId);
        const now = new Date();
        const calc = input.calculate({ draw, value, tickets, sales, asOf: now });
        if (calc.blockers.length > 0) return { outcome: "blocked" as const, calc };
        if (calc.calculationHash !== input.expectedHash) return { outcome: "hash_mismatch" as const, calc };

        // Supersede the previous public version, its run and its current awards (history kept).
        const supersededAwardByTicket = new Map<string, string>();
        if (previous) {
          const oldAwards = await trx
            .selectFrom("prize_awards")
            .select(["id", "ticket_id"])
            .where("draw_id", "=", input.drawId)
            .where("is_current", "=", true)
            .forUpdate()
            .execute();
          for (const a of oldAwards) supersededAwardByTicket.set(a.ticket_id, a.id);
          if (oldAwards.length > 0) {
            await trx
              .updateTable("prize_awards")
              .set({ is_current: false, status: "SUPERSEDED" })
              .where("id", "in", oldAwards.map((a) => a.id))
              .execute();
          }
          await trx
            .updateTable("prize_calculation_runs")
            .set({ status: "SUPERSEDED" })
            .where("result_id", "=", previous.id)
            .where("status", "=", "PUBLISHED")
            .execute();
          await trx.updateTable("results").set({ is_public_current: false, status: "SUPERSEDED" }).where("id", "=", previous.id).execute();
        }

        const evidence = await trx.selectFrom("draw_evidence").select("id").where("draw_id", "=", input.drawId).orderBy("created_at", "desc").executeTakeFirst();

        await trx
          .updateTable("results")
          .set({
            status: "PUBLISHED",
            is_public_current: true,
            reviewed_by: input.adminId,
            reviewed_at: now,
            published_by: input.adminId,
            published_at: now,
            publication_reason: input.reason,
            draw_evidence_id: evidence?.id ?? null,
          })
          .where("id", "=", target.id)
          .execute();

        // The next jackpot flows to the next chronological draw only when that draw has no
        // published result yet; otherwise it is flagged for manual reconciliation.
        const downstream = await applyNextJackpot(trx, {
          drawId: input.drawId,
          drawNumber: draw.draw_number,
          nextJackpotToman: calc.summary.gameType === "SIX_CHANCE" ? calc.summary.financials.nextJackpotToman : null,
          adminId: input.adminId,
          resultId: target.id,
          isCorrection: previous !== undefined,
          audit: input.audit,
        });

        const runNumber = await trx
          .selectFrom("prize_calculation_runs")
          .select((eb) => eb.fn.max("run_number").as("n"))
          .where("result_id", "=", target.id)
          .executeTakeFirst();
        const run = await trx
          .insertInto("prize_calculation_runs")
          .values({
            draw_id: input.drawId,
            result_id: target.id,
            rule_version_id: draw.current_rule_version_id,
            run_number: Number(runNumber?.n ?? 0) + 1,
            status: "PUBLISHED",
            calculation_hash: Buffer.from(calc.calculationHash, "hex"),
            summary: JSON.stringify({ ...calc.summary, warnings: calc.warnings, downstreamJackpot: downstream }),
            created_by: input.adminId,
            approved_by: input.adminId,
            approved_at: now,
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        const deadline = new Date(calc.summary.claimDeadlineAt);
        const newAwardByTicket = new Map<string, string>();
        for (let i = 0; i < calc.awards.length; i += 500) {
          const chunk = calc.awards.slice(i, i + 500);
          const inserted = await trx
            .insertInto("prize_awards")
            .values(
              chunk.map((a: CalcAward) => ({
                calculation_run_id: run.id,
                result_id: target.id,
                draw_id: input.drawId,
                ticket_id: a.ticketId,
                tier_code: a.tierCode,
                award_type: a.awardType,
                amount_toman: a.amountToman === null ? null : a.amountToman.toString(),
                free_ticket_quantity: a.freeTicketQuantity,
                calculation_details: JSON.stringify(a.details),
                status: "ACTIVE" as const,
                is_current: true,
                claim_deadline_at: deadline,
                supersedes_award_id: supersededAwardByTicket.get(a.ticketId) ?? null,
              })),
            )
            .returning(["id", "ticket_id"])
            .execute();
          for (const row of inserted) newAwardByTicket.set(row.ticket_id, row.id);
          const components = chunk.flatMap((a) =>
            a.components.map((c) => ({
              award_id: newAwardByTicket.get(a.ticketId)!,
              tier_code: c.tierCode,
              component_type: c.componentType,
              amount_toman: c.amountToman === null ? null : c.amountToman.toString(),
              free_ticket_quantity: c.freeTicketQuantity,
              matched_combinations: c.matchedCombinations,
              calculation_details: JSON.stringify(c.details),
            })),
          );
          for (let j = 0; j < components.length; j += 1000) {
            await trx.insertInto("prize_award_components").values(components.slice(j, j + 1000)).execute();
          }
        }

        // Ticket outcomes follow the current result: winners, then every other confirmed row.
        const winnerIds = calc.awards.map((a) => a.ticketId);
        await trx
          .updateTable("tickets")
          .set({ outcome_status: sql`CASE WHEN id = ANY(${winnerIds}::uuid[]) THEN 'WINNER'::ticket_outcome_enum ELSE 'NOT_WINNER'::ticket_outcome_enum END` })
          .where("draw_id", "=", input.drawId)
          .where("status", "=", "CONFIRMED")
          .execute();

        // Claims on superseded awards follow their ticket to the replacement award and are
        // flagged for manual reconciliation. A PAID claim is never repointed or reversed.
        const claimsFlagged = previous
          ? await reconcileClaims(trx, {
              supersededAwardByTicket,
              newAwardByTicket,
              adminId: input.adminId,
              versionNumber: target.version_number,
              audit: input.audit,
            })
          : 0;

        await changeDrawStatus(trx, input.drawId, lockedDraw.status, "PUBLISHED", input.adminId, input.reason);
        if (!lockedDraw.published_at) {
          await trx.updateTable("draws").set({ published_at: now }).where("id", "=", input.drawId).execute();
        }

        const isCorrection = previous !== undefined;
        if (input.early) {
          await insertAudit(trx, {
            ...input.audit,
            adminId: input.adminId,
            action: "results.early_publication",
            entityType: "results",
            entityId: target.id,
            newValues: { draw_at: draw.draw_at.toISOString(), sales_closes_at: draw.sales_closes_at.toISOString(), published_at: now.toISOString() },
            reason: input.early.reason,
            severity: "WARNING",
          });
        }
        await insertAudit(trx, {
          ...input.audit,
          adminId: input.adminId,
          action: isCorrection ? "results.publish_correction" : "results.publish",
          entityType: "results",
          entityId: target.id,
          changedFields: ["status", "is_public_current"],
          oldValues: previous ? { superseded_result_id: previous.id, superseded_version: previous.version_number, superseded_awards: supersededAwardByTicket.size } : null,
          newValues: {
            version_number: target.version_number,
            value,
            calculation_run_id: run.id,
            calculation_hash: calc.calculationHash,
            winning_tickets: calc.awards.length,
            total_cash_liability_toman: calc.summary.totalCashLiabilityToman,
            total_free_tickets: calc.summary.totalFreeTickets,
            financials: calc.summary.financials,
            downstream_jackpot: downstream,
            claims_flagged_for_reconciliation: claimsFlagged,
          },
          reason: input.reason,
          severity: isCorrection ? "WARNING" : "INFO",
        });

        return { outcome: "published" as const, resultId: target.id, versionNumber: target.version_number, runId: run.id, isCorrection, calc, downstream, claimsFlagged };
      });
    },
  };
}

// ---------------------------------------------------------------- helpers

export interface DownstreamJackpot {
  action: "APPLIED" | "UNCHANGED" | "REQUIRES_MANUAL_RECONCILIATION" | "NO_NEXT_DRAW";
  drawId: string | null;
  drawNumber: string | null;
  previousToman: string | null;
  nextJackpotToman: string;
}

// draw_at is compared inside SQL: PostgreSQL keeps microseconds, a JS Date only milliseconds,
// so a round-tripped timestamp would wrongly find the draw itself "later" than itself.
async function nextChronologicalDraw(db: Database | Trx, drawId: string) {
  const self = await db.selectFrom("draws").select(["game_id"]).where("id", "=", drawId).executeTakeFirst();
  if (!self) return undefined;
  return db
    .selectFrom("draws as d")
    .select([
      "d.id",
      "d.draw_number",
      "d.status",
      "d.opening_jackpot_toman",
      (eb) =>
        eb
          .exists(eb.selectFrom("results as r").select("r.id").whereRef("r.draw_id", "=", "d.id").where("r.is_public_current", "=", true))
          .as("has_public_result"),
    ])
    .where("d.game_id", "=", self.game_id)
    .where("d.id", "!=", drawId)
    .where("d.draw_at", ">", (eb) => eb.selectFrom("draws").select("draw_at").where("id", "=", drawId))
    .where("d.status", "not in", ["CANCELLED", "VOID"])
    .orderBy("d.draw_at")
    .limit(1)
    .executeTakeFirst();
}

async function applyNextJackpot(
  trx: Trx,
  input: {
    drawId: string;
    drawNumber: string;
    nextJackpotToman: string | null;
    adminId: string;
    resultId: string;
    isCorrection: boolean;
    audit: Omit<AuditRow, "adminId" | "action" | "entityType" | "entityId">;
  },
): Promise<DownstreamJackpot | null> {
  if (input.nextJackpotToman === null) return null;
  const self = await trx.selectFrom("draws").select(["game_id"]).where("id", "=", input.drawId).executeTakeFirstOrThrow();
  const next = await trx
    .selectFrom("draws")
    .select(["id", "draw_number", "status", "opening_jackpot_toman"])
    .where("game_id", "=", self.game_id)
    .where("id", "!=", input.drawId)
    .where("draw_at", ">", (eb) => eb.selectFrom("draws as s").select("s.draw_at").where("s.id", "=", input.drawId))
    .where("status", "not in", ["CANCELLED", "VOID"])
    .orderBy("draw_at")
    .limit(1)
    .forUpdate()
    .executeTakeFirst();
  if (!next) {
    // Draw generation reads the next jackpot from this published calculation instead.
    return { action: "NO_NEXT_DRAW", drawId: null, drawNumber: null, previousToman: null, nextJackpotToman: input.nextJackpotToman };
  }
  const published = await trx.selectFrom("results").select("id").where("draw_id", "=", next.id).where("is_public_current", "=", true).executeTakeFirst();
  const locked = published !== undefined || ["PUBLISHED", "SETTLED", "CLOSED"].includes(next.status);
  const base = { drawId: next.id, drawNumber: next.draw_number, previousToman: next.opening_jackpot_toman, nextJackpotToman: input.nextJackpotToman };
  if (locked) {
    if (next.opening_jackpot_toman === input.nextJackpotToman) return { action: "UNCHANGED", ...base };
    // Never silently overwrite a draw that already has a published result.
    await insertAudit(trx, {
      ...input.audit,
      adminId: input.adminId,
      action: "draws.jackpot_reconciliation_required",
      entityType: "draws",
      entityId: next.id,
      oldValues: { opening_jackpot_toman: next.opening_jackpot_toman },
      newValues: { recalculated_opening_jackpot_toman: input.nextJackpotToman, source_draw_id: input.drawId, source_result_id: input.resultId },
      reason: `Draw #${input.drawNumber} ${input.isCorrection ? "correction" : "publication"} changes the jackpot of an already published draw; manual reconciliation required.`,
      severity: "WARNING",
    });
    return { action: "REQUIRES_MANUAL_RECONCILIATION", ...base };
  }
  if (next.opening_jackpot_toman === input.nextJackpotToman) return { action: "UNCHANGED", ...base };
  await trx.updateTable("draws").set({ opening_jackpot_toman: input.nextJackpotToman }).where("id", "=", next.id).execute();
  await insertAudit(trx, {
    ...input.audit,
    adminId: input.adminId,
    action: "draws.opening_jackpot_apply",
    entityType: "draws",
    entityId: next.id,
    changedFields: ["opening_jackpot_toman"],
    oldValues: { opening_jackpot_toman: next.opening_jackpot_toman },
    newValues: { opening_jackpot_toman: input.nextJackpotToman, source_draw_id: input.drawId, source_result_id: input.resultId },
    reason: `Next jackpot from draw #${input.drawNumber} ${input.isCorrection ? "correction" : "publication"}.`,
  });
  return { action: "APPLIED", ...base };
}

const PAYABLE_CLAIM_STATUSES = ["APPROVED", "READY_FOR_PAYMENT", "PAYMENT_PENDING", "PAID"];

async function reconcileClaims(
  trx: Trx,
  input: {
    supersededAwardByTicket: Map<string, string>;
    newAwardByTicket: Map<string, string>;
    adminId: string;
    versionNumber: number;
    audit: Omit<AuditRow, "adminId" | "action" | "entityType" | "entityId">;
  },
): Promise<number> {
  const ticketIds = [...input.supersededAwardByTicket.keys()];
  if (ticketIds.length === 0) return 0;
  const claims = await trx
    .selectFrom("prize_claims")
    .select(["id", "ticket_id", "status", "current_award_id"])
    .where("ticket_id", "in", ticketIds)
    .forUpdate()
    .execute();
  for (const claim of claims) {
    const oldAward = input.supersededAwardByTicket.get(claim.ticket_id)!;
    const newAward = input.newAwardByTicket.get(claim.ticket_id) ?? null;
    const paid = claim.status === "PAID";
    // PAID: history untouched (still points at the award that was paid). Otherwise follow the
    // ticket to its replacement award, or to none when a payable status does not require one.
    const nextAward = paid ? claim.current_award_id : newAward ?? (PAYABLE_CLAIM_STATUSES.includes(claim.status) ? claim.current_award_id : null);
    const notes = paid
      ? `Result correction v${input.versionNumber}: the PAID award ${oldAward} was superseded${newAward ? ` by ${newAward}` : " with no replacement"}. Payment not reversed; reconcile manually.`
      : `Result correction v${input.versionNumber}: award ${oldAward} superseded${newAward ? ` by ${newAward}` : " with no replacement"}.`;
    await trx
      .updateTable("prize_claims")
      .set({ current_award_id: nextAward, requires_manual_reconciliation: true, manual_reconciliation_notes: notes })
      .where("id", "=", claim.id)
      .execute();
    if (newAward && !paid) {
      await trx
        .insertInto("prize_claim_award_links")
        .values({ claim_id: claim.id, award_id: newAward, ticket_id: claim.ticket_id, link_reason: "RESULT_CORRECTION", linked_by_type: "ADMIN", linked_by_admin_id: input.adminId })
        .execute();
    }
    // Status is unchanged; the event is still recorded in the claim's own history.
    await trx
      .insertInto("prize_claim_status_history")
      .values({ claim_id: claim.id, from_status: claim.status, to_status: claim.status, reason: notes, actor_type: "ADMIN", actor_admin_id: input.adminId })
      .execute();
    await insertAudit(trx, {
      ...input.audit,
      adminId: input.adminId,
      action: "prize_claims.correction_reconciliation",
      entityType: "prize_claims",
      entityId: claim.id,
      changedFields: ["current_award_id", "requires_manual_reconciliation"],
      oldValues: { current_award_id: claim.current_award_id, requires_manual_reconciliation: false },
      newValues: { current_award_id: nextAward, requires_manual_reconciliation: true, replacement_award_id: newAward, status: claim.status },
      reason: notes,
      severity: "WARNING",
    });
  }
  return claims.length;
}

export type ResultsRepository = ReturnType<typeof createResultsRepository>;
