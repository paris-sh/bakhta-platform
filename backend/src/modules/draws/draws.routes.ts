import { ADMIN_PERMISSIONS } from "../auth/permissions.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { createAuthenticateHook } from "../../plugins/authenticate.js";
import { requirePermission } from "../../plugins/authorize.js";
import type { AuthService } from "../auth/auth.service.js";
import type { GamesService } from "../games/games.service.js";
import {
  createEvidenceBodySchema,
  drawIdParamsSchema,
  drawListResponseSchema,
  drawResponseSchema,
  evidenceIdParamsSchema,
  evidenceResponseSchema,
  gameIdParamsSchema,
  gameSlugParamsSchema,
  generateDrawsBodySchema,
  updateEvidenceStatusBodySchema,
} from "./draws.schemas.js";
import type { AuditContext, DrawsService } from "./draws.service.js";

const PERMISSIONS = {
  VIEW: ADMIN_PERMISSIONS.DRAWS_VIEW,
  CREATE: ADMIN_PERMISSIONS.DRAWS_CREATE,
  MANAGE_EVIDENCE: ADMIN_PERMISSIONS.DRAWS_MANAGE_EVIDENCE,
} as const;

function auditContext(request: FastifyRequest): AuditContext {
  const userAgent = request.headers["user-agent"];
  return {
    requestId: request.id ?? null,
    ipAddress: request.ip ?? null,
    userAgent: typeof userAgent === "string" ? userAgent : null,
  };
}

export function registerDrawsRoutes(
  app: FastifyInstance,
  drawsService: DrawsService,
  gamesService: GamesService,
  authService: AuthService,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const authenticate = createAuthenticateHook(authService);

  // --- Public ---
  // Reads the next draw from the draws table only — see draws.service.ts's
  // getNextPublicDraw for why this is never computed from the schedule per-request.

  typed.get(
    "/v1/games/:slug/draws/next",
    { schema: { params: gameSlugParamsSchema, response: { 200: drawResponseSchema } } },
    async (request) => {
      const game = await gamesService.getPublicGameBySlug(request.params.slug);
      return drawsService.getNextPublicDraw(game.id);
    },
  );

  // --- Admin ---

  typed.get(
    "/v1/admin/draws/:id",
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.VIEW)],
      schema: { params: drawIdParamsSchema, response: { 200: drawResponseSchema } },
    },
    async (request) => drawsService.getDraw(request.params.id),
  );

  typed.get(
    "/v1/admin/games/:id/draws",
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.VIEW)],
      schema: { params: gameIdParamsSchema, response: { 200: drawListResponseSchema } },
    },
    async (request) => drawsService.listDrawsForGame(request.params.id),
  );

  // Creates new future draws from the active rule version's schedule. Never touches an
  // existing draw — this is additive-only, so it does not need SUPER_ADMIN override
  // treatment the way rescheduling/cancelling an existing draw would (not yet built; see
  // module README).
  typed.post(
    "/v1/admin/games/:id/draws/generate",
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.CREATE)],
      schema: {
        params: gameIdParamsSchema,
        body: generateDrawsBodySchema,
        response: { 200: drawListResponseSchema },
      },
    },
    async (request) => {
      const principal = request.principal as { type: "ADMIN"; adminId: string };
      return drawsService.generateUpcomingDraws(
        request.params.id,
        request.body.horizonDays,
        principal.adminId,
        auditContext(request),
      );
    },
  );

  typed.post(
    "/v1/admin/draws/:id/evidence",
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.MANAGE_EVIDENCE)],
      schema: {
        params: drawIdParamsSchema,
        body: createEvidenceBodySchema,
        response: { 201: evidenceResponseSchema },
      },
    },
    async (request, reply) => {
      const principal = request.principal as { type: "ADMIN"; adminId: string };
      const created = await drawsService.recordEvidence(
        request.params.id,
        request.body,
        principal.adminId,
        auditContext(request),
      );
      reply.status(201);
      return created;
    },
  );

  typed.patch(
    "/v1/admin/draw-evidence/:id/status",
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.MANAGE_EVIDENCE)],
      schema: {
        params: evidenceIdParamsSchema,
        body: updateEvidenceStatusBodySchema,
        response: { 200: evidenceResponseSchema },
      },
    },
    async (request) => {
      const principal = request.principal as { type: "ADMIN"; adminId: string };
      return drawsService.updateEvidenceStatus(
        request.params.id,
        request.body,
        principal.adminId,
        auditContext(request),
      );
    },
  );
}

export { PERMISSIONS as DRAWS_PERMISSIONS };
