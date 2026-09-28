"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { useAdminI18n } from "@/lib/admin/i18n";
import {
  TEHRAN_TIME_ZONE,
  WEEKDAYS_EN,
  WEEKDAYS_EN_SHORT,
  WEEKDAYS_FA,
  WEEKDAYS_FA_SHORT,
  addDays,
  addMonths,
  calendarForLocale,
  detectLocalTimeZone,
  formatCalendarDate,
  formatInstantInZone,
  formatWallInput,
  formatWallTime,
  fromGregorianDate,
  fromTehranInput,
  gregorianWeekday,
  localeDigits,
  monthGrid,
  monthName,
  parseWallInput,
  sameDate,
  toGregorianDate,
  wallTimeInZone,
  weekdayOrder,
  type CalendarDate,
  type CalendarKind,
  type CalendarLocale,
} from "@/lib/admin/tehran-time";
import { CalendarIcon } from "@/components/icons";
import { inputSm } from "./ui";

// The editable value is always a Tehran wall time ("YYYY-MM-DDTHH:mm"). In Persian the admin
// navigates and picks the day in the Jalali calendar; in English, the Gregorian one. The time
// is a separate 24-hour selector. Conversion to UTC happens once, in the caller, through
// fromTehranInput()/resolveTehranInput() — this component never touches the browser timezone
// except for the read-only "your local time" line.

const noSubscription = () => () => undefined;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const two = (n: number) => String(n).padStart(2, "0");

