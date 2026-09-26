import { z } from "zod";

export const drawIdParamsSchema = z.object({ id: z.string().uuid() });
export const gameIdParamsSchema = z.object({ id: z.string().uuid() });
export const gameSlugParamsSchema = z.object({ slug: z.string() });
export const evidenceIdParamsSchema = z.object({ id: z.string().uuid() });

export const drawResponseSchema = z.object({
  id: z.string().uuid(),
  gameId: z.string().uuid(),
  drawNumber: z.string(), // BIGINT — string, same discipline as every other toman/int8 value
  status: z.string(),
  salesOpensAt: z.string(),
  salesClosesAt: z.string(),
  drawAt: z.string(),
  officialTimezone: z.string(),
  currentRuleVersionId: z.string().uuid(),
  currentRulesSnapshot: z.record(z.string(), z.unknown()),
  openingJackpotToman: z.string().nullable(),
  finalJackpotToman: z.string().nullable(),
  youtubeLiveUrl: z.string().nullable(),
  publishedAt: z.string().nullable(),
  settledAt: z.string().nullable(),
});

export const drawListResponseSchema = z.array(drawResponseSchema);

export const generateDrawsBodySchema = z.object({
  horizonDays: z.number().int().min(0).max(90).default(14),
});

export const evidenceResponseSchema = z.object({
  id: z.string().uuid(),
  drawId: z.string().uuid(),
  youtubeLiveUrl: z.string(),
  youtubeVideoId: z.string(),
  scheduledAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  archiveUrl: z.string().nullable(),
  status: z.string(),
});

export const createEvidenceBodySchema = z.object({
  youtubeLiveUrl: z.string().url(),
  youtubeVideoId: z.string().min(1),
  scheduledAt: z.string().datetime().optional(),
});

export const updateEvidenceStatusBodySchema = z
  .object({
    status: z.enum(["LIVE", "ENDED", "UNAVAILABLE"]).optional(),
    archiveUrl: z.string().url().optional(),
  })
  .refine((v) => v.status !== undefined || v.archiveUrl !== undefined, {
    message: "At least one field must be provided.",
  });
