// Privacy helpers for admin read endpoints. Admin screens identify customers and render
// audit payloads, but must never expose credentials, secrets or full customer email
// addresses. Everything here is applied server-side, before data leaves the API.

/** "guest-demo@example.com" → "gu••••@example.com". Enough to recognise, not to harvest. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0) return "••••";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}••••@${domain}`;
}

// Keys whose values are never shown in the admin UI, at any depth. Matching is by key name,
// so a new sensitive field is covered as long as its name says what it is.
const SENSITIVE_KEY = /(password|passwd|hash|digest|token|secret|credential|otp|private[_-]?key|api[_-]?key|claim[_-]?code)/i;

export const REDACTED = "[REDACTED]";

/** Deep-copies a JSON value, replacing the value of every sensitive key with "[REDACTED]". */
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactSensitive(v);
    }
    return out;
  }
  return value;
}
