'use client';

/**
 * OperatorHmiView — the SIMPLIFIED operator tablet screen (per training feedback).
 * Shows only what the operator needs, big and touch-first:
 *   Today's Work Order · Target Qty · Actual/Production Qty · Accepted/Rejected ·
 *   Downtime · Downtime Reason.
 * Plus the core shift actions (Start / Pause / Complete, +Count, +Downtime) and the
 * historical downtime-reason list (assign reason/sub-reason to recorded stoppages).
 *
 * Deliberately a NEW screen — the full ShopFloorView (many KPIs) is untouched and
 * still used by supervisors on the desktop. All actions use production:execute
 * endpoints, which operators hold.
 */

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Play, Pause, CheckSquare, Plus, AlertTriangle, Loader2, Package, Clock, Factory,
  Activity, Bell, Wrench,
} from 'lucide-react';

import { api } from '@/services/api.client';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { LogDowntimeDialog } from '@/features/shop-floor/log-downtime-dialog';
import type { JOActionTarget } from '@/features/shop-floor/shop-floor-actions';
import { DowntimeReasonList } from './downtime-reason-list';
import { MachineSummary } from './machine-summary';
import { AlarmsLog } from './alarms-log';
import { useCurrentUser } from './use-current-user';
import {
  MachineStatusDialog, RaiseAlarmDialog, RaiseMaintenanceDialog, type MachineLite,
} from './operator-actions';

type JOStatus = 'SCHEDULED' | 'READY' | 'EXECUTING' | 'PAUSED' | 'COMPLETE' | 'CANCELLED';
interface JO {
  id: string;
  operationName: string;
  status: JOStatus;
  plannedQtyOut?: number;
  outputUnit?: string;
  actualQtyGood: number;
  actualQtyRejected: number;
  actualStart?: string;
  operatorId?: string;
  workOrder?: { id: string; orderNumber: string; sku?: { name: string; code: string } };
  machine?: { id?: string; name: string; code: string };
}

const ACTIVE: JOStatus[] = ['EXECUTING', 'PAUSED', 'READY'];

