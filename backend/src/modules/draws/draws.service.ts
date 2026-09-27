import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from "../../shared/errors.js";
import type { AuditService } from "../audit/audit.service.js";
import type { GamesRepository } from "../games/games.repository.js";
import { normalizeSchedule, scheduleTimezone, type NormalizedSchedule } from "../games/rules.schemas.js";
import type { DrawsRepository } from "./draws.repository.js";
import { occurrenceOn, occurrenceState, pendingOccurrences, type PendingOccurrence, type ScheduledOccurrence } from "./schedule.js";
import { drawSalesState } from "./sales-window.js";

export interface AuditContext {
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

function dateOnly(v: unknown): string {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  return String(v).slice(0, 10);
}

function toDrawShape(draw: {
  id: string;
  game_id: string;
  draw_number: string;
  status: string;
  sales_opens_at: Date;
  sales_closes_at: Date;
  draw_at: Date;
  official_timezone: string;
  current_rule_version_id: string;
  current_rules_snapshot: unknown;
  opening_jackpot_toman: string | null;
  final_jackpot_toman: string | null;
  youtube_live_url: string | null;
  published_at: Date | null;
  settled_at: Date | null;
  scheduled_slot_id?: string | null;
  scheduled_local_date?: Date | string | null;
  scheduled_draw_at?: Date | null;
  schedule_timezone?: string | null;
  schedule_claim?: string | null;
}, now: Date = new Date()) {
  return {
    id: draw.id,
    gameId: draw.game_id,
    drawNumber: draw.draw_number,
    status: draw.status,
    salesOpensAt: draw.sales_opens_at.toISOString(),
    salesClosesAt: draw.sales_closes_at.toISOString(),
    // Server-side verdict (see sales-window.ts): a SALES_OPEN row is not necessarily saleable.
    salesState: drawSalesState(draw, now),
    drawAt: draw.draw_at.toISOString(),
    officialTimezone: draw.official_timezone,
    currentRuleVersionId: draw.current_rule_version_id,
    currentRulesSnapshot: draw.current_rules_snapshot as Record<string, unknown>,
    openingJackpotToman: draw.opening_jackpot_toman,
    finalJackpotToman: draw.final_jackpot_toman,
    youtubeLiveUrl: draw.youtube_live_url,
    publishedAt: draw.published_at ? draw.published_at.toISOString() : null,
    settledAt: draw.settled_at ? draw.settled_at.toISOString() : null,
    // Admin-only (stripped from the public response schema): the scheduled occurrence this
    // draw claimed at creation, kept even when its actual times are edited later.
    scheduledOccurrence:
      draw.scheduled_slot_id && draw.scheduled_local_date && draw.scheduled_draw_at && draw.schedule_timezone
        ? {
            slotId: draw.scheduled_slot_id,
            localDate: dateOnly(draw.scheduled_local_date),
            scheduledDrawAt: draw.scheduled_draw_at.toISOString(),
            timezone: draw.schedule_timezone,
            claim: draw.schedule_claim as "SCHEDULED" | "REPLACEMENT",
          }
        : null,
  };
}

function toEvidenceShape(ev: {
  id: string;
  draw_id: string;
  youtube_live_url: string;
  youtube_video_id: string;
  scheduled_at: Date | null;
  started_at: Date | null;
  ended_at: Date | null;
  archive_url: string | null;
  status: string;
}) {
  return {
    id: ev.id,
    drawId: ev.draw_id,
    youtubeLiveUrl: ev.youtube_live_url,
    youtubeVideoId: ev.youtube_video_id,
    scheduledAt: ev.scheduled_at ? ev.scheduled_at.toISOString() : null,
    startedAt: ev.started_at ? ev.started_at.toISOString() : null,
    endedAt: ev.ended_at ? ev.ended_at.toISOString() : null,
    archiveUrl: ev.archive_url,
    status: ev.status,
  };
}

export interface DrawWarning {
  code:
    | "SALES_OPENING_IN_PAST"
    | "SALES_CLOSING_IN_PAST"
    | "DRAW_TIME_IN_PAST"
    | "OVERLAPS_DRAW"
    | "SAME_DRAW_TIME"
    | "TICKETS_ALREADY_SOLD"
    | "DIFFERS_FROM_SCHEDULE"
    | "RESULT_PUBLISHED"
    | "CLAIMS_PAID";
  params?: Record<string, string | number>;
}

type Times = { salesOpensAt: Date; salesClosesAt: Date; drawAt: Date };

/**
 * Unusual-but-allowed times. A warning never blocks a SUPER_ADMIN; it makes a reason
 * mandatory. Times taken unchanged from a claimed scheduled occurrence are what the board
 * configured, so a past opening (an overdue occurrence) or an overlap between slots is not
 * flagged for them; closing or drawing in the past always is.
 */
function drawWarnings(
  times: Times,
  others: { draw_number: string; sales_opens_at: Date; sales_closes_at: Date; draw_at: Date }[],
  now: Date,
  opts: { confirmedTickets?: number; matchesSchedule?: boolean } = {},
): DrawWarning[] {
  const w: DrawWarning[] = [];
  const grace = 5 * 60_000;
  if (!opts.matchesSchedule && times.salesOpensAt.getTime() < now.getTime() - grace) w.push({ code: "SALES_OPENING_IN_PAST" });
  if (times.salesClosesAt.getTime() < now.getTime()) w.push({ code: "SALES_CLOSING_IN_PAST" });
  if (times.drawAt.getTime() < now.getTime()) w.push({ code: "DRAW_TIME_IN_PAST" });
  for (const o of others) {
    if (!opts.matchesSchedule && times.salesOpensAt < o.sales_closes_at && o.sales_opens_at < times.salesClosesAt) {
      w.push({ code: "OVERLAPS_DRAW", params: { drawNumber: o.draw_number } });
    }
    if (times.drawAt.getTime() === o.draw_at.getTime()) w.push({ code: "SAME_DRAW_TIME", params: { drawNumber: o.draw_number } });
  }
  if (opts.confirmedTickets) w.push({ code: "TICKETS_ALREADY_SOLD", params: { tickets: opts.confirmedTickets } });
  return w;
}

/** Structurally impossible windows are refused; everything else is a warning at most. */
function checkOrder(times: Times) {
  if (!(times.salesOpensAt < times.salesClosesAt)) throw new ValidationError("Sales must open before they close.");
  if (!(times.salesClosesAt < times.drawAt)) throw new ValidationError("Sales must close before the draw time.");
}

const sameTimes = (a: Times, o: ScheduledOccurrence) =>
  a.salesOpensAt.getTime() === o.salesOpensAt.getTime() && a.salesClosesAt.getTime() === o.salesClosesAt.getTime() && a.drawAt.getTime() === o.drawAt.getTime();

function occurrenceShape(o: PendingOccurrence | (ScheduledOccurrence & { state: string })) {
  return {
    key: `${o.slotId}|${o.localDate}`,
    slotId: o.slotId,
    slotLabel: o.slotLabel,
    localDate: o.localDate,
    timezone: o.timezone,
    drawAt: o.drawAt.toISOString(),
    salesOpensAt: o.salesOpensAt.toISOString(),
    salesClosesAt: o.salesClosesAt.toISOString(),
    state: o.state,
  };
}

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";

export function createDrawsService(
  repo: DrawsRepository,
  gamesRepo: GamesRepository,
  audit: AuditService,
) {
  /** The game's ACTIVE settings and their schedule, or a clear error. */
  async function activeSchedule(gameId: string) {
    const game = await gamesRepo.findGameById(gameId);
    if (!game) throw new NotFoundError(`No game found with id "${gameId}".`);
    const active = await gamesRepo.findActiveRuleVersion(gameId);
    if (!active) throw new ConflictError("This game has no active settings yet.");
    const rules = active.rules as { minimum_jackpot_toman?: unknown; schedule?: unknown };
    const schedule = normalizeSchedule(rules.schedule);
    if (!schedule) throw new ValidationError("The active settings have no valid schedule.");
    return { game, active, rules, schedule };
  }

  /** The occurrence (slot, local date) of the active schedule, or a 409 when it does not exist. */
  function resolveOccurrence(schedule: NormalizedSchedule, slotId: string, localDate: string) {
    const slot = schedule.slots.find((s) => s.slot_id === slotId);
    if (!slot) throw new BusinessRuleError("OCCURRENCE_NOT_IN_SCHEDULE", `The active schedule has no slot "${slotId}".`);
    const o = occurrenceOn(schedule, slot, localDate);
    if (!o) throw new BusinessRuleError("OCCURRENCE_NOT_IN_SCHEDULE", `Slot "${slotId}" has no draw on ${localDate}.`);
    return o;
  }

  async function suggestedJackpot(gameId: string, gameType: string, minimum: unknown) {
    if (gameType !== "SIX_CHANCE") return { amount: null, source: null };
    const carried = await repo.latestPublishedCarryForward(gameId);
    return carried
      ? { amount: carried, source: "LATEST_PUBLISHED_CALCULATION" as const }
      : { amount: String(minimum ?? 0), source: "MINIMUM" as const };
  }

  return {
    async listDrawsForGame(gameId: string) {
      const game = await gamesRepo.findGameById(gameId);
      if (!game) throw new NotFoundError(`No game found with id "${gameId}".`);
      const draws = await repo.listDrawsForGame(gameId);
      return draws.map((d) => toDrawShape(d));
    },

    async getDraw(id: string) {
      const draw = await repo.findDrawById(id);
      if (!draw) throw new NotFoundError(`No draw found with id "${id}".`);
      return toDrawShape(draw);
    },

    /** Public: reads the next SALES_OPEN draw from the draws TABLE — never derives one from
     * the schedule. Draws exist only once a SUPER_ADMIN created them. */
    async getNextPublicDraw(gameId: string) {
      const draw = await repo.findNextOpenDraw(gameId);
      if (!draw) throw new NotFoundError("No upcoming draw is currently scheduled for this game.");
      return toDrawShape(draw);
    },

    /**
     * Reminders for one game, derived from the ACTIVE settings' schedule. Read-only: nothing
     * is inserted — only the SUPER_ADMIN's explicit Create Draw does that. `next` is the
     * occurrence the Create Draw form is prefilled with.
     */
    async gameReminders(gameId: string, now = new Date()) {
      const { game, active, rules, schedule } = await activeSchedule(gameId);
      const since = active.activated_at ?? active.created_at;
      const pending = pendingOccurrences(schedule, now, {
        since,
        claimed: await repo.claimedOccurrences(gameId),
        dismissed: await repo.dismissedOccurrences(gameId),
      });
      const jackpot = await suggestedJackpot(gameId, game.game_type, rules.minimum_jackpot_toman);
      const next = pending.find((o) => o.state !== "MISSED") ?? pending[0] ?? null;
      return {
        gameId,
        gameType: game.game_type,
        ruleVersion: { id: active.id, versionNumber: active.version_number },
        drawNumber: (await repo.nextDrawNumber(gameId)).toString(),
        suggestedJackpotToman: jackpot.amount,
        jackpotSource: jackpot.source,
        slots: schedule.slots.map((s) => ({ slotId: s.slot_id, label: s.label ?? null, enabled: s.enabled, drawTime: s.draw_time, timezone: s.timezone, weekdays: s.weekdays })),
        occurrences: pending.map(occurrenceShape),
        next: next ? occurrenceShape(next) : null,
      };
    },

    /** Reminders for every ACTIVE game with valid active settings (dashboard). */
    async listReminders(now = new Date()) {
      const games = await gamesRepo.listGames();
      const out = [];
      for (const g of games) {
        if (g.status !== "ACTIVE") continue;
        try {
          out.push(await this.gameReminders(g.id, now));
        } catch {
          // No active settings or no valid schedule: nothing to remind about.
        }
      }
      return out;
    },

    /** SUPER_ADMIN decision for a scheduled occurrence nobody will create (e.g. missed). */
    async dismissOccurrence(gameId: string, input: { slotId: string; localDate: string; reason: string }, adminId: string, ctx: AuditContext) {
      const { schedule } = await activeSchedule(gameId);
      const o = resolveOccurrence(schedule, input.slotId, input.localDate);
      try {
        await repo.dismissOccurrence({
          gameId,
          slotId: o.slotId,
          localDate: o.localDate,
          scheduledDrawAt: o.drawAt,
          timezone: o.timezone,
          reason: input.reason,
          adminId,
          audit: ctx,
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw new BusinessRuleError("OCCURRENCE_TAKEN", "This scheduled occurrence already has a draw or was already dismissed.");
        throw e;
      }
      return this.gameReminders(gameId);
    },

    /**
     * SUPER_ADMIN manual draw creation — the ONLY operation that inserts a draw. Snapshots the
     * ACTIVE rule version and, for Six Chance, the advertised jackpot. It may claim one
     * scheduled occurrence (SCHEDULED from a reminder, or REPLACEMENT for a special draw that
     * explicitly replaces it); without one it is a special draw that claims nothing. Unusual
     * or overlapping times are allowed with a mandatory reason; everything is audited.
     */
    async createManualDraw(
      gameId: string,
      input: {
        salesOpensAt: string;
        salesClosesAt: string;
        drawAt: string;
        openingJackpotToman?: string | undefined;
        ruleVersionId?: string | undefined;
        occurrence?: { slotId: string; localDate: string; claim: "SCHEDULED" | "REPLACEMENT" } | undefined;
        reason?: string | undefined;
        dryRun?: boolean | undefined;
      },
      actorAdminId: string,
      ctx: AuditContext,
      now = new Date(),
    ) {
      const { game, active, rules, schedule } = await activeSchedule(gameId);
      // The form shows which settings the draw will snapshot; refuse if they changed since.
      if (input.ruleVersionId && input.ruleVersionId !== active.id) {
        throw new BusinessRuleError("SETTINGS_CHANGED", "The game settings changed after this form was opened; review the draw again.", {
          activeRuleVersionId: active.id,
          activeVersionNumber: active.version_number,
        });
      }
      const times = { salesOpensAt: new Date(input.salesOpensAt), salesClosesAt: new Date(input.salesClosesAt), drawAt: new Date(input.drawAt) };
      checkOrder(times);
      if (game.game_type !== "SIX_CHANCE" && input.openingJackpotToman !== undefined) {
        throw new ValidationError("Only Six Chance draws have a jackpot.");
      }
      const occurrence = input.occurrence ? resolveOccurrence(schedule, input.occurrence.slotId, input.occurrence.localDate) : null;
      if (occurrence) {
        const key = `${occurrence.slotId}|${occurrence.localDate}`;
        if ((await repo.claimedOccurrences(gameId)).has(key) || (await repo.dismissedOccurrences(gameId)).has(key)) {
          throw new BusinessRuleError("OCCURRENCE_TAKEN", "This scheduled occurrence already has a draw or was dismissed.");
        }
      }
      const matchesSchedule = occurrence !== null && sameTimes(times, occurrence);
      const warnings = drawWarnings(times, await repo.drawWindows(gameId), now, { matchesSchedule });
      if (occurrence && !matchesSchedule) warnings.push({ code: "DIFFERS_FROM_SCHEDULE" });

      let jackpot: string | null = null;
      let jackpotSource: "ENTERED" | "LATEST_PUBLISHED_CALCULATION" | "MINIMUM" | null = null;
      if (game.game_type === "SIX_CHANCE") {
        const suggested = await suggestedJackpot(gameId, game.game_type, rules.minimum_jackpot_toman);
        jackpot = input.openingJackpotToman ?? suggested.amount;
        jackpotSource = input.openingJackpotToman ? "ENTERED" : suggested.source;
      }
      const nextNumber = await repo.nextDrawNumber(gameId);
      const plan = {
        warnings,
        ruleVersion: { id: active.id, versionNumber: active.version_number },
        openingJackpotToman: jackpot,
        jackpotSource,
        drawNumber: nextNumber.toString(),
        occurrence: occurrence ? { ...occurrenceShape({ ...occurrence, state: occurrenceState(occurrence, now) }), claim: input.occurrence!.claim } : null,
      };
      if (input.dryRun) return { dryRun: true as const, ...plan, draw: null };
      if (warnings.length > 0 && !input.reason) {
        throw new BusinessRuleError("REASON_REQUIRED", "These times are unusual; a reason is required.", { warnings });
      }
      let draw;
      try {
        draw = await repo.createDraw({
          gameId,
          gameType: game.game_type,
          drawNumber: nextNumber,
          salesOpensAt: times.salesOpensAt,
          salesClosesAt: times.salesClosesAt,
          drawAt: times.drawAt,
          officialTimezone: occurrence?.timezone ?? scheduleTimezone(rules.schedule),
          currentRuleVersionId: active.id,
          currentRulesSnapshot: active.rules as Record<string, unknown>,
          openingJackpotToman: jackpot,
          occurrence: occurrence
            ? { slotId: occurrence.slotId, localDate: occurrence.localDate, scheduledDrawAt: occurrence.drawAt, timezone: occurrence.timezone, claim: input.occurrence!.claim }
            : null,
        });
      } catch (e) {
        // The database enforces one live draw per occurrence (and none for a dismissed one).
        if (isUniqueViolation(e)) throw new BusinessRuleError("OCCURRENCE_TAKEN", "This scheduled occurrence already has a draw or was dismissed.");
        throw e;
      }
      await audit.recordAdminAction({
        adminId: actorAdminId,
        action: "draws.create_manual",
        entityType: "draws",
        entityId: draw.id,
        newValues: {
          draw_number: draw.draw_number,
          sales_opens_at: times.salesOpensAt.toISOString(),
          sales_closes_at: times.salesClosesAt.toISOString(),
          draw_at: times.drawAt.toISOString(),
          rule_version_id: active.id,
          opening_jackpot_toman: jackpot,
          jackpot_source: jackpotSource,
          scheduled_occurrence: plan.occurrence,
          warnings,
        },
        reason: input.reason ?? null,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      return { dryRun: false as const, ...plan, draw: toDrawShape(draw) };
    },

    /**
     * SUPER_ADMIN edit of a draw's times at any time, with a mandatory reason. Never touches
     * tickets, snapshots or the draw's scheduled-occurrence identity. When the draw already has
     * a published result (or paid claims), awards and claims are NOT recalculated: the change
     * is flagged for manual reconciliation; result values change only through a correction.
     */
    async updateDrawTimes(
      drawId: string,
      input: { salesOpensAt?: string | undefined; salesClosesAt?: string | undefined; drawAt?: string | undefined; reason?: string | undefined; dryRun?: boolean | undefined },
      actorAdminId: string,
      ctx: AuditContext,
      now = new Date(),
    ) {
      const draw = await repo.findDrawById(drawId);
      if (!draw) throw new NotFoundError(`No draw found with id "${drawId}".`);
      const times = {
        salesOpensAt: input.salesOpensAt ? new Date(input.salesOpensAt) : draw.sales_opens_at,
        salesClosesAt: input.salesClosesAt ? new Date(input.salesClosesAt) : draw.sales_closes_at,
        drawAt: input.drawAt ? new Date(input.drawAt) : draw.draw_at,
      };
      checkOrder(times);
      const warnings = drawWarnings(times, await repo.drawWindows(draw.game_id, drawId), now, { confirmedTickets: await repo.confirmedTicketCount(drawId) });
      const published = await repo.hasPublicResult(drawId);
      const paidClaims = published ? await repo.paidClaimCount(drawId) : 0;
      if (published) warnings.push({ code: "RESULT_PUBLISHED" });
      if (paidClaims > 0) warnings.push({ code: "CLAIMS_PAID", params: { claims: paidClaims } });
      if (input.dryRun) return { dryRun: true as const, warnings, draw: null };
      if (!input.reason) throw new BusinessRuleError("REASON_REQUIRED", "A reason is required to edit a draw.", { warnings });
      const updated = await repo.updateDrawTimes(drawId, times);
      const oldValues = { sales_opens_at: draw.sales_opens_at.toISOString(), sales_closes_at: draw.sales_closes_at.toISOString(), draw_at: draw.draw_at.toISOString() };
      const newValues = { sales_opens_at: times.salesOpensAt.toISOString(), sales_closes_at: times.salesClosesAt.toISOString(), draw_at: times.drawAt.toISOString() };
      await audit.recordAdminAction({
        adminId: actorAdminId,
        action: "draws.update_times",
        entityType: "draws",
        entityId: drawId,
        changedFields: ["sales_opens_at", "sales_closes_at", "draw_at"],
        oldValues,
        newValues: { ...newValues, draw_status: draw.status, warnings },
        reason: input.reason,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      if (published) {
        await audit.recordAdminAction({
          adminId: actorAdminId,
          action: "draws.reconciliation_required",
          entityType: "draws",
          entityId: drawId,
          severity: "WARNING",
          oldValues,
          newValues: { ...newValues, paid_claims: paidClaims, note: "Times changed after publication; awards and claims were not recalculated." },
          reason: input.reason,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });
      }
      return { dryRun: false as const, warnings, draw: toDrawShape(updated) };
    },

    async recordEvidence(
      drawId: string,
      input: { youtubeLiveUrl: string; youtubeVideoId: string; scheduledAt?: string | undefined },
      actorAdminId: string,
      ctx: AuditContext,
    ) {
      const draw = await repo.findDrawById(drawId);
      if (!draw) throw new NotFoundError(`No draw found with id "${drawId}".`);

      const existing = await repo.findLatestEvidence(drawId);
      if (existing) {
        throw new ConflictError(
          "Evidence already exists for this draw. A separately recorded replacement video " +
            "is never treated as the draw's source evidence — update the existing evidence's " +
            "status/timing instead of creating a new one.",
        );
      }

      const created = await repo.createEvidence({
        drawId,
        youtubeLiveUrl: input.youtubeLiveUrl,
        youtubeVideoId: input.youtubeVideoId,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      });

      await audit.recordAdminAction({
        adminId: actorAdminId,
        action: "draw_evidence.create",
        entityType: "draw_evidence",
        entityId: created.id,
        newValues: { draw_id: drawId, youtube_video_id: input.youtubeVideoId },
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return toEvidenceShape(created);
    },

    /** Status/timing only — youtube_live_url/youtube_video_id are immutable once recorded
     * ("a separately recorded replacement video is not the draw evidence"). */
    async updateEvidenceStatus(
      evidenceId: string,
      patch: {
        status?: "LIVE" | "ENDED" | "UNAVAILABLE" | undefined;
        archiveUrl?: string | undefined;
      },
      actorAdminId: string,
      ctx: AuditContext,
    ) {
      const existing = await repo.findEvidenceById(evidenceId);
      if (!existing) throw new NotFoundError(`No draw evidence found with id "${evidenceId}".`);

      const now = new Date();
      const updated = await repo.updateEvidenceStatus(evidenceId, {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.status === "LIVE" && !existing.started_at ? { startedAt: now } : {}),
        ...(patch.status === "ENDED" ? { endedAt: now } : {}),
        ...(patch.archiveUrl !== undefined ? { archiveUrl: patch.archiveUrl } : {}),
      });
      if (!updated) throw new NotFoundError(`No draw evidence found with id "${evidenceId}".`);

      await audit.recordAdminAction({
        adminId: actorAdminId,
        action: "draw_evidence.update_status",
        entityType: "draw_evidence",
        entityId: evidenceId,
        changedFields: Object.keys(patch),
        oldValues: { status: existing.status },
        newValues: { status: updated.status },
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return toEvidenceShape(updated);
    },
  };
}

export type DrawsService = ReturnType<typeof createDrawsService>;
