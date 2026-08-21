'use client';
/**
 * The three charts every breakdown tab draws, written once.
 *
 * Machines, job orders and shifts are the same SHAPE of question asked of three
 * different groupings — who scored what, where their time went, and what came
 * out. Three copies of that would drift the moment one was corrected, which is
 * the reason the engines share a minute classifier and the analyses share a
 * chart kit. These take rows and know nothing about which grouping produced
 * them.
 *
 * ── On colour ───────────────────────────────────────────────────────────────
 * None of these charts colours by IDENTITY, so none of them needs a categorical
 * ramp and none can run out of hues when a twentieth job order appears:
 *
 *   Ranked OEE      → status. The bar's colour is the band the reading falls in,
 *                     and the number is printed on every bar, so the colour is
 *                     the second encoding and never the only one.
 *   Time composition→ the segment palette the whole OEE family already uses, so
 *                     "starved" is the same amber here as on the timeline.
 *   Output          → good/bad status, again with a legend and printed values.
 *
 * Status colours are reserved for state everywhere in this project; they are not
 * reused here as "series 1 and 2" — good and rejected genuinely ARE good and bad.
 */
import React from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, Cell, ReferenceLine, LabelList,
} from 'recharts';

import { STATUS, BANDS, SEGMENT_COLOUR, SEGMENT_LABEL, bandOf, dur, pctText } from '@/features/oee-analysis/chart-kit';
import type { SegmentKind } from '@/features/oee-analysis/chart-kit';

export interface Slice {
  key: string;
  label: string;
  sublabel?: string | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  teep: number | null;
  slotElapsedPct?: number | null;
  time: Record<string, number>;
  counts: { good: number; rejected: number; total: number; theoretical: number };
}

const num = (n: number | null | undefined) =>
  n == null ? '—' : Math.round(n).toLocaleString();

/**
 * How many bars before a chart stops being readable.
 *
 * A job-order breakdown can run to dozens of rows. Beyond this the bars are
 * thinner than their own labels, so the chart shows the worst performers and
 * says how many it left out — the table below carries the rest, paginated.
 * Silently truncating would be the same chart telling a different story than
 * the table under it.
 */
const MAX_BARS = 12;

function topBy<T extends Slice>(rows: T[], pick: (r: T) => number | null): { shown: T[]; hidden: number } {
  const usable = rows.filter((r) => pick(r) != null);
  const sorted = [...usable].sort((a, b) => (pick(a) ?? 0) - (pick(b) ?? 0)); // worst first
  return { shown: sorted.slice(0, MAX_BARS), hidden: Math.max(0, sorted.length - MAX_BARS) };
}

/** A frame with a title, a one-line reason it exists, and a note when rows were dropped. */
function Figure({
  title, blurb, hidden, height, children,
}: {
  title: string; blurb: string; hidden?: number; height: number; children: React.ReactElement;
}) {
  return (
    <figure className="m-0 rounded-lg border border-border/60 bg-card p-3">
      <figcaption className="mb-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-[11px] text-muted-foreground">
          {blurb}
          {hidden ? ` Showing the ${MAX_BARS} lowest; ${hidden} more are in the table below.` : ''}
        </p>
      </figcaption>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </figure>
  );
}

const AXIS = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };
const GRID = 'hsl(var(--border))';

/** Chart height that grows with the rows, so bars stay a readable thickness. */
const rowsHeight = (n: number, min = 140) => Math.max(min, n * 30 + 46);

// ── 1. Who scored what ──────────────────────────────────────────────────────

