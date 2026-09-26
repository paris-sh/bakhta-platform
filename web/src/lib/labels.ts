// Persian display labels for backend enum values. Unknown values fall back to a neutral
// Persian word rather than leaking a raw English enum into the UI.

const ORDER_STATUS_FA: Record<string, string> = {
  DRAFT: "پیش‌نویس",
  PENDING_PAYMENT: "در انتظار پرداخت",
  CONFIRMED: "تأیید شده",
  EXPIRED: "منقضی شده",
  CANCELLED: "لغو شده",
  REFUNDED: "بازپرداخت شده",
};

const TICKET_STATUS_FA: Record<string, string> = {
  PENDING: "در انتظار تأیید",
  CONFIRMED: "تأیید شده",
  CANCELLED: "لغو شده",
  REFUNDED: "بازپرداخت شده",
  VOID: "باطل شده",
};

const TICKET_OUTCOME_FA: Record<string, string> = {
  PENDING: "در انتظار قرعه‌کشی",
  WINNER: "برنده",
  NOT_WINNER: "بدون جایزه",
  VOID: "باطل شده",
};

const DRAW_STATUS_FA: Record<string, string> = {
  SALES_OPEN: "فروش باز است",
  SALES_CLOSED: "فروش بسته شده",
  DRAW_IN_PROGRESS: "در حال قرعه‌کشی",
  RESULT_ENTERED: "نتیجه ثبت شده",
  PENDING_REVIEW: "در حال بررسی نتیجه",
  PUBLISHED: "نتیجه اعلام شده",
  SETTLED: "تسویه شده",
  CLOSED: "بسته شده",
  DELAYED: "به تعویق افتاده",
  CANCELLED: "لغو شده",
  VOID: "باطل شده",
};

const GAME_TYPE_FA: Record<string, string> = {
  FOUR_LEAF: "چهار برگ",
  SIX_CHANCE: "شش شانس",
};

const UNKNOWN_FA = "نامشخص";

export const orderStatusFa = (status: string) => ORDER_STATUS_FA[status] ?? UNKNOWN_FA;
export const ticketStatusFa = (status: string) => TICKET_STATUS_FA[status] ?? UNKNOWN_FA;
export const ticketOutcomeFa = (status: string) => TICKET_OUTCOME_FA[status] ?? UNKNOWN_FA;
export const drawStatusFa = (status: string) => DRAW_STATUS_FA[status] ?? UNKNOWN_FA;
export const gameTypeFa = (gameType: string) => GAME_TYPE_FA[gameType] ?? UNKNOWN_FA;
