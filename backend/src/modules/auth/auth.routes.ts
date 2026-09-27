import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { createAuthenticateHook } from "../../plugins/authenticate.js";
import { requirePrincipalType } from "../../plugins/authorize.js";
import {
  adminMeResponseSchema,
  loginBodySchema,
  meResponseSchema,
  registerBodySchema,
  registerResponseSchema,
  sessionResponseSchema,
} from "./auth.schemas.js";
import type { AuthService } from "./auth.service.js";

function requestContext(request: { ip: string; headers: Record<string, unknown> }) {
  const userAgent = request.headers["user-agent"];
  return {
    ip: request.ip,
    userAgent: typeof userAgent === "string" ? userAgent : null,
  };
}

export function registerAuthRoutes(app: FastifyInstance, authService: AuthService): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const authenticate = createAuthenticateHook(authService);

  typed.post(
    "/v1/auth/register",
    { schema: { body: registerBodySchema, response: { 201: registerResponseSchema } } },
    async (request, reply) => {
      const result = await authService.registerUser(request.body);
      reply.status(201);
      return result;
    },
  );

  typed.post(
    "/v1/auth/login",
    { schema: { body: loginBodySchema, response: { 200: sessionResponseSchema } } },
    async (request) => {
      const session = await authService.loginUser(request.body, requestContext(request));
      return {
        token: session.token,
        idleExpiresAt: session.idleExpiresAt.toISOString(),
        absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
      };
    },
  );

  typed.post(
    "/v1/admin/auth/login",
    { schema: { body: loginBodySchema, response: { 200: sessionResponseSchema } } },
    async (request) => {
      const session = await authService.loginAdmin(request.body, requestContext(request));
      return {
        token: session.token,
        idleExpiresAt: session.idleExpiresAt.toISOString(),
        absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
      };
    },
  );

  typed.post("/v1/auth/logout", async (request, reply) => {
    const header = request.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      await authService.logout(header.slice("Bearer ".length).trim());
    }
    reply.status(204);
  });

  typed.get(
    "/v1/me",
    {
      preHandler: [authenticate, requirePrincipalType("USER")],
      schema: { response: { 200: meResponseSchema } },
    },
    async (request) => {
      // requirePrincipalType guarantees this shape.
      const principal = request.principal as { type: "USER"; userId: string };
      const user = await authService.getUserProfile(principal.userId);
      return {
        id: user.id,
        userNumber: user.user_number,
        email: user.email,
        status: user.status,
        emailVerified: user.email_verified_at !== null,
      };
    },
  );

  typed.get(
    "/v1/admin/me",
    {
      preHandler: [authenticate, requirePrincipalType("ADMIN")],
      schema: { response: { 200: adminMeResponseSchema } },
    },
    async (request) => {
      const principal = request.principal as { type: "ADMIN"; adminId: string };
      const { admin, permissions, roles } = await authService.getAdminProfile(principal.adminId);
      return {
        id: admin.id,
        adminNumber: admin.admin_number,
        email: admin.email,
        status: admin.status,
        roles,
        permissions,
      };
    },
  );
}