export function OperatorHmiView() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [downtimeTarget, setDowntimeTarget] = useState<JOActionTarget | null>(null);
  const [countFor, setCountFor] = useState<JO | null>(null);
  const [dialog, setDialog] = useState<null | 'status' | 'alarm' | 'maint'>(null);

  const { data: me } = useCurrentUser();

  const { data, isLoading } = useQuery({
    queryKey: ['shop-floor-jobs', 'operator-hmi'],
    queryFn: () => api.get('/production/job-orders'),
    refetchInterval: 15_000,
  });
  const { data: shiftA } = useQuery({
    queryKey: ['shift-analysis'],
    queryFn: () => api.get('/shifts/analysis'),
    refetchInterval: 20_000,
  });

  const allJobs: JO[] = (data as any) ?? [];
  // Shop floor shows ONLY the job orders assigned to the logged-in operator, and
  // only the active ones (executing/ready/paused). The operator cannot reassign —
  // there is no assign control here (that stays with supervisors/managers).
  const jobs = useMemo(
    () => allJobs
      .filter((j) => ACTIVE.includes(j.status) && (!me?.id || j.operatorId === me.id))
      .sort((a, b) => (a.status === 'EXECUTING' ? -1 : 1)),
    [allJobs, me?.id],
  );
  const machineIds = useMemo(
    () => [...new Set(jobs.map((j) => j.machine?.id).filter(Boolean) as string[])],
    [jobs],
  );
  // Machine list for the action dialogs (from the operator's own job orders).
  const machines: MachineLite[] = useMemo(() => {
    const map = new Map<string, MachineLite>();
    for (const j of jobs) if (j.machine?.id) map.set(j.machine.id, { id: j.machine.id, name: j.machine.name, code: j.machine.code });
    return [...map.values()];
  }, [jobs]);

  // Shift downtime totals (per the shift engine) for the Downtime tile.
  const shift: any = shiftA;
  const downtimeMins = Math.round(shift?.totals?.downtimeMins ?? 0);

  const transition = useMutation({
    mutationFn: ({ id, status }: { id: string; status: JOStatus }) =>
      api.patch(`/production/job-orders/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shop-floor-jobs'] }),
    onError: (e: any) => toast({ variant: 'destructive', title: 'Action failed', description: e?.response?.data?.message }),
  });

  const addCount = useMutation({
    mutationFn: ({ id, goodDelta, scrapDelta }: { id: string; goodDelta: number; scrapDelta: number }) =>
      api.patch(`/production/job-orders/${id}/add-count`, { goodDelta, scrapDelta, reason: 'MANUAL' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shop-floor-jobs'] }); setCountFor(null); },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Count failed', description: e?.response?.data?.message }),
  });

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
      {/* Shift strip */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Today’s Work</h1>
          <p className="text-sm text-foreground/50">
            {me?.name ? `${me.name} · ` : ''}{shift?.status?.active?.name ?? 'Shift'} · {jobs.length} active
          </p>
        </div>
        <TileMini label="Downtime" value={`${downtimeMins}m`} tone={downtimeMins > 0 ? 'amber' : 'default'} icon={<Clock size={14} />} />
      </div>

      {/* Machine-state summary dashboard */}
      <div className="mb-4"><MachineSummary /></div>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <ToolbarBtn onClick={() => setDialog('status')} icon={<Activity size={16} />} label="Machine status" />
        <ToolbarBtn onClick={() => setDialog('alarm')} icon={<Bell size={16} />} label="Raise alarm" tone="red" />
        <ToolbarBtn onClick={() => setDialog('maint')} icon={<Wrench size={16} />} label="Maint. request" tone="amber" />
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-10"><Loader2 className="animate-spin" size={16} /> Loading…</div>
      ) : jobs.length === 0 ? (
        <div className="rounded-2xl border border-border/60 p-10 text-center text-foreground/50">
          <Factory className="mx-auto mb-2 opacity-40" size={28} />
          No active work order right now.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {jobs.map((jo) => {
            const target = Math.max(0, jo.plannedQtyOut ?? 0);
            const good = jo.actualQtyGood ?? 0;
            const rej = jo.actualQtyRejected ?? 0;
            const pct = target > 0 ? Math.min(100, Math.round((good / target) * 100)) : 0;
            const running = jo.status === 'EXECUTING';
            return (
              <div key={jo.id} className="rounded-2xl border border-border/60 bg-card p-4">
                {/* WO header */}
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-foreground truncate">{jo.workOrder?.orderNumber ?? '—'}</span>
                      <span className={cn('text-[10px] font-bold uppercase px-2 py-0.5 rounded-full',
                        running ? 'bg-green-500/15 text-green-400' : jo.status === 'PAUSED' ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/15 text-blue-400')}>
                        {jo.status}
                      </span>
                    </div>
                    <div className="text-sm text-foreground/50 truncate">
                      {jo.workOrder?.sku?.name ?? jo.operationName} · {jo.machine?.code ?? jo.machine?.name ?? ''}
                    </div>
                  </div>
                </div>

                {/* KPI tiles */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <Tile label="Target" value={target.toLocaleString()} unit={jo.outputUnit} />
                  <Tile label="Actual" value={good.toLocaleString()} unit={jo.outputUnit} tone="sky" />
                  <Tile label="Accepted / Rejected" value={`${good.toLocaleString()} / ${rej.toLocaleString()}`} tone={rej > 0 ? 'red' : 'emerald'} />
                </div>

                {/* Progress */}
                <div className="h-2 rounded-full bg-muted overflow-hidden mb-3">
                  <div className="h-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} />
                </div>

                {/* Actions — large touch targets */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {running ? (
                    <ActionBtn onClick={() => transition.mutate({ id: jo.id, status: 'PAUSED' })} icon={<Pause size={18} />} label="Pause" tone="amber" />
                  ) : (
                    <ActionBtn onClick={() => transition.mutate({ id: jo.id, status: 'EXECUTING' })} icon={<Play size={18} />} label="Start" tone="green" />
                  )}
                  <ActionBtn onClick={() => setCountFor(jo)} icon={<Plus size={18} />} label="Count" tone="sky" />
                  <ActionBtn
                    onClick={() => setDowntimeTarget({ jobOrderId: jo.id, workOrderId: jo.workOrder?.id, machineId: jo.machine?.id, machineName: jo.machine?.name, operationName: jo.operationName })}
                    icon={<AlertTriangle size={18} />} label="Downtime" tone="red"
                  />
                  <ActionBtn onClick={() => transition.mutate({ id: jo.id, status: 'COMPLETE' })} icon={<CheckSquare size={18} />} label="Complete" tone="emerald" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Downtime events — close (adjustable end time) + set reason / sub-reason */}
      <div className="mt-8">
        <h2 className="text-base font-bold text-foreground mb-1">Downtime events</h2>
        <p className="text-sm text-foreground/50 mb-3">Tap an event to close it (set end time) or set its reason and sub-reason.</p>
        <DowntimeReasonList machineIds={machineIds.length ? machineIds : undefined} />
      </div>

      {/* Alarms log */}
      <div className="mt-8">
        <h2 className="text-base font-bold text-foreground mb-3">Alarms</h2>
        <AlarmsLog />
      </div>

      {/* Dialogs */}
      <LogDowntimeDialog open={!!downtimeTarget} onOpenChange={(v) => !v && setDowntimeTarget(null)} target={downtimeTarget} />
      {countFor && <CountDialog jo={countFor} onClose={() => setCountFor(null)} onSubmit={(g, s) => addCount.mutate({ id: countFor.id, goodDelta: g, scrapDelta: s })} pending={addCount.isPending} />}
      {dialog === 'status' && <MachineStatusDialog machines={machines} onClose={() => setDialog(null)} />}
      {dialog === 'alarm' && <RaiseAlarmDialog machines={machines} onClose={() => setDialog(null)} />}
      {dialog === 'maint' && <RaiseMaintenanceDialog machines={machines} onClose={() => setDialog(null)} />}
    </div>
  );
}

function ToolbarBtn({ onClick, icon, label, tone = 'default' }: { onClick: () => void; icon: React.ReactNode; label: string; tone?: string }) {
  const cls: Record<string, string> = {
    default: 'border-border text-foreground/80',
    red: 'border-red-500/30 text-red-400',
    amber: 'border-amber-500/30 text-amber-400',
  };
  return (
    <button onClick={onClick} className={cn('flex flex-col items-center justify-center gap-1 h-14 rounded-xl border bg-card text-[11px] font-semibold transition active:scale-95', cls[tone])}>
      {icon}{label}
    </button>
  );
}

// ── small presentational helpers ────────────────────────────────────────────
function Tile({ label, value, unit, tone = 'default' }: { label: string; value: string; unit?: string; tone?: string }) {
  const toneCls: Record<string, string> = {
    default: 'text-foreground', sky: 'text-sky-400', emerald: 'text-emerald-400', red: 'text-red-400', amber: 'text-amber-400',
  };
  return (
    <div className="rounded-xl bg-muted/40 p-2.5 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-foreground/45">{label}</div>
      <div className={cn('text-lg font-bold tabular-nums mt-0.5', toneCls[tone])}>
        {value}{unit ? <span className="text-[11px] font-normal text-foreground/40 ml-1">{unit}</span> : null}
      </div>
    </div>
  );
}
function TileMini({ label, value, tone = 'default', icon }: { label: string; value: string; tone?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 px-3 py-1.5 text-center">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-foreground/45">{icon}{label}</div>
      <div className={cn('text-base font-bold tabular-nums', tone === 'amber' && 'text-amber-400')}>{value}</div>
    </div>
  );
}
function ActionBtn({ onClick, icon, label, tone }: { onClick: () => void; icon: React.ReactNode; label: string; tone: string }) {
  const cls: Record<string, string> = {
    green: 'bg-green-500/15 text-green-400 active:bg-green-500/25',
    amber: 'bg-amber-500/15 text-amber-400 active:bg-amber-500/25',
    sky: 'bg-sky-500/15 text-sky-400 active:bg-sky-500/25',
    red: 'bg-red-500/15 text-red-400 active:bg-red-500/25',
    emerald: 'bg-emerald-500/15 text-emerald-400 active:bg-emerald-500/25',
  };
  return (
    <button onClick={onClick} className={cn('flex flex-col items-center justify-center gap-1 h-16 rounded-xl font-semibold text-xs transition active:scale-95', cls[tone])}>
      {icon}{label}
    </button>
  );
}

// Minimal count entry (good / scrap deltas). Native number inputs; inputMode numeric.
function CountDialog({ jo, onClose, onSubmit, pending }: { jo: JO; onClose: () => void; onSubmit: (good: number, scrap: number) => void; pending: boolean }) {
  const [good, setGood] = useState('');
  const [scrap, setScrap] = useState('');
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <Package size={18} className="text-sky-400" />
          <div className="font-bold text-foreground">Add count · {jo.workOrder?.orderNumber}</div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-emerald-400">Accepted (+)</span>
            <input type="number" inputMode="numeric" min={0} value={good} onChange={(e) => setGood(e.target.value)}
              className="h-12 text-lg text-center rounded-xl bg-muted/40 border border-border focus:outline-none focus:border-sky-400" autoFocus />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-red-400">Rejected (+)</span>
            <input type="number" inputMode="numeric" min={0} value={scrap} onChange={(e) => setScrap(e.target.value)}
              className="h-12 text-lg text-center rounded-xl bg-muted/40 border border-border focus:outline-none focus:border-red-400" />
          </label>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-border font-semibold text-sm active:scale-95">Cancel</button>
          <button
            disabled={pending || (!good && !scrap)}
            onClick={() => onSubmit(Number(good) || 0, Number(scrap) || 0)}
            className="flex-1 h-11 rounded-xl bg-sky-500 text-white font-semibold text-sm active:scale-95 disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save count'}
          </button>
        </div>
      </div>
    </div>
  );
}
