"use client";

import { useI18n } from "../i18n/locale-context";
import { ADMIN_MESSAGES } from "../i18n/admin-messages";

/** The shared locale context plus the admin dictionary (`a`) and an inline separator.
 * Persian uses "،" because a middle dot reads as the Persian zero (۰) next to digits. */
export function useAdminI18n() {
  const base = useI18n();
  return { ...base, a: ADMIN_MESSAGES[base.locale], sep: base.locale === "fa" ? "، " : " · " };
}
