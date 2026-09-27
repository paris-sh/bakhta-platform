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

/** Must run after requirePermission(). Some actions are reserved to the SUPER_ADMIN role
 * itself (not merely a permission that could be granted to another role); the role is
 * re-resolved from the database on every request. */
export function requireSuperAdmin(isSuperAdmin: (adminId: string) => Promise<boolean>) {
  return async function (request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!request.principal || request.principal.type !== "ADMIN") {
      throw new ForbiddenError("This endpoint requires an ADMIN session.");
    }
    if (!(await isSuperAdmin(request.principal.adminId))) {
      throw new ForbiddenError("Only a SUPER_ADMIN may perform this action.");
    }
  };
}
