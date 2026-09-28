import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { createAuthenticateHook } from "../../plugins/authenticate.js";
import { requirePermission, requireSuperAdmin } from "../../plugins/authorize.js";
import type { AuthService } from "../auth/auth.service.js";
import { ADMIN_PERMISSIONS } from "../auth/permissions.js";
import {
  adminResultListQuerySchema,
  drawIdParamsSchema,
  jackpotAnnouncementQuerySchema,
  jackpotAnnouncementResponseSchema,
  publicResultDetailResponseSchema,
  publicResultListQuerySchema,
  publicResultListResponseSchema,
  publicResultParamsSchema,
  discardDraftBodySchema,
  publishBodySchema,
  recordJackpotBodySchema,
  saveDraftBodySchema,
} from "./results.schemas.js";
import type { RequestContext, ResultsService } from "./results.service.js";

function requestContext(request: FastifyRequest): RequestContext {
  const userAgent = request.headers["user-agent"];
  return { requestId: request.id ?? null, ipAddress: request.ip ?? null, userAgent: typeof userAgent === "string" ? userAgent : null };
}

type AdminRequest = FastifyRequest & { principal?: { type: "ADMIN"; adminId: string } };

export function registerResultsRoutes(app: FastifyInstance, results: ResultsService, authService: AuthService): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const authenticate = createAuthenticateHook(authService);
  const superAdminOnly = requireSuperAdmin((id) => authService.isSuperAdmin(id));
  const adminId = (request: FastifyRequest) => (request as AdminRequest).principal!.adminId;

  // ---------------------------------------------------------------- admin

  // Authentication and authorization run in onRequest — before Fastify validates params,
  // query or body — so an unauthenticated caller always gets 401, never a validation 400
  // that would reveal the endpoint's input rules. The hooks read headers only.

  typed.get(
    "/v1/admin/results",
    { onRequest: [authenticate, requirePermission(ADMIN_PERMISSIONS.RESULTS_VIEW)], schema: { querystring: adminResultListQuerySchema } },
    async (request) => results.list(request.query),
  );

  typed.get(
    "/v1/admin/results/draws/:drawId",
    { onRequest: [authenticate, requirePermission(ADMIN_PERMISSIONS.RESULTS_VIEW)], schema: { params: drawIdParamsSchema } },
    async (request) => results.detail(request.params.drawId),
  );

  typed.put(
    "/v1/admin/results/draws/:drawId/draft",
    {
      onRequest: [authenticate, requirePermission(ADMIN_PERMISSIONS.RESULTS_ENTER)],
      schema: { params: drawIdParamsSchema, body: saveDraftBodySchema },
    },
    async (request) => {
      const id = adminId(request);
      // Whether this is a correction is decided server-side from the stored results; a
      // correction additionally requires the SUPER_ADMIN role (checked in the service).
      return results.saveDraft(request.params.drawId, request.body, { adminId: id, isSuperAdmin: await authService.isSuperAdmin(id) }, requestContext(request));
    },
  );

  typed.post(
    "/v1/admin/results/draws/:drawId/draft/discard",
    {
      onRequest: [authenticate, requirePermission(ADMIN_PERMISSIONS.RESULTS_ENTER)],
      schema: { params: drawIdParamsSchema, body: discardDraftBodySchema },
    },
    async (request) => {
      const id = adminId(request);
      return results.discardDraft(request.params.drawId, request.body.reason, { adminId: id, isSuperAdmin: await authService.isSuperAdmin(id) }, requestContext(request));
    },
  );

  typed.post(
    "/v1/admin/results/draws/:drawId/preview",
    { onRequest: [authenticate, requirePermission(ADMIN_PERMISSIONS.RESULTS_VIEW)], schema: { params: drawIdParamsSchema } },
    async (request) => results.preview(request.params.drawId),
  );

  typed.post(
    "/v1/admin/results/draws/:drawId/publish",
    {
      onRequest: [authenticate, requirePermission(ADMIN_PERMISSIONS.RESULTS_PUBLISH), superAdminOnly],
      schema: { params: drawIdParamsSchema, body: publishBodySchema },
    },
    async (request) => results.publish(request.params.drawId, request.body, adminId(request), requestContext(request)),
  );

  // SUPER_ADMIN sets or changes a Six Chance draw's advertised jackpot (append-only history;
  // a published draw is routed through a correction).
  typed.post(
    "/v1/admin/results/draws/:drawId/jackpot",
    {
      onRequest: [authenticate, requirePermission(ADMIN_PERMISSIONS.RESULTS_PUBLISH), superAdminOnly],
      schema: { params: drawIdParamsSchema, body: recordJackpotBodySchema },
    },
    async (request) => results.overrideOpeningJackpot(request.params.drawId, request.body, adminId(request), requestContext(request)),
  );

  // ---------------------------------------------------------------- public

  typed.get(
    "/v1/results",
    { schema: { querystring: publicResultListQuerySchema, response: { 200: publicResultListResponseSchema } } },
    async (request) => results.publicList(request.query),
  );

  typed.get(
    "/v1/results/jackpot-announcement",
    { schema: { querystring: jackpotAnnouncementQuerySchema, response: { 200: jackpotAnnouncementResponseSchema } } },
    async (request) => results.jackpotAnnouncement(request.query.game),
  );

  typed.get(
    "/v1/results/:slug/:drawNumber",
    { schema: { params: publicResultParamsSchema, response: { 200: publicResultDetailResponseSchema } } },
    async (request) => results.publicDetail(request.params.slug, request.params.drawNumber),
  );
}
