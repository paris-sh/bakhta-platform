import { createHash, randomBytes } from "node:crypto";

/** Case-insensitive-stable hash of an identifying value (e.g. an email) for auth_attempts —
 * never store the raw value there. */
export function hashIdentifier(value: string): Buffer {
  return createHash("sha256").update(value.trim().toLowerCase()).digest();
}

/** Short, non-guessable public-ish number for users/admin accounts, e.g. "U-8F3A9C1E2B04". */
export function generatePublicNumber(prefix: string): string {
  const suffix = randomBytes(6).toString("hex").toUpperCase();
  return `${prefix}-${suffix}`;
}
