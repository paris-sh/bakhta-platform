import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors.js";
import type { AuditService } from "../audit/audit.service.js";
import type { GamesRepository } from "../games/games.repository.js";
import { scheduleSchema } from "../games/rules.schemas.js";
import type { DrawsRepository } from "./draws.repository.js";
import { computeScheduledOccurrences } from "./schedule.js";

export interface AuditContext {
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
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
}) {
  return {
    id: draw.id,
    gameId: draw.game_id,
    drawNumber: draw.draw_number,
    status: draw.status,
    salesOpensAt: draw.sales_opens_at.toISOString(),
    salesClosesAt: draw.sales_closes_at.toISOString(),
    drawAt: draw.draw_at.toISOString(),
    officialTimezone: draw.official_timezone,
    currentRuleVersionId: draw.current_rule_version_id,
    currentRulesSnapshot: draw.current_rules_snapshot as Record<string, unknown>,
    openingJackpotToman: draw.opening_jackpot_toman,
    finalJackpotToman: draw.final_jackpot_toman,
    youtubeLiveUrl: draw.youtube_live_url,
    publishedAt: draw.published_at ? draw.published_at.toISOString() : null,
    settledAt: draw.settled_at ? draw.settled_at.toISOString() : null,
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

export function createDrawsService(
  repo: DrawsRepository,
  gamesRepo: GamesRepository,
  audit: AuditService,
) {
  return {
    async listDrawsForGame(gameId: string) {
      const game = await gamesRepo.findGameById(gameId);
      if (!game) throw new NotFoundError(`No game found with id "${gameId}".`);
      const draws = await repo.listDrawsForGame(gameId);
      return draws.map(toDrawShape);
    },

    async getDraw(id: string) {
      const draw = await repo.findDrawById(id);
      if (!draw) throw new NotFoundError(`No draw found with id "${id}".`);
      return toDrawShape(draw);
    },

    /** Public: reads the next SALES_OPEN draw from the draws TABLE — never recomputes a
     * "next occurrence" from the schedule on the fly. If nothing has been generated yet
     * (see generateUpcomingDraws), there is no next draw to return, and that is surfaced
     * as NotFoundError rather than silently synthesizing one. */
    async getNextPublicDraw(gameId: string) {
      const draw = await repo.findNextOpenDraw(gameId);
      if (!draw) throw new NotFoundError("No upcoming draw is currently scheduled for this game.");
      return toDrawShape(draw);
    },

    /**
     * Materializes real `draws` rows from the game's currently ACTIVE rule version's
     * `schedule`, for occurrences within [today, today + horizonDays] that don't already
     * have a draw (idempotent — safe to call repeatedly, e.g. from a daily scheduled job).
     * Each created draw permanently snapshots current_rule_version_id and
     * current_rules_snapshot at creation time: a later rule-version activation changes what
     * NEW draws will snapshot, never what an already-created draw already snapshotted.
     */
    async generateUpcomingDraws(
      gameId: string,
      horizonDays: number,
      actorAdminId: string,
      ctx: AuditContext,
    ) {
      const game = await gamesRepo.findGameById(gameId);
      if (!game) throw new NotFoundError(`No game found with id "${gameId}".`);

      const activeRuleVersion = await gamesRepo.findActiveRuleVersion(gameId);
      if (!activeRuleVersion) {
        throw new ConflictError(
          "This game has no ACTIVE rule version yet — activate one before generating draws.",
        );
      }

      const rawSchedule = (activeRuleVersion.rules as Record<string, unknown>).schedule;
      const parsedSchedule = scheduleSchema.safeParse(rawSchedule);
      if (!parsedSchedule.success) {
        throw new ValidationError(
          "The active rule version's rules.schedule is missing or invalid.",
          { issues: parsedSchedule.error.issues },
        );
      }

      const todayISO = new Date().toISOString().slice(0, 10);
      const occurrences = computeScheduledOccurrences(parsedSchedule.data, todayISO, horizonDays);

      const existing = await repo.existingDrawTimestamps(gameId);
      const toCreate = occurrences.filter((o) => !existing.has(o.drawAt.getTime()));

      const created = [];
      let nextNumber = await repo.nextDrawNumber(gameId);
      for (const occurrence of toCreate) {
        const draw = await repo.createDraw({
          gameId,
          gameType: game.game_type,
          drawNumber: nextNumber,
          salesOpensAt: occurrence.salesOpensAt,
          salesClosesAt: occurrence.salesClosesAt,
          drawAt: occurrence.drawAt,
          officialTimezone: parsedSchedule.data.timezone,
          currentRuleVersionId: activeRuleVersion.id,
          currentRulesSnapshot: activeRuleVersion.rules as Record<string, unknown>,
        });
        created.push(draw);
        nextNumber += 1n;
      }

      if (created.length > 0) {
        await audit.recordAdminAction({
          adminId: actorAdminId,
          action: "draws.generate",
          entityType: "games",
          entityId: gameId,
          newValues: {
            created_count: created.length,
            draw_numbers: created.map((d) => d.draw_number),
            rule_version_id: activeRuleVersion.id,
          },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });
      }

      return created.map(toDrawShape);
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
