/**
 * Factory-timezone date/time handling — the single place the platform converts
 * between stored instants and what a user sees or types.
 *
 * ── The rule ────────────────────────────────────────────────────────────
 *   STORE  an absolute instant, always UTC (Prisma writes UTC into
 *          `timestamp(3)`; the API returns ISO-8601 with `Z`).
 *   SHOW   that instant in the FACTORY's timezone — never UTC, never the
 *          viewer's browser timezone.
 *
 * Why the factory and not the browser: a shift boundary, a downtime event and
 * an OEE window are statements about plant-local time. "Shift 1 starts 07:30"
 * must read 07:30 to a supervisor on site, to a manager in Dubai and to a
 * consultant in Cairo alike. Formatting in browser time makes the same shift
 * show three different clock values, and a laptop with a wrong timezone
 * silently shifts every KPI window.
 *
 * ── The bug this replaces ───────────────────────────────────────────────
 * A production order entered as 01 Aug 2026 00:00 Riyadh is correctly stored as
 * 2026-07-31T21:00:00Z. Screens that formatted with `timeZone: 'UTC'`, or
 * bucketed days with `toISOString().slice(0,10)`, rendered that as 31 July
 * 21:00 — a correct value displayed three hours early, and on the wrong day.
 *
 * Input needs the same treatment: `<input type="datetime-local">` reads and
 * writes BROWSER-local time, so a value typed by someone outside the plant
 * timezone would mean a different instant than intended. Use
 * {@link toDateTimeLocal} / {@link fromDateTimeLocal} on both ends of every
 * datetime-local field.
 */

import { useAuthStore } from '@/store/auth-store';

/** Used until the user profile (and its factory) has loaded. */
export const DEFAULT_TIME_ZONE = 'Asia/Riyadh';

/**
 * The timezone every date on screen is rendered in.
 *
 * Deliberately a plain function, not a hook, so non-React code (CSV export,
 * chart axis builders, sort comparators) resolves the same zone as the UI.
 */