export function RankedOee({ rows }: { rows: Slice[] }) {
  const { shown, hidden } = topBy(rows, (r) => r.oee);
  const data = shown.map((r) => ({
    name: r.label, sub: r.sublabel ?? '',
    oee: r.oee ?? 0,
    availability: r.availability, performance: r.performance, quality: r.quality,
  }));
  if (data.length === 0) return null;

  return (
    <Figure
      title="OEE, worst first"
      blurb={`The colour is the band the reading falls in — under ${BANDS.OEE.warn}% red, under ${BANDS.OEE.good}% amber. The dashed line is the target.`}
      hidden={hidden}
      height={rowsHeight(data.length)}
    >
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 52, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tick={AXIS} stroke={GRID} unit="%" />
        <YAxis type="category" dataKey="name" tick={AXIS} stroke={GRID} width={132} interval={0} />
        <Tooltip content={<FactorTip />} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
        <ReferenceLine x={BANDS.OEE.good} stroke={STATUS.good} strokeDasharray="4 3"
          label={{ value: `target ${BANDS.OEE.good}%`, position: 'top', fontSize: 10, fill: STATUS.good }} />
        <Bar dataKey="oee" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
          {data.map((d) => <Cell key={d.name} fill={STATUS[bandOf('OEE', d.oee)]} />)}
          {/* Direct-labelled, so the value never depends on reading the axis. */}
          <LabelList dataKey="oee" position="right" formatter={(v: number) => `${v.toFixed(1)}%`}
            style={{ fontSize: 11, fill: 'hsl(var(--foreground))' }} />
        </Bar>
      </BarChart>
    </Figure>
  );
}

function FactorTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 shadow-md">
      <p className="text-[11px] font-medium text-foreground">{d.name}</p>
      {d.sub && <p className="mb-1 text-[10px] text-muted-foreground">{d.sub}</p>}
      <dl className="grid grid-cols-[auto_auto] gap-x-3 text-[11px]">
        {([['OEE', d.oee], ['Availability', d.availability], ['Performance', d.performance], ['Quality', d.quality]] as const)
          .map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-end font-medium tabular-nums text-foreground">{pctText(v as number | null)}</dd>
            </React.Fragment>
          ))}
      </dl>
    </div>
  );
}

// ── 2. Where the time went ──────────────────────────────────────────────────

/**
 * The segments, in the order the time model spends them.
 *
 * Stacked left to right in that same order so the bar reads as the model does:
 * running first, then the three kinds of stop, then the silence. A reader
 * comparing two rows is comparing the same thing at the same offset.
 */
const SEGMENTS: Array<{ key: string; kind: SegmentKind }> = [
  { key: 'netProductionMin', kind: 'running' },
  { key: 'availabilityLossMin', kind: 'downtime' },
  { key: 'externalLossMin', kind: 'external' },
  { key: 'plannedStopMin', kind: 'planned' },
  { key: 'unmeasuredMin', kind: 'unmeasured' },
];

export function TimeComposition({ rows }: { rows: Slice[] }) {
  // Ranked by how much of the time was NOT production — the chart's own subject.
  const { shown, hidden } = topBy(rows, (r) => -(r.time?.netProductionMin ?? 0));
  const data = shown.map((r) => {
    const out: Record<string, string | number> = { name: r.label, sub: r.sublabel ?? '' };
    for (const s of SEGMENTS) out[s.key] = Math.max(0, r.time?.[s.key] ?? 0);
    return out;
  });
  if (data.length === 0) return null;

  return (
    <Figure
      title="Where the time went"
      blurb="Minutes, stacked in the order the time model spends them. Same colours as the machine-status timeline."
      hidden={hidden}
      height={rowsHeight(data.length)}
    >
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={AXIS} stroke={GRID}
          tickFormatter={(v: number) => (v >= 60 ? `${Math.round(v / 60)}h` : `${v}m`)} />
        <YAxis type="category" dataKey="name" tick={AXIS} stroke={GRID} width={132} interval={0} />
        <Tooltip content={<MinutesTip />} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {SEGMENTS.map((s, i) => (
          <Bar
            key={s.key} dataKey={s.key} stackId="t" name={SEGMENT_LABEL[s.kind]}
            fill={SEGMENT_COLOUR[s.kind]} maxBarSize={18} isAnimationActive={false}
            // A 2px gap between segments, and the outer ends rounded — so the
            // stack reads as parts rather than one striped bar.
            radius={i === 0 ? [4, 0, 0, 4] : i === SEGMENTS.length - 1 ? [0, 4, 4, 0] : 0}
            stroke="hsl(var(--card))" strokeWidth={2}
          />
        ))}
      </BarChart>
    </Figure>
  );
}

function MinutesTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((a: number, e: any) => a + (e.value ?? 0), 0);
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 shadow-md">
      <p className="mb-1 text-[11px] font-medium text-foreground">{payload[0].payload.name}</p>
      {payload.filter((e: any) => e.value > 0).map((e: any) => (
        <p key={e.dataKey} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-2 w-2 rounded-sm" style={{ background: e.color }} aria-hidden />
          <span className="flex-1">{e.name}</span>
          <span className="font-medium tabular-nums text-foreground">{dur(e.value)}</span>
        </p>
      ))}
      <p className="mt-1 border-t border-border/60 pt-1 text-[11px] font-medium tabular-nums text-foreground">
        {dur(total)} total
      </p>
    </div>
  );
}

// ── 3. What came out ────────────────────────────────────────────────────────

export function OutputBars({ rows }: { rows: Slice[] }) {
  const { shown, hidden } = topBy(rows, (r) => -(r.counts?.total ?? 0));
  const data = shown
    .map((r) => ({
      name: r.label, sub: r.sublabel ?? '',
      good: Math.max(0, r.counts?.good ?? 0),
      rejected: Math.max(0, r.counts?.rejected ?? 0),
      theoretical: Math.max(0, r.counts?.theoretical ?? 0),
    }))
    .filter((d) => d.good + d.rejected + d.theoretical > 0);
  if (data.length === 0) return null;

  return (
    <Figure
      title="What came out"
      blurb="Pieces, so the stations are comparable — a pallet is 160 of them. The dashed bar above each pair is what the design speed allowed in the same time; the gap to it is the performance loss."
      hidden={hidden}
      height={rowsHeight(data.length)}
    >
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={AXIS} stroke={GRID} tickFormatter={(v: number) => num(v)} />
        <YAxis type="category" dataKey="name" tick={AXIS} stroke={GRID} width={132} interval={0} />
        <Tooltip content={<CountTip />} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {/* Theoretical is a PAIRED bar above the actual, not a third series
            competing for attention: unfilled, dashed and thicker, so it reads as
            the envelope the actual is being measured against. Recharts groups
            bars rather than overlaying them, so "behind" is not available — and
            a pair is honest about being two measurements anyway. */}
        <Bar dataKey="theoretical" name="Theoretical" fill="transparent" stroke={STATUS.none}
          strokeDasharray="3 2" maxBarSize={22} isAnimationActive={false} />
        <Bar dataKey="good" name="Good" stackId="a" fill={STATUS.good} maxBarSize={14}
          radius={[4, 0, 0, 4]} isAnimationActive={false} stroke="hsl(var(--card))" strokeWidth={2} />
        <Bar dataKey="rejected" name="Rejected" stackId="a" fill={STATUS.bad} maxBarSize={14}
          radius={[0, 4, 4, 0]} isAnimationActive={false} stroke="hsl(var(--card))" strokeWidth={2} />
      </BarChart>
    </Figure>
  );
}

function CountTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const total = d.good + d.rejected;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 shadow-md">
      <p className="mb-1 text-[11px] font-medium text-foreground">{d.name}</p>
      <dl className="grid grid-cols-[auto_auto] gap-x-3 text-[11px]">
        <dt className="text-muted-foreground">Good</dt>
        <dd className="text-end font-medium tabular-nums" style={{ color: STATUS.good }}>{num(d.good)}</dd>
        <dt className="text-muted-foreground">Rejected</dt>
        <dd className="text-end font-medium tabular-nums" style={{ color: d.rejected > 0 ? STATUS.bad : undefined }}>
          {num(d.rejected)}
        </dd>
        <dt className="text-muted-foreground">Theoretical</dt>
        <dd className="text-end font-medium tabular-nums text-foreground">{num(d.theoretical)}</dd>
        <dt className="text-muted-foreground">Quality</dt>
        <dd className="text-end font-medium tabular-nums text-foreground">
          {total > 0 ? `${((d.good / total) * 100).toFixed(1)}%` : '—'}
        </dd>
      </dl>
    </div>
  );
}
