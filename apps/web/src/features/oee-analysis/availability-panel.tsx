'use client';
/**
 * The Availability analysis: one reading, its trend, the reliability pair, and
 * where the time actually went.
 *
 * The two tabs at the bottom answer different questions about the same minutes.
 * Distribution asks WHAT the time was spent on; Trend asks WHEN. Putting them on
 * one screen would give each half the room and neither the emphasis, which is
 * why the reference tabs them too.
 */
import React from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, PieChart, Pie, Cell,
} from 'recharts';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Gauge, STATUS, SEGMENT_COLOUR, SEGMENT_LABEL, dur, type SegmentKind } from './chart-kit';

export interface AvailabilityTrendPoint {
  at: string;
  availability: number | null;
  time: Record<string, number>;
}
export interface ReasonSlice {
  key: string; label: string; kind: SegmentKind;
  minutes: number; occurrence: number; medianMin: number; averageMin: number;
  children?: ReasonSlice[];
}
export interface Distribution {
  occurrence: number; totalMin: number; medianMin: number; averageMin: number;
  reasons: ReasonSlice[];
}

/** The stack, bottom to top. Fixed order so a bar never re-sorts between buckets. */
const STACK: Array<{ key: string; kind: SegmentKind }> = [
  { key: 'netProductionMin', kind: 'running' },
  { key: 'availabilityLossMin', kind: 'downtime' },
  { key: 'externalLossMin', kind: 'external' },
  { key: 'plannedStopMin', kind: 'planned' },
  { key: 'unmeasuredMin', kind: 'unmeasured' },
];

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function AvailabilityPanel({
  availability, trend, netProductionMin, availabilityLossMin, production, distribution,
}: {
  availability: number | null;
  trend: AvailabilityTrendPoint[];
  netProductionMin: number;
  availabilityLossMin: number;
  production: { mttrMin: number | null; mtbfMin: number | null; downtimeCount: number; microstopCount: number };
  distribution: Distribution;
}) {
  const [tab, setTab] = React.useState<'distribution' | 'trend'>('distribution');
  // Which level of the reason tree is open. Null is the top — the time model.
  const [drill, setDrill] = React.useState<string | null>(null);

  const level = drill ? distribution.reasons.find((r) => r.key === drill) : null;
  const rows = level?.children ?? distribution.reasons;
  const shown = level
    ? { occurrence: level.occurrence, totalMin: level.minutes, medianMin: level.medianMin, averageMin: level.averageMin }
    : distribution;

  const data = trend.map((p) => ({
    t: hhmm(p.at),
    availability: p.availability,
    ...Object.fromEntries(STACK.map((s) => [s.key, p.time?.[s.key] ?? 0])),
  }));

  return (
    <div className="flex flex-col gap-5">
      {/* ── The reading, and the same reading over time ── */}
      <div className="grid gap-3 lg:grid-cols-[200px_1fr]">
        <Gauge label="Availability" value={availability} />
        <section className="rounded-lg border border-border/60 bg-card p-4">
          {/* One series, so no legend box — the heading names it. */}
          <h2 className="mb-3 text-sm font-semibold">Availability over time</h2>
          {data.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No buckets in this window yet.</p>
          ) : (
            <div className="h-[180px] w-full">
              <ResponsiveContainer>
                <LineChart data={data} margin={{ top: 6, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.4} vertical={false} />
                  <XAxis dataKey="t" stroke="hsl(var(--border))" tickLine={false} minTickGap={24}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                  <YAxis domain={[0, 100]} stroke="hsl(var(--border))" tickLine={false} width={38} unit="%"
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                  <Tooltip
                    cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '3 3' }}
                    content={({ active, payload, label }: any) =>
                      active && payload?.length ? (
                        <div className="rounded-md border border-border bg-popover p-2 text-xs shadow-md">
                          <div className="mb-0.5 font-medium">{label}</div>
                          <div className="font-mono tabular-nums">
                            {payload[0].value == null ? '—' : `${Number(payload[0].value).toFixed(1)}%`}
                          </div>
                        </div>
                      ) : null}
                  />
                  <Line type="monotone" dataKey="availability" stroke="var(--viz-1)" strokeWidth={2}
                    dot={{ r: 4, strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      {/* ── The reliability pair ── */}
      <section className="rounded-lg border border-border/60 bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Availability KPIs</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Net production time" value={dur(netProductionMin)} />
          <Stat label="Availability loss" value={dur(availabilityLossMin)} tone="bad" />
          <Stat label="MTTR" value={production.mttrMin == null ? '—' : dur(production.mttrMin)}
            note={`${production.downtimeCount} failures`} />
          <Stat label="MTBF" value={production.mtbfMin == null ? '—' : dur(production.mtbfMin)}
            note="running time ÷ failures" />
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Only <b>unplanned</b> stops count as failures. A break is not a breakdown, and counting one
          would shorten MTTR and lengthen MTBF at the same time — both figures improving because the
          plant took a scheduled lunch. Microstops are excluded from this pair as well, and there are{' '}
          {production.microstopCount} of them because nothing measures them yet.
        </p>
      </section>

      {/* ── What the time was spent on, and when ── */}
      <section className="rounded-lg border border-border/60 bg-card">
        <div className="flex gap-1 border-b border-border/60 px-3 pt-3">
          {(['distribution', 'trend'] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded-t-md px-3 py-1.5 text-xs capitalize transition-colors ${
                tab === k ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}>
              {k}
            </button>
          ))}
        </div>

        {tab === 'distribution' ? (
          <div className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              {level ? (
                <button onClick={() => setDrill(null)}
                  className="flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-xs hover:bg-muted">
                  <ChevronLeft className="h-3 w-3" /> Time model
                </button>
              ) : (
                <span className="rounded border border-border/60 px-2 py-1 text-xs font-medium">Time model</span>
              )}
              <span className="text-xs text-muted-foreground">
                {level ? `states inside ${level.label}` : 'status reasons by duration'}
              </span>
              <div className="ml-auto flex flex-wrap gap-5">
                <Mini label="Occurrence" value={String(shown.occurrence)} />
                <Mini label="Total" value={dur(shown.totalMin)} />
                <Mini label="Median" value={dur(shown.medianMin)} />
                <Mini label="Average" value={dur(shown.averageMin)} />
              </div>
            </div>

            {rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nothing recorded in this window.</p>
            ) : (
              <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
                <div className="h-[200px]">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={rows} dataKey="minutes" nameKey="label" innerRadius={0} outerRadius={88}
                        stroke="hsl(var(--card))" strokeWidth={2} isAnimationActive={false}>
                        {rows.map((r) => <Cell key={r.key} fill={SEGMENT_COLOUR[r.kind]} />)}
                      </Pie>
                      <Tooltip content={({ active, payload }: any) =>
                        active && payload?.length ? (
                          <div className="rounded-md border border-border bg-popover p-2 text-xs shadow-md">
                            <div className="font-medium">{payload[0].payload.label}</div>
                            <div className="font-mono tabular-nums">{dur(payload[0].value)}</div>
                          </div>
                        ) : null} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* The list IS the legend — every slice named, timed and counted. */}
                <div className="grid gap-2 sm:grid-cols-2">
                  {rows.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => r.children?.length && setDrill(r.key)}
                      disabled={!r.children?.length}
                      className={`flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-start text-xs ${
                        r.children?.length ? 'hover:bg-muted' : 'cursor-default'
                      }`}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SEGMENT_COLOUR[r.kind] }} />
                      <span className="truncate font-medium">{r.label}</span>
                      <span className="ml-auto shrink-0 font-mono tabular-nums text-muted-foreground">
                        {dur(r.minutes)}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-muted-foreground">×{r.occurrence}</span>
                      {!!r.children?.length && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-3 text-[11px] text-muted-foreground">
              Median as well as average, because stopped time is not evenly spread: one long
              breakdown among many short stops drags the average to a length no single stop ever
              was. Where they disagree, the median is the typical stop.
            </p>
          </div>
        ) : (
          <div className="p-4">
            <h3 className="mb-1 text-sm font-semibold">Utilization distribution</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              The same minutes as the status band on Overview, one stacked bar per bucket — how each
              slice of the period was spent.
            </p>
            {data.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No buckets in this window yet.</p>
            ) : (
              <>
                <div className="h-[260px] w-full">
                  <ResponsiveContainer>
                    <BarChart data={data} margin={{ top: 6, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.4} vertical={false} />
                      <XAxis dataKey="t" stroke="hsl(var(--border))" tickLine={false} minTickGap={20}
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                      <YAxis stroke="hsl(var(--border))" tickLine={false} width={44} unit="m"
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                      <Tooltip
                        cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.35 }}
                        content={({ active, payload, label }: any) =>
                          active && payload?.length ? (
                            <div className="rounded-md border border-border bg-popover p-2 text-xs shadow-md">
                              <div className="mb-1 font-medium">{label}</div>
                              {payload.filter((p: any) => p.value > 0).map((p: any) => (
                                <div key={p.dataKey} className="flex items-center gap-2">
                                  <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
                                  <span className="text-muted-foreground">{p.name}</span>
                                  <span className="ml-auto font-mono tabular-nums">{dur(p.value)}</span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                      />
                      {STACK.map((s, i) => (
                        <Bar key={s.key} dataKey={s.key} name={SEGMENT_LABEL[s.kind]} stackId="a"
                          fill={SEGMENT_COLOUR[s.kind]} isAnimationActive={false}
                          // 2px of surface between segments, and only the top one
                          // is rounded — a rounded cap mid-stack reads as a gap in
                          // the data rather than as a spacer.
                          stroke="hsl(var(--card))" strokeWidth={1}
                          radius={i === STACK.length - 1 ? [3, 3, 0, 0] : undefined} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex flex-wrap gap-3">
                  {STACK.map((s) => (
                    <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SEGMENT_COLOUR[s.kind] }} />
                      {SEGMENT_LABEL[s.kind]}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'bad' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`text-xl font-semibold tabular-nums ${tone === 'bad' ? 'text-destructive' : ''}`}
        style={tone ? undefined : { color: STATUS.none === '' ? undefined : undefined }}>
        {value}
      </span>
      {note && <span className="font-mono text-[10px] text-muted-foreground">{note}</span>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-mono text-sm tabular-nums">{value}</span>
    </div>
  );
}
