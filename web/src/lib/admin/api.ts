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
  DraftInput,
  GameReminders,
  DrawWarning,
  ManualDrawInput,
  ManualDrawResult,
  Paged,
  ResultDetail,
  ResultListItem,
  ResultPreview,
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

  // Orders (read-only)
  listOrders: (token: string, query: Query) =>
    request<Paged<AdminOrderListItem>>("GET", `/v1/admin/orders${qs(query)}`, undefined, { token }),
  getOrder: (token: string, id: string) => request<AdminOrderDetail>("GET", `/v1/admin/orders/${id}`, undefined, { token }),

  // Audit (read-only)
  listAudit: (token: string, query: Query) =>
    request<Paged<AdminAuditItem> & { entityTypes: string[] }>("GET", `/v1/admin/audit-logs${qs(query)}`, undefined, {
      token,
    }),

  // Simplified workflow
  saveGameSettings: (token: string, gameId: string, body: { rules: Record<string, unknown>; reason: string }) =>
    request<RuleVersion>("PUT", `/v1/admin/games/${gameId}/settings`, body, { token }),
  discardRuleVersion: (token: string, id: string, reason: string) =>
    request<{ id: string; versionNumber: number; discarded: true }>("POST", `/v1/admin/rule-versions/${id}/discard`, { reason }, { token }),
  // Reminder-only scheduling: reading reminders never creates a draw.
  gameReminders: (token: string, gameId: string) =>
    request<GameReminders>("GET", `/v1/admin/games/${gameId}/schedule/reminders`, undefined, { token }),
  reminders: (token: string) => request<{ items: GameReminders[] }>("GET", "/v1/admin/schedule/reminders", undefined, { token }),
  dismissOccurrence: (token: string, gameId: string, body: { slotId: string; localDate: string; reason: string }) =>
    request<GameReminders>("POST", `/v1/admin/games/${gameId}/schedule/dismiss`, body, { token }),
  createDraw: (token: string, gameId: string, body: ManualDrawInput) =>
    request<ManualDrawResult>("POST", `/v1/admin/games/${gameId}/draws`, body, { token }),
  updateDraw: (
    token: string,
    drawId: string,
    body: { salesOpensAt?: string; salesClosesAt?: string; drawAt?: string; reason?: string; dryRun?: boolean },
  ) => request<{ dryRun: boolean; warnings: DrawWarning[]; draw: AdminDraw | null }>("PATCH", `/v1/admin/draws/${drawId}`, body, { token }),
  discardResultDraft: (token: string, drawId: string, reason: string) =>
    request<{ discardedVersion: number; restoredDrawStatus: string | null }>("POST", `/v1/admin/results/draws/${drawId}/draft/discard`, { reason }, { token }),

  // Results
  listResults: (token: string, query: Query) =>
    request<Paged<ResultListItem>>("GET", `/v1/admin/results${qs(query)}`, undefined, { token }),
  getResult: (token: string, drawId: string) =>
    request<ResultDetail>("GET", `/v1/admin/results/draws/${drawId}`, undefined, { token }),
  saveResultDraft: (token: string, drawId: string, body: DraftInput) =>
    request<{ resultId: string; versionNumber: number; isCorrection: boolean }>(
      "PUT",
      `/v1/admin/results/draws/${drawId}/draft`,
      body,
      { token },
    ),
  previewResult: (token: string, drawId: string) =>
    request<ResultPreview>("POST", `/v1/admin/results/draws/${drawId}/preview`, undefined, { token }),
  publishResult: (token: string, drawId: string, body: { resultId: string; calculationHash: string; reason: string; earlyReason?: string }) =>
    request<{ resultId: string; versionNumber: number; alreadyPublished: boolean; isCorrection: boolean }>(
      "POST",
      `/v1/admin/results/draws/${drawId}/publish`,
      body,
      { token },
    ),
  recordJackpot: (token: string, drawId: string, body: { amountToman: string; reason: string }) =>
    request<{ drawId: string; openingJackpotToman: string; previousToman: string | null; requiresCorrection: boolean; correctionDraftVersion: number | null; existingDraftVersion: number | null }>(
      "POST",
      `/v1/admin/results/draws/${drawId}/jackpot`,
      body,
      { token },
    ),
  recordEvidence: (token: string, drawId: string, body: { youtubeLiveUrl: string; youtubeVideoId: string }) =>
    request<{ id: string }>("POST", `/v1/admin/draws/${drawId}/evidence`, body, { token }),
};
