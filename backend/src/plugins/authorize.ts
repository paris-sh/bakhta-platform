import type { FastifyReply, FastifyRequest } from "fastify";
import { ForbiddenError } from "../shared/errors.js";

/** Must run after the authenticate hook (requires request.principal to be set). */
export function requirePrincipalType(type: "USER" | "ADMIN") {
  return async function (request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!request.principal || request.principal.type !== type) {
      throw new ForbiddenError(`This endpoint requires a ${type} session.`);
    }
  };
}

/** Must run after requirePrincipalType("ADMIN"). Authorization is always a backend
 * permission check against role_permissions, never a hidden-UI-control assumption. */
export function requirePermission(code: string) {
  return async function (request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!request.principal || request.principal.type !== "ADMIN") {
      throw new ForbiddenError("This endpoint requires an ADMIN session.");
    }
    if (!request.principal.permissions.includes(code)) {
      throw new ForbiddenError(`Missing required permission: ${code}`);
    }
  };
}
