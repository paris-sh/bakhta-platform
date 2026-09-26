const TOKEN_KEY = "bakhta.session_token";

// sessionStorage only, per the approved design — never localStorage, never cookies, and
// this key is used for the AUTH session token only. Claim Tokens never touch this module
// or any other browser storage; they exist only transiently in component state, shown once.

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage unavailable (private mode, quota) — session simply won't persist across a
    // reload; the in-memory auth context still works for the current page life.
  }
}

export function clearStoredToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to do — already effectively cleared for this tab's lifetime.
  }
}
