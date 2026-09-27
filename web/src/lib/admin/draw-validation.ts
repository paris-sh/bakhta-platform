// Client-side checks for the Create/Edit draw forms. They mirror the backend exactly:
// structurally impossible windows block saving; anything else is a warning at most (the
// backend returns those), which only makes a reason mandatory for a SUPER_ADMIN.

export const MIN_REASON_LENGTH = 5;

export type TimeField = "open" | "close" | "draw";
export type TimeIssue = { field: TimeField; code: "REQUIRED" | "OPEN_NOT_BEFORE_CLOSE" | "CLOSE_NOT_BEFORE_DRAW" };

/** ISO instants (or null when a field is empty/invalid) → blocking problems, per field. */
export function validateDrawTimes(times: { open: string | null; close: string | null; draw: string | null }): TimeIssue[] {
  const issues: TimeIssue[] = [];
  (["open", "close", "draw"] as const).forEach((field) => {
    if (!times[field]) issues.push({ field, code: "REQUIRED" });
  });
  if (issues.length > 0) return issues;
  const open = Date.parse(times.open!);
  const close = Date.parse(times.close!);
  const draw = Date.parse(times.draw!);
  if (!(open < close)) issues.push({ field: "close", code: "OPEN_NOT_BEFORE_CLOSE" });
  if (!(close < draw)) issues.push({ field: "draw", code: "CLOSE_NOT_BEFORE_DRAW" });
  return issues;
}

export type ReasonState = "NOT_NEEDED" | "MISSING" | "TOO_SHORT" | "OK";

export function reasonState(reason: string, required: boolean): ReasonState {
  const n = reason.trim().length;
  if (n >= MIN_REASON_LENGTH) return "OK";
  if (!required && n === 0) return "NOT_NEEDED";
  return n === 0 ? "MISSING" : "TOO_SHORT";
}

/** Why the save button is disabled, in display order; empty = saving is allowed. */
export function saveBlockers(input: { timeIssues: TimeIssue[]; reason: string; reasonRequired: boolean; checking?: boolean }): ("TIMES" | "REASON" | "CHECKING")[] {
  const out: ("TIMES" | "REASON" | "CHECKING")[] = [];
  if (input.timeIssues.length > 0) out.push("TIMES");
  const r = reasonState(input.reason, input.reasonRequired);
  if (r === "MISSING" || r === "TOO_SHORT") out.push("REASON");
  if (input.checking) out.push("CHECKING");
  return out;
}
