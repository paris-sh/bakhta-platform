import { z } from "zod";

export const gamePublicResponseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  gameType: z.enum(["SIX_CHANCE", "FOUR_LEAF"]),
  slug: z.string(),
  nameFa: z.string(),
  nameEn: z.string(),
  status: z.string(),
  activeRules: z.record(z.string(), z.unknown()).nullable(),
  activeRuleVersionNumber: z.number().int().nullable(),
});

export const gameListResponseSchema = z.array(gamePublicResponseSchema);

export const gameSlugParamsSchema = z.object({ slug: z.string() });
export const gameIdParamsSchema = z.object({ id: z.string().uuid() });
export const ruleVersionIdParamsSchema = z.object({ id: z.string().uuid() });

export const updateGameBodySchema = z
  .object({
    nameFa: z.string().min(1).optional(),
    nameEn: z.string().min(1).optional(),
    status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
  })
  .refine((v) => v.nameFa !== undefined || v.nameEn !== undefined || v.status !== undefined, {
    message: "At least one field must be provided.",
  });

export const adminGameResponseSchema = gamePublicResponseSchema.extend({
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ruleVersionResponseSchema = z.object({
  id: z.string().uuid(),
  gameId: z.string().uuid(),
  versionNumber: z.number().int(),
  status: z.string(),
  rules: z.record(z.string(), z.unknown()),
  changeReason: z.string(),
  createdBy: z.string().uuid(),
  activatedBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  activatedAt: z.string().nullable(),
  retiredAt: z.string().nullable(),
});

export const ruleVersionListResponseSchema = z.array(ruleVersionResponseSchema);

const operationalReason = z.string().trim().min(5, "must be at least 5 characters").max(2000);

/** "Save changes" on the current game settings. */
export const saveSettingsBodySchema = z.object({
  rules: z.record(z.unknown()),
  reason: operationalReason,
});

export const discardRuleVersionBodySchema = z.object({ reason: operationalReason });

export const createRuleVersionBodySchema = z.object({
  // Validated further, per (game_type, schema_version), in the service layer against
  // rules.schemas.ts — kept as a generic record here since the shape depends on both.
  rules: z.record(z.string(), z.unknown()),
  changeReason: z.string().min(1),
});

export const updateRuleVersionBodySchema = z
  .object({
    rules: z.record(z.string(), z.unknown()).optional(),
    changeReason: z.string().min(1).optional(),
  })
  .refine((v) => v.rules !== undefined || v.changeReason !== undefined, {
    message: "At least one field must be provided.",
  });
