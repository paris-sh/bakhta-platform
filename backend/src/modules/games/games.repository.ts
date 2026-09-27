import type { Selectable, Transaction } from "kysely";
import type { Database } from "../../db/client.js";
import type { DB, GameRuleVersions, GameStatusEnum } from "../../db/types.js";

/** Audit context written in the same transaction as the change it records. */
export interface TxAudit {
  /** null = a SYSTEM action (e.g. a documented maintenance step), never attributed to a person. */
  actorAdminId: string | null;
  reason: string;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

async function writeAudit(
  trx: Transaction<DB>,
  audit: TxAudit,
  entry: { action: string; entityType: string; entityId: string; oldValues?: unknown; newValues?: unknown; severity?: string },
) {
  await trx
    .insertInto("audit_logs")
    .values({
      actor_type: audit.actorAdminId ? "ADMIN" : "SYSTEM",
      actor_admin_id: audit.actorAdminId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      old_values: entry.oldValues === undefined ? null : JSON.stringify(entry.oldValues),
      new_values: entry.newValues === undefined ? null : JSON.stringify(entry.newValues),
      reason: audit.reason,
      request_id: audit.requestId,
      ip_address: audit.ipAddress,
      user_agent: audit.userAgent,
      ...(entry.severity ? { severity: entry.severity } : {}),
    })
    .execute();
}

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

    /**
     * "Save changes" on the current game settings: in ONE transaction, create a new rule
     * version and make it ACTIVE, retiring the previous ACTIVE one. Existing draws keep the
     * rules they snapshotted; only draws created afterwards use the new version.
     */
    async saveSettingsAsNewActiveVersion(input: {
      gameId: string;
      gameType: "SIX_CHANCE" | "FOUR_LEAF";
      rules: Record<string, unknown>;
      rulesHash: Buffer;
      changeReason: string;
      adminId: string;
      audit: TxAudit;
    }): Promise<
      | { outcome: "saved"; row: Selectable<GameRuleVersions>; previous: Selectable<GameRuleVersions> | undefined }
      | { outcome: "concurrent_conflict" }
    > {
      return db.transaction().execute(async (trx) => {
        // Lock the game row so two saves for the same game serialize.
        await trx.selectFrom("games").select("id").where("id", "=", input.gameId).forUpdate().executeTakeFirstOrThrow();
        const previous = await trx
          .selectFrom("game_rule_versions")
          .selectAll()
          .where("game_id", "=", input.gameId)
          .where("status", "=", "ACTIVE")
          .forUpdate()
          .executeTakeFirst();
        const max = await trx
          .selectFrom("game_rule_versions")
          .select((eb) => eb.fn.max("version_number").as("v"))
          .where("game_id", "=", input.gameId)
          .executeTakeFirst();
        const now = new Date();
        if (previous) {
          const retired = await trx
            .updateTable("game_rule_versions")
            .set({ status: "RETIRED", retired_at: now })
            .where("id", "=", previous.id)
            .where("status", "=", "ACTIVE")
            .executeTakeFirst();
          if (retired.numUpdatedRows === 0n) return { outcome: "concurrent_conflict" as const };
        }
        const row = await trx
          .insertInto("game_rule_versions")
          .values({
            game_id: input.gameId,
            game_type: input.gameType,
            version_number: Number(max?.v ?? 0) + 1,
            status: "ACTIVE",
            rules: JSON.stringify(input.rules),
            rules_hash: input.rulesHash,
            change_reason: input.changeReason,
            created_by: input.adminId,
            activated_by: input.adminId,
            activated_at: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await writeAudit(trx, input.audit, {
          action: "game_rule_versions.save_settings",
          entityType: "game_rule_versions",
          entityId: row.id,
          oldValues: previous ? { version_number: previous.version_number, rules: previous.rules, status: "ACTIVE" } : null,
          newValues: { version_number: row.version_number, rules: row.rules, status: "ACTIVE", previous_retired: previous?.version_number ?? null },
        });
        return { outcome: "saved" as const, row, previous };
      });
    },

    /**
     * Deletes an unused DRAFT rule version. Refuses ACTIVE/RETIRED versions and any version a
     * draw, ticket or calculation run references (the foreign keys would refuse it too).
     */
    async discardDraftRuleVersion(ruleVersionId: string, audit: TxAudit): Promise<
      | { outcome: "discarded"; row: Selectable<GameRuleVersions> }
      | { outcome: "not_found" }
      | { outcome: "not_draft"; status: string }
      | { outcome: "referenced"; draws: number; tickets: number; runs: number }
    > {
      return db.transaction().execute(async (trx) => {
        const row = await trx.selectFrom("game_rule_versions").selectAll().where("id", "=", ruleVersionId).forUpdate().executeTakeFirst();
        if (!row) return { outcome: "not_found" as const };
        if (row.status !== "DRAFT") return { outcome: "not_draft" as const, status: row.status };
        const n = (row: { n: string } | undefined) => Number(row?.n ?? 0);
        const draws = n(await trx.selectFrom("draws").select((eb) => eb.fn.countAll<string>().as("n")).where("current_rule_version_id", "=", ruleVersionId).executeTakeFirst());
        const tickets = n(await trx.selectFrom("tickets").select((eb) => eb.fn.countAll<string>().as("n")).where("rule_version_id", "=", ruleVersionId).executeTakeFirst());
        const runs = n(await trx.selectFrom("prize_calculation_runs").select((eb) => eb.fn.countAll<string>().as("n")).where("rule_version_id", "=", ruleVersionId).executeTakeFirst());
        if (draws + tickets + runs > 0) return { outcome: "referenced" as const, draws, tickets, runs };
        await trx.deleteFrom("game_rule_versions").where("id", "=", ruleVersionId).where("status", "=", "DRAFT").execute();
        // The row is gone; its complete content lives on in the audit trail.
        await writeAudit(trx, audit, {
          action: "game_rule_versions.discard_draft",
          entityType: "game_rule_versions",
          entityId: row.id,
          oldValues: {
            game_id: row.game_id,
            version_number: row.version_number,
            status: row.status,
            rules: row.rules,
            change_reason: row.change_reason,
            created_by: row.created_by,
            created_at: row.created_at,
          },
          newValues: { discarded: true },
          severity: "WARNING",
        });
        return { outcome: "discarded" as const, row };
      });
    },
  };
}

export type GamesRepository = ReturnType<typeof createGamesRepository>;
