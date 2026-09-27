// The ADMIN session token lives under its own sessionStorage key, completely separate from
// the customer session (lib/session-storage.ts): signing in to one never signs in, out or
// overwrites the other, and neither token is ever sent to the other side's endpoints.

const ADMIN_TOKEN_KEY = "bakhta.admin_session_token";

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string): void {
  try {
    window.sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  } catch {
    // Storage unavailable — the in-memory admin context still works for this page's life.
  }
}

export function clearAdminToken(): void {
  try {
    window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // Nothing to do.
  }
}
