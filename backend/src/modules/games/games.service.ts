import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "../../shared/canonical-json.js";
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from "../../shared/errors.js";
import type { GameStatusEnum } from "../../db/types.js";
import type { AuditService } from "../audit/audit.service.js";
import type { GamesRepository } from "./games.repository.js";
import {
  CREATABLE_SCHEMA_VERSION,
  resolveRulesValidator,
  supportedSchemaVersions,
  type GameType,
} from "./rules.schemas.js";

export interface AuditContext {
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

function hashRules(rules: Record<string, unknown>): Buffer {
  return createHash("sha256").update(canonicalJsonStringify(rules)).digest();
}

/** Validates a raw rules payload against the validator registered for its declared
 * schema_version, resolved by (game_type, schema_version) together — never game_type alone. */
function validateRulesPayload(
  gameType: GameType,
  rawRules: Record<string, unknown>,
): Record<string, unknown> {
  const schemaVersion = rawRules.schema_version;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    throw new ValidationError(
      "rules.schema_version is required and must be an integer.",
      { supportedSchemaVersions: supportedSchemaVersions(gameType) },
    );
  }

  // Every rule version written from now on (a new draft or an edit to one) must use the
  // creatable schema_version, which makes the payout mode and claim period explicit. Older
  // schema versions stay registered only so stored versions and draw snapshots stay readable.
  const creatable = CREATABLE_SCHEMA_VERSION[gameType];
  if (schemaVersion !== creatable) {
    throw new ValidationError(
      `New rule versions for ${gameType} must use schema_version ${creatable}.`,
      { requiredSchemaVersion: creatable, supportedSchemaVersions: supportedSchemaVersions(gameType) },
    );
  }

  const validator = resolveRulesValidator(gameType, schemaVersion);
  if (!validator) {
    throw new ValidationError(
      `Unsupported schema_version ${schemaVersion} for game_type ${gameType}.`,
      { supportedSchemaVersions: supportedSchemaVersions(gameType) },
    );
  }

  const parsed = validator.safeParse(rawRules);
  if (!parsed.success) {
    throw new ValidationError(
      `Rule payload failed validation for ${gameType} schema_version ${schemaVersion}.`,
      { issues: parsed.error.issues },
    );
  }
  return parsed.data as Record<string, unknown>;
}

function toPublicShape(
  game: { id: string; code: string; game_type: string; slug: string; name_fa: string; name_en: string; status: string },
  activeRuleVersion: { rules: unknown; version_number: number } | undefined,
) {
  return {
    id: game.id,
    code: game.code,
    gameType: game.game_type as "SIX_CHANCE" | "FOUR_LEAF",
    slug: game.slug,
    nameFa: game.name_fa,
    nameEn: game.name_en,
    status: game.status,
    activeRules: (activeRuleVersion?.rules as Record<string, unknown> | undefined) ?? null,
    activeRuleVersionNumber: activeRuleVersion?.version_number ?? null,
  };
}

function toRuleVersionShape(rv: {
  id: string;
  game_id: string;
  version_number: number;
  status: string;
  rules: unknown;
  change_reason: string;
  created_by: string;
  activated_by: string | null;
  created_at: Date;
  activated_at: Date | null;
  retired_at: Date | null;
}) {
  return {
    id: rv.id,
    gameId: rv.game_id,
    versionNumber: rv.version_number,
    status: rv.status,
    rules: rv.rules as Record<string, unknown>,
    changeReason: rv.change_reason,
    createdBy: rv.created_by,
    activatedBy: rv.activated_by,
    createdAt: rv.created_at.toISOString(),
    activatedAt: rv.activated_at ? rv.activated_at.toISOString() : null,
    retiredAt: rv.retired_at ? rv.retired_at.toISOString() : null,
  };
}

