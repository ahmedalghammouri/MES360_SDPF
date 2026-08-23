'use client';
/**
 * The Quality analysis: the reading, its trend, the good/rejected split, and two
 * views of the rejects — when they happened and what caused them.
 *
 * The reject reasons come from what operators log, not from the counters. The
 * counters know a part was rejected; only a person knows why. So this page has
 * an honest empty state for the case where nobody is logging reasons — which is
 * a configuration state, not a plant with no defects.
 */
import React from 'react';
import {
  ResponsiveContainer, ComposedChart, BarChart, LineChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import { Info } from 'lucide-react';

import { Gauge, pctText, STATUS, TrendChart } from './chart-kit';

export interface QualityTrendPoint {
  at: string;
  quality: number | null;
  counts: { good: number; rejected: number; total: number; theoretical: number };
}
export interface RejectReason {
  reason: string; category: string;
  pieces: number; occurrence: number; sharePct: number; cumulativePct: number;
}
export interface RejectReasons {
  configured: boolean;
  totalPieces: number;
  occurrence: number;
  reasons: RejectReason[];
}

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const num = (n: number) => Math.round(n).toLocaleString();

/**
 * The Pareto bars, in RANK order.
 *
 * A ranked chart is the one place a fixed hue-per-entity would be wrong: rank 1
 * is a position, not an identity, and the reasons change between windows. So the
 * bars carry a single hue and the ranked list beside them carries the names —
 * identity lives in the label, which is where it can be read.
 */
const PARETO_BAR = 'var(--viz-2)';
const PARETO_LINE = 'var(--viz-1)';

export function QualityPanel({
  quality, trend, counts, rejectReasons,
}: {
  quality: number | null;
  trend: QualityTrendPoint[];
  counts: { good: number; rejected: number; total: number; theoretical: number };
  rejectReasons: RejectReasons;
}) {
  const [tab, setTab] = React.useState<'overTime' | 'reasons'>('overTime');

  const rejects = trend.map((p) => ({ t: hhmm(p.at), at: p.at, rejected: p.counts?.rejected ?? 0 }));
  const values = rejects.map((r) => r.rejected);
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

  // When the rejects peaked, named rather than left for the reader to find by
  // eye. A bar chart shows the shape; the shift supervisor needs the timestamp.
  const worst = rejects.reduce<{ at: string; rejected: number } | null>(
    (best, r) => (best == null || r.rejected > best.rejected ? r : best), null,
  );

  const rejectRate = counts.total > 0 ? (counts.rejected / counts.total) * 100 : null;
  const goodShare = counts.total > 0 ? (counts.good / counts.total) * 100 : 0;

  const pareto = rejectReasons.reasons.map((r, i) => ({ ...r, rank: i + 1 }));

  return (
    <div className="flex flex-col gap-5">
      {/* ── The reading, and the same reading over time ── */}
      <div className="grid gap-3 lg:grid-cols-[200px_1fr]">
        <Gauge label="Quality" value={quality} />
        <section className="rounded-lg border border-border/60 bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Quality over time</h2>
          {trend.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No buckets in this window yet.</p>
          ) : (
            <TrendChart
              data={trend.map((p) => ({ t: hhmm(p.at), quality: p.quality }))}
              height={220}
              series={[{ key: 'quality', name: 'Quality', colour: 'var(--viz-3)', emphasis: true }]}
            />
          )}
        </section>
      </div>

      {/* ── The split ── */}
      <section className="rounded-lg border border-border/60 bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Total production</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Produced" value={`${num(counts.total)} pcs`} />
          <Stat label="Good" value={`${num(counts.good)} pcs`} tone="good" />
          <Stat label="Rejected" value={`${num(counts.rejected)} pcs`} tone="bad" />
          <Stat label="Reject rate" value={rejectRate == null ? '—' : `${rejectRate.toFixed(2)}%`} tone="bad" />
          <Stat label="Highest rejects at"
            value={worst && worst.rejected > 0 ? new Date(worst.at).toLocaleString() : '—'}
            note={worst && worst.rejected > 0 ? `${num(worst.rejected)} pcs in that bucket` : undefined} />
        </div>
        {/* The bar is the same ratio as the numbers above it — for the glance,
            not instead of them. */}
        <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full" style={{ width: `${goodShare}%`, background: STATUS.good }} />
          <div className="h-full flex-1" style={{ background: STATUS.bad }} />
        </div>
      </section>

      {/* ── When, and why ── */}
      <section className="rounded-lg border border-border/60 bg-card">
        <div className="flex gap-1 border-b border-border/60 px-3 pt-3">
          {([['overTime', 'Rejects over time'], ['reasons', 'Top reject reasons']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded-t-md px-3 py-1.5 text-xs transition-colors ${
                tab === k ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'overTime' ? (
          <div className="p-4">
            {rejects.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No buckets in this window yet.</p>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-4">
                  <Mini label="Avg" value={`${num(avg)} pcs`} />
                  <Mini label="Min" value={`${num(Math.min(...values))} pcs`} />
                  <Mini label="Max" value={`${num(Math.max(...values))} pcs`} />
                </div>
                <div className="h-[260px] w-full">
                  <ResponsiveContainer>
                    <BarChart data={rejects} margin={{ top: 6, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.4} vertical={false} />
                      <XAxis dataKey="t" stroke="hsl(var(--border))" tickLine={false} minTickGap={20}
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                      <YAxis stroke="hsl(var(--border))" tickLine={false} width={50}
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                      <Tooltip cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.35 }}
                        content={({ active, payload, label }: any) => active && payload?.length ? (
                          <div className="rounded-md border border-border bg-popover p-2 text-xs shadow-md">
                            <div className="mb-0.5 font-medium">{label}</div>
                            <div className="font-mono tabular-nums">{num(payload[0].value)} pcs rejected</div>
                          </div>
                        ) : null} />
                      {/* One series, so no legend — the heading names it. */}
                      <Bar dataKey="rejected" name="Rejected" fill={STATUS.bad}
                        radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="p-4">
            {!rejectReasons.configured ? (
              /*
                An empty chart here would read as "no defects", which is the
                opposite of the truth. The counters know a part was rejected;
                only a person knows why, and nobody has said.
              */
              <div className="flex items-start gap-3 rounded-lg border border-amber-600/30 bg-amber-500/5 p-4 text-sm">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="flex flex-col gap-1">
                  <span className="font-medium">No reject reasons are being recorded</span>
                  <span className="text-muted-foreground">
                    The counters know <b>{num(counts.rejected)} pieces</b> were rejected in this
                    window; nothing says why. Reasons are logged per job order under{' '}
                    <b>Production → Scrap</b>, and until somebody records them this ranking has
                    nothing to rank. An empty chart here would read as &ldquo;no defects&rdquo;,
                    which is the opposite of what the counters say.
                  </span>
                </div>
              </div>
            ) : (
              <>
                <p className="mb-3 text-xs text-muted-foreground">
                  Ranked by pieces, not by how many times a reason was written down — one scrapped
                  pallet outweighs a hundred scrapped inners on this line. The line is the running
                  share of the total, so where it flattens is where the rest stops mattering.
                </p>
                <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
                  <div className="h-[280px]">
                    <ResponsiveContainer>
                      <ComposedChart data={pareto} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.4} vertical={false} />
                        <XAxis dataKey="rank" stroke="hsl(var(--border))" tickLine={false}
                          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                        <YAxis yAxisId="pieces" stroke="hsl(var(--border))" tickLine={false} width={54}
                          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                        {/*
                          The one legitimate second axis: a Pareto's cumulative
                          line is a PERCENTAGE of the bars beneath it, fixed 0–100
                          and derived from the same numbers. It is not a second
                          measure competing for the same space.
                        */}
                        <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} unit="%" width={44}
                          stroke="hsl(var(--border))" tickLine={false}
                          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                        <Tooltip cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.35 }}
                          content={({ active, payload }: any) => active && payload?.length ? (
                            <div className="rounded-md border border-border bg-popover p-2 text-xs shadow-md">
                              <div className="mb-1 font-medium">{payload[0].payload.reason}</div>
                              <div className="text-muted-foreground">{payload[0].payload.category}</div>
                              <div className="mt-1 font-mono tabular-nums">
                                {num(payload[0].payload.pieces)} pcs · {payload[0].payload.sharePct.toFixed(1)}%
                              </div>
                              <div className="font-mono tabular-nums text-muted-foreground">
                                cumulative {payload[0].payload.cumulativePct.toFixed(1)}%
                              </div>
                            </div>
                          ) : null} />
                        <Bar yAxisId="pieces" dataKey="pieces" fill={PARETO_BAR}
                          radius={[3, 3, 0, 0]} isAnimationActive={false}>
                          {pareto.map((r) => <Cell key={r.reason} fill={PARETO_BAR} />)}
                        </Bar>
                        <Line yAxisId="pct" type="monotone" dataKey="cumulativePct" stroke={PARETO_LINE}
                          strokeWidth={2} dot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  {/* The ranked list is where identity lives — the bars are all one
                      hue because rank is a position, not an entity. */}
                  <div className="flex flex-col gap-2">
                    {pareto.map((r) => (
                      <div key={`${r.category}:${r.reason}`}
                        className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs">
                        <span className="w-4 shrink-0 font-mono tabular-nums text-muted-foreground">{r.rank}.</span>
                        <span className="flex flex-col overflow-hidden">
                          <span className="truncate font-medium">{r.reason}</span>
                          <span className="truncate text-[10px] text-muted-foreground">{r.category}</span>
                        </span>
                        <span className="ml-auto shrink-0 text-end font-mono tabular-nums">
                          <span className="block">{num(r.pieces)} pcs</span>
                          <span className="block text-[10px] text-muted-foreground">×{r.occurrence}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums"
        style={tone ? { color: tone === 'good' ? STATUS.good : STATUS.bad } : undefined}>
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
      <span className="font-mono text-lg tabular-nums">{value}</span>
    </div>
  );
}