export function getFactoryTimeZone(): string {
  try {
    const user = useAuthStore.getState().user;
    return (
      (user?.factory as { timezone?: string } | null | undefined)?.timezone ||
      user?.timezone ||
      DEFAULT_TIME_ZONE
    );
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** Accepts anything the API or a chart might hand us; `null` when unusable. */
export function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── core Intl plumbing ────────────────────────────────────────────────────

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock fields of `date` as seen in `timeZone`. */
function zonedParts(date: Date, timeZone: string) {
  const p = partsFormatter(timeZone).formatToParts(date);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  // Intl renders midnight as hour "24" in some engines; normalise to 0.
  const hour = get('hour') % 24;
  return { year: get('year'), month: get('month'), day: get('day'), hour, minute: get('minute'), second: get('second') };
}

/** Offset of `timeZone` from UTC at `date`, in milliseconds (+ east of UTC). */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Strip sub-second noise so the diff is a clean offset.
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// ── formatting ────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** `01 Aug 2026` in factory time. */
export function formatDate(value: Date | string | number | null | undefined, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return '—';
  const p = zonedParts(d, timeZone ?? getFactoryTimeZone());
  return `${pad(p.day)} ${MONTHS[p.month - 1]} ${p.year}`;
}

/** `00:00` in factory time. */
export function formatTime(value: Date | string | number | null | undefined, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return '—';
  const p = zonedParts(d, timeZone ?? getFactoryTimeZone());
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** `01 Aug 2026 00:00` in factory time — the default for any planned/actual timestamp. */
export function formatDateTime(value: Date | string | number | null | undefined, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return '—';
  const tz = timeZone ?? getFactoryTimeZone();
  return `${formatDate(d, tz)} ${formatTime(d, tz)}`;
}

/** `+03` — the factory's UTC offset at that instant. */
export function formatZoneOffset(value: Date | string | number | null | undefined, timeZone?: string): string {
  const d = toDate(value) ?? new Date();
  const mins = zoneOffsetMs(d, timeZone ?? getFactoryTimeZone()) / 60000;
  const sign = mins < 0 ? '-' : '+';
  const a = Math.abs(mins);
  const hh = pad(Math.floor(a / 60));
  const mm = Math.round(a % 60);
  return mm ? `${sign}${hh}:${pad(mm)}` : `${sign}${hh}`;
}

/**
 * `01 Aug 2026 00:00 (+03)` — for detail screens and audit trails, where the
 * reader must be able to tell which clock the number is on.
 */
export function formatDateTimeWithZone(value: Date | string | number | null | undefined, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return '—';
  const tz = timeZone ?? getFactoryTimeZone();
  return `${formatDateTime(d, tz)} (${formatZoneOffset(d, tz)})`;
}

/** `01 Aug 00:00` — compact form for dense tables and chart tooltips. */
export function formatDateTimeShort(value: Date | string | number | null | undefined, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return '—';
  const tz = timeZone ?? getFactoryTimeZone();
  const p = zonedParts(d, tz);
  return `${pad(p.day)} ${MONTHS[p.month - 1]} ${pad(p.hour)}:${pad(p.minute)}`;
}

// ── day bucketing ─────────────────────────────────────────────────────────

/**
 * `2026-08-01` for the factory-local day an instant falls in.
 *
 * Replaces `toISOString().slice(0, 10)`, which returns the UTC day — so
 * anything after 21:00 Riyadh was bucketed into the following day, and a
 * shift starting 00:00 Riyadh into the previous one.
 */
export function toFactoryDayKey(value: Date | string | number | null | undefined, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return '';
  const p = zonedParts(d, timeZone ?? getFactoryTimeZone());
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * The UTC instants bounding a factory-local calendar day — what a date filter
 * should send to the API so "1 Aug" means 1 Aug at the plant.
 */
export function factoryDayBounds(dayKey: string, timeZone?: string): { from: string; to: string } {
  const tz = timeZone ?? getFactoryTimeZone();
  return {
    from: fromDateTimeLocal(`${dayKey}T00:00`, tz).toISOString(),
    to: fromDateTimeLocal(`${dayKey}T23:59:59`, tz).toISOString(),
  };
}

// ── <input type="datetime-local"> ─────────────────────────────────────────

/**
 * Instant → `YYYY-MM-DDTHH:mm` **in factory time**, for prefilling a
 * datetime-local input. The native input has no timezone concept, so the string
 * we hand it must already be plant-local.
 */
export function toDateTimeLocal(value: Date | string | number | null | undefined, timeZone?: string): string {
  const d = toDate(value);
  if (!d) return '';
  const p = zonedParts(d, timeZone ?? getFactoryTimeZone());
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * `YYYY-MM-DDTHH:mm` typed by the user (plant-local) → the absolute instant.
 *
 * `new Date('2026-08-01T00:00')` would interpret it in the BROWSER's zone; this
 * interprets it in the factory's. The second pass re-resolves the offset at the
 * candidate instant so the result stays correct across a DST transition (Riyadh
 * has none, but other plants may).
 */
export function fromDateTimeLocal(localValue: string, timeZone?: string): Date {
  const tz = timeZone ?? getFactoryTimeZone();
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(localValue);
  if (!m) return new Date(NaN);
  const [, Y, Mo, D, h, mi, s] = m;
  const wall = Date.UTC(+Y, +Mo - 1, +D, +h, +mi, s ? +s : 0);
  let ts = wall - zoneOffsetMs(new Date(wall), tz);
  ts = wall - zoneOffsetMs(new Date(ts), tz);
  return new Date(ts);
}

/** Convenience for form submit: plant-local input string → ISO UTC for the API. */
export function dateTimeLocalToIso(
  localValue: string | null | undefined,
  timeZone?: string,
): string | undefined {
  if (!localValue) return undefined;
  const d = fromDateTimeLocal(localValue, timeZone);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
