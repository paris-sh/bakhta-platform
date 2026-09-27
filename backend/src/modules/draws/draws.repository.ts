import type { Database } from "../../db/client.js";
import type { DrawEvidenceStatusEnum, GameTypeEnum } from "../../db/types.js";

/** A DATE column as "YYYY-MM-DD" whether the driver returns a string or a Date. */
function isoDate(v: unknown): string {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  return String(v).slice(0, 10);
}

export function createDrawsRepository(db: Database) {
  return {
    async listDrawsForGame(gameId: string) {
      return db
        .selectFrom("draws")
        .selectAll()
        .where("game_id", "=", gameId)
        .orderBy("draw_number")
        .execute();
    },

    async findDrawById(id: string) {
      return db.selectFrom("draws").selectAll().where("id", "=", id).executeTakeFirst();
    },

    /** The next SALES_OPEN draw for a game, by draw_at — a plain indexed query against
     * already-materialized rows, never computed from the schedule on request. */
    async findNextOpenDraw(gameId: string) {
      return db
        .selectFrom("draws")
        .selectAll()
        .where("game_id", "=", gameId)
        .where("status", "=", "SALES_OPEN")
        // No scheduler moves a draw to SALES_CLOSED at its cutoff yet, so a past-cutoff draw
        // can still carry SALES_OPEN — skip it the same way order creation rejects it.
        .where("sales_closes_at", ">", new Date())
        .orderBy("draw_at")
        .executeTakeFirst();
    },

    async nextDrawNumber(gameId: string): Promise<bigint> {
      const row = await db
        .selectFrom("draws")
        .select((eb) => eb.fn.max("draw_number").as("max_draw_number"))
        .where("game_id", "=", gameId)
        .executeTakeFirst();
      return row?.max_draw_number ? BigInt(row.max_draw_number) + 1n : 1n;
    },

    /** Occurrences (slotId|localDate) claimed by a live draw of this game. */
    async claimedOccurrences(gameId: string): Promise<Set<string>> {
      const rows = await db
        .selectFrom("draws")
        .select(["scheduled_slot_id", "scheduled_local_date"])
        .where("game_id", "=", gameId)
        .where("scheduled_slot_id", "is not", null)
        .where("status", "not in", ["CANCELLED", "VOID"])
        .execute();
      return new Set(rows.map((r) => `${r.scheduled_slot_id}|${isoDate(r.scheduled_local_date)}`));
    },

    /** Occurrences (slotId|localDate) a SUPER_ADMIN dismissed for this game. */
    async dismissedOccurrences(gameId: string): Promise<Set<string>> {
      const rows = await db.selectFrom("scheduled_occurrence_dismissals").select(["slot_id", "local_date"]).where("game_id", "=", gameId).execute();
      return new Set(rows.map((r) => `${r.slot_id}|${isoDate(r.local_date)}`));
    },

    /** Records a dismissed occurrence and its audit entry in one transaction. The database
     * refuses it when a live draw already claims the occurrence (and vice versa). */
    async dismissOccurrence(input: {
      gameId: string;
      slotId: string;
      localDate: string;
      scheduledDrawAt: Date;
      timezone: string;
      reason: string;
      adminId: string;
      audit: { requestId: string | null; ipAddress: string | null; userAgent: string | null };
    }) {
      return db.transaction().execute(async (trx) => {
        const row = await trx
          .insertInto("scheduled_occurrence_dismissals")
          .values({
            game_id: input.gameId,
            slot_id: input.slotId,
            local_date: input.localDate,
            scheduled_draw_at: input.scheduledDrawAt,
            schedule_timezone: input.timezone,
            reason: input.reason,
            dismissed_by: input.adminId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("audit_logs")
          .values({
            actor_type: "ADMIN",
            actor_admin_id: input.adminId,
            action: "draws.occurrence_dismiss",
            entity_type: "scheduled_occurrence_dismissals",
            entity_id: row.id,
            new_values: JSON.stringify({
              game_id: input.gameId,
              slot_id: input.slotId,
              local_date: input.localDate,
              scheduled_draw_at: input.scheduledDrawAt.toISOString(),
              schedule_timezone: input.timezone,
            }),
            reason: input.reason,
            request_id: input.audit.requestId,
            ip_address: input.audit.ipAddress,
            user_agent: input.audit.userAgent,
            severity: "WARNING",
          })
          .execute();
        return row;
      });
    },

    /**
     * The jackpot a new Six Chance draw is prefilled with: the next jackpot of the game's most
     * recent PUBLISHED calculation (public current result), or null when none exists yet (the
     * caller then uses the configured minimum).
     */
    async latestPublishedCarryForward(gameId: string): Promise<string | null> {
      const run = await db
        .selectFrom("prize_calculation_runs as pr")
        .innerJoin("results as r", "r.id", "pr.result_id")
        .innerJoin("draws as d", "d.id", "pr.draw_id")
        .select("pr.summary")
        .where("d.game_id", "=", gameId)
        .where("pr.status", "=", "PUBLISHED")
        .where("r.is_public_current", "=", true)
        .orderBy("d.draw_at", "desc")
        .limit(1)
        .executeTakeFirst();
      const next = (run?.summary as { financials?: { nextJackpotToman?: unknown } } | undefined)?.financials?.nextJackpotToman;
      return typeof next === "string" ? next : null;
    },

    async paidClaimCount(drawId: string) {
      const row = await db
        .selectFrom("prize_claims as c")
        .innerJoin("tickets as t", "t.id", "c.ticket_id")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("t.draw_id", "=", drawId)
        .where("c.status", "=", "PAID")
        .executeTakeFirstOrThrow();
      return Number(row.n);
    },

    /** Other live draws of a game, for overlap warnings. */
    async drawWindows(gameId: string, excludeDrawId?: string) {
      let q = db
        .selectFrom("draws")
        .select(["id", "draw_number", "sales_opens_at", "sales_closes_at", "draw_at", "status"])
        .where("game_id", "=", gameId)
        .where("status", "not in", ["CANCELLED", "VOID"]);
      if (excludeDrawId) q = q.where("id", "!=", excludeDrawId);
      return q.orderBy("draw_at").execute();
    },

    async confirmedTicketCount(drawId: string) {
      const row = await db
        .selectFrom("tickets")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("draw_id", "=", drawId)
        .where("status", "=", "CONFIRMED")
        .executeTakeFirstOrThrow();
      return Number(row.n);
    },

    async hasPublicResult(drawId: string) {
      const row = await db.selectFrom("results").select("id").where("draw_id", "=", drawId).where("is_public_current", "=", true).executeTakeFirst();
      return row !== undefined;
    },

    async updateDrawTimes(drawId: string, times: { salesOpensAt: Date; salesClosesAt: Date; drawAt: Date }) {
      return db
        .updateTable("draws")
        .set({ sales_opens_at: times.salesOpensAt, sales_closes_at: times.salesClosesAt, draw_at: times.drawAt })
        .where("id", "=", drawId)
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    async createDraw(input: {
      gameId: string;
      gameType: GameTypeEnum;
      drawNumber: bigint;
      salesOpensAt: Date;
      salesClosesAt: Date;
      drawAt: Date;
      officialTimezone: string;
      currentRuleVersionId: string;
      currentRulesSnapshot: Record<string, unknown>;
      openingJackpotToman?: string | null;
      occurrence?: { slotId: string; localDate: string; scheduledDrawAt: Date; timezone: string; claim: "SCHEDULED" | "REPLACEMENT" } | null;
    }) {
      return db
        .insertInto("draws")
        .values({
          game_id: input.gameId,
          game_type: input.gameType,
          draw_number: input.drawNumber.toString(),
          status: "SALES_OPEN",
          sales_opens_at: input.salesOpensAt,
          sales_closes_at: input.salesClosesAt,
          draw_at: input.drawAt,
          official_timezone: input.officialTimezone,
          current_rule_version_id: input.currentRuleVersionId,
          // Snapshotted at creation time, as its own independent JSONB value — never a live
          // reference to game_rule_versions. A later rule-version change literally cannot
          // reach this column; it would require a separate, explicit write to THIS row.
          current_rules_snapshot: JSON.stringify(input.currentRulesSnapshot),
          opening_jackpot_toman: input.openingJackpotToman ?? null,
          ...(input.occurrence
            ? {
                scheduled_slot_id: input.occurrence.slotId,
                scheduled_local_date: input.occurrence.localDate,
                scheduled_draw_at: input.occurrence.scheduledDrawAt,
                schedule_timezone: input.occurrence.timezone,
                schedule_claim: input.occurrence.claim,
              }
            : {}),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    async createEvidence(input: {
      drawId: string;
      youtubeLiveUrl: string;
      youtubeVideoId: string;
      scheduledAt: Date | null;
    }) {
      return db
        .insertInto("draw_evidence")
        .values({
          draw_id: input.drawId,
          youtube_live_url: input.youtubeLiveUrl,
          youtube_video_id: input.youtubeVideoId,
          scheduled_at: input.scheduledAt,
          status: "SCHEDULED",
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    async findLatestEvidence(drawId: string) {
      return db
        .selectFrom("draw_evidence")
        .selectAll()
        .where("draw_id", "=", drawId)
        .orderBy("created_at", "desc")
        .executeTakeFirst();
    },

    async findEvidenceById(id: string) {
      return db.selectFrom("draw_evidence").selectAll().where("id", "=", id).executeTakeFirst();
    },

    async updateEvidenceStatus(
      evidenceId: string,
      patch: {
        status?: DrawEvidenceStatusEnum;
        startedAt?: Date;
        endedAt?: Date;
        archiveUrl?: string;
      },
    ) {
      return db
        .updateTable("draw_evidence")
        .set({
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.startedAt !== undefined ? { started_at: patch.startedAt } : {}),
          ...(patch.endedAt !== undefined ? { ended_at: patch.endedAt } : {}),
          ...(patch.archiveUrl !== undefined ? { archive_url: patch.archiveUrl } : {}),
        })
        .where("id", "=", evidenceId)
        .returningAll()
        .executeTakeFirst();
    },
  };
}

export type DrawsRepository = ReturnType<typeof createDrawsRepository>;
