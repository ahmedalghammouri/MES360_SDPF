import type { EdgeType } from './types';

/** Truthy test shared by BOOL and numeric signals: numeric > 0, or boolean true. */
function isHigh(v: number | boolean | null | undefined): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  return v > 0;
}

/**
 * Pure edge detector. Returns the number of counts to add (0 or 1) given the
 * previous and current raw values.
 *
 * - RISING  (default): low→high transition  (0→1, false→true)   → +1
 * - FALLING:           high→low transition  (1→0, true→false)   → +1
 * - CHANGE:            any change in level                       → +1
 *
 * The first observation (prev === null/undefined) never counts — we only have a
 * baseline, not a transition. This is what makes restarts safe when the caller
 * seeds `prev` from the persisted last raw value.
 */
export function detectEdge(
  prev: number | boolean | null | undefined,
  curr: number | boolean | null | undefined,
  edgeType: EdgeType = 'RISING',
): number {
  if (prev === null || prev === undefined) return 0; // baseline only
  if (curr === null || curr === undefined) return 0;

  const prevHigh = isHigh(prev);
  const currHigh = isHigh(curr);

  switch (edgeType) {
    case 'RISING':
      return !prevHigh && currHigh ? 1 : 0;
    case 'FALLING':
      return prevHigh && !currHigh ? 1 : 0;
    case 'CHANGE':
      return prevHigh !== currHigh ? 1 : 0;
    default:
      return 0;
  }
}

/**
 * Stateful wrapper around {@link detectEdge}. Holds the last observed raw value
 * (seed it from the DB on startup) and an optional debounce window that ignores
 * edges arriving faster than `debounceMs` apart (suppresses contact bounce).
 */
export class EdgeCounter {
  private last: number | boolean | null;
  private lastEdgeAt = 0;

  constructor(
    private readonly edgeType: EdgeType = 'RISING',
    private readonly debounceMs = 0,
    seed: number | boolean | null = null,
  ) {
    this.last = seed;
  }

  /** Feed a new raw value; returns counts to add (0 or 1). */
  update(curr: number | boolean | null, now: number = Date.now()): number {
    const inc = detectEdge(this.last, curr, this.edgeType);
    this.last = curr;
    if (inc === 0) return 0;
    if (this.debounceMs > 0 && now - this.lastEdgeAt < this.debounceMs) return 0;
    this.lastEdgeAt = now;
    return inc;
  }

  get lastValue(): number | boolean | null {
    return this.last;
  }
}
