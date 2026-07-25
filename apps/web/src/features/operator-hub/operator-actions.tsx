'use client';

/**
 * Shop-floor operator action dialogs: change machine status, raise an alarm, and
 * raise a maintenance request. All use endpoints the OPERATOR role can call
 * (production:execute / unguarded alarm create). Lightweight, touch-first modals.
 */

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, Wrench, X } from 'lucide-react';

import { api } from '@/services/api.client';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

export type MachineLite = { id: string; name: string; code: string };

const MACHINE_STATES = ['RUNNING', 'IDLE', 'PLANNED_STOP', 'BREAKDOWN', 'SETUP', 'CHANGEOVER', 'STARVED', 'BLOCKED', 'MAINTENANCE', 'OFFLINE'];
const STATE_COLOR: Record<string, string> = {
  RUNNING: 'text-green-400 border-green-500/40', IDLE: 'text-slate-400 border-slate-500/40',
  PLANNED_STOP: 'text-blue-400 border-blue-500/40', BREAKDOWN: 'text-red-400 border-red-500/40',
  SETUP: 'text-amber-400 border-amber-500/40', CHANGEOVER: 'text-amber-400 border-amber-500/40',
  STARVED: 'text-orange-400 border-orange-500/40', BLOCKED: 'text-orange-400 border-orange-500/40',
  MAINTENANCE: 'text-purple-400 border-purple-500/40', OFFLINE: 'text-slate-500 border-slate-600/40',
};

