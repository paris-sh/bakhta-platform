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
  /** UPCOMING | OPEN | CLOSED | NOT_ON_SALE — only OPEN may be purchased. */
  salesState: z.enum(["UPCOMING", "OPEN", "CLOSED", "NOT_ON_SALE"]),
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

/** Admin view of a draw: adds the scheduled occurrence it claimed (never shown publicly). */
export const adminDrawResponseSchema = drawResponseSchema.extend({
  scheduledOccurrence: z
    .object({
      slotId: z.string(),
      localDate: z.string(),
      scheduledDrawAt: z.string(),
      timezone: z.string(),
      claim: z.enum(["SCHEDULED", "REPLACEMENT"]),
    })
    .nullable(),
});
export const adminDrawListResponseSchema = z.array(adminDrawResponseSchema);

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const slotId = z.string().min(1).max(40);

const isoTime = z.string().datetime({ offset: true });
const optionalReason = z.string().trim().min(5, "must be at least 5 characters").max(2000).optional();

/** SUPER_ADMIN manual draw creation. `dryRun` returns warnings, the rule version and the
 * jackpot that would be used, without creating anything. */
export const createManualDrawBodySchema = z.object({
  salesOpensAt: isoTime,
  salesClosesAt: isoTime,
  drawAt: isoTime,
  openingJackpotToman: z.string().regex(/^[1-9]\d{0,17}$/, "must be a positive whole Toman amount").optional(),
  /** The settings version the form displayed; creation is refused if it is no longer active. */
  ruleVersionId: z.string().uuid().optional(),
  /** The scheduled occurrence this draw claims: SCHEDULED (from a reminder) or REPLACEMENT (a
   * special draw explicitly replacing it). Omitted: a special draw that claims nothing. */
  occurrence: z.object({ slotId, localDate, claim: z.enum(["SCHEDULED", "REPLACEMENT"]) }).optional(),
  reason: optionalReason,
  dryRun: z.boolean().optional(),
});

/** SUPER_ADMIN edit of a draw's times (a reason is always required). */
export const updateDrawBodySchema = z
  .object({
    salesOpensAt: isoTime.optional(),
    salesClosesAt: isoTime.optional(),
    drawAt: isoTime.optional(),
    reason: optionalReason,
    dryRun: z.boolean().optional(),
  })
  .refine((b) => b.salesOpensAt || b.salesClosesAt || b.drawAt, { message: "Change at least one time." });

/** SUPER_ADMIN decision to dismiss a scheduled occurrence (e.g. a missed one), with a reason. */
export const dismissOccurrenceBodySchema = z.object({
  slotId,
  localDate,
  reason: z.string().trim().min(5, "must be at least 5 characters").max(2000),
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

// Evidence is metadata only (no video is ever uploaded): the scheduled YouTube Live URL and
// its stable video id. Only YouTube hosts are accepted.
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const youtubeUrl = z
  .string()
  .url()
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" && YOUTUBE_HOSTS.has(u.hostname);
    } catch {
      return false;
    }
  }, "must be an https YouTube URL");

export const createEvidenceBodySchema = z.object({
  youtubeLiveUrl: youtubeUrl,
  youtubeVideoId: z.string().regex(/^[A-Za-z0-9_-]{6,32}$/, "must be a YouTube video id"),
  scheduledAt: z.string().datetime().optional(),
});

export const updateEvidenceStatusBodySchema = z
  .object({
    status: z.enum(["LIVE", "ENDED", "UNAVAILABLE"]).optional(),
    archiveUrl: youtubeUrl.optional(),
  })
  .refine((v) => v.status !== undefined || v.archiveUrl !== undefined, {
    message: "At least one field must be provided.",
  });
