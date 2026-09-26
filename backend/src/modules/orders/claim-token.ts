import { createHash, randomBytes } from "node:crypto";

// Claim Tokens are generated and validated entirely within this file and share NO code or
// module boundary with session tokens (src/modules/auth/session-token.ts) — the two
// mechanisms are kept structurally independent by explicit product direction, even though
// both happen to use "32 random bytes, base64url, SHA-256 digest" as a pattern. This is a
// deliberate, minimal placeholder: full Claim Token lifecycle (rotation, guest submission,
// recovery) belongs to the future Claims module. This phase only needs "generate once at
// confirmation time, store only the digest" for the dev-only confirmation endpoint.

export interface GeneratedClaimToken {
  /** Returned to the client exactly once, in the confirmation response body. Never stored,
   * never logged, never passed to any audit/notification/outbox call. */
  raw: string;
  /** Stored in claim_credentials.token_digest. */
  digest: Buffer;
}

export function generateClaimToken(): GeneratedClaimToken {
  const raw = randomBytes(32).toString("base64url");
  return { raw, digest: createHash("sha256").update(raw).digest() };
}
