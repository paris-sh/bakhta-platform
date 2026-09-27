import { BusinessRuleError, ForbiddenError, NotFoundError, ValidationError } from "../../shared/errors.js";
import { calculatePrizes, type CalcInput, type CalcOutput, type SalesInput, type WinningValue } from "./calculation.js";
import {
  RESULT_ENTRY_STATUSES,
  toWinningValue,
  type DrawRow,
  type ResultsRepository,
  type ResultVersionRow,
} from "./results.repository.js";

export interface RequestContext {
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

const WINNERS_SHOWN = 100;

function gameRef(d: DrawRow) {
  return { id: d.game_id, code: d.game_code, slug: d.game_slug, gameType: d.game_type, nameEn: d.name_en, nameFa: d.name_fa };
}

function drawShape(d: DrawRow) {
  return {
    id: d.id,
    game: gameRef(d),
    drawNumber: d.draw_number,
    status: d.status,
    salesOpensAt: d.sales_opens_at.toISOString(),
    salesClosesAt: d.sales_closes_at.toISOString(),
    drawAt: d.draw_at.toISOString(),
    officialTimezone: d.official_timezone,
    ruleVersionId: d.current_rule_version_id,
    rulesSnapshot: d.current_rules_snapshot as Record<string, unknown>,
    openingJackpotToman: d.opening_jackpot_toman,
    publishedAt: d.published_at ? d.published_at.toISOString() : null,
  };
}

function versionShape(v: ResultVersionRow) {
  return {
    id: v.id,
    versionNumber: v.version_number,
    status: v.status,
    isPublicCurrent: v.is_public_current,
    value: toWinningValue(v),
    correctionReason: v.correction_reason,
    publicationReason: v.publication_reason,
    enteredBy: v.entered_by_email,
    enteredAt: v.entered_at.toISOString(),
    publishedBy: v.published_by_email,
    publishedAt: v.published_at ? v.published_at.toISOString() : null,
  };
}

/** Admin view of a calculation: everything, plus the first winners by public ticket code. */
function calcShape(calc: CalcOutput) {
  return {
    summary: calc.summary,
    warnings: calc.warnings,
    blockers: calc.blockers,
    calculationHash: calc.calculationHash,
    canPublish: calc.blockers.length === 0,
    winners: calc.awards.slice(0, WINNERS_SHOWN).map((a) => ({
      publicCode: a.publicCode,
      tierCode: a.tierCode,
      awardType: a.awardType,
      amountToman: a.amountToman === null ? null : a.amountToman.toString(),
      freeTicketQuantity: a.freeTicketQuantity,
      components: a.components.map((c) => ({
        tierCode: c.tierCode,
        componentType: c.componentType,
        amountToman: c.amountToman === null ? null : c.amountToman.toString(),
        freeTicketQuantity: c.freeTicketQuantity,
        matchedCombinations: c.matchedCombinations,
      })),
    })),
    winnersTotal: calc.awards.length,
  };
}

function sortedNumbers(v: WinningValue) {
  return v.kind === "SIX_CHANCE" ? [...v.drawOrder].sort((a, b) => a - b) : [];
}

function publicWinning(v: WinningValue) {
  return v.kind === "FOUR_LEAF"
    ? { kind: "FOUR_LEAF" as const, numberValue: v.numberValue }
    : { kind: "SIX_CHANCE" as const, drawOrder: v.drawOrder, sortedNumbers: sortedNumbers(v), symbol: v.symbol };
}

export function createResultsService(repo: ResultsRepository) {
  function runCalc(draw: DrawRow, value: WinningValue, tickets: CalcInput["tickets"], sales: SalesInput, asOf: Date) {
    return calculatePrizes({
      gameType: draw.game_type,
      ruleVersionId: draw.current_rule_version_id,
      rules: draw.current_rules_snapshot as Record<string, unknown>,
      openingJackpotToman: draw.opening_jackpot_toman === null ? null : BigInt(draw.opening_jackpot_toman),
      sales,
      result: value,
      tickets,
      asOf,
    });
  }

  /** Validates an entered result against the draw's own snapshotted rules. */
  function validateValue(draw: DrawRow, body: { fourLeaf?: { numberValue: string } | undefined; sixChance?: { drawOrder: number[]; symbol: number } | undefined }): WinningValue {
    const rules = draw.current_rules_snapshot as { selection?: Record<string, unknown> };
    const sel = (rules.selection ?? {}) as Record<string, unknown>;
    if (draw.game_type === "FOUR_LEAF") {
      if (!body.fourLeaf) throw new ValidationError("This is a Four Leaf draw: enter a four-digit number.");
      const v = body.fourLeaf.numberValue;
      const min = typeof sel.min === "string" ? sel.min : "0000";
      const max = typeof sel.max === "string" ? sel.max : "9999";
      if (v < min || v > max) throw new ValidationError(`The number must be between ${min} and ${max}.`);
      return { kind: "FOUR_LEAF", numberValue: v };
    }
    if (!body.sixChance) throw new ValidationError("This is a Six Chance draw: enter six numbers and a symbol.");
    const main = (sel.main_numbers ?? {}) as { count?: number; min?: number; max?: number };
    const chance = (sel.chance_symbol ?? {}) as { min?: number; max?: number };
    const { drawOrder, symbol } = body.sixChance;
    const count = main.count ?? 6;
    if (drawOrder.length !== count) throw new ValidationError(`Enter exactly ${count} main numbers.`);
    const lo = main.min ?? 1;
    const hi = main.max ?? 33;
    if (drawOrder.some((n) => n < lo || n > hi)) throw new ValidationError(`Main numbers must be between ${lo} and ${hi}.`);
    if (new Set(drawOrder).size !== drawOrder.length) throw new ValidationError("Main numbers must all be different.");
    const slo = chance.min ?? 1;
    const shi = chance.max ?? 5;
    if (symbol < slo || symbol > shi) throw new ValidationError(`The symbol must be between ${slo} and ${shi}.`);
    return { kind: "SIX_CHANCE", drawOrder, symbol };
  }

  async function loadDraw(drawId: string) {
    const draw = await repo.findDraw(drawId);
    if (!draw) throw new NotFoundError(`No draw found with id "${drawId}".`);
    return draw;
  }

  return {
    async list(q: { view: "awaiting" | "published"; gameId?: string | undefined; page: number; pageSize: number }, now = new Date()) {
      if (q.view === "awaiting") {
        const { items, total } = await repo.listAwaiting(q, now);
        return {
          page: q.page,
          pageSize: q.pageSize,
          total,
          items: items.map((d) => ({
            draw: drawShape(d),
            draftVersion: d.draft_version ?? null,
            confirmedTickets: Number(d.confirmed_tickets ?? 0),
            published: null,
          })),
        };
      }
      const { items, total } = await repo.listPublished(q);
      return {
        page: q.page,
        pageSize: q.pageSize,
        total,
        items: items.map((d) => {
          const summary = d.summary as unknown as CalcOutput["summary"];
          return {
            draw: drawShape(d),
            draftVersion: null,
            confirmedTickets: summary.confirmedTickets,
            published: {
              versionNumber: d.version_number,
              publishedAt: d.result_published_at!.toISOString(),
              value: toWinningValue({ game_type: d.result_game_type, number_value: d.number_value, draw_order_values: d.draw_order_values, symbol: d.symbol }),
              winningTickets: summary.winningTickets,
              totalCashLiabilityToman: summary.totalCashLiabilityToman,
              totalFreeTickets: summary.totalFreeTickets,
            },
          };
        }),
      };
    },

    async detail(drawId: string, now = new Date()) {
      const draw = await loadDraw(drawId);
      const [versions, evidence, run, runs, winners, jackpotHistory] = await Promise.all([
        repo.resultVersions(drawId),
        repo.latestEvidence(drawId),
        repo.currentPublishedRun(drawId),
        repo.runs(drawId),
        repo.currentWinners(drawId, WINNERS_SHOWN),
        repo.jackpotHistory(drawId),
      ]);
      const hasPublic = versions.some((v) => v.is_public_current);
      const components = await repo.awardComponents(winners.map((w) => w.id));
      return {
        draw: drawShape(draw),
        // Entry is possible in any non-terminal state; before the draw is held it needs a
        // SUPER_ADMIN and a reason (`early`).
        eligibleForEntry: RESULT_ENTRY_STATUSES.includes(draw.status) || draw.status === "PUBLISHED",
        early: draw.draw_at > now || draw.sales_closes_at > now,
        hasPublishedResult: hasPublic,
        versions: versions.map(versionShape),
        draft: versions.find((v) => v.status === "ENTERED") ? versionShape(versions.find((v) => v.status === "ENTERED")!) : null,
        jackpot:
          draw.game_type === "SIX_CHANCE"
            ? {
                currentToman: draw.opening_jackpot_toman,
                history: jackpotHistory.map((h) => ({
                  id: h.id,
                  previousToman: (h.before_snapshot as { opening_jackpot_toman?: string | null }).opening_jackpot_toman ?? null,
                  newToman: (h.after_snapshot as { opening_jackpot_toman?: string }).opening_jackpot_toman ?? null,
                  reason: h.reason,
                  actor: h.actor_email,
                  at: h.effective_at.toISOString(),
                  correctionDraftVersion: (h.impact_snapshot as { correction_draft_version?: number | null }).correction_draft_version ?? null,
                })),
              }
            : null,
        evidence: evidence
          ? {
              id: evidence.id,
              youtubeLiveUrl: evidence.youtube_live_url,
              youtubeVideoId: evidence.youtube_video_id,
              archiveUrl: evidence.archive_url,
              status: evidence.status,
            }
          : null,
        published: run
          ? {
              versionNumber: run.version_number,
              runNumber: run.run_number,
              approvedAt: run.approved_at ? run.approved_at.toISOString() : null,
              calculationHash: Buffer.from(run.calculation_hash).toString("hex"),
              summary: run.summary,
              winners: winners.map((w) => ({
                publicCode: w.public_code,
                tierCode: w.tier_code,
                awardType: w.award_type,
                amountToman: w.amount_toman,
                freeTicketQuantity: w.free_ticket_quantity,
                combinationCount: w.combination_count,
                components: components
                  .filter((c) => c.award_id === w.id)
                  .map((c) => ({
                    tierCode: c.tier_code,
                    componentType: c.component_type,
                    amountToman: c.amount_toman,
                    freeTicketQuantity: c.free_ticket_quantity,
                    matchedCombinations: c.matched_combinations,
                  })),
              })),
            }
          : null,
        runs: runs.map((r) => ({
          id: r.id,
          status: r.status,
          runNumber: r.run_number,
          resultVersion: r.version_number,
          approvedAt: r.approved_at ? r.approved_at.toISOString() : null,
          winningTickets: (r.summary as { winningTickets?: number }).winningTickets ?? 0,
          totalCashLiabilityToman: (r.summary as { totalCashLiabilityToman?: string }).totalCashLiabilityToman ?? "0",
        })),
      };
    },

    async saveDraft(
      drawId: string,
      body: Parameters<typeof validateValue>[1] & { correctionReason?: string | undefined; earlyReason?: string | undefined },
      actor: { adminId: string; isSuperAdmin: boolean },
      ctx: RequestContext,
      now = new Date(),
    ) {
      const draw = await loadDraw(drawId);
      if (draw.status === "CANCELLED" || draw.status === "VOID") {
        throw new BusinessRuleError("DRAW_NOT_RESULTABLE", `A ${draw.status.toLowerCase()} draw cannot receive a result.`);
      }
      // Before the draw has been held only a SUPER_ADMIN may enter a result, with a reason
      // that is audited. Everyone else still has to wait.
      const early = draw.sales_closes_at > now || draw.draw_at > now;
      if (early) {
        if (!actor.isSuperAdmin) {
          throw new BusinessRuleError("DRAW_NOT_HELD_YET", "Results can be entered only after sales have closed and the draw time has passed.", {
            drawAt: draw.draw_at.toISOString(),
          });
        }
        if (!body.earlyReason) {
          throw new BusinessRuleError("EARLY_REASON_REQUIRED", "The draw time has not arrived; a reason is required to enter the result now.", {
            drawAt: draw.draw_at.toISOString(),
            salesClosesAt: draw.sales_closes_at.toISOString(),
          });
        }
      }
      const versions = await repo.resultVersions(drawId);
      const isCorrection = versions.some((v) => v.is_public_current);
      if (!isCorrection && !RESULT_ENTRY_STATUSES.includes(draw.status)) {
        throw new BusinessRuleError("DRAW_NOT_RESULTABLE", `This draw is ${draw.status} and cannot receive a result.`);
      }
      if (isCorrection) {
        if (!actor.isSuperAdmin) throw new ForbiddenError("Only a SUPER_ADMIN may correct a published result.");
        const draft = versions.find((v) => v.status === "ENTERED");
        if (!body.correctionReason && !draft?.correction_reason) {
          throw new ValidationError("A correction reason is required to correct a published result.");
        }
      }
      const value = validateValue(draw, body);
      const saved = await repo.saveDraft({
        drawId,
        value,
        correctionReason: isCorrection ? (body.correctionReason ?? null) : null,
        adminId: actor.adminId,
        early: early ? { reason: body.earlyReason!, drawAt: draw.draw_at, salesClosesAt: draw.sales_closes_at } : null,
        audit: ctx,
      });
      return { ...saved, isCorrection, value };
    },

    /** Discards the unpublished draft (kept as VOID). A correction draft needs a SUPER_ADMIN. */
    async discardDraft(drawId: string, reason: string, actor: { adminId: string; isSuperAdmin: boolean }, ctx: RequestContext) {
      const versions = await repo.resultVersions(drawId);
      if (versions.some((v) => v.is_public_current) && !actor.isSuperAdmin) {
        throw new ForbiddenError("Only a SUPER_ADMIN may discard a correction draft.");
      }
      const res = await repo.discardDraft({ drawId, adminId: actor.adminId, reason, audit: ctx });
      if (res.outcome === "not_found") throw new NotFoundError(`No draw found with id "${drawId}".`);
      if (res.outcome === "no_draft") throw new BusinessRuleError("NO_DRAFT", "There is no unpublished draft to discard.");
      return { discardedVersion: res.versionNumber, restoredDrawStatus: res.restoredStatus };
    },

    /** Side-effect free: calculates the current draft exactly as publication would. */
    async preview(drawId: string, now = new Date()) {
      const draw = await loadDraw(drawId);
      const versions = await repo.resultVersions(drawId);
      const draft = versions.find((v) => v.status === "ENTERED");
      if (!draft) throw new BusinessRuleError("NO_DRAFT", "There is no draft result to preview.");
      const [tickets, sales, next] = await Promise.all([repo.confirmedTickets(drawId), repo.confirmedSales(drawId), repo.nextDraw(drawId)]);
      const calc = runCalc(draw, toWinningValue(draft), tickets, sales, now);
      const nextJackpot = calc.summary.gameType === "SIX_CHANCE" ? calc.summary.financials.nextJackpotToman : null;
      let downstream = null;
      if (nextJackpot !== null) {
        const locked = next ? Boolean(next.has_public_result) || ["PUBLISHED", "SETTLED", "CLOSED"].includes(next.status) : false;
        downstream = next
          ? {
              drawNumber: next.draw_number,
              currentToman: next.opening_jackpot_toman,
              nextJackpotToman: nextJackpot,
              action: next.opening_jackpot_toman === nextJackpot ? "UNCHANGED" : locked ? "REQUIRES_MANUAL_RECONCILIATION" : "APPLY",
            }
          : { drawNumber: null, currentToman: null, nextJackpotToman: nextJackpot, action: "NO_NEXT_DRAW" };
        if (downstream.action === "REQUIRES_MANUAL_RECONCILIATION") {
          calc.warnings.push({ code: "DOWNSTREAM_JACKPOT_LOCKED", params: { drawNumber: next!.draw_number, currentToman: next!.opening_jackpot_toman, nextJackpotToman: nextJackpot } });
        }
      }
      return { resultId: draft.id, versionNumber: draft.version_number, isCorrection: versions.some((v) => v.is_public_current), downstream, ...calcShape(calc) };
    },

    async publish(
      drawId: string,
      body: { resultId: string; calculationHash: string; reason: string; earlyReason?: string | undefined },
      adminId: string,
      ctx: RequestContext,
      now = new Date(),
    ) {
      const draw = await loadDraw(drawId);
      const early = draw.sales_closes_at > now || draw.draw_at > now;
      if (early && !body.earlyReason) {
        throw new BusinessRuleError("EARLY_REASON_REQUIRED", "The draw time has not arrived; a reason is required to publish now.", {
          drawAt: draw.draw_at.toISOString(),
        });
      }
      const result = await repo.publish({
        early: early ? { reason: body.earlyReason! } : null,
        drawId,
        resultId: body.resultId,
        adminId,
        reason: body.reason,
        expectedHash: body.calculationHash,
        calculate: ({ draw, value, tickets, sales, asOf }) => runCalc(draw, value, tickets, sales, asOf),
        audit: ctx,
      });
      switch (result.outcome) {
        case "not_found":
          throw new NotFoundError("No such draft result for this draw.");
        case "not_draft":
          throw new BusinessRuleError("RESULT_NOT_DRAFT", `This result is ${result.status} and cannot be published.`);
        case "blocked":
          throw new BusinessRuleError("CALCULATION_BLOCKED", "The prize calculation has unresolved blockers.", { blockers: result.calc.blockers });
        case "hash_mismatch":
          throw new BusinessRuleError("PREVIEW_OUTDATED", "The draft or its tickets changed since the preview. Review the new preview before publishing.", {
            calculationHash: result.calc.calculationHash,
          });
        case "already_published":
          return {
            resultId: result.resultId,
            versionNumber: result.versionNumber,
            alreadyPublished: true,
            isCorrection: false,
            winningTickets: null,
            totalCashLiabilityToman: null,
            downstreamJackpot: null,
            claimsFlaggedForReconciliation: 0,
          };
        case "published":
          return {
            resultId: result.resultId,
            versionNumber: result.versionNumber,
            alreadyPublished: false,
            isCorrection: result.isCorrection,
            winningTickets: result.calc.awards.length,
            totalCashLiabilityToman: result.calc.summary.totalCashLiabilityToman,
            downstreamJackpot: result.downstream,
            claimsFlaggedForReconciliation: result.claimsFlagged,
          };
      }
    },

    /**
     * SUPER_ADMIN override of a Six Chance draw's advertised jackpot — at any time, with a
     * reason, recorded append-only. A published draw gets a correction draft instead of any
     * change to its awards (see results.repository#overrideOpeningJackpot).
     */
    async overrideOpeningJackpot(drawId: string, body: { amountToman: string; reason: string }, adminId: string, ctx: RequestContext) {
      const res = await repo.overrideOpeningJackpot({ drawId, amountToman: BigInt(body.amountToman), reason: body.reason, adminId, audit: ctx });
      switch (res.outcome) {
        case "not_found":
          throw new NotFoundError(`No draw found with id "${drawId}".`);
        case "not_six_chance":
          throw new BusinessRuleError("NOT_SIX_CHANCE", "Only Six Chance draws have a jackpot.");
        case "unchanged":
          throw new BusinessRuleError("JACKPOT_UNCHANGED", "The draw already advertises this jackpot.");
        case "overridden":
          return {
            drawId,
            openingJackpotToman: body.amountToman,
            previousToman: res.previousToman,
            requiresCorrection: res.hasPublishedResult,
            correctionDraftVersion: res.correctionDraftVersion,
            existingDraftVersion: res.existingDraftVersion,
          };
      }
    },

    // ---------------------------------------------------------------- public

    async publicList(q: { page: number; pageSize: number; game?: string | undefined }) {
      const { items, total } = await repo.listPublished({ page: q.page, pageSize: q.pageSize, slug: q.game });
      return {
        page: q.page,
        pageSize: q.pageSize,
        total,
        items: items.map((d) => {
          const summary = d.summary as unknown as CalcOutput["summary"];
          const value = toWinningValue({ game_type: d.result_game_type, number_value: d.number_value, draw_order_values: d.draw_order_values, symbol: d.symbol });
          return {
            game: { slug: d.game_slug, gameType: d.game_type, nameEn: d.name_en, nameFa: d.name_fa },
            drawNumber: d.draw_number,
            drawAt: d.draw_at.toISOString(),
            // The draw's first publication time — never the correction's — so nothing hints
            // that a result was corrected.
            publishedAt: (d.published_at ?? d.result_published_at!).toISOString(),
            winning: publicWinning(value),
            winningRows: summary.tiers.reduce((n, t) => n + t.winningCombinations, 0),
          };
        }),
      };
    },

    async publicDetail(slug: string, drawNumber: string) {
      const draw = await repo.findPublicDraw(slug, drawNumber);
      if (!draw) throw new NotFoundError("No published result for this draw.");
      const [versions, run, evidence] = await Promise.all([
        repo.resultVersions(draw.id),
        repo.currentPublishedRun(draw.id),
        repo.latestEvidence(draw.id),
      ]);
      const current = versions.find((v) => v.is_public_current);
      if (!current || !run) throw new NotFoundError("No published result for this draw.");
      const summary = run.summary as unknown as CalcOutput["summary"];
      const tiers = summary.tiers.map((t) => ({
        code: t.code,
        match: t.match,
        prizeType: t.prizeType,
        winningRows: t.winningCombinations,
        prizePerRowToman: t.amountPerCombinationToman,
        freeTicketsPerRow: t.freeTicketsPerCombination,
        totalPrizeToman: t.totalCashToman,
      }));
      return {
        game: { slug: draw.game_slug, gameType: draw.game_type, nameEn: draw.name_en, nameFa: draw.name_fa },
        drawNumber: draw.draw_number,
        drawAt: draw.draw_at.toISOString(),
        salesClosedAt: draw.sales_closes_at.toISOString(),
        publishedAt: (draw.published_at ?? current.published_at!).toISOString(),
        officialTimezone: draw.official_timezone,
        winning: publicWinning(toWinningValue(current)),
        confirmedTickets: summary.confirmedTickets,
        tiers,
        totalPrizeToman: summary.totalCashLiabilityToman,
        jackpot: summary.jackpot
          ? {
              amountToman: summary.jackpot.openingJackpotToman,
              won: summary.jackpot.winningCombinations > 0,
              nextJackpotToman: summary.jackpot.nextJackpotToman ?? null,
            }
          : null,
        evidence: evidence ? { youtubeUrl: evidence.archive_url ?? evidence.youtube_live_url } : null,
      };
    },
  };
}

export type ResultsService = ReturnType<typeof createResultsService>;
