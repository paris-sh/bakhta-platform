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
  /** The backend's original (English) message — for debugging only, never shown in the UI. */
  readonly serverMessage: string | undefined;

  constructor(status: number, code: string, message: string, details?: unknown, serverMessage?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.serverMessage = serverMessage;
  }
}

// The backend's error messages are English; the UI must only ever show Persian. Specific
// messages users can realistically hit get a precise translation, everything else falls
// back to a Persian message chosen by error code.
const SERVER_MESSAGE_FA: Record<string, string> = {
  "Invalid email or password.": "ایمیل یا رمز عبور نادرست است.",
  "An account with this email already exists.": "حسابی با این ایمیل قبلاً ثبت شده است.",
  "This account is not active.": "این حساب کاربری فعال نیست.",
  "Invalid or expired session.": "نشست شما منقضی شده است. لطفاً دوباره وارد شوید.",
  "Session was invalidated by a global logout.": "نشست شما منقضی شده است. لطفاً دوباره وارد شوید.",
  "Sales have closed for this draw.": "مهلت فروش بلیط برای این قرعه‌کشی به پایان رسیده است.",
  "Sales have closed for this draw since the order was created.":
    "مهلت فروش بلیط برای این قرعه‌کشی پس از ثبت سفارش به پایان رسید.",
  "Sales have not opened yet for this draw.": "فروش بلیط برای این قرعه‌کشی هنوز آغاز نشده است.",
  "This draw is not currently open for sales.": "این قرعه‌کشی در حال حاضر برای فروش باز نیست.",
  "Admin sessions cannot place orders.": "حساب مدیریتی امکان خرید بلیط ندارد.",
  "No upcoming draw is currently scheduled for this game.":
    "در حال حاضر هیچ قرعه‌کشی‌ای با فروش باز برای این بازی وجود ندارد.",
};

const CODE_MESSAGE_FA: Record<string, string> = {
  VALIDATION_ERROR: "اطلاعات واردشده معتبر نیست. لطفاً دوباره بررسی کنید.",
  UNAUTHORIZED: "برای ادامه باید وارد حساب کاربری شوید.",
  FORBIDDEN: "اجازه دسترسی به این بخش را ندارید.",
  NOT_FOUND: "مورد درخواستی یافت نشد.",
  CONFLICT: "این درخواست با وضعیت فعلی سازگار نیست. لطفاً دوباره تلاش کنید.",
  RATE_LIMITED: "تعداد تلاش‌ها بیش از حد مجاز است. لطفاً چند دقیقه بعد دوباره تلاش کنید.",
  INTERNAL_ERROR: "خطای داخلی سرور رخ داد. لطفاً دوباره تلاش کنید.",
};

function persianErrorMessage(code: string, serverMessage: string | undefined): string {
  if (serverMessage && SERVER_MESSAGE_FA[serverMessage]) return SERVER_MESSAGE_FA[serverMessage];
  return CODE_MESSAGE_FA[code] ?? "خطای غیرمنتظره‌ای رخ داد.";
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
    const code = envelope?.error?.code ?? "UNKNOWN_ERROR";
    throw new ApiError(
      response.status,
      code,
      persianErrorMessage(code, envelope?.error?.message),
      envelope?.error?.details,
      envelope?.error?.message,
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
