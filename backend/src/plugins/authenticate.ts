import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthService, Principal } from "../modules/auth/auth.service.js";
import { UnauthorizedError } from "../shared/errors.js";

declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
  }
}

const BEARER_PREFIX = "Bearer ";

/**
 * Registered users and administrators both authenticate with:
 *   Authorization: Bearer <opaque_session_token>
 * No cookies anywhere, for either principal type — and correspondingly no CSRF handling,
 * since that concern doesn't apply to header-based bearer auth. Claim Tokens (guest prize
 * claims) never flow through this hook; they are verified entirely within the claims module
 * against claim_credentials, a completely separate table and mechanism from sessions.
 */
export function createAuthenticateHook(authService: AuthService) {
  return async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedError("Missing or malformed Authorization header.");
    }
    const token = header.slice(BEARER_PREFIX.length).trim();
    if (!token) {
      throw new UnauthorizedError("Missing bearer token.");
    }
    request.principal = await authService.verifySessionToken(token);
  };
}

/**
 * For endpoints reachable by BOTH guests (no session at all) and registered users — order
 * creation being the motivating case. A present-but-invalid/expired token is still a 401
 * (never silently downgraded to "treat as guest", which would mask a broken session in a
 * confusing way); only a genuinely ABSENT Authorization header means guest.
 */
export function createOptionalAuthenticateHook(authService: AuthService) {
  return async function optionalAuthenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header) return;
    if (!header.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedError("Malformed Authorization header.");
    }
    const token = header.slice(BEARER_PREFIX.length).trim();
    if (!token) {
      throw new UnauthorizedError("Missing bearer token.");
    }
    request.principal = await authService.verifySessionToken(token);
  };
}
