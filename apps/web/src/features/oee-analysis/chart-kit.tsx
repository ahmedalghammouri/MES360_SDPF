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
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';

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
 * The muted axis/grid palette every ECharts panel in this app already draws
 * with — `components/charts/production-trend.tsx` and
 * `features/downtime-center/downtime-charts.tsx` both hand-tune this exact
 * pair of values per theme. Centralised here rather than copied a fourth
 * time.
 */
export function echartsAxisColours(isDark: boolean) {
  return {
    text: isDark ? '#ffffff60' : '#00000060',
    grid: isDark ? '#ffffff10' : '#00000010',
    line: isDark ? '#ffffff20' : '#00000020',
    tooltipBg: isDark ? '#1a1f2e' : '#ffffff',
    tooltipBorder: isDark ? '#ffffff10' : '#00000010',
    tooltipText: isDark ? '#ffffff90' : '#000000',
  };
}

/**
 * A colour + alpha → a translucent fill Canvas will actually parse.
 *
 * Series colour comes from two places: the resolved `--viz-N` hex steps, and
 * literal `hsl(...)` constants like `STATUS.good`/`SEGMENT_COLOUR` that were
 * never `var()` references for `resolveChartColour` to touch. Appending a hex
 * alpha suffix to an hsl() string produces `'hsl(142 62% 38%)47'`, which is not
 * a colour — `CanvasGradient.addColorStop` throws on it and takes the whole
 * chart down. Splice the alpha in as CSS instead, per the input's own syntax.
 */