export function createGamesService(repo: GamesRepository, audit: AuditService) {
  return {
    async listPublicGames() {
      const games = await repo.listGames();
      const result = [];
      for (const game of games) {
        const active = await repo.findActiveRuleVersion(game.id);
        result.push(toPublicShape(game, active));
      }
      return result;
    },

    async getPublicGameBySlug(slug: string) {
      const game = await repo.findGameBySlug(slug);
      if (!game) throw new NotFoundError(`No game found with slug "${slug}".`);
      const active = await repo.findActiveRuleVersion(game.id);
      return toPublicShape(game, active);
    },

    async getAdminGame(id: string) {
      const game = await repo.findGameById(id);
      if (!game) throw new NotFoundError(`No game found with id "${id}".`);
      const active = await repo.findActiveRuleVersion(game.id);
      return {
        ...toPublicShape(game, active),
        createdAt: game.created_at.toISOString(),
        updatedAt: game.updated_at.toISOString(),
      };
    },

    async updateGame(
      id: string,
      patch: { nameFa?: string | undefined; nameEn?: string | undefined; status?: GameStatusEnum | undefined },
      actorAdminId: string,
      ctx: AuditContext,
    ) {
      const game = await repo.findGameById(id);
      if (!game) throw new NotFoundError(`No game found with id "${id}".`);

      const updated = await repo.updateGame(id, {
        ...(patch.nameFa !== undefined ? { name_fa: patch.nameFa } : {}),
        ...(patch.nameEn !== undefined ? { name_en: patch.nameEn } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      });
      if (!updated) throw new NotFoundError(`No game found with id "${id}".`);

      await audit.recordAdminAction({
        adminId: actorAdminId,
        action: "games.update",
        entityType: "games",
        entityId: id,
        changedFields: Object.keys(patch),
        oldValues: { name_fa: game.name_fa, name_en: game.name_en, status: game.status },
        newValues: { name_fa: updated.name_fa, name_en: updated.name_en, status: updated.status },
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      const active = await repo.findActiveRuleVersion(updated.id);
      return {
        ...toPublicShape(updated, active),
        createdAt: updated.created_at.toISOString(),
        updatedAt: updated.updated_at.toISOString(),
      };
    },

    async listRuleVersions(gameId: string) {
      const game = await repo.findGameById(gameId);
      if (!game) throw new NotFoundError(`No game found with id "${gameId}".`);
      const versions = await repo.listRuleVersions(gameId);
      return versions.map(toRuleVersionShape);
    },

    async createRuleVersion(
      gameId: string,
      input: { rules: Record<string, unknown>; changeReason: string },
      createdBy: string,
      ctx: AuditContext,
    ) {
      const game = await repo.findGameById(gameId);
      if (!game) throw new NotFoundError(`No game found with id "${gameId}".`);

      const validatedRules = validateRulesPayload(game.game_type, input.rules);

      const versionNumber = await repo.nextVersionNumber(gameId);
      const rulesHash = hashRules(validatedRules);
      const created = await repo.createRuleVersion({
        gameId,
        gameType: game.game_type,
        versionNumber,
        rules: validatedRules,
        rulesHash,
        changeReason: input.changeReason,
        createdBy,
      });

      await audit.recordAdminAction({
        adminId: createdBy,
        action: "game_rule_versions.create",
        entityType: "game_rule_versions",
        entityId: created.id,
        newValues: { version_number: created.version_number, rules: validatedRules },
        reason: input.changeReason,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return toRuleVersionShape(created);
    },

    /** Only a DRAFT rule version may be edited — ACTIVE and RETIRED are immutable by
     * design; changing either requires creating a new DRAFT version instead. */
    async updateRuleVersion(
      ruleVersionId: string,
      patch: { rules?: Record<string, unknown> | undefined; changeReason?: string | undefined },
      actorAdminId: string,
      ctx: AuditContext,
    ) {
      const existing = await repo.findRuleVersionById(ruleVersionId);
      if (!existing) throw new NotFoundError(`No rule version found with id "${ruleVersionId}".`);
      if (existing.status !== "DRAFT") {
        throw new ConflictError(
          `Only a DRAFT rule version can be updated (this one is ${existing.status}). ` +
            "Create a new DRAFT version to change an ACTIVE or RETIRED rule.",
        );
      }

      let validatedRules: Record<string, unknown> | undefined;
      let rulesHash: Buffer | undefined;
      if (patch.rules !== undefined) {
        validatedRules = validateRulesPayload(existing.game_type, patch.rules);
        rulesHash = hashRules(validatedRules);
      }

      const updated = await repo.updateDraftRuleVersion({
        ruleVersionId,
        ...(validatedRules !== undefined ? { rules: validatedRules } : {}),
        ...(rulesHash !== undefined ? { rulesHash } : {}),
        ...(patch.changeReason !== undefined ? { changeReason: patch.changeReason } : {}),
      });
      if (!updated) {
        // Lost a race with something that moved this version out of DRAFT concurrently.
        throw new ConflictError("This rule version is no longer a draft.");
      }

      await audit.recordAdminAction({
        adminId: actorAdminId,
        action: "game_rule_versions.update",
        entityType: "game_rule_versions",
        entityId: ruleVersionId,
        changedFields: Object.keys(patch),
        oldValues: { rules: existing.rules, change_reason: existing.change_reason },
        newValues: { rules: updated.rules, change_reason: updated.change_reason },
        reason: patch.changeReason ?? existing.change_reason,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return toRuleVersionShape(updated);
    },

    /**
     * "Save changes" on the current settings: validates the rules (creatable schema), then
     * creates and activates a new version atomically, retiring the previous one.
     */
    async saveSettings(gameId: string, input: { rules: Record<string, unknown>; reason: string }, adminId: string, ctx: AuditContext) {
      const game = await repo.findGameById(gameId);
      if (!game) throw new NotFoundError(`No game found with id "${gameId}".`);
      const validatedRules = validateRulesPayload(game.game_type, input.rules);
      const result = await repo.saveSettingsAsNewActiveVersion({
        gameId,
        gameType: game.game_type,
        rules: validatedRules,
        rulesHash: hashRules(validatedRules),
        changeReason: input.reason,
        adminId,
        audit: { actorAdminId: adminId, reason: input.reason, ...ctx },
      });
      if (result.outcome === "concurrent_conflict") {
        throw new ConflictError("The game's settings changed concurrently with this request; reload and try again.");
      }
      return toRuleVersionShape(result.row);
    },

    /** Deletes an unused DRAFT rule version; its full content is kept in the audit trail. */
    async discardDraftRuleVersion(ruleVersionId: string, reason: string, actorAdminId: string | null, ctx: AuditContext) {
      const result = await repo.discardDraftRuleVersion(ruleVersionId, { actorAdminId, reason, ...ctx });
      switch (result.outcome) {
        case "not_found":
          throw new NotFoundError(`No rule version found with id "${ruleVersionId}".`);
        case "not_draft":
          throw new BusinessRuleError("RULE_VERSION_NOT_DRAFT", `Only an unused DRAFT can be discarded (this version is ${result.status}).`);
        case "referenced":
          throw new BusinessRuleError("RULE_VERSION_REFERENCED", "This version is used by draws, tickets or calculations and cannot be discarded.", {
            draws: result.draws,
            tickets: result.tickets,
            runs: result.runs,
          });
        case "discarded":
          return { id: result.row.id, versionNumber: result.row.version_number, discarded: true };
      }
    },

    async activateRuleVersion(ruleVersionId: string, activatedBy: string, ctx: AuditContext) {
      const ruleVersion = await repo.findRuleVersionById(ruleVersionId);
      if (!ruleVersion) {
        throw new NotFoundError(`No rule version found with id "${ruleVersionId}".`);
      }
      if (ruleVersion.status !== "DRAFT") {
        throw new ConflictError(
          `Only a DRAFT rule version can be activated (this one is ${ruleVersion.status}).`,
        );
      }

      const result = await repo.activateRuleVersion({
        gameId: ruleVersion.game_id,
        ruleVersionId,
        activatedBy,
      });

      if (result.outcome === "not_draft") {
        throw new ConflictError("This rule version was already activated or is no longer a draft.");
      }
      if (result.outcome === "concurrent_conflict") {
        throw new ConflictError(
          "The game's active rule version changed concurrently with this request; please retry.",
        );
      }

      await audit.recordAdminAction({
        adminId: activatedBy,
        action: "game_rule_versions.activate",
        entityType: "game_rule_versions",
        entityId: ruleVersionId,
        newValues: { status: "ACTIVE", version_number: result.row.version_number },
        // The version's own change reason is the audit reason for putting it into effect.
        reason: result.row.change_reason,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      return toRuleVersionShape(result.row);
    },
  };
}

export type GamesService = ReturnType<typeof createGamesService>;
