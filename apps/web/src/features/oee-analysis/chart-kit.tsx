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
import {
  ResponsiveContainer, CartesianGrid, XAxis, YAxis, Legend,
  Tooltip as RTooltip, LineChart, Line, AreaChart, Area, BarChart, Bar, Brush,
} from 'recharts';

import { useDashboardPrefsStore } from '@/store/dashboard-prefs-store';

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

/* ── The trend chart every analytical page draws ─────────────────────────── */

export interface TrendSeries {
  key: string;
  name: string;
  colour: string;
  /** The headline series is drawn heavier than the factors it is made of. */
  emphasis?: boolean;
  /** Plot against the right-hand axis — for a series in different units. */
  axis?: 'left' | 'right';
}

/** A bucket size the reader can switch a chart to. */
export interface TrendBucket {
  value: string;
  label: string;
}

/**
 * Crosshair tooltip. Values in ink, identity carried by the swatch beside them.
 *
 * A series with no value in this bucket is listed as "—" rather than omitted:
 * the reader asked what happened at this moment, and "not measured" is an
 * answer. Silently dropping the row makes a gap look like a rendering fault.
 */
function TrendTip({ active, payload, label, unit = '%', decimals = 1 }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[168px] rounded-md border border-border/60 bg-popover px-3 py-2 shadow-lg">
      <div className="mb-1.5 border-b border-border/50 pb-1 text-[11px] font-medium text-muted-foreground">
        {label}
      </div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 py-[1px] text-xs">
          <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ms-auto font-medium tabular-nums text-foreground">
            {p.value == null ? '—' : `${Number(p.value).toLocaleString('en-US', {
              minimumFractionDigits: 0, maximumFractionDigits: decimals,
            })}${unit}`}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Compact axis numbers: 12.4k rather than 12400, which crowds a narrow chart. */
function axisNumber(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1_000) return `${(v / 1_000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(v * 10) / 10);
}

/**
 * Hand the reader the numbers behind the picture.
 *
 * A trend answers "what shape was the shift". The next question is always "what
 * exactly, and can I put it in a report" — and re-typing figures off a chart is
 * where transcription errors come from. Values are written unrounded, because
 * this file is for arithmetic, not for reading.
 */
function exportCsv(
  name: string,
  data: Array<Record<string, unknown>>,
  series: readonly TrendSeries[],
  xKey: string,
): void {
  const cell = (v: unknown) => {
    if (v == null) return '';
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const head = ['period', ...series.map((s) => s.name)].map(cell).join(',');
  const rows = data.map((d) => [cell(d[xKey]), ...series.map((s) => cell(d[s.key]))].join(','));
  // A BOM, so Excel opens a UTF-8 file with Arabic labels intact instead of mojibake.
  const blob = new Blob([`﻿${head}\n${rows.join('\n')}\n`], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** One segmented control, used for both the form switch and the bucket switch. */
function Segmented<T extends string>({
  value, options, onChange, label,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label}
      className="inline-flex items-center rounded-md border border-border/60 bg-muted/40 p-[2px]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            aria-pressed={on}
            className={[
              'rounded-[4px] px-2 py-[3px] text-[11px] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              on ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const FORM_OPTIONS = [
  { value: 'area' as const, label: 'Area' },
  { value: 'line' as const, label: 'Line' },
  { value: 'bar' as const, label: 'Bar' },
];

/**
 * One time series chart — the only one in this app.
 *
 * ── What a trend has to carry ───────────────────────────────────────────────
 * A picture of a shift is not an analysis. Reading one means asking WHEN
 * something happened, HOW MUCH it was, and what it looks like at a different
 * resolution — and then taking the numbers away. A chart that renders a shape
 * and nothing else forces the reader back to the database for every one of
 * those, which is what "not professional" means in practice.
 *
 * So every trend in the app carries the same six things, and none of them is
 * optional per page: labelled axes, a crosshair reading every series at the
 * hovered moment, a legend that hides a series on click, a form switch, a zoom
 * that narrows the window without redrawing the page, and an export.
 *
 * ── Gaps are the point ──────────────────────────────────────────────────────
 * `connectNulls` is OFF, deliberately and everywhere. The engines return null
 * for a bucket they could not measure — an hour with no parts counted has no
 * Performance and no Quality — and bridging that draws a straight line THROUGH
 * time the plant has no measurement for.
 *
 * A gap says "not measured". A line through it says "we know, and it was fine".
 * Only one of those is true.
 *
 * Zero is NOT a gap: a machine that genuinely produced nothing is measured, and
 * its zero belongs on the chart.
 *
 * ── The form switch is local, seeded globally ───────────────────────────────
 * The filter panel sets the house style and every chart follows it. Changing it
 * ON a chart changes only that chart, because the reader comparing two panels
 * wants one of them in bars and is not asking to restyle the application.
 */
export function TrendChart({
  data,
  series,
  xKey = 't',
  height = 280,
  domain = [0, 100],
  unit = '%',
  decimals = 1,
  empty = 'No buckets in this window yet.',
  title,
  bucket,
  buckets,
  onBucketChange,
  exportName,
  zoom = true,
  toolbar = true,
  rightDomain,
  rightUnit,
}: {
  data: Array<Record<string, unknown>>;
  series: readonly TrendSeries[];
  xKey?: string;
  height?: number;
  /** `'auto'` lets the values set the scale — for counts rather than percentages. */
  domain?: [number, number] | 'auto';
  unit?: string;
  decimals?: number;
  empty?: string;
  title?: string;
  /** Bucket controls appear only when the page can actually re-bucket its data. */
  bucket?: string;
  buckets?: readonly TrendBucket[];
  onBucketChange?: (b: string) => void;
  /** Enables the CSV button, and names the file. */
  exportName?: string;
  zoom?: boolean;
  toolbar?: boolean;
  rightDomain?: [number, number] | 'auto';
  rightUnit?: string;
}) {
  const globalForm = useDashboardPrefsStore((s) => s.trendType);
  const [form, setForm] = React.useState(globalForm);
  // Follow the house style when it changes, until this chart is told otherwise.
  React.useEffect(() => setForm(globalForm), [globalForm]);

  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  /**
   * The zoomed window, as bucket indices.
   *
   * Narrowing redraws the chart over fewer buckets rather than scaling the marks
   * — so the axis ticks and the crosshair keep reading the real values instead
   * of a stretched picture of them.
   */
  const [range, setRange] = React.useState<[number, number] | null>(null);

  const shown = React.useMemo(
    () => series.filter((s) => !hidden.has(s.key)),
    [series, hidden],
  );

  const toggle = React.useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      // Never let the last series be hidden — an empty chart with a legend
      // reads as a failure rather than as a choice the reader just made.
      if (next.has(key)) next.delete(key);
      else if (next.size < series.length - 1) next.add(key);
      return next;
    });
  }, [series.length]);

  const hasBuckets = !!(buckets?.length && onBucketChange);
  const zoomed = range !== null;

  const head = toolbar && (title || hasBuckets || exportName || zoomed || true) ? (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      <div className="ms-auto flex flex-wrap items-center gap-2">
        {zoomed && (
          <button type="button" onClick={() => setRange(null)}
            className="rounded-md border border-border/60 px-2 py-[3px] text-[11px] font-medium
                       text-muted-foreground transition-colors hover:text-foreground
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Reset zoom
          </button>
        )}
        {hasBuckets && (
          <Segmented label="Bucket size" value={bucket ?? buckets![0].value}
            options={buckets!.map((b) => ({ value: b.value, label: b.label }))}
            onChange={(v) => { setRange(null); onBucketChange!(v); }} />
        )}
        <Segmented label="Chart form" value={form} options={FORM_OPTIONS} onChange={setForm} />
        {exportName && (
          <button type="button" onClick={() => exportCsv(exportName, data, series, xKey)}
            title="Download these buckets as CSV"
            className="rounded-md border border-border/60 px-2 py-[3px] text-[11px] font-medium
                       text-muted-foreground transition-colors hover:text-foreground
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            CSV
          </button>
        )}
      </div>
    </div>
  ) : null;

  if (!data || data.length === 0) {
    return (
      <div>
        {head}
        <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>
      </div>
    );
  }

  const grid = (
    <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.35} strokeDasharray="3 3"
      vertical={false} />
  );

  const axes = (
    <>
      <XAxis dataKey={xKey} stroke="hsl(var(--border))" tickLine={false} minTickGap={28}
        height={22} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
      <YAxis yAxisId="left" domain={domain === 'auto' ? ['auto', 'auto'] : domain}
        stroke="hsl(var(--border))" tickLine={false} width={46}
        tickFormatter={(v: number) => `${axisNumber(v)}${unit}`}
        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
      {rightUnit !== undefined && (
        <YAxis yAxisId="right" orientation="right"
          domain={rightDomain === 'auto' || !rightDomain ? ['auto', 'auto'] : rightDomain}
          stroke="hsl(var(--border))" tickLine={false} width={46}
          tickFormatter={(v: number) => `${axisNumber(v)}${rightUnit}`}
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
      )}
    </>
  );

  const overlay = (
    <>
      <RTooltip content={<TrendTip unit={unit} decimals={decimals} />}
        cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '3 3' }} />
      {series.length > 1 && (
        <Legend iconType="plainline" verticalAlign="bottom" height={26}
          wrapperStyle={{ fontSize: 11, paddingTop: 6, cursor: 'pointer' }}
          onClick={(e: any) => toggle(String(e.dataKey ?? e.value))}
          formatter={(value: string, entry: any) => (
            <span style={{ opacity: hidden.has(String(entry?.dataKey)) ? 0.4 : 1 }}>{value}</span>
          )} />
      )}
      {zoom && data.length > 6 && (
        <Brush dataKey={xKey} height={22} travellerWidth={8}
          stroke="hsl(var(--border))" fill="hsl(var(--muted))" fillOpacity={0.3}
          startIndex={range?.[0]} endIndex={range?.[1]}
          onChange={(r: any) => {
            if (r?.startIndex === 0 && r?.endIndex === data.length - 1) setRange(null);
            else if (typeof r?.startIndex === 'number') setRange([r.startIndex, r.endIndex]);
          }} />
      )}
    </>
  );

  const axisOf = (s: TrendSeries) => (s.axis === 'right' && rightUnit !== undefined ? 'right' : 'left');
  const margin = { top: 8, right: rightUnit !== undefined ? 8 : 16, bottom: 0, left: 0 };

  return (
    <div>
      {head}
      {/* The brush and legend need room of their own, or they eat the plot. */}
      <div className="w-full" style={{ height: height + (zoom && data.length > 6 ? 26 : 0) }}>
        <ResponsiveContainer>
          {form === 'bar' ? (
            <BarChart data={data} margin={margin} barGap={2}>
              {grid}{axes}{overlay}
              {shown.map((s) => (
                // A rounded data-end reads as the end of a quantity; the flat
                // foot stays on the baseline it is measured from.
                <Bar key={s.key} yAxisId={axisOf(s)} dataKey={s.key} name={s.name}
                  fill={s.colour} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              ))}
            </BarChart>
          ) : form === 'area' ? (
            <AreaChart data={data} margin={margin}>
              <defs>
                {series.map((s) => (
                  <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.colour} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={s.colour} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              {grid}{axes}{overlay}
              {shown.map((s) => (
                <Area key={s.key} yAxisId={axisOf(s)} type="monotone" dataKey={s.key} name={s.name}
                  stroke={s.colour} strokeWidth={s.emphasis ? 2.5 : 2}
                  fill={`url(#fill-${s.key})`} connectNulls={false}
                  dot={false} activeDot={{ r: 5 }} isAnimationActive={false} />
              ))}
            </AreaChart>
          ) : (
            <LineChart data={data} margin={margin}>
              {grid}{axes}{overlay}
              {shown.map((s) => (
                <Line key={s.key} yAxisId={axisOf(s)} type="monotone" dataKey={s.key} name={s.name}
                  stroke={s.colour} strokeWidth={s.emphasis ? 2.5 : 2}
                  connectNulls={false}
                  dot={data.length <= 60 ? { r: 3, strokeWidth: 0 } : false}
                  activeDot={{ r: 5 }} isAnimationActive={false} />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
