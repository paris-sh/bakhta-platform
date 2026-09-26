import type { Selectable } from "kysely";
import type { Database } from "../../db/client.js";
import type { GameRuleVersions, GameStatusEnum } from "../../db/types.js";

export function createGamesRepository(db: Database) {
  return {
    async listGames() {
      return db.selectFrom("games").selectAll().orderBy("code").execute();
    },

    async findGameBySlug(slug: string) {
      return db.selectFrom("games").selectAll().where("slug", "=", slug).executeTakeFirst();
    },

    async findGameById(id: string) {
      return db.selectFrom("games").selectAll().where("id", "=", id).executeTakeFirst();
    },

    async updateGame(
      id: string,
      patch: { name_fa?: string; name_en?: string; status?: GameStatusEnum },
    ) {
      return db
        .updateTable("games")
        .set(patch)
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
    },

    async findActiveRuleVersion(gameId: string) {
      return db
        .selectFrom("game_rule_versions")
        .selectAll()
        .where("game_id", "=", gameId)
        .where("status", "=", "ACTIVE")
        .executeTakeFirst();
    },

    async findRuleVersionById(id: string) {
      return db
        .selectFrom("game_rule_versions")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
    },

    async listRuleVersions(gameId: string) {
      return db
        .selectFrom("game_rule_versions")
        .selectAll()
        .where("game_id", "=", gameId)
        .orderBy("version_number", "desc")
        .execute();
    },

    async nextVersionNumber(gameId: string): Promise<number> {
      const row = await db
        .selectFrom("game_rule_versions")
        .select((eb) => eb.fn.max("version_number").as("max_version"))
        .where("game_id", "=", gameId)
        .executeTakeFirst();
      return (row?.max_version ?? 0) + 1;
    },

    async createRuleVersion(input: {
      gameId: string;
      gameType: "SIX_CHANCE" | "FOUR_LEAF";
      versionNumber: number;
      rules: Record<string, unknown>;
      rulesHash: Buffer;
      changeReason: string;
      createdBy: string;
    }) {
      return db
        .insertInto("game_rule_versions")
        .values({
          game_id: input.gameId,
          game_type: input.gameType,
          version_number: input.versionNumber,
          status: "DRAFT",
          rules: JSON.stringify(input.rules),
          rules_hash: input.rulesHash,
          change_reason: input.changeReason,
          created_by: input.createdBy,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    },

    async updateDraftRuleVersion(input: {
      ruleVersionId: string;
      rules?: Record<string, unknown>;
      rulesHash?: Buffer;
      changeReason?: string;
    }) {
      const patch: Record<string, unknown> = {};
      if (input.rules !== undefined) patch.rules = JSON.stringify(input.rules);
      if (input.rulesHash !== undefined) patch.rules_hash = input.rulesHash;
      if (input.changeReason !== undefined) patch.change_reason = input.changeReason;

      return db
        .updateTable("game_rule_versions")
        .set(patch)
        .where("id", "=", input.ruleVersionId)
        .where("status", "=", "DRAFT")
        .returningAll()
        .executeTakeFirst();
    },

    /**
     * Retires the game's current ACTIVE version (if any) and activates the target DRAFT
     * version, atomically — never allowing two ACTIVE rows to exist even transiently.
     *
     * Concurrency design (see tests/concurrency/rule_version_activation_race.sh for the
     * real two-connection proof): the retire step is scoped to the SPECIFIC row this
     * transaction observed as currently active (a compare-and-swap on that row's id), not
     * to a generic "whatever is ACTIVE right now" predicate. If a concurrent transaction
     * already retired that exact row by the time this one's retire-UPDATE runs, the UPDATE
     * naturally affects zero rows (Postgres re-evaluates the WHERE clause against the
     * latest committed version of that specific row after any lock wait) — which this
     * function reports as `concurrent_conflict`, a clean, reportable outcome, rather than
     * silently proceeding to activate a second version and relying on the partial unique
     * index alone as a last-resort safety net.
     */
    async activateRuleVersion(input: {
      gameId: string;
      ruleVersionId: string;
      activatedBy: string;
    }): Promise<
      | { outcome: "activated"; row: Selectable<GameRuleVersions> }
      | { outcome: "not_draft" }
      | { outcome: "concurrent_conflict" }
    > {
      return db.transaction().execute(async (trx) => {
        const currentActive = await trx
          .selectFrom("game_rule_versions")
          .select("id")
          .where("game_id", "=", input.gameId)
          .where("status", "=", "ACTIVE")
          .executeTakeFirst();

        const target = await trx
          .selectFrom("game_rule_versions")
          .select(["id", "status"])
          .where("id", "=", input.ruleVersionId)
          .where("game_id", "=", input.gameId)
          .executeTakeFirst();

        if (!target || target.status !== "DRAFT") {
          return { outcome: "not_draft" as const };
        }

        if (currentActive) {
          const retireResult = await trx
            .updateTable("game_rule_versions")
            .set({ status: "RETIRED", retired_at: new Date() })
            .where("id", "=", currentActive.id)
            .where("status", "=", "ACTIVE")
            .executeTakeFirst();
          if (retireResult.numUpdatedRows === 0n) {
            return { outcome: "concurrent_conflict" as const };
          }
        }

        const activated = await trx
          .updateTable("game_rule_versions")
          .set({ status: "ACTIVE", activated_by: input.activatedBy, activated_at: new Date() })
          .where("id", "=", input.ruleVersionId)
          .where("game_id", "=", input.gameId)
          .where("status", "=", "DRAFT")
          .returningAll()
          .executeTakeFirst();

        if (!activated) {
          return { outcome: "not_draft" as const };
        }
        return { outcome: "activated" as const, row: activated };
      });
    },
  };
}

export type GamesRepository = ReturnType<typeof createGamesRepository>;
