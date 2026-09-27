import { request } from "../api-client";
import type {
  AdminAuditItem,
  AdminDashboard,
  AdminDraw,
  AdminDrawListItem,
  AdminGame,
  AdminMe,
  AdminOrderDetail,
  AdminOrderListItem,
  Paged,
  RuleVersion,
} from "./types";

// Admin API client. Every call carries the ADMIN session token explicitly — it never reads
// the customer session. Uses the same request helper (and translated error reasons) as the
// customer client.

type Query = Record<string, string | number | undefined | null>;

function qs(query: Query): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export const adminApi = {
  login: (email: string, password: string) =>
    request<{ token: string; idleExpiresAt: string; absoluteExpiresAt: string }>("POST", "/v1/admin/auth/login", {
      email,
      password,
    }),
  logout: (token: string) => request<void>("POST", "/v1/auth/logout", undefined, { token }),
  me: (token: string) => request<AdminMe>("GET", "/v1/admin/me", undefined, { token }),

  dashboard: (token: string) => request<AdminDashboard>("GET", "/v1/admin/dashboard", undefined, { token }),

  // Games & rule versions (existing endpoints)
  listGames: () => request<AdminGame[]>("GET", "/v1/games"),
  getGame: (token: string, id: string) => request<AdminGame>("GET", `/v1/admin/games/${id}`, undefined, { token }),
  updateGame: (token: string, id: string, body: { nameEn?: string; nameFa?: string; status?: string }) =>
    request<AdminGame>("PATCH", `/v1/admin/games/${id}`, body, { token }),
  listRuleVersions: (token: string, gameId: string) =>
    request<RuleVersion[]>("GET", `/v1/admin/games/${gameId}/rule-versions`, undefined, { token }),
  createRuleVersion: (token: string, gameId: string, body: { rules: Record<string, unknown>; changeReason: string }) =>
    request<RuleVersion>("POST", `/v1/admin/games/${gameId}/rule-versions`, body, { token }),
  updateRuleVersion: (token: string, id: string, body: { rules?: Record<string, unknown>; changeReason?: string }) =>
    request<RuleVersion>("PATCH", `/v1/admin/rule-versions/${id}`, body, { token }),
  activateRuleVersion: (token: string, id: string) =>
    request<RuleVersion>("POST", `/v1/admin/rule-versions/${id}/activate`, undefined, { token }),

  // Draws
  listDraws: (token: string, query: Query) =>
    request<Paged<AdminDrawListItem>>("GET", `/v1/admin/draws${qs(query)}`, undefined, { token }),
  getDraw: (token: string, id: string) => request<AdminDraw>("GET", `/v1/admin/draws/${id}`, undefined, { token }),
  generateDraws: (token: string, gameId: string, horizonDays: number) =>
    request<AdminDraw[]>("POST", `/v1/admin/games/${gameId}/draws/generate`, { horizonDays }, { token }),

  // Orders (read-only)
  listOrders: (token: string, query: Query) =>
    request<Paged<AdminOrderListItem>>("GET", `/v1/admin/orders${qs(query)}`, undefined, { token }),
  getOrder: (token: string, id: string) => request<AdminOrderDetail>("GET", `/v1/admin/orders/${id}`, undefined, { token }),

  // Audit (read-only)
  listAudit: (token: string, query: Query) =>
    request<Paged<AdminAuditItem> & { entityTypes: string[] }>("GET", `/v1/admin/audit-logs${qs(query)}`, undefined, {
      token,
    }),
};
