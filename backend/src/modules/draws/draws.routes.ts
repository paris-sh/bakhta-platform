import { ADMIN_PERMISSIONS } from "../auth/permissions.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { createAuthenticateHook } from "../../plugins/authenticate.js";
import { requirePermission, requireSuperAdmin } from "../../plugins/authorize.js";
import type { AuthService } from "../auth/auth.service.js";
import type { GamesService } from "../games/games.service.js";
import {
  adminDrawListResponseSchema,
  adminDrawResponseSchema,
  createEvidenceBodySchema,
  dismissOccurrenceBodySchema,
  drawIdParamsSchema,
  drawResponseSchema,
  evidenceIdParamsSchema,
  evidenceResponseSchema,
  gameIdParamsSchema,
  gameSlugParamsSchema,
  createManualDrawBodySchema,
  updateDrawBodySchema,
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
      onRequest: [authenticate, requirePermission(PERMISSIONS.VIEW)],
      schema: { params: drawIdParamsSchema, response: { 200: adminDrawResponseSchema } },
    },
    async (request) => drawsService.getDraw(request.params.id),
  );

  typed.get(
    "/v1/admin/games/:id/draws",
    {
      onRequest: [authenticate, requirePermission(PERMISSIONS.VIEW)],
      schema: { params: gameIdParamsSchema, response: { 200: adminDrawListResponseSchema } },
    },
    async (request) => drawsService.listDrawsForGame(request.params.id),
  );

  // Reminders derived from the active schedule. Read-only: the schedule never creates a draw
  // (no generation endpoint, job or seed exists); only the Create Draw POST below inserts one.
  typed.get(
    "/v1/admin/games/:id/schedule/reminders",
    {
      onRequest: [authenticate, requirePermission(PERMISSIONS.VIEW)],
      schema: { params: gameIdParamsSchema },
    },
    async (request) => drawsService.gameReminders(request.params.id),
  );

  typed.get(
    "/v1/admin/schedule/reminders",
    { onRequest: [authenticate, requirePermission(PERMISSIONS.VIEW)] },
    async () => ({ items: await drawsService.listReminders() }),
  );

  // Primary workflow: a SUPER_ADMIN creates or edits a draw by hand. Auth runs in onRequest,
  // before body validation.
  const superAdminOnly = requireSuperAdmin((id) => authService.isSuperAdmin(id));

  typed.post(
    "/v1/admin/games/:id/draws",
    {
      onRequest: [authenticate, requirePermission(PERMISSIONS.CREATE), superAdminOnly],
      schema: { params: gameIdParamsSchema, body: createManualDrawBodySchema },
    },
    async (request, reply) => {
      const principal = request.principal as { type: "ADMIN"; adminId: string };
      const result = await drawsService.createManualDraw(request.params.id, request.body, principal.adminId, auditContext(request));
      if (!result.dryRun) reply.status(201);
      return result;
    },
  );

  typed.post(
    "/v1/admin/games/:id/schedule/dismiss",
    {
      onRequest: [authenticate, requirePermission(PERMISSIONS.CREATE), superAdminOnly],
      schema: { params: gameIdParamsSchema, body: dismissOccurrenceBodySchema },
    },
    async (request) => {
      const principal = request.principal as { type: "ADMIN"; adminId: string };
      return drawsService.dismissOccurrence(request.params.id, request.body, principal.adminId, auditContext(request));
    },
  );

  typed.patch(
    "/v1/admin/draws/:id",
    {
      onRequest: [authenticate, requirePermission(PERMISSIONS.CREATE), superAdminOnly],
      schema: { params: drawIdParamsSchema, body: updateDrawBodySchema },
    },
    async (request) => {
      const principal = request.principal as { type: "ADMIN"; adminId: string };
      return drawsService.updateDrawTimes(request.params.id, request.body, principal.adminId, auditContext(request));
    },
  );

  typed.post(
    "/v1/admin/draws/:id/evidence",
    {
      onRequest: [authenticate, requirePermission(PERMISSIONS.MANAGE_EVIDENCE)],
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
      onRequest: [authenticate, requirePermission(PERMISSIONS.MANAGE_EVIDENCE)],
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
