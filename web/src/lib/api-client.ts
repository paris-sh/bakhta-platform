import { API_BASE_URL } from "./config";
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

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
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
    throw new ApiError(0, "NETWORK_ERROR", "امکان ارتباط با سرور وجود ندارد.");
  }

  const isNoContent = response.status === 204;
  const payload = isNoContent ? null : await response.json().catch(() => null);

  if (!response.ok) {
    const envelope = payload as { error?: { code?: string; message?: string; details?: unknown } } | null;
    throw new ApiError(
      response.status,
      envelope?.error?.code ?? "UNKNOWN_ERROR",
      envelope?.error?.message ?? "خطای غیرمنتظره‌ای رخ داد.",
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
