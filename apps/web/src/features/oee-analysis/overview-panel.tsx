'use client';
/**
 * The Overview analysis, as the reference lays it out: four gauges, one trend,
 * the production tally, and the machine-status band.
 *
 * Each of the four answers a different question, so each gets the form that
 * question deserves — a single reading is a gauge, four readings over time are
 * one line chart, four totals are stat tiles rather than a chart of four bars,
 * and a chronology is a timeline. None of them is a chart because a chart looks
 * analytical.
 */
import React from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

import { Gauge, dur, type SegmentKind, TrendChart, type TrendSeries } from './chart-kit';
import { MachineStateGantt, type GanttRow } from '@/components/charts/machine-state-gantt';
import { toDate, formatTime, formatDayShort, formatMonth } from '@/lib/datetime';

export interface TrendPoint {
  at: string;
  oee: number | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
}
export interface TimelineSegment {
  machineId: string; machineCode: string; state: string;
  kind: SegmentKind;
  from: string; to: string; minutes: number;
}
export interface ProductionDetails {
  downtimeCount: number; downtimeMin: number;
  microstopCount: number; microstopMin: number;
  plannedStopCount: number; plannedStopMin: number;
  externalCount: number; externalMin: number;
}

/**
 * The four series, in FIXED order.
 *
 * Assigned once and never cycled: hiding a line from the legend must not repaint
 * the ones left, or a reader who hid Quality comes back to a chart where OEE has
 * changed colour. Emphasis on OEE is carried by stroke weight rather than by
 * promoting it to a louder hue — weight is a second channel, a hue swap is a
 * broken one.
 *
 * These are the project's validated categorical steps. Checked in both themes:
 * light CVD ΔE 9.1 (protan) / 22.9 normal, dark 8.4 / 19.8. The light mode's
 * contrast warning is why this chart always carries a legend and the page
 * always carries the tables.
 */
const SERIES: TrendSeries[] = [
  { key: 'availability', name: 'Availability', colour: 'var(--viz-1)' },
  { key: 'performance', name: 'Performance', colour: 'var(--viz-2)' },
  { key: 'quality', name: 'Quality', colour: 'var(--viz-3)' },
  { key: 'oee', name: 'OEE', colour: 'var(--viz-4)' },
] as const;

/** Crosshair tooltip. Values in ink, identity carried by the swatch beside them. */
function TrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover p-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto font-mono tabular-nums">
            {p.value == null ? '—' : `${Number(p.value).toFixed(1)}%`}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Bucket sizes offered on the trend. "Auto" is first and is the default: the
 * timeframe already implies a sensible size, and most readers want that.
 */
const BUCKETS = [
  { value: 'auto', label: 'Auto' },
  { value: 'hour', label: 'Hour' },
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
] as const;

