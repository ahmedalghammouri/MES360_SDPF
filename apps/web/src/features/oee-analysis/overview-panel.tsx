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

import { Gauge, SEGMENT_COLOUR, SEGMENT_LABEL, dur, type SegmentKind } from './chart-kit';

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
const SERIES = [
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

export function OverviewPanel({
  oee, availability, performance, quality, trend, production, timeline, operationalMin, usedOperationalMin,
}: {
  oee: number | null; availability: number | null; performance: number | null; quality: number | null;
  trend: TrendPoint[];
  production: ProductionDetails;
  timeline: TimelineSegment[];
  operationalMin: number;
  usedOperationalMin: number;
}) {
  const hhmm = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const data = trend.map((p) => ({ ...p, t: hhmm(p.at) }));

  // One row per machine, so a stopped machine reads as its own band rather than
  // being interleaved with the others into a stripe nobody can attribute.
  const byMachine = React.useMemo(() => {
    const m = new Map<string, TimelineSegment[]>();
    for (const s of timeline) {
      const arr = m.get(s.machineCode) ?? [];
      arr.push(s);
      m.set(s.machineCode, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [timeline]);

  const span = React.useMemo(() => {
    if (timeline.length === 0) return null;
    const from = Math.min(...timeline.map((s) => new Date(s.from).getTime()));
    const to = Math.max(...timeline.map((s) => new Date(s.to).getTime()));
    return to > from ? { from, to, ms: to - from } : null;
  }, [timeline]);

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
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No buckets in this window yet.
          </p>
        ) : (
          <div className="h-[280px] w-full">
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.4} vertical={false} />
                <XAxis dataKey="t" stroke="hsl(var(--border))" tickLine={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} minTickGap={24} />
                <YAxis domain={[0, 100]} stroke="hsl(var(--border))" tickLine={false} width={38}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} unit="%" />
                <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '3 3' }} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                {SERIES.map((s) => (
                  <Line key={s.key} type="monotone" dataKey={s.key} name={s.name}
                    stroke={s.colour} strokeWidth={s.key === 'oee' ? 2.5 : 2}
                    dot={{ r: 4, strokeWidth: 0 }} activeDot={{ r: 5 }}
                    connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
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
      <section className="rounded-lg border border-border/60 bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold">Machine status</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Every state the machines reported, in order. Hover a block for its state and duration.
        </p>
        {!span ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No machine states recorded in this window.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {byMachine.map(([code, segs]) => (
                <div key={code} className="grid grid-cols-[52px_1fr] items-center gap-3">
                  <span className="truncate font-mono text-xs text-muted-foreground">{code}</span>
                  <div className="relative h-6 w-full overflow-hidden rounded-sm bg-muted/40">
                    {segs.map((s, i) => {
                      const left = ((new Date(s.from).getTime() - span.from) / span.ms) * 100;
                      const width = ((new Date(s.to).getTime() - new Date(s.from).getTime()) / span.ms) * 100;
                      return (
                        <div
                          key={`${s.from}-${i}`}
                          className="absolute inset-y-0"
                          // A 1px inset on each side is the 2px surface gap between
                          // adjacent fills; without it a run of short states reads
                          // as one long block.
                          style={{
                            left: `${left}%`,
                            width: `max(2px, calc(${width}% - 2px))`,
                            marginLeft: 1,
                            background: SEGMENT_COLOUR[s.kind],
                          }}
                          title={`${s.state} — ${SEGMENT_LABEL[s.kind]}\n${dur(s.minutes)}\n${new Date(s.from).toLocaleString()} → ${new Date(s.to).toLocaleString()}`}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
              <span>{new Date(span.from).toLocaleString()}</span>
              <span>{new Date(span.to).toLocaleString()}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              {(Object.keys(SEGMENT_LABEL) as Array<TimelineSegment['kind']>).map((k) => (
                <span key={k} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SEGMENT_COLOUR[k] }} />
                  {SEGMENT_LABEL[k]}
                </span>
              ))}
            </div>
          </>
        )}
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
