'use client';
/**
 * The standard OEE engine, on its own screen.
 *
 * Deliberately standalone: its own date control, its own queries, no shared
 * scope store. The point of a second engine is to be checkable against the
 * first, and a screen that inherited the same filters and the same helpers
 * would share the assumptions it exists to test.
 *
 * The layout follows the reference's own chart — the time model as a descending
 * waterfall, each level the one above it minus a loss — because that is the
 * artefact a plant engineer already knows how to read.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';

import { api } from '@/services/api.client';

// ── Shapes, mirroring oee-standard.calc.ts ──────────────────────────────────
interface Bar { key: string; minutes: number; pct: number; kind: 'base' | 'loss' | 'result' }
interface Factors {
  availability: number | null; performance: number | null; quality: number | null;
  oee: number | null; teep: number | null; utilization: number | null;
}
interface Slice extends Factors {
  key: string; label: string; sublabel?: string | null;
  time: Record<string, number>;
  counts: { good: number; rejected: number; total: number; theoretical: number };
  bars: Bar[];
}
interface Payload extends Slice {
  window: { from: string; to: string };
  audit: { ok: boolean; bucketsMin: number; bucketDriftMin: number; identityDriftMin: number };
  machines: Slice[];
  jobOrders: Slice[];
  shifts: Slice[];
  trend: Array<Slice & { at: string }>;
  states: Array<{ state: string | null; minutes: number; rows: number }>;
}

/** The reference's own names for the levels, in its own order. */
const BAR_LABEL: Record<string, string> = {
  totalTime: 'Total time',
  plannedStops: 'Planned stops',
  externalLoss: 'External loss (starved / blocked)',
  unmeasured: 'Unmeasured',
  operationalTime: 'Operational time',
  availabilityLosses: 'Availability losses',
  netProductionTime: 'Net production time',
  performanceLosses: 'Performance losses',
  microstopLosses: 'Microstop losses',
  netOperationalTime: 'Net operational time',
  qualityLosses: 'Quality losses',
  usedOperationalTime: 'Used operational time',
};

const pct = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)}%`);
const mins = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h ${Math.round(n % 60)}m` : `${n.toFixed(1)}m`);