/** A 24-hour time selector (hour : minute) with the locale's digits. Never shows AM/PM. */
export function TimeOfDaySelect({
  id,
  hour,
  minute,
  onChange,
  disabled,
  invalid,
}: {
  id: string;
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const { a, locale } = useAdminI18n();
  const p = a.workflow.picker;
  const loc = locale as CalendarLocale;
  return (
    // Hour then minute, always left-to-right like a clock face: "21:00".
    <div className="flex items-center gap-1" dir="ltr" role="group" aria-label={p.time}>
      <select
        id={id}
        aria-label={p.hour}
        className={`${inputSm} tabular w-[4.5rem] px-2`}
        value={hour}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(Number(e.target.value), minute)}
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {localeDigits(two(h), loc)}
          </option>
        ))}
      </select>
      <span className="font-bold text-muted" aria-hidden="true">
        :
      </span>
      <select
        aria-label={p.minute}
        className={`${inputSm} tabular w-[4.5rem] px-2`}
        value={minute}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(hour, Number(e.target.value))}
      >
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {localeDigits(two(m), loc)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** "HH:mm" slot time (e.g. a schedule's Tehran draw time) edited with TimeOfDaySelect. */
export function SlotTimeSelect({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  const hour = m ? Math.min(23, Number(m[1])) : 0;
  const minute = m ? Math.min(59, Number(m[2])) : 0;
  return <TimeOfDaySelect id={id} hour={hour} minute={minute} disabled={disabled} onChange={(h, mi) => onChange(`${two(h)}:${two(mi)}`)} />;
}

/**
 * One absolute business date-time, edited as Tehran time: a calendar in the locale's own
 * calendar, a 24-hour time, and read-only Tehran/local summaries that update immediately.
 */
export function TehranDateTimeField({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  const { a, locale, dir } = useAdminI18n();
  const p = a.workflow.picker;
  const loc = locale as CalendarLocale;
  const kind = calendarForLocale(loc);
  const wall = parseWallInput(value);
  // A time chosen before any date is kept here until a day is picked.
  const [pendingTime, setPendingTime] = useState({ hour: 0, minute: 0 });
  const hour = wall?.hour ?? pendingTime.hour;
  const minute = wall?.minute ?? pendingTime.minute;
  const selected = wall ? fromGregorianDate(kind, wall) : null;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = `${id}-calendar`;
  const errorId = `${id}-error`;
  const summaryId = `${id}-summary`;

  // Read on the client only (null while server-rendering), so hydration markup matches.
  const localZone = useSyncExternalStore(noSubscription, detectLocalTimeZone, () => null);

  function emit(date: CalendarDate | null, h: number, m: number) {
    if (!date) {
      setPendingTime({ hour: h, minute: m });
      return;
    }
    const g = toGregorianDate(kind, date);
    onChange(formatWallInput({ year: g.year, month: g.month, day: g.day, hour: h, minute: m }));
  }

  const iso = fromTehranInput(value);

  return (
    <div className="min-w-0" dir={dir}>
      <label htmlFor={`${id}-date`} className="mb-1 block text-xs font-semibold text-ink-soft">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          ref={triggerRef}
          id={`${id}-date`}
          type="button"
          className={`${inputSm} flex min-w-0 flex-1 basis-44 items-center justify-between gap-2 text-start ${selected ? "" : "text-muted"}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-describedby={`${error ? `${errorId} ` : ""}${summaryId}`}
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="truncate">{selected ? formatCalendarDate(selected, loc) : p.chooseDate}</span>
          <CalendarIcon className="h-4 w-4 shrink-0 text-muted" />
        </button>
        <TimeOfDaySelect id={`${id}-hour`} hour={hour} minute={minute} disabled={disabled} invalid={Boolean(error)} onChange={(h, m) => emit(selected, h, m)} />
      </div>

      {open && (
        <CalendarPanel
          id={panelId}
          kind={kind}
          locale={loc}
          selected={selected}
          onSelect={(d) => {
            emit(d, hour, minute);
            setOpen(false);
            triggerRef.current?.focus();
          }}
          onClose={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
        />
      )}

      {error && (
        <p id={errorId} className="mt-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}
      <div id={summaryId} className="mt-1.5 flex flex-col gap-0.5 text-xs" aria-live="polite">
        <p className="text-ink-soft">
          <span className="font-semibold">{p.tehranLine}:</span> {wall ? formatWallTime(wall, loc) : p.noDate}
        </p>
        {localZone && iso && (
          <p className="text-muted" title={p.localHint}>
            {p.localLine} (<bdi dir="ltr">{localZone}</bdi>): {formatInstantInZone(iso, localZone, loc)}
          </p>
        )}
      </div>
    </div>
  );
}

function tehranToday(kind: CalendarKind): CalendarDate {
  return fromGregorianDate(kind, wallTimeInZone(Date.now(), TEHRAN_TIME_ZONE));
}

/** An inline month calendar (a disclosure below the field, so it never clips inside modals
 * or overflows a phone screen). Grid keyboard navigation follows the WAI-ARIA date picker
 * pattern, with Left/Right mirrored in RTL. */
function CalendarPanel({
  id,
  kind,
  locale,
  selected,
  onSelect,
  onClose,
}: {
  id: string;
  kind: CalendarKind;
  locale: CalendarLocale;
  selected: CalendarDate | null;
  onSelect: (d: CalendarDate) => void;
  onClose: () => void;
}) {
  const { a } = useAdminI18n();
  const p = a.workflow.picker;
  const rtl = locale === "fa";
  const today = useMemo(() => tehranToday(kind), [kind]);
  const [focused, setFocused] = useState<CalendarDate>(selected ?? today);
  const gridRef = useRef<HTMLTableElement | null>(null);
  const headingId = useId();
  const weeks = monthGrid(kind, focused.year, focused.month);
  const order = weekdayOrder(kind);
  const weekdayNames = locale === "fa" ? WEEKDAYS_FA : WEEKDAYS_EN;
  const weekdayShort = locale === "fa" ? WEEKDAYS_FA_SHORT : WEEKDAYS_EN_SHORT;

  // Move DOM focus to the focused day when the calendar opens and after each keyboard move;
  // the month buttons change the view without stealing focus from themselves.
  const focusGrid = useRef(true);
  useEffect(() => {
    if (!focusGrid.current) return;
    focusGrid.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
  }, [focused]);

  const dayLabel = (d: CalendarDate) => {
    const weekday = gregorianWeekday(toGregorianDate(kind, d));
    return localeDigits(`${weekdayNames[weekday]} ${d.day} ${monthName(locale, d.month)} ${d.year}`, locale);
  };
  const weekStartOffset = (d: CalendarDate) => (gregorianWeekday(toGregorianDate(kind, d)) - order[0]! + 7) % 7;

  function onKeyDown(e: KeyboardEvent<HTMLTableElement>) {
    let next: CalendarDate | null = null;
    switch (e.key) {
      case "ArrowRight":
        next = addDays(kind, focused, rtl ? -1 : 1);
        break;
      case "ArrowLeft":
        next = addDays(kind, focused, rtl ? 1 : -1);
        break;
      case "ArrowUp":
        next = addDays(kind, focused, -7);
        break;
      case "ArrowDown":
        next = addDays(kind, focused, 7);
        break;
      case "Home":
        next = addDays(kind, focused, -weekStartOffset(focused));
        break;
      case "End":
        next = addDays(kind, focused, 6 - weekStartOffset(focused));
        break;
      case "PageUp":
        next = addMonths(kind, focused, e.shiftKey ? -12 : -1);
        break;
      case "PageDown":
        next = addMonths(kind, focused, e.shiftKey ? 12 : 1);
        break;
      case "Escape":
        // Close only the calendar, not the surrounding modal.
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      default:
        return;
    }
    e.preventDefault();
    focusGrid.current = true;
    setFocused(next);
  }

  const navButton = (label: string, delta: number, glyph: string) => (
    <button type="button" className="btn btn-ghost btn-sm h-9 w-9 px-0 text-base" aria-label={label} title={label} onClick={() => setFocused(addMonths(kind, focused, delta))}>
      <span aria-hidden="true">{glyph}</span>
    </button>
  );

  return (
    <div
      id={id}
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      dir={rtl ? "rtl" : "ltr"}
      lang={locale}
      className="mt-2 w-full max-w-sm rounded-xl border border-border bg-surface p-3 shadow-md"
    >
      <div className="mb-2 flex items-center justify-between gap-1">
        <div className="flex">
          {navButton(p.prevYear, -12, rtl ? "»" : "«")}
          {navButton(p.prevMonth, -1, rtl ? "›" : "‹")}
        </div>
        <p id={headingId} className="text-sm font-bold" aria-live="polite">
          {localeDigits(`${monthName(locale, focused.month)} ${focused.year}`, locale)}
        </p>
        <div className="flex">
          {navButton(p.nextMonth, 1, rtl ? "‹" : "›")}
          {navButton(p.nextYear, 12, rtl ? "«" : "»")}
        </div>
      </div>
      <table ref={gridRef} role="grid" aria-labelledby={headingId} className="w-full table-fixed border-collapse text-center" onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {order.map((wd) => (
              <th key={wd} scope="col" abbr={weekdayNames[wd]} className="pb-1 text-[0.7rem] font-semibold text-muted">
                {weekdayShort[wd]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((d, di) =>
                d === null ? (
                  <td key={di} />
                ) : (
                  <td key={di} className="p-0.5" aria-selected={sameDate(d, selected)}>
                    <button
                      type="button"
                      tabIndex={sameDate(d, focused) ? 0 : -1}
                      aria-label={dayLabel(d)}
                      aria-current={sameDate(d, today) ? "date" : undefined}
                      onClick={() => onSelect(d)}
                      onFocus={() => {
                        if (!sameDate(d, focused)) setFocused(d);
                      }}
                      className={`focus-ring tabular h-9 w-full rounded-md text-sm transition-colors ${
                        sameDate(d, selected)
                          ? "bg-brand font-bold text-white"
                          : sameDate(d, today)
                            ? "font-bold text-brand ring-1 ring-brand/40 hover:bg-brand-50"
                            : "text-foreground hover:bg-brand-50"
                      }`}
                    >
                      {localeDigits(d.day, locale)}
                    </button>
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSelect(today)}>
          {p.today}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
          {p.close}
        </button>
      </div>
      <p className="mt-1 text-[0.7rem] text-muted">{p.keyboardHint}</p>
    </div>
  );
}
