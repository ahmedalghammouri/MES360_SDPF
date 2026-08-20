'use client';
/**
 * The schedule-basis engine, on its own screen.
 *
 * Same layout as the standard engine on purpose — the two are meant to be read
 * side by side, and a different arrangement would make the comparison work the
 * reader has to do. What differs is the top of the model and two extra losses,
 * and those are the only things this page emphasises.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';

import { api } from '@/services/api.client';

interface Bar { key: string; minutes: number; pct: number; kind: 'base' | 'loss' | 'result' }
interface Slice {
  key: string; label: string; sublabel?: string | null;
  availability: number | null; performance: number | null; quality: number | null;
  oee: number | null; teep: number | null; utilization: number | null;
  slotElapsedPct: number | null;
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
  states: Array<{ state: string | null; minutes: number; rows: number }>;
}

const BAR_LABEL: Record<string, string> = {
  committedTime: 'Committed time',
  plannedStops: 'Planned stops',
  externalLoss: 'External loss (starved / blocked)',
  unmeasured: 'Unmeasured',
  operationalTime: 'Operational time',
  notStarted: 'Not started (slot open, machine idle)',
  notYetReached: 'Not yet reached',
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

function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function OeeScheduleView() {
  const [dateFrom, setDateFrom] = React.useState(localDate(0));
  const [dateTo, setDateTo] = React.useState(localDate(0));
  const [machineId, setMachineId] = React.useState<string>('');

  const q = useQuery({
    queryKey: ['oee-schedule', dateFrom, dateTo, machineId],
    queryFn: () => api.get<Payload>('/oee-schedule', {
      params: { dateFrom, dateTo, machineId: machineId || undefined },
    }),
    refetchInterval: 30_000,
  });

  const d = q.data;

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">OEE — Schedule Basis</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          The same measured minutes divided by the slot the order was <b>committed</b> to, not by
          the time that went by. It charges a late start and it charges the part of the slot the
          order has not reached yet — so it reads low early and climbs. This answers &ldquo;of the
          time we promised, how much have we delivered&rdquo;; the standard engine answers
          &ldquo;of the time it ran, how well did it run&rdquo;. They are not meant to agree.
        </p>
      </header>

      <div className="rounded-lg border border-border/60 bg-muted/30 p-3 font-mono text-xs text-muted-foreground">
        committedFrom = min(plannedStart, actualStart)<br />
        committedTo&nbsp;&nbsp; = actualEnd == null ? max(now, plannedEnd) : max(actualEnd, plannedEnd)
      </div>

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
          <div className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm ${
            d.audit.ok ? 'border-emerald-600/30 bg-emerald-500/5' : 'border-amber-600/40 bg-amber-500/10'
          }`}>
            {d.audit.ok
              ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />}
            <span className="font-medium">
              {d.audit.ok ? 'Every minute of the slot is accounted for' : 'Slot minutes do not reconcile'}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              buckets {d.audit.bucketsMin}m · bucket drift {d.audit.bucketDriftMin}m · identity drift {d.audit.identityDriftMin}m
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Kpi label="OEE" value={pct(d.oee)} big
              hint={d.slotElapsedPct != null ? `slot ${pct(d.slotElapsedPct)} elapsed` : undefined} />
            <Kpi label="Availability" value={pct(d.availability)}
              hint={`${mins(d.time.netProductionMin)} ÷ ${mins(d.time.operationalMin)}`} />
            <Kpi label="Performance" value={pct(d.performance)}
              hint={`${Math.round(d.counts.total)} ÷ ${Math.round(d.counts.theoretical)} parts`} />
            <Kpi label="Quality" value={pct(d.quality)}
              hint={`${Math.round(d.counts.good)} good of ${Math.round(d.counts.total)}`} />
            <Kpi label="Slot elapsed" value={pct(d.slotElapsedPct)}
              hint={`${mins(d.time.notYetReachedMin)} not reached`} />
            <Kpi label="TEEP" value={pct(d.teep)} hint="OEE × Utilization" />
          </div>

          {/*
            The same figure means two different things depending on where in the
            slot you read it, so the page says which one is on screen rather than
            leaving a low number to be read as a failure it may not be.
          */}
          {d.slotElapsedPct != null && d.slotElapsedPct < 99 && (
            <p className="rounded-lg border border-amber-600/30 bg-amber-500/5 p-3 text-sm">
              <b>{pct(d.slotElapsedPct)}</b> of the committed slot has gone by, so{' '}
              <b>{mins(d.time.notYetReachedMin)}</b> of it is time the orders have not reached yet
              and is counted against them. A reading taken mid-slot is a progress figure, not a
              verdict — read it again when the slot closes.
            </p>
          )}

          <section className="rounded-lg border border-border/60 bg-card p-4">
            <h2 className="mb-1 text-sm font-semibold">
              Time model{d.machines.length > 1 ? ' — machine-minutes' : ''}
            </h2>
            <p className="mb-2 text-xs text-muted-foreground">
              Every bar is a share of Committed time. Each grey level is the one above it minus the
              amber losses between them.
            </p>
            <p className="mb-4 text-xs text-muted-foreground">
              {d.machines.length > 1 ? (
                <>
                  Summed over <b>{d.machines.length} machines</b>, so Committed time is
                  machine-minutes: each machine contributes its own slot. That is{' '}
                  <span className="font-mono tabular-nums">
                    {mins(d.time.committedMin / d.machines.length)}
                  </span>{' '}
                  per machine. Pick one machine above to read it against the clock.
                </>
              ) : (
                <>One machine, so Committed time is the slot itself, on the clock.</>
              )}
            </p>
            <TimeModel bars={d.bars} />
          </section>

          {d.states.length > 0 && (
            <section className="rounded-lg border border-border/60 bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold">Minutes by machine state</h2>
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

function TimeModel({ bars }: { bars: Bar[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {bars.map((b) => {
        const colour =
          b.kind === 'result' ? 'bg-emerald-600'
          : b.kind === 'loss' ? 'bg-amber-500'
          : 'bg-muted-foreground/30';
        return (
          <div key={b.key} className="grid grid-cols-[minmax(120px,230px)_1fr] items-center gap-3">
            <span className={`truncate text-xs ${b.kind === 'loss' ? 'text-muted-foreground' : 'font-medium'}`}
              title={BAR_LABEL[b.key] ?? b.key}>
              {BAR_LABEL[b.key] ?? b.key}
            </span>
            <div className={`flex items-center gap-2 ${b.kind === 'loss' ? 'flex-row-reverse' : ''}`}>
              <div className="h-5 min-w-[2px] rounded-sm transition-all" style={{ width: `${Math.max(b.pct, 0)}%` }}>
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
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border/60 text-xs text-muted-foreground">
              <th className="px-4 py-2 text-start font-medium">Name</th>
              <th className="px-3 py-2 text-end font-medium">OEE</th>
              <th className="px-3 py-2 text-end font-medium">A</th>
              <th className="px-3 py-2 text-end font-medium">P</th>
              <th className="px-3 py-2 text-end font-medium">Q</th>
              <th className="px-3 py-2 text-end font-medium">Slot</th>
              <th className="px-3 py-2 text-end font-medium">Committed</th>
              <th className="px-3 py-2 text-end font-medium">Not reached</th>
              <th className="px-3 py-2 text-end font-medium">Net production</th>
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
                <td className="px-3 py-2 text-end font-mono tabular-nums text-muted-foreground">{pct(r.slotElapsedPct)}</td>
                <td className="px-3 py-2 text-end font-mono tabular-nums text-muted-foreground">{mins(r.time.committedMin)}</td>
                <td className="px-3 py-2 text-end font-mono tabular-nums text-muted-foreground">{mins(r.time.notYetReachedMin)}</td>
                <td className="px-3 py-2 text-end font-mono tabular-nums text-muted-foreground">{mins(r.time.netProductionMin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