/** Today, in the plant's own wall clock — never a UTC slice of it. */
function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function OeeStandardView() {
  const [dateFrom, setDateFrom] = React.useState(localDate(0));
  const [dateTo, setDateTo] = React.useState(localDate(0));
  const [machineId, setMachineId] = React.useState<string>('');

  const q = useQuery({
    queryKey: ['oee-standard', dateFrom, dateTo, machineId],
    queryFn: () => api.get<Payload>('/oee-standard', {
      params: { dateFrom, dateTo, granularity: 'hour', machineId: machineId || undefined },
    }),
    refetchInterval: 30_000,
  });

  const d = q.data;

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-xl font-semibold">OEE — Standard Engine</h1>
          <a
            className="text-xs text-muted-foreground underline decoration-dotted underline-offset-4"
            href="https://documentation.mindsphere.io/MindSphere/apps/insights-hub-oee/OEE-standard-formulas.html"
            target="_blank" rel="noreferrer"
          >
            Insights Hub standard formulas
          </a>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          A second engine reading the same signals against a published reference. It is here to be
          compared with the existing pages, not to replace them — a disagreement between two engines
          is evidence, and a single engine that is wrong is just a number.
        </p>
      </header>

      {/* ── Window ── */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 bg-card p-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">From</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="rounded border border-border bg-background px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">To</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="rounded border border-border bg-background px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Machine</span>
          <select value={machineId} onChange={(e) => setMachineId(e.target.value)}
            className="rounded border border-border bg-background px-2 py-1 text-sm">
            <option value="">All machines</option>
            {(d?.machines ?? []).map((m) => (
              <option key={m.key} value={m.key}>{m.label} — {m.sublabel}</option>
            ))}
          </select>
        </label>
        <button onClick={() => q.refetch()}
          className="ml-auto flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs hover:bg-muted">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.isError && <p className="text-sm text-destructive">Could not load. Is the API running?</p>}

      {d && (
        <>
          {/*
            The audit sits ABOVE the numbers, not behind a debug flag. A page that
            shows a figure and cannot show whether its minutes reconcile is asking
            to be believed; one that shows both is asking to be checked.
          */}
          <div className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm ${
            d.audit.ok ? 'border-emerald-600/30 bg-emerald-500/5' : 'border-amber-600/40 bg-amber-500/10'
          }`}>
            {d.audit.ok
              ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />}
            <span className="font-medium">
              {d.audit.ok ? 'Every minute is accounted for' : 'Minutes do not reconcile'}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              buckets {d.audit.bucketsMin}m · bucket drift {d.audit.bucketDriftMin}m · identity drift {d.audit.identityDriftMin}m
            </span>
          </div>

          {/* ── Factors ── */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Kpi label="OEE" value={pct(d.oee)} big />
            <Kpi label="Availability" value={pct(d.availability)}
              hint={`${mins(d.time.netProductionMin)} ÷ ${mins(d.time.operationalMin)}${
                d.machines.length > 1 ? ` · ${d.machines.length} machines` : ''}`} />
            <Kpi label="Performance" value={pct(d.performance)}
              hint={`${Math.round(d.counts.total)} ÷ ${Math.round(d.counts.theoretical)} parts`} />
            <Kpi label="Quality" value={pct(d.quality)}
              hint={`${Math.round(d.counts.good)} good of ${Math.round(d.counts.total)}`} />
            <Kpi label="Utilization" value={pct(d.utilization)} hint="PPT ÷ Total time" />
            <Kpi label="TEEP" value={pct(d.teep)} hint="OEE × Utilization" />
          </div>

          {/* ── The time model ── */}
          {/*
            Total time across several machines is MACHINE-minutes, not clock
            minutes: four machines running for an hour contribute four hours.
            Read as wall clock it looks impossible — a work order forty minutes
            old showing 2h 23m — so the scope says so in as many words rather
            than leaving the reader to work out which of the two it is.
          */}
          <section className="rounded-lg border border-border/60 bg-card p-4">
            <h2 className="mb-1 text-sm font-semibold">
              Time model{d.machines.length > 1 ? ' — machine-minutes' : ''}
            </h2>
            <p className="mb-2 text-xs text-muted-foreground">
              Every bar is a share of Total time. Each grey level is the one above it minus the
              amber loss between them.
            </p>
            <p className="mb-4 text-xs text-muted-foreground">
              {d.machines.length > 1 ? (
                <>
                  Summed over <b>{d.machines.length} machines</b>, so Total time is machine-minutes:
                  each machine contributes its own clock. That is{' '}
                  <span className="font-mono tabular-nums">
                    {mins(d.time.totalMin / d.machines.length)}
                  </span>{' '}
                  per machine, not {mins(d.time.totalMin)} of wall clock. Pick one machine above to
                  read it against the clock.
                </>
              ) : (
                <>One machine, so Total time is wall clock — the minutes its job orders occupied.</>
              )}
            </p>
            <TimeModel bars={d.bars} />
          </section>

          {/* ── Where the minutes went ── */}
          {d.states.length > 0 && (
            <section className="rounded-lg border border-border/60 bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold">Minutes by machine state</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                The model says how much was lost. This says under which state — without it,
                &ldquo;availability loss 3h&rdquo; is not something anybody can act on.
              </p>
              <div className="flex flex-wrap gap-2">
                {d.states.map((s) => (
                  <span key={s.state ?? 'none'}
                    className="rounded border border-border/60 bg-muted/40 px-2 py-1 font-mono text-xs">
                    {s.state ?? 'no state reported'} · {mins(s.minutes)}
                  </span>
                ))}
              </div>
            </section>
          )}

          <SliceTable title="By machine" rows={d.machines} />
          <SliceTable title="By job order" rows={d.jobOrders} />
          <SliceTable title="By shift" rows={d.shifts} />
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, hint, big }: { label: string; value: string; hint?: string; big?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-card p-3">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ${big ? 'text-3xl' : 'text-2xl'}`}>{value}</span>
      {hint && <span className="font-mono text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

/**
 * The waterfall.
 *
 * Bars are drawn RIGHT-aligned for losses and left-aligned for levels, the way
 * the reference draws them: a loss visually cuts into the level above it, so the
 * descent down the model is something you see rather than something you compute.
 */
function TimeModel({ bars }: { bars: Bar[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {bars.map((b) => {
        const colour =
          b.kind === 'result' ? 'bg-emerald-600'
          : b.kind === 'loss' ? 'bg-amber-500'
          : 'bg-muted-foreground/30';
        return (
          <div key={b.key} className="grid grid-cols-[minmax(120px,190px)_1fr] items-center gap-3">
            <span className={`truncate text-xs ${b.kind === 'loss' ? 'text-muted-foreground' : 'font-medium'}`}
              title={BAR_LABEL[b.key] ?? b.key}>
              {BAR_LABEL[b.key] ?? b.key}
            </span>
            <div className={`flex items-center gap-2 ${b.kind === 'loss' ? 'flex-row-reverse' : ''}`}>
              <div className="h-5 min-w-[2px] rounded-sm transition-all"
                style={{ width: `${Math.max(b.pct, 0)}%` }}>
                <div className={`h-full w-full rounded-sm ${colour}`} />
              </div>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                {b.pct.toFixed(2)}% · {mins(b.minutes)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SliceTable({ title, rows }: { title: string; rows: Slice[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="rounded-lg border border-border/60 bg-card">
      <h2 className="border-b border-border/60 px-4 py-3 text-sm font-semibold">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border/60 text-xs text-muted-foreground">
              <th className="px-4 py-2 text-start font-medium">Name</th>
              <th className="px-3 py-2 text-end font-medium">OEE</th>
              <th className="px-3 py-2 text-end font-medium">A</th>
              <th className="px-3 py-2 text-end font-medium">P</th>
              <th className="px-3 py-2 text-end font-medium">Q</th>
              <th className="px-3 py-2 text-end font-medium">Operational</th>
              <th className="px-3 py-2 text-end font-medium">Net production</th>
              <th className="px-3 py-2 text-end font-medium">Good / total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2">
                  <div className="font-medium">{r.label}</div>
                  {r.sublabel && <div className="text-xs text-muted-foreground">{r.sublabel}</div>}
                </td>
                <td className="px-3 py-2 text-end font-mono font-semibold tabular-nums">{pct(r.oee)}</td>
                <td className="px-3 py-2 text-end font-mono tabular-nums">{pct(r.availability)}</td>
                <td className="px-3 py-2 text-end font-mono tabular-nums">{pct(r.performance)}</td>
                <td className="px-3 py-2 text-end font-mono tabular-nums">{pct(r.quality)}</td>
                <td className="px-3 py-2 text-end font-mono tabular-nums text-muted-foreground">{mins(r.time.operationalMin)}</td>
                <td className="px-3 py-2 text-end font-mono tabular-nums text-muted-foreground">{mins(r.time.netProductionMin)}</td>
                <td className="px-3 py-2 text-end font-mono tabular-nums text-muted-foreground">
                  {Math.round(r.counts.good)} / {Math.round(r.counts.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
