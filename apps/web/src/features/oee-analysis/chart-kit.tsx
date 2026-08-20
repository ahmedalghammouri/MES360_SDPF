'use client';
/**
 * The pieces every analysis on this page shares.
 *
 * Six analyses draw the same gauge and colour the same five kinds of time. Six
 * copies of that would drift the moment one was corrected — the same reason the
 * two engines share their minute classifier rather than each keeping one.
 *
 * What lives here is only what is genuinely common. A chart that appears once
 * stays in the panel that owns it.
 */
import React from 'react';

export type SegmentKind = 'running' | 'planned' | 'external' | 'downtime' | 'unmeasured';

/**
 * Status colours, reserved for state and never reused as a series hue.
 *
 * Every place these are used also prints a label, so state is never carried by
 * colour alone — which is what makes the chart readable to a colour-blind reader
 * and in print.
 */
export const STATUS = {
  good: 'hsl(142 62% 38%)',
  warn: 'hsl(38 92% 46%)',
  bad: 'hsl(0 72% 51%)',
  none: 'hsl(215 16% 60%)',
};

export const SEGMENT_COLOUR: Record<SegmentKind, string> = {
  running: STATUS.good,
  downtime: STATUS.bad,
  planned: 'hsl(215 20% 55%)',
  external: STATUS.warn,
  unmeasured: 'hsl(215 14% 78%)',
};

export const SEGMENT_LABEL: Record<SegmentKind, string> = {
  running: 'Running',
  downtime: 'Unplanned downtime',
  planned: 'Planned stop',
  external: 'Starved / blocked',
  unmeasured: 'Not reported',
};

/**
 * Where a reading turns from good to warning to bad.
 *
 * Constants for now, and deliberately printed under the gauge rather than
 * implied by its colour: a band nobody can read is a band nobody agreed to.
 * These belong in factory configuration — the reference sets them per machine —
 * and until they are, every plant is graded against somebody else's targets.
 */
export const BANDS: Record<string, { warn: number; good: number }> = {
  OEE: { warn: 60, good: 70 },
  Availability: { warn: 80, good: 90 },
  Performance: { warn: 80, good: 95 },
  Quality: { warn: 95, good: 99 },
  // TEEP is OEE against the whole calendar, so it is always the smaller number
  // and its bands have to be lower — grading it against OEE's would paint every
  // plant on earth red.
  TEEP: { warn: 25, good: 40 },
};

/**
 * A colour per machine state, fixed by the state itself.
 *
 * Assigned by IDENTITY, never by rank. On the downtime page the same colour ties
 * a Pareto bar to the blocks in the timeline beneath it, so if the colour moved
 * with the ranking, changing the filter would repaint both charts and the link
 * between them would silently point somewhere else.
 *
 * The plant's states are a closed set, so they are written out. Anything unknown
 * falls to a stable hash rather than to "the next colour", which would depend on
 * what else happened to be in the window.
 */
const STATE_SLOT: Record<string, number> = {
  BREAKDOWN: 8, IDLE: 4, STARVED: 2, BLOCKED: 5,
  SETUP: 7, CHANGEOVER: 1, PLANNED_STOP: 3, MAINTENANCE: 6,
  OFFLINE: 5, RUNNING: 6,
};

export function stateColour(state: string): string {
  const slot = STATE_SLOT[state];
  if (slot) return `var(--viz-${slot})`;
  // Stable across windows and filters: the same name always lands on the same
  // slot, which is the whole point.
  let h = 0;
  for (let i = 0; i < state.length; i++) h = (h * 31 + state.charCodeAt(i)) >>> 0;
  return `var(--viz-${(h % 8) + 1})`;
}

export function bandOf(label: string, v: number | null): keyof typeof STATUS {
  if (v == null) return 'none';
  const b = BANDS[label];
  if (!b) return 'none';
  if (v >= b.good) return 'good';
  if (v >= b.warn) return 'warn';
  return 'bad';
}

/** Minutes as a duration a shop floor reads: days, hours, minutes. */
export const dur = (m: number | null | undefined) => {
  if (m == null) return '—';
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = Math.round(m % 60);
  return [d ? `${d}d` : '', h ? `${h}h` : '', `${min}m`].filter(Boolean).join(' ');
};

export const pctText = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}%`);

/**
 * A semi-donut gauge.
 *
 * Two arcs and a label rather than a charting library: the shape is one sweep,
 * and a library would bring an axis system it has no use for. The value is
 * printed inside — the colour is the second encoding, never the only one.
 */
export function Gauge({
  label, value, onOpen,
}: { label: string; value: number | null; onOpen?: () => void }) {
  const colour = STATUS[bandOf(label, value)];
  const b = BANDS[label];

  // 180° sweep, 0% on the left.
  const R = 52, CX = 70, CY = 68, W = 13;
  const arc = (p: number) => {
    const a = Math.PI * (1 - Math.min(1, Math.max(0, p / 100)));
    return `${CX - R},${CY} A ${R} ${R} 0 0 1 ${CX + R * Math.cos(a)},${CY - R * Math.sin(a)}`;
  };

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        {onOpen && (
          <button onClick={onOpen} title={`Open the ${label} analysis`}
            className="rounded px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">↗</button>
        )}
      </div>
      <svg viewBox="0 0 140 82" className="w-full" role="img"
        aria-label={`${label} ${value == null ? 'not available' : `${value.toFixed(1)} percent`}`}>
        <path d={`M ${arc(100)}`} fill="none" stroke="hsl(var(--muted))" strokeWidth={W} strokeLinecap="round" />
        {value != null && (
          <path d={`M ${arc(value)}`} fill="none" stroke={colour} strokeWidth={W} strokeLinecap="round" />
        )}
        <text x={CX} y={CY - 8} textAnchor="middle" className="fill-foreground"
          style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {value == null ? '—' : `${value.toFixed(1)}%`}
        </text>
      </svg>
      <span className="text-center text-[10px] text-muted-foreground">
        {b ? `warn ${b.warn}% · good ${b.good}%` : 'no band configured'}
      </span>
    </div>
  );
}

export interface TimeModelBar {
  key: string;
  minutes: number;
  pct: number;
  kind: 'base' | 'loss' | 'result';
}

/**
 * The time model as a descending waterfall.
 *
 * Losses are drawn right-aligned so each one visually cuts into the level above
 * it. The descent is then something you see rather than something you compute,
 * which is the only reason to draw it as bars at all instead of listing the
 * numbers.
 */
export function TimeModel({
  bars, labels,
}: { bars: TimeModelBar[]; labels: Record<string, string> }) {
  return (
    <div className="flex flex-col gap-1.5">
      {bars.map((b) => {
        const colour =
          b.kind === 'result' ? 'bg-emerald-600'
          : b.kind === 'loss' ? 'bg-amber-500'
          : 'bg-muted-foreground/30';
        return (
          <div key={b.key} className="grid grid-cols-[minmax(120px,240px)_1fr] items-center gap-3">
            <span className={`truncate text-xs ${b.kind === 'loss' ? 'text-muted-foreground' : 'font-medium'}`}
              title={labels[b.key] ?? b.key}>
              {labels[b.key] ?? b.key}
            </span>
            <div className={`flex items-center gap-2 ${b.kind === 'loss' ? 'flex-row-reverse' : ''}`}>
              <div className="h-5 min-w-[2px] rounded-sm transition-all" style={{ width: `${Math.max(b.pct, 0)}%` }}>
                <div className={`h-full w-full rounded-sm ${colour}`} />
              </div>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                {b.pct.toFixed(2)}% · {dur(b.minutes)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