export function OverviewPanel({
  oee, availability, performance, quality, trend, production, timeline,
  operationalMin, usedOperationalMin, machines, windowStart, windowEnd,
  bucket, onBucketChange,
}: {
  /** Bucket size in force; undefined = chosen from the timeframe. */
  bucket?: string;
  onBucketChange?: (b: string) => void;
  oee: number | null; availability: number | null; performance: number | null; quality: number | null;
  trend: TrendPoint[];
  production: ProductionDetails;
  timeline: TimelineSegment[];
  operationalMin: number;
  usedOperationalMin: number;
  machines: Array<{ key: string; label: string; sublabel?: string | null; availability: number | null }>;
  windowStart: string;
  windowEnd: string;
}) {
  /**
   * The axis label has to follow the bucket.
   *
   * "14:00" is the right label for an hour and meaningless for a month, and a
   * chart of twelve points all reading 00:00 is what a fixed clock format
   * produces once the bucket grows. Formatted in FACTORY time, like every other
   * date on screen — see lib/datetime.
   */
  const labelOf = (iso: string) => {
    const d = toDate(iso);
    if (!d) return '';
    if (bucket === 'month') return formatMonth(d);
    if (bucket === 'week' || bucket === 'day') return formatDayShort(d);
    return formatTime(d);
  };
  const data = trend.map((p) => ({ ...p, t: labelOf(p.at) }));

  /**
   * One row per machine, with its own availability beside the code.
   *
   * The Gantt wants segments with real start and end instants; it works out the
   * geometry, the gaps and the axis itself. Handing it anything less — a
   * pre-computed percentage, say — would be doing its job badly on its behalf.
   */
  const ganttRows: GanttRow[] = React.useMemo(() => {
    const byMachine = new Map<string, { label: string; segments: TimelineSegment[] }>();
    for (const s of timeline) {
      const hit = byMachine.get(s.machineId) ?? { label: s.machineCode, segments: [] };
      hit.segments.push(s);
      byMachine.set(s.machineId, hit);
    }
    return [...byMachine.entries()]
      .map(([id, v]) => {
        const m = machines.find((x) => x.key === id);
        const running = v.segments.filter((x) => x.kind === 'running').reduce((a, x) => a + x.minutes, 0);
        return {
          id,
          label: m?.label ?? v.label,
          sublabel: m?.sublabel ?? undefined,
          meta: `${m?.availability == null ? '—' : `${m.availability}%`} · ${dur(running)}`,
          segments: v.segments.map((x) => ({ state: x.state, startTime: x.from, endTime: x.to })),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [timeline, machines]);

  return (
    <div className="flex flex-col gap-5">
      {/* ── The four readings ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Gauge label="OEE" value={oee} />
        <Gauge label="Availability" value={availability} />
        <Gauge label="Performance" value={performance} />
        <Gauge label="Quality" value={quality} />
      </div>

      {/* ── The same four over time ── */}
      <section className="rounded-lg border border-border/60 bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold">Over time</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Each point is one bucket of the selected period. Click a name in the legend to hide
          that line.
        </p>
        <TrendChart
          data={data}
          series={SERIES.map((s) => ({ ...s, emphasis: s.key === 'oee' }))}
          exportName="oee-overview"
          bucket={bucket ?? 'auto'}
          buckets={onBucketChange ? BUCKETS : undefined}
          onBucketChange={onBucketChange ? (b) => onBucketChange(b === 'auto' ? '' : b) : undefined}
        />
      </section>

      {/* ── Four totals: tiles, not a chart of four bars ── */}
      <section className="rounded-lg border border-border/60 bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Production details</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Operational time" value={dur(operationalMin)} />
          <Stat label="Used operational time" value={dur(usedOperationalMin)} />
          <Stat label="Downtimes" value={String(production.downtimeCount)}
            note={`incl. ${production.microstopCount} microstops`} tone="bad" />
          <Stat label="Total downtime" value={dur(production.downtimeMin)}
            note={`incl. ${dur(production.microstopMin)} microstops`} tone="bad" />
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          A downtime is an <b>episode</b>, not a minute — a two-hour breakdown is one stop.
          Microstops read zero because nothing in this plant measures them yet, which is not the
          same as none happening.
        </p>
      </section>

      {/* ── The chronology ── */}
      {/*
        The shared Gantt, not a strip of divs. It already solves the things a
        hand-rolled one gets wrong: gaps stay gaps instead of being closed by
        neighbouring bands, zoom re-renders against a narrower window rather than
        CSS-scaling the marks into blur, and its palette is validated at
        --pairs all because any two states can end up adjacent on a row. A second
        timeline would have been a second set of those decisions to get wrong.
      */}
      <section className="rounded-lg border border-border/60 bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold">Machine status timeline</h2>
        <p className="mb-4 text-[11px] text-muted-foreground">
          One band per period a machine spent in a state. Gaps mean the machine reported nothing —
          they are left blank rather than filled in, because a guess here would hide a signal outage.
        </p>
        <MachineStateGantt rows={ganttRows} windowStart={windowStart} windowEnd={windowEnd} />
      </section>
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'bad' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`text-xl font-semibold tabular-nums ${tone === 'bad' ? 'text-destructive' : ''}`}>
        {value}
      </span>
      {note && <span className="font-mono text-[10px] text-muted-foreground">{note}</span>}
    </div>
  );
}
