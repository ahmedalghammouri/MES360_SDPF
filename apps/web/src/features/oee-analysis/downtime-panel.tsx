'use client';
/**
 * The Downtime analysis: which stops cost the most, when they happened, and what
 * sits underneath them.
 *
 * ── Why the colours matter more here than anywhere else ─────────────────────
 * The Pareto bar and the blocks in the timeline beneath it are the SAME reason,
 * and the colour is what says so. That makes the hue an identity, not a
 * decoration — so it is fixed per state in chart-kit and never assigned by rank.
 * If it moved with the ranking, changing the filter would repaint both charts
 * and the link between them would quietly start pointing somewhere else.
 *
 * Duration or occurrence is a real question rather than a display preference:
 * one four-hour breakdown and forty two-minute stops are different problems with
 * different fixes, and a page that only ranks by one of them hides the other.
 */
import React from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, PieChart, Pie, Cell,
} from 'recharts';
import { ChevronLeft, ChevronRight, Info } from 'lucide-react';

import { dur, stateColour, SEGMENT_COLOUR, SEGMENT_LABEL, type SegmentKind } from './chart-kit';

export interface TimelineSegment {
  machineId: string; machineCode: string; state: string;
  kind: SegmentKind; from: string; to: string; minutes: number;
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

type RankBy = 'duration' | 'occurrence';

const num = (n: number) => Math.round(n).toLocaleString();

export function DowntimePanel({
  distribution, timeline,
}: { distribution: Distribution; timeline: TimelineSegment[] }) {
  const [rankBy, setRankBy] = React.useState<RankBy>('duration');
  const [drill, setDrill] = React.useState<string | null>(null);

  // Only stops charged to the machine. A break is not a downtime reason, and
  // ranking it alongside breakdowns puts the canteen at the top of a Pareto
  // meant to send somebody to a machine.
  const downtime = distribution.reasons.find((r) => r.kind === 'downtime');
  const leaves = React.useMemo(() => {
    const rows = [...(downtime?.children ?? [])];
    rows.sort((a, b) => (rankBy === 'duration' ? b.minutes - a.minutes : b.occurrence - a.occurrence));
    const total = rows.reduce((a, r) => a + (rankBy === 'duration' ? r.minutes : r.occurrence), 0);
    let running = 0;
    return rows.map((r, i) => {
      const v = rankBy === 'duration' ? r.minutes : r.occurrence;
      running += v;
      return {
        ...r, rank: i + 1, value: v,
        sharePct: total > 0 ? (v / total) * 100 : 0,
        cumulativePct: total > 0 ? (running / total) * 100 : 0,
        colour: stateColour(r.label),
      };
    });
  }, [downtime, rankBy]);

  // The drilldown starts at the time model, exactly as the reference does, so
  // the reader can see planned and external time beside the unplanned before
  // going into it.
  const level = drill ? distribution.reasons.find((r) => r.key === drill) : null;
  const drillRows = level?.children ?? distribution.reasons;
  const shown = level
    ? { occurrence: level.occurrence, totalMin: level.minutes, medianMin: level.medianMin, averageMin: level.averageMin }
    : distribution;

  const span = React.useMemo(() => {
    if (timeline.length === 0) return null;
    const from = Math.min(...timeline.map((s) => new Date(s.from).getTime()));
    const to = Math.max(...timeline.map((s) => new Date(s.to).getTime()));
    return to > from ? { from, to, ms: to - from } : null;
  }, [timeline]);

  const byMachine = React.useMemo(() => {
    const m = new Map<string, TimelineSegment[]>();
    for (const s of timeline) {
      const arr = m.get(s.machineCode) ?? [];
      arr.push(s);
      m.set(s.machineCode, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [timeline]);

  if (!downtime || leaves.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-card p-4 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <span className="font-medium">No unplanned downtime in this window</span>
          <span className="text-muted-foreground">
            Nothing was charged to the machines&rsquo; own availability. Planned stops and time the
            line could not feed are on the Availability page, under Distribution.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ── The ranking ── */}
      <section className="rounded-lg border border-border/60 bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">Top downtime reasons by</h2>
          <div className="inline-flex rounded-md border border-border/60 p-0.5">
            {(['duration', 'occurrence'] as const).map((k) => (
              <button key={k} onClick={() => setRankBy(k)}
                className={`rounded px-2 py-0.5 text-[11px] capitalize transition-colors ${
                  rankBy === k ? 'bg-primary/15 font-semibold text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}>
                {k}
              </button>
            ))}
          </div>
          <span className="ml-auto text-xs text-muted-foreground">
            {downtime.occurrence} stops · {dur(downtime.minutes)} lost
          </span>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="h-[280px]">
            <ResponsiveContainer>
              <ComposedChart data={leaves} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.4} vertical={false} />
                <XAxis dataKey="rank" stroke="hsl(var(--border))" tickLine={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                <YAxis yAxisId="v" stroke="hsl(var(--border))" tickLine={false} width={54}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                {/*
                  The cumulative line is a percentage OF the bars beneath it,
                  fixed 0–100 and derived from the same numbers — the one second
                  axis that is not a second measure competing for the space.
                */}
                <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} unit="%" width={44}
                  stroke="hsl(var(--border))" tickLine={false}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                <Tooltip cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.35 }}
                  content={({ active, payload }: any) => active && payload?.length ? (
                    <div className="rounded-md border border-border bg-popover p-2 text-xs shadow-md">
                      <div className="mb-1 font-medium">{payload[0].payload.label}</div>
                      <div className="font-mono tabular-nums">
                        {rankBy === 'duration'
                          ? `${dur(payload[0].payload.minutes)} · ×${payload[0].payload.occurrence}`
                          : `×${payload[0].payload.occurrence} · ${dur(payload[0].payload.minutes)}`}
                      </div>
                      <div className="font-mono tabular-nums text-muted-foreground">
                        {payload[0].payload.sharePct.toFixed(1)}% · cumulative {payload[0].payload.cumulativePct.toFixed(1)}%
                      </div>
                    </div>
                  ) : null} />
                <Bar yAxisId="v" dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {leaves.map((r) => <Cell key={r.key} fill={r.colour} />)}
                </Bar>
                <Line yAxisId="pct" type="monotone" dataKey="cumulativePct"
                  stroke="hsl(var(--muted-foreground))" strokeWidth={2}
                  dot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* The list carries the names. The bars are numbered, so a reader can
              match them without relying on colour at all. */}
          <div className="flex flex-col gap-2">
            {leaves.map((r) => (
              <div key={r.key}
                className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs">
                <span className="w-4 shrink-0 font-mono tabular-nums text-muted-foreground">{r.rank}.</span>
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: r.colour }} />
                <span className="truncate font-medium">{r.label}</span>
                <span className="ml-auto shrink-0 text-end font-mono tabular-nums">
                  <span className="block">{dur(r.minutes)}</span>
                  <span className="block text-[10px] text-muted-foreground">×{r.occurrence}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── When they happened, in the ranking's own colours ── */}
      <section className="rounded-lg border border-border/60 bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold">Downtime timeline</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          The same blocks as the status band on Overview, coloured by reason instead of by
          category — so a colour here and a bar above it are the same stop. Everything that is not
          unplanned downtime is greyed back.
        </p>
        {!span ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No machine states in this window.</p>
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
                      const isDown = s.kind === 'downtime';
                      return (
                        <div key={`${s.from}-${i}`} className="absolute inset-y-0"
                          style={{
                            left: `${left}%`,
                            width: `max(2px, calc(${width}% - 2px))`,
                            marginLeft: 1,
                            background: isDown ? stateColour(s.state) : 'hsl(var(--muted))',
                            opacity: isDown ? 1 : 0.55,
                          }}
                          title={`${s.state} — ${isDown ? 'unplanned downtime' : SEGMENT_LABEL[s.kind]}\n${dur(s.minutes)}\n${new Date(s.from).toLocaleString()} → ${new Date(s.to).toLocaleString()}`} />
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
          </>
        )}
      </section>

      {/* ── The tree ── */}
      <section className="rounded-lg border border-border/60 bg-card p-4">
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
            {level ? `states inside ${level.label}` : 'all categories — drill into one'}
          </span>
          <div className="ml-auto flex flex-wrap gap-5">
            <Mini label="Occurrence" value={String(shown.occurrence)} />
            <Mini label="Total" value={dur(shown.totalMin)} />
            <Mini label="Median" value={dur(shown.medianMin)} />
            <Mini label="Average" value={dur(shown.averageMin)} />
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
          <div className="h-[200px]">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={drillRows} dataKey="minutes" nameKey="label" outerRadius={88}
                  stroke="hsl(var(--card))" strokeWidth={2} isAnimationActive={false}>
                  {drillRows.map((r) => (
                    <Cell key={r.key} fill={level ? stateColour(r.label) : SEGMENT_COLOUR[r.kind]} />
                  ))}
                </Pie>
                <Tooltip content={({ active, payload }: any) => active && payload?.length ? (
                  <div className="rounded-md border border-border bg-popover p-2 text-xs shadow-md">
                    <div className="font-medium">{payload[0].payload.label}</div>
                    <div className="font-mono tabular-nums">{dur(payload[0].value)}</div>
                  </div>
                ) : null} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {drillRows.map((r) => (
              <button key={r.key}
                onClick={() => r.children?.length && setDrill(r.key)}
                disabled={!r.children?.length}
                className={`flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-start text-xs ${
                  r.children?.length ? 'hover:bg-muted' : 'cursor-default'
                }`}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: level ? stateColour(r.label) : SEGMENT_COLOUR[r.kind] }} />
                <span className="truncate font-medium">{r.label}</span>
                <span className="ml-auto shrink-0 font-mono tabular-nums text-muted-foreground">{dur(r.minutes)}</span>
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">×{r.occurrence}</span>
                {!!r.children?.length && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">
          The tree stops at the machine state. Going deeper — a cause per stop, not per state —
          needs a reason recorded against each downtime event; until that happens this is the last
          level there is, and saying so beats inventing a leaf.
        </p>
      </section>
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
