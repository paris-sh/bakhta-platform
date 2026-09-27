// Hands a just-registered email to the login page without putting it in the URL or in any
// browser storage: a plain module variable, which survives client-side navigation but not a
// reload. The login page peeks it into state, then clears it once mounted.

let pendingEmail: string | null = null;

export function setPendingLoginEmail(email: string): void {
  pendingEmail = email;
}

/** Pure read — safe inside a useState initializer (which React may call twice in dev). */
export function peekPendingLoginEmail(): string {
  return pendingEmail ?? "";
}

export function clearPendingLoginEmail(): void {
  pendingEmail = null;
}
