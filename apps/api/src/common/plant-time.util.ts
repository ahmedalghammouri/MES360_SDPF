/**
 * Plant-local time helpers for server-side bucketing and labelling.
 *
 * Instants are stored and compared in UTC — that never changes. What these
 * helpers fix is the *labelling* step: deciding which calendar day, hour or week
 * an instant belongs to. That question only has a meaningful answer in the
 * plant's own timezone.
 *
 * `toISOString().slice(0, 10)` answers it in UTC, which for a +03 plant pushes
 * everything after 21:00 local into the next day and pulls a 00:00 shift into
 * the previous one — so a night shift's output lands on two different dates and
 * a "today" query silently spans the wrong 24 hours.
 *
 * The API container sets TZ=Asia/Riyadh (see docker-compose + the tzdata package
 * in the Dockerfile), so `PLANT_TZ` defaults to the process zone; pass an
 * explicit IANA zone when a request is scoped to a factory in another one.
 *
 * Frontend counterpart: apps/web/src/lib/datetime.ts
 */

export const DEFAULT_PLANT_TZ =
  process.env.TZ && process.env.TZ !== 'UTC' ? process.env.TZ : 'Asia/Riyadh';

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
    fmtCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock fields of `date` as seen in `timeZone`. */
export function plantParts(date: Date, timeZone: string = DEFAULT_PLANT_TZ) {
  const p = partsFormatter(timeZone).formatToParts(date);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return {
    year: get('year'), month: get('month'), day: get('day'),
    hour: get('hour') % 24, minute: get('minute'),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-08-01` — the plant-local calendar day an instant falls in. */
export function plantDayKey(date: Date, timeZone?: string): string {
  const p = plantParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** `2026-08-01T14` — the plant-local hour bucket. */
export function plantHourKey(date: Date, timeZone?: string): string {
  const p = plantParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}`;
}

/**
 * `2026-07-27` — the Monday of the plant-local ISO week.
 *
 * Derived from the plant-local date rather than the UTC one, so a Sunday-evening
 * reading is not filed under the previous week.
 */
export function plantWeekKey(date: Date, timeZone?: string): string {
  const p = plantParts(date, timeZone);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // ISO week starts Monday
  return d.toISOString().slice(0, 10);
}
