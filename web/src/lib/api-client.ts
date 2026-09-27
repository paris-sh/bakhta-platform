import { API_BASE_URL } from "./config";
import type { ApiErrorReason } from "./i18n/messages";
import type {
  ConfirmOrderResult,
  Draw,
  Game,
  MeResponse,
  Order,
  PublicTicketCheck,
  SessionResponse,
  Ticket,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  /** What went wrong, as a translatable key. The UI renders `t.errors[reason]` — never
   * `message`, which holds the backend's original (English) text for debugging only. */
  readonly reason: ApiErrorReason;

  constructor(status: number, code: string, reason: ApiErrorReason, serverMessage?: string, details?: unknown) {
    super(serverMessage ?? reason);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.reason = reason;
    this.details = details;
  }
}

// Specific backend messages a user can realistically hit get a precise reason; everything
// else falls back to a reason chosen by error code.
const SERVER_MESSAGE_REASON: Record<string, ApiErrorReason> = {
  "Invalid email or password.": "invalidCredentials",
  "An account with this email already exists.": "emailTaken",
  "This account is not active.": "accountInactive",
  "Invalid or expired session.": "sessionExpired",
  "Session was invalidated by a global logout.": "sessionExpired",
  "Sales have closed for this draw.": "salesClosed",
  "Sales have closed for this draw since the order was created.": "salesClosedAfterOrder",
  "Sales have not opened yet for this draw.": "salesNotOpen",
  "This draw is not currently open for sales.": "drawNotOpen",
  "Admin sessions cannot place orders.": "adminCannotOrder",
  "No upcoming draw is currently scheduled for this game.": "noUpcomingDraw",
};

const CODE_REASON: Record<string, ApiErrorReason> = {
  VALIDATION_ERROR: "validation",
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "notFound",
  CONFLICT: "conflict",
  RATE_LIMITED: "rateLimited",
  INTERNAL_ERROR: "server",
};

function errorReason(status: number, code: string, serverMessage: string | undefined): ApiErrorReason {
  if (serverMessage && SERVER_MESSAGE_REASON[serverMessage]) return SERVER_MESSAGE_REASON[serverMessage];
  if (CODE_REASON[code]) return CODE_REASON[code];
  return status >= 500 ? "server" : "unknown";
}

interface RequestOptions {
  token?: string | null;
  idempotencyKey?: string;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (options?.token) headers.Authorization = `Bearer ${options.token}`;
  if (options?.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "network");
  }

  const isNoContent = response.status === 204;
  const payload = isNoContent ? null : await response.json().catch(() => null);

  if (!response.ok) {
    const envelope = payload as { error?: { code?: string; message?: string; details?: unknown } } | null;
    const code = envelope?.error?.code ?? "UNKNOWN_ERROR";
    const serverMessage = envelope?.error?.message;
    throw new ApiError(
      response.status,
      code,
      errorReason(response.status, code, serverMessage),
      serverMessage,
      envelope?.error?.details,
    );
  }

  return payload as T;
}

export const api = {
  listGames: () => request<Game[]>("GET", "/v1/games"),
  getGame: (slug: string) => request<Game>("GET", `/v1/games/${encodeURIComponent(slug)}`),
  getNextDraw: (slug: string) =>
    request<Draw>("GET", `/v1/games/${encodeURIComponent(slug)}/draws/next`),

  register: (email: string, password: string) =>
    request<{ id: string; userNumber: string; email: string }>("POST", "/v1/auth/register", {
      email,
      password,
    }),
  login: (email: string, password: string) =>
    request<SessionResponse>("POST", "/v1/auth/login", { email, password }),
  logout: (token: string) => request<void>("POST", "/v1/auth/logout", undefined, { token }),
  me: (token: string) => request<MeResponse>("GET", "/v1/me", undefined, { token }),

  createOrder: (
    input: {
      drawId: string;
      guestEmail?: string;
      tickets: Array<{
        isQuickPick: boolean;
        fourLeafNumber?: string;
        sixChanceNumbers?: number[];
        sixChanceSymbol?: number;
      }>;
    },
    idempotencyKey: string,
    token?: string | null,
  ) => request<Order>("POST", "/v1/orders", input, { idempotencyKey, token }),

  confirmOrderDev: (orderId: string) =>
    request<ConfirmOrderResult>("POST", `/v1/dev/orders/${orderId}/confirm`),

  myOrders: (token: string) => request<Order[]>("GET", "/v1/me/orders", undefined, { token }),
  myTickets: (token: string) => request<Ticket[]>("GET", "/v1/me/tickets", undefined, { token }),

  checkTicket: (publicCode: string) =>
    request<PublicTicketCheck>("GET", `/v1/tickets/check/${encodeURIComponent(publicCode)}`),
};
