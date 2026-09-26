import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { AuthService } from "../auth/auth.service.js";
import { createAuthenticateHook } from "../../plugins/authenticate.js";
import { requirePermission } from "../../plugins/authorize.js";
import type { AuditContext } from "./games.service.js";
import {
  adminGameResponseSchema,
  createRuleVersionBodySchema,
  gameIdParamsSchema,
  gameListResponseSchema,
  gamePublicResponseSchema,
  gameSlugParamsSchema,
  ruleVersionIdParamsSchema,
  ruleVersionListResponseSchema,
  ruleVersionResponseSchema,
  updateGameBodySchema,
  updateRuleVersionBodySchema,
} from "./games.schemas.js";
import type { GamesService } from "./games.service.js";

// Permission codes this module checks. Seeding/granting them onto roles is an
// Administration-module concern (not yet built) — until a role is granted these, no ADMIN
// can reach the corresponding endpoint, which is the correct default-deny posture.
const PERMISSIONS = {
  VIEW: "games.view",
  EDIT: "games.edit",
  ACTIVATE_RULE_VERSION: "games.activate_rule_version",
} as const;

function auditContext(request: FastifyRequest): AuditContext {
  const userAgent = request.headers["user-agent"];
  return {
    requestId: request.id ?? null,
    ipAddress: request.ip ?? null,
    userAgent: typeof userAgent === "string" ? userAgent : null,
  };
}

export function registerGamesRoutes(
  app: FastifyInstance,
  gamesService: GamesService,
  authService: AuthService,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const authenticate = createAuthenticateHook(authService);

  // --- Public ---

  typed.get(
    "/v1/games",
    { schema: { response: { 200: gameListResponseSchema } } },
    async () => gamesService.listPublicGames(),
  );

  typed.get(
    "/v1/games/:slug",
    { schema: { params: gameSlugParamsSchema, response: { 200: gamePublicResponseSchema } } },
    async (request) => gamesService.getPublicGameBySlug(request.params.slug),
  );

  // --- Admin ---

  typed.get(
    "/v1/admin/games/:id",
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.VIEW)],
      schema: { params: gameIdParamsSchema, response: { 200: adminGameResponseSchema } },
    },
    async (request) => gamesService.getAdminGame(request.params.id),
  );

  typed.patch(
    "/v1/admin/games/:id",
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.EDIT)],
      schema: {
        params: gameIdParamsSchema,
        body: updateGameBodySchema,
        response: { 200: adminGameResponseSchema },
      },
    },
    async (request) => {
      const principal = request.principal as { type: "ADMIN"; adminId: string };
      return gamesService.updateGame(
        request.params.id,
        request.body,
        principal.adminId,
        auditContext(request),
      );
    },
  );

  typed.get(
    "/v1/admin/games/:id/rule-versions",
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.VIEW)],
      schema: { params: gameIdParamsSchema, response: { 200: ruleVersionListResponseSchema } },
    },
    async (request) => gamesService.listRuleVersions(request.params.id),
  );

  typed.post(
    "/v1/admin/games/:id/rule-versions",
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.EDIT)],
      schema: {
        params: gameIdParamsSchema,
        body: createRuleVersionBodySchema,
        response: { 201: ruleVersionResponseSchema },
      },
    },
    async (request, reply) => {
      // requirePermission guarantees an ADMIN principal here.
      const principal = request.principal as { type: "ADMIN"; adminId: string };
      const created = await gamesService.createRuleVersion(
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
    "/v1/admin/rule-versions/:id",
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.EDIT)],
      schema: {
        params: ruleVersionIdParamsSchema,
        body: updateRuleVersionBodySchema,
        response: { 200: ruleVersionResponseSchema },
      },
    },
    async (request) => {
      const principal = request.principal as { type: "ADMIN"; adminId: string };
      return gamesService.updateRuleVersion(
        request.params.id,
        request.body,
        principal.adminId,
        auditContext(request),
      );
    },
  );

  typed.post(
    "/v1/admin/rule-versions/:id/activate",
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.ACTIVATE_RULE_VERSION)],
      schema: {
        params: ruleVersionIdParamsSchema,
        response: { 200: ruleVersionResponseSchema },
      },
    },
    async (request) => {
      const principal = request.principal as { type: "ADMIN"; adminId: string };
      return gamesService.activateRuleVersion(
        request.params.id,
        principal.adminId,
        auditContext(request),
      );
    },
  );
}

export { PERMISSIONS as GAMES_PERMISSIONS };
