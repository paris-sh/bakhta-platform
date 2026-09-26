import type { Database } from "../../db/client.js";
import type { DrawEvidenceStatusEnum, GameTypeEnum } from "../../db/types.js";

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

    /** draw_at timestamps already materialized for this game, to make schedule generation
     * idempotent (never insert a second draw for an occurrence that already exists). */
    async existingDrawTimestamps(gameId: string): Promise<Set<number>> {
      const rows = await db
        .selectFrom("draws")
        .select("draw_at")
        .where("game_id", "=", gameId)
        .execute();
      return new Set(rows.map((r) => r.draw_at.getTime()));
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
