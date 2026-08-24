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

import { dur, stateColour, SEGMENT_COLOUR, type SegmentKind } from './chart-kit';
import { MachineStateGantt, type GanttRow } from '@/components/charts/machine-state-gantt';

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

// 'en-US' pinned, not the runtime default: `.toLocaleString()` with no
// locale follows Node's ICU default on the server and the visitor's OWN
// BROWSER LANGUAGE on the client — an Arabic-language browser renders
// different digit grouping than the server, which is a hydration text
// mismatch (React error #418) on every number this formats.
const num = (n: number) => Math.round(n).toLocaleString('en-US');

export function DowntimePanel({
  distribution, timeline, machines, windowStart, windowEnd,
}: {
  distribution: Distribution;
  timeline: TimelineSegment[];
  machines: Array<{ key: string; label: string; sublabel?: string | null; availability: number | null }>;
  windowStart: string;
  windowEnd: string;
}) {
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

  /**
   * The same rows the Overview draws, from the same component.
   *
   * The reference colours this band by the top downtime reasons so a bar and a
   * block match. That link is worth having, but not at the price of a second,
   * weaker timeline — this one keeps gaps honest, re-renders on zoom instead of
   * scaling, and ships a validated palette with texture for CVD and print. The
   * ranking above carries NUMBERS as well as colour, so a reader can still match
   * a bar to a stop without either chart agreeing on hue.
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
        const down = v.segments.filter((x) => x.kind === 'downtime');
        const lost = down.reduce((a, x) => a + x.minutes, 0);
        return {
          id,
          label: m?.label ?? v.label,
          sublabel: m?.sublabel ?? undefined,
          meta: `${down.length} stops · ${dur(lost)}`,
          segments: v.segments.map((x) => ({ state: x.state, startTime: x.from, endTime: x.to })),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [timeline, machines]);

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

      {/* ── When they happened ── */}
      <section className="rounded-lg border border-border/60 bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold">Downtime timeline</h2>
        <p className="mb-4 text-[11px] text-muted-foreground">
          The same bands as Overview, with each machine&rsquo;s stop count beside it. Red is the
          machine&rsquo;s own loss, amber is the line waiting on something else — the exact state is
          one hover away, and the ranking above is numbered so a bar can be matched to a stop
          without relying on colour.
        </p>
        <MachineStateGantt rows={ganttRows} windowStart={windowStart} windowEnd={windowEnd} />
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
