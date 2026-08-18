/**
 * Splitting a window's stopped time into the three kinds OEE treats differently.
 *
 * ── Why this is not a sum ───────────────────────────────────────────────────
 * The obvious implementation adds up each event's duration. Real downtime logs
 * break it two ways, both observed on this plant's data:
 *
 *   1. DUPLICATE events — the same stop written twice (same machine, same start,
 *      same end, different id). Summing counted it twice, so a one-minute bucket
 *      reported two minutes of downtime.
 *   2. OVERLAPPING classifications — a minute covered by BOTH a planned stop and
 *      an unplanned one, because an operator logged a changeover while the status
 *      signal had already opened a breakdown.
 *
 * Either way the stopped total exceeded the window and the accounting identity
 * that every read surface relies on — PPT − run = unplanned downtime — silently
 * stopped holding. On M1 it came out as 1,500 against 1,625.
 *
 * So intervals are CLIPPED to the window, MERGED within each kind (a minute is
 * stopped or it is not; it cannot be stopped twice), and then assigned to exactly
 * one kind by precedence:
 *
 *   planned → external → unplanned
 *
 * Planned wins because it is a deliberate human decision about that time, and
 * external wins over unplanned because a machine that cannot be fed is not
 * breaking down. Whatever is left over is the machine's own unplanned loss —
 * which is the only kind Availability charges for.
 *
 * The result is exact by construction: planned + external + unplanned ≤ window.
 */

export interface StopInterval {
  startTime: Date;
  endTime: Date | null;
  isPlanned: boolean;
  affectsOEE: boolean;
}

export interface StoppedSplit {
  /** Minutes excluded from BOTH run time and PPT — scheduled, so not a loss. */
  plannedMin: number;
  /** Minutes excluded from BOTH — the line could not feed or drain a healthy machine. */
  externalMin: number;
  /** Minutes out of run but kept in PPT — the availability loss. */
  downMin: number;
}

type Span = [number, number];

/** Clip to [from, to], drop empties, merge every overlap and touching pair. */
function merge(spans: Span[]): Span[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: Span[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur[0] <= last[1]) last[1] = Math.max(last[1], cur[1]);
    else out.push(cur);
  }
  return out;
}

/** Total length of `spans` (already merged) that does NOT fall inside `taken`. */
function subtract(spans: Span[], taken: Span[]): Span[] {
  if (taken.length === 0) return spans;
  const out: Span[] = [];
  for (const [s, e] of spans) {
    let cursor = s;
    for (const [ts, te] of taken) {
      if (te <= cursor || ts >= e) continue;
      if (ts > cursor) out.push([cursor, Math.min(ts, e)]);
      cursor = Math.max(cursor, te);
      if (cursor >= e) break;
    }
    if (cursor < e) out.push([cursor, e]);
  }
  return out;
}

const total = (spans: Span[]) => spans.reduce((sum, [s, e]) => sum + (e - s), 0);

/**
 * Split the stopped time inside [from, to] into planned / external / unplanned.
 *
 * @param events   downtime events (any machine filtering is the caller's job)
 * @param from     window start, epoch ms
 * @param to       window end, epoch ms
 * @param openEnd  what an event with no endTime is treated as ending at
 */
export function splitStoppedTime(
  events: StopInterval[],
  from: number,
  to: number,
  openEnd: number,
): StoppedSplit {
  const MS_PER_MIN = 60_000;
  if (!(to > from)) return { plannedMin: 0, externalMin: 0, downMin: 0 };

  const planned: Span[] = [];
  const external: Span[] = [];
  const unplanned: Span[] = [];

  for (const ev of events) {
    const s = Math.max(ev.startTime.getTime(), from);
    const e = Math.min((ev.endTime ?? new Date(openEnd)).getTime(), to);
    if (e <= s) continue;
    if (ev.isPlanned) planned.push([s, e]);
    else if (ev.affectsOEE) unplanned.push([s, e]);
    else external.push([s, e]);
  }

  // Merge first (kills duplicates), then apply precedence so no minute is counted
  // under two headings.
  const p = merge(planned);
  const x = subtract(merge(external), p);
  const u = subtract(merge(unplanned), [...p, ...x].sort((a, b) => a[0] - b[0]));

  return {
    plannedMin: total(p) / MS_PER_MIN,
    externalMin: total(x) / MS_PER_MIN,
    downMin: total(u) / MS_PER_MIN,
  };
}
