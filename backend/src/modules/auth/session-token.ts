import { createHash, randomBytes } from "node:crypto";

// Session tokens are generated and validated entirely within this module and are never
// shared code/logic with Claim Tokens (src/modules/claims, not yet built) — the two
// mechanisms are kept structurally independent by design, per explicit product direction,
// even though both happen to use "32 random bytes, base64url, SHA-256 digest" as a pattern.

export interface GeneratedSessionToken {
  /** Returned to the client once, in the login response body. Never stored, never logged. */
  raw: string;
  /** Stored in sessions.token_digest. */
  digest: Buffer;
}

export function generateSessionToken(): GeneratedSessionToken {
  const raw = randomBytes(32).toString("base64url");
  return { raw, digest: digestSessionToken(raw) };
}

export function digestSessionToken(raw: string): Buffer {
  return createHash("sha256").update(raw).digest();
}