function Modal({ title, icon, onClose, children }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-card border border-border p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 font-bold text-foreground">{icon}{title}</div>
          <button onClick={onClose} className="text-foreground/50 hover:text-foreground"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MachinePicker({ machines, value, onChange }: { machines: MachineLite[]; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full h-11 rounded-xl bg-muted/40 border border-border px-3 text-sm focus:outline-none focus:border-brand-400">
      <option value="">Select machine…</option>
      {machines.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
    </select>
  );
}

const inputCls = 'w-full h-11 rounded-xl bg-muted/40 border border-border px-3 text-sm focus:outline-none focus:border-brand-400';
const btnPrimary = 'flex-1 h-11 rounded-xl text-white font-semibold text-sm active:scale-95 disabled:opacity-50';

// ── Change machine status ───────────────────────────────────────────────────
export function MachineStatusDialog({ machines, defaultMachineId, onClose }: { machines: MachineLite[]; defaultMachineId?: string; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [machineId, setMachineId] = useState(defaultMachineId ?? machines[0]?.id ?? '');
  const [state, setState] = useState('RUNNING');
  const [notes, setNotes] = useState('');

  const mut = useMutation({
    mutationFn: () => api.patch(`/production/downtime/machines/${machineId}/state`, { state, ...(notes.trim() ? { notes: notes.trim() } : {}) }),
    onSuccess: () => {
      toast({ title: 'Machine status updated' });
      qc.invalidateQueries({ queryKey: ['machine-states'] });
      qc.invalidateQueries({ queryKey: ['machine-states-3d'] });
      qc.invalidateQueries({ queryKey: ['downtime-events'] });
      onClose();
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Update failed', description: e?.response?.data?.message }),
  });

  return (
    <Modal title="Change machine status" icon={<Activity size={18} className="text-brand-400" />} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <MachinePicker machines={machines} value={machineId} onChange={setMachineId} />
        <div className="grid grid-cols-2 gap-2">
          {MACHINE_STATES.map((s) => (
            <button key={s} onClick={() => setState(s)}
              className={cn('h-10 rounded-xl border text-xs font-semibold transition', STATE_COLOR[s],
                state === s ? 'bg-accent ring-1 ring-brand-400' : 'bg-transparent')}>
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note (optional)" className={inputCls} />
        <div className="flex gap-2 mt-1">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-border font-semibold text-sm active:scale-95">Cancel</button>
          <button disabled={mut.isPending || !machineId} onClick={() => mut.mutate()} className={cn(btnPrimary, 'bg-brand-500')}>
            {mut.isPending ? 'Saving…' : 'Update status'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Raise an alarm ──────────────────────────────────────────────────────────
export function RaiseAlarmDialog({ machines, defaultMachineId, jobOrderId, onClose }: { machines: MachineLite[]; defaultMachineId?: string; jobOrderId?: string; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [machineId, setMachineId] = useState(defaultMachineId ?? machines[0]?.id ?? '');
  const [severity, setSeverity] = useState('MEDIUM');
  const [description, setDescription] = useState('');

  const mut = useMutation({
    mutationFn: () => api.post('/alarms', { ...(machineId ? { machineId } : {}), ...(jobOrderId ? { jobOrderId } : {}), severity, description: description.trim() }),
    onSuccess: () => {
      toast({ title: 'Alarm raised' });
      qc.invalidateQueries({ queryKey: ['alarms'] });
      onClose();
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Failed to raise alarm', description: e?.response?.data?.message }),
  });

  return (
    <Modal title="Raise alarm" icon={<AlertTriangle size={18} className="text-red-400" />} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <MachinePicker machines={machines} value={machineId} onChange={setMachineId} />
        <div className="grid grid-cols-5 gap-1.5">
          {['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => (
            <button key={s} onClick={() => setSeverity(s)}
              className={cn('h-9 rounded-lg border text-[11px] font-semibold', severity === s ? 'bg-accent ring-1 ring-red-400 text-foreground' : 'border-border text-foreground/60')}>
              {s}
            </button>
          ))}
        </div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is happening?" rows={3}
          className="w-full rounded-xl bg-muted/40 border border-border px-3 py-2 text-sm focus:outline-none focus:border-red-400" />
        <div className="flex gap-2 mt-1">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-border font-semibold text-sm active:scale-95">Cancel</button>
          <button disabled={mut.isPending || !description.trim()} onClick={() => mut.mutate()} className={cn(btnPrimary, 'bg-red-500')}>
            {mut.isPending ? 'Raising…' : 'Raise alarm'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Raise a maintenance request ─────────────────────────────────────────────
export function RaiseMaintenanceDialog({ machines, defaultMachineId, onClose }: { machines: MachineLite[]; defaultMachineId?: string; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [machineId, setMachineId] = useState(defaultMachineId ?? machines[0]?.id ?? '');
  const [priority, setPriority] = useState('MEDIUM');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const mut = useMutation({
    mutationFn: () => api.post('/maintenance/requests', { machineId, priority, title: title.trim(), ...(description.trim() ? { description: description.trim() } : {}) }),
    onSuccess: () => {
      toast({ title: 'Maintenance request sent' });
      qc.invalidateQueries({ queryKey: ['my-maint-requests'] });
      onClose();
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Request failed', description: e?.response?.data?.message }),
  });

  return (
    <Modal title="Maintenance request" icon={<Wrench size={18} className="text-amber-400" />} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <MachinePicker machines={machines} value={machineId} onChange={setMachineId} />
        <div className="grid grid-cols-4 gap-2">
          {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => (
            <button key={p} onClick={() => setPriority(p)}
              className={cn('h-9 rounded-lg border text-[11px] font-semibold', priority === p ? 'bg-accent ring-1 ring-amber-400 text-foreground' : 'border-border text-foreground/60')}>
              {p}
            </button>
          ))}
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short title (e.g. Conveyor jam)" className={inputCls} />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details (optional)" rows={3}
          className="w-full rounded-xl bg-muted/40 border border-border px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
        <div className="flex gap-2 mt-1">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-border font-semibold text-sm active:scale-95">Cancel</button>
          <button disabled={mut.isPending || !machineId || !title.trim()} onClick={() => mut.mutate()} className={cn(btnPrimary, 'bg-amber-500')}>
            {mut.isPending ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