export function withAlpha(colour: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const trimmed = colour.trim();

  const hex = /^#[0-9a-fA-F]{6}$/.exec(trimmed);
  if (hex) {
    return `${trimmed}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
  }

  const hsl = /^hsl\(([^)]+)\)$/.exec(trimmed);
  if (hsl) {
    const body = hsl[1];
    return body.includes(',') ? `hsla(${body}, ${a})` : `hsl(${body} / ${a})`;
  }

  return trimmed;
}

/**
 * The eight-hue chart palette, defined once in `globals.css` and RE-STEPPED
 * per theme there (see the comment beside `--viz-1`): the same hex on both
 * cards put violet at 2.04:1 contrast on the dark surface — effectively
 * invisible — so light and dark each get their own validated step.
 *
 * Every chart in this app reads these as `var(--viz-N)` and lets the CSS
 * cascade pick the right step, which works for anything CSS paints — a div, an
 * SVG `fill`. It does NOT work for ECharts: its default renderer is a plain
 * `<canvas>`, and a canvas 2D context's `fillStyle` is never part of the
 * CSSOM — handing it the literal string `'var(--viz-1)'` resolves to nothing,
 * silently, and the series paints in whatever colour the context happened to
 * have set before it. This mirrors the same eight steps as concrete hex per
 * theme, so a caller keeps writing `colour: 'var(--viz-1)'` unchanged and it
 * still reaches a real, theme-correct colour once it hits the canvas.
 */
const VIZ_HEX: Record<string, { light: string; dark: string }> = {
  '--viz-1': { light: '#2a78d6', dark: '#3987e5' },
  '--viz-2': { light: '#eb6834', dark: '#d95926' },
  '--viz-3': { light: '#1baf7a', dark: '#199e70' },
  '--viz-4': { light: '#eda100', dark: '#c98500' },
  '--viz-5': { light: '#e87ba4', dark: '#d55181' },
  '--viz-6': { light: '#008300', dark: '#008300' },
  '--viz-7': { light: '#4a3aa7', dark: '#9085e9' },
  '--viz-8': { light: '#e34948', dark: '#e66767' },
};

/** `'var(--viz-3)'` → a concrete hex for the active theme. Anything already concrete (hex, hsl()) passes through unchanged. */
export function resolveChartColour(colour: string, isDark: boolean): string {
  const m = /^var\((--viz-\d)\)$/.exec(colour.trim());
  if (!m) return colour;
  const step = VIZ_HEX[m[1]];
  return step ? (isDark ? step.dark : step.light) : colour;
}

/**
 * One time series chart — the only one in this app.
 *
 * ── Why ECharts, not the hand-rolled SVG this replaced ──────────────────────
 * `components/charts/production-trend.tsx` (Command Center) and
 * `features/downtime-center/downtime-charts.tsx` (Downtime Command Center)
 * already establish this app's chart language, and they are built on ECharts:
 * native cross-hair tooltips, native click-to-hide legends, native gradient
 * fills, native dual axes, native zoom. A second trend component built on a
 * different library — Recharts — could match none of that by construction,
 * however much CSS it wore; it would always read as a second visual system
 * bolted onto the first. So this draws with the same engine the rest of the
 * app already trusts, the same axis palette, the same legend behaviour.
 *
 * ── What a trend has to carry ───────────────────────────────────────────────
 * A picture of a shift is not an analysis. Reading one means asking WHEN
 * something happened, HOW MUCH it was, and what it looks like at a different
 * resolution — and then taking the numbers away. So every trend in the app
 * carries the same things, and none of them is optional per page: labelled
 * axes, a crosshair reading every series at the hovered moment, a legend that
 * hides a series on click, a form switch, zoom (drag-to-select on the plot,
 * or the handles on the slider beneath it — both native to ECharts'
 * `dataZoom`, not a bolted-on approximation of it), and a CSV export.
 *
 * ── An incomplete bucket is not on the chart at all ────────────────────────
 * A bucket the engine could not measure is sent as `null`, and a bucket where
 * even one plotted series is `null` is dropped from `rows` before anything is
 * drawn — not bridged with a line, and not left as a visible break either.
 * Both of those still read as "the chart has an opinion about this moment";
 * the true answer is that the moment has no reading to show, the same as if
 * it were never in the window. It never reaches the CSV export either, so a
 * downloaded file has no half-populated row to explain.
 *
 * Zero is NOT incomplete: a machine that genuinely produced nothing is
 * measured, and its zero belongs on the chart same as any other reading.
 *
 * ── The form switch is local, seeded globally ───────────────────────────────
 * The filter panel sets the house style and every chart follows it. Changing
 * it ON a chart changes only that chart, because the reader comparing two
 * panels wants one of them in bars and is not asking to restyle the app.
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

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const c = echartsAxisColours(isDark);

  const hasBuckets = !!(buckets?.length && onBucketChange);

  // ── EVERY hook runs before the early return below ──────────────────────────
  // Not a style preference: an early return placed above a hook changes the
  // NUMBER of hooks between renders, and React aborts the whole tree with
  // error #310 ("rendered fewer hooks than expected") the moment it happens.
  // This chart hits that transition routinely — a period change can take it
  // from "some complete buckets" to "none" in one render — so the rule has to
  // hold structurally rather than by nobody noticing.

  // A bucket where even ONE of the plotted series has no reading is dropped
  // outright, not drawn with a break in it — a half-answered row is not a
  // fact about the plant the way a fully-measured zero is, and showing it as
  // a gap in an otherwise-continuous line reads as one series failed rather
  // than as "this moment has nothing to say". The CSV export reads this same
  // filtered list, so an incomplete bucket is absent from the file rather
  // than present with a blank cell.
  const rows = React.useMemo(
    () => data.filter((d) => series.every((s) => d[s.key] != null)),
    [data, series],
  );
  const dropped = data.length - rows.length;

  // Resolved ONCE, here — every downstream read of a series' colour (the
  // palette array, the area gradients, the zoom slider's filler) uses this,
  // never `series` directly, so nothing can reach the canvas as an
  // unresolved `var(--viz-N)` reference.
  const resolved = React.useMemo(
    () => series.map((s) => ({ ...s, colour: resolveChartColour(s.colour, isDark) })),
    [series, isDark],
  );

  const hasZoom = zoom && rows.length > 6;

  const option = React.useMemo(() => {
    const yAxis: Record<string, unknown>[] = [{
      type: 'value',
      min: domain === 'auto' ? undefined : domain[0],
      max: domain === 'auto' ? undefined : domain[1],
      axisLabel: { color: c.text, fontSize: 10, formatter: (v: number) => `${axisNumber(v)}${unit}` },
      splitLine: { lineStyle: { color: c.grid } },
      axisLine: { show: false },
    }];
    if (rightUnit !== undefined) {
      yAxis.push({
        type: 'value',
        min: rightDomain === 'auto' || !rightDomain ? undefined : rightDomain[0],
        max: rightDomain === 'auto' || !rightDomain ? undefined : rightDomain[1],
        axisLabel: { color: c.text, fontSize: 10, formatter: (v: number) => `${axisNumber(v)}${rightUnit}` },
        splitLine: { show: false },
        axisLine: { show: false },
      });
    }

    return {
      backgroundColor: 'transparent',
      color: resolved.map((s) => s.colour),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', label: { backgroundColor: c.tooltipBg } },
        backgroundColor: c.tooltipBg,
        borderColor: c.tooltipBorder,
        textStyle: { color: c.tooltipText, fontSize: 12 },
        // `rows` already dropped every incomplete bucket, so this is a
        // defensive fallback rather than a path a reader should ever see.
        valueFormatter: (v: unknown) =>
          v == null ? '—' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: decimals })}${unit}`,
      },
      legend: series.length > 1 ? {
        data: resolved.map((s) => s.name),
        textStyle: { color: c.text, fontSize: 11 },
        icon: 'circle', itemWidth: 8, itemHeight: 8,
        top: 0, right: 0,
      } : undefined,
      grid: {
        top: series.length > 1 ? 34 : 12,
        left: 8, right: rightUnit !== undefined ? 8 : 12,
        bottom: hasZoom ? 44 : 8,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: rows.map((d) => String(d[xKey] ?? '')),
        boundaryGap: form === 'bar',
        axisLabel: { color: c.text, fontSize: 10 },
        axisLine: { lineStyle: { color: c.line } },
        splitLine: { show: false },
      },
      yAxis,
      dataZoom: hasZoom ? [
        // Drag-to-select directly on the plot, and the scroll wheel — the
        // "zoom in" the reader reaches for first.
        { type: 'inside', throttle: 50 },
        // A visible handle for a precise range, and the only part of this
        // that needs a pixel budget of its own — hence the extra grid bottom
        // margin above.
        {
          type: 'slider', height: 18, bottom: 6,
          borderColor: c.grid, fillerColor: withAlpha(resolved[0]?.colour ?? '#4c7571', 0.12),
          handleStyle: { color: c.line },
          textStyle: { color: c.text, fontSize: 9 },
        },
      ] : undefined,
      series: resolved.map((s) => {
        const axisIndex = s.axis === 'right' && rightUnit !== undefined ? 1 : 0;
        const base = {
          name: s.name,
          // `rows` already excludes any bucket missing a reading for this or
          // any other plotted series, so every value reaching the chart here
          // is real.
          data: rows.map((d) => d[s.key]),
          yAxisIndex: axisIndex,
        };
        if (form === 'bar') {
          return { ...base, type: 'bar', barMaxWidth: 28, itemStyle: { borderRadius: [3, 3, 0, 0] } };
        }
        return {
          ...base,
          type: 'line',
          smooth: true,
          symbol: rows.length <= 60 ? 'circle' : 'none',
          symbolSize: 5,
          lineStyle: { width: s.emphasis ? 3 : 2 },
          ...(form === 'area' ? {
            areaStyle: {
              color: {
                type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: withAlpha(s.colour, 0.28) },
                  { offset: 1, color: withAlpha(s.colour, 0.02) },
                ],
              },
            },
          } : {}),
        };
      }),
    };
    // `isDark` rather than `c`: the colour table is rebuilt on every render, so
    // depending on the object itself would bust this memo every time. It is a
    // pure function of the theme, which is what actually changes.
  }, [rows, resolved, series.length, form, domain, rightDomain, unit, rightUnit, decimals, isDark, hasZoom, xKey]);

  // ── Hooks are done; from here it is safe to branch ────────────────────────
  const head = toolbar ? (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      <div className="ms-auto flex flex-wrap items-center gap-2">
        {hasBuckets && (
          <Segmented label="Bucket size" value={bucket ?? buckets![0].value}
            options={buckets!.map((b) => ({ value: b.value, label: b.label }))}
            onChange={(v) => onBucketChange!(v)} />
        )}
        <Segmented label="Chart form" value={form} options={FORM_OPTIONS} onChange={setForm} />
        {exportName && (
          <button type="button" onClick={() => exportCsv(exportName, rows, series, xKey)}
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

  if (rows.length === 0) {
    return (
      <div>
        {head}
        <p className="py-8 text-center text-sm text-muted-foreground">
          {/*
            "No buckets" and "every bucket was incomplete" are different facts,
            and saying the first when the second is true sends the reader
            looking for a window problem they do not have. The count is the
            actionable part: it says the plant reported SOMETHING here, and
            names how much was set aside for missing a factor.
          */}
          {dropped > 0
            ? `All ${dropped} bucket${dropped === 1 ? '' : 's'} in this window were incomplete — `
              + `each was missing a reading for at least one of ${series.map((s) => s.name).join(', ')}, `
              + 'so none can be plotted.'
            : empty}
        </p>
      </div>
    );
  }

  return (
    <div>
      {head}
      <ReactECharts option={option} notMerge style={{ height, width: '100%' }} />
      {/*
        Buckets the plant reported but could not fully measure. Stated rather
        than silently omitted: a reader comparing this chart to the shift log
        needs to know the line has gaps in it, and roughly how many.
      */}
      {dropped > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {dropped} of {data.length} buckets are not plotted — each was missing a reading for at
          least one series, and a partly-measured bucket is not a point on this chart.
        </p>
      )}
    </div>
  );
}
