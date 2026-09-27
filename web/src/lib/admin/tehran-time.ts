// Draw times are entered and shown in the official timezone, Asia/Tehran, which has used a
// fixed +03:30 offset (no daylight saving) since 2022 — independent of the admin's browser.

const OFFSET_MINUTES = 3 * 60 + 30;

/** ISO instant → "YYYY-MM-DDTHH:mm" in Tehran time, for a datetime-local input. */
export function toTehranInput(iso: string): string {
  const t = new Date(new Date(iso).getTime() + OFFSET_MINUTES * 60_000);
  return t.toISOString().slice(0, 16);
}

/** "YYYY-MM-DDTHH:mm" (Tehran wall time) → ISO instant with the +03:30 offset. */
export function fromTehranInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}:00+03:30`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Now plus `hours`, rounded down to the minute, as a Tehran input value. */
export function tehranInputFromNow(hours: number, now = Date.now()): string {
  const ms = Math.floor((now + hours * 3_600_000) / 60_000) * 60_000;
  return toTehranInput(new Date(ms).toISOString());
}
