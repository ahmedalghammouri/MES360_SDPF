'use client';

/**
 * PlannedDowntimeManager — manage planned (scheduled) downtime events:
 * generate this week from shifts, add manual entries, list & delete.
 *
 * Extracted from Shift Configuration so it can live where downtime belongs:
 * the Downtime Management module and the Planned Downtime Schedule page.
 */

import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, Plus, Trash2, ShieldOff, Coffee, Sparkles, Timer } from 'lucide-react';

import { api } from '@/services/api.client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SelectMenu } from '@/components/ui/select-menu';
import { FormDialog } from '@/components/ui/form-dialog';
import { InlineFormSlot } from '@/components/ui/inline-form-panel';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  usePlannedCauses, usePlannedDowntime, useGeneratePlannedDowntime,
  useAddPlannedDowntime, useDeletePlannedDowntime,
} from './use-shifts';
import { ScopeTreePicker, type ScopeSelection } from './scope-tree-picker';

const causeIcon = (category?: string) =>
  category === 'PLANNED_CLEANING' ? Sparkles : category === 'PLANNED_BREAK' ? Coffee : ShieldOff;

const weekRange = () => {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { dateFrom: iso(today), dateTo: iso(new Date(today.getTime() + 6 * 86_400_000)) };
};

export function PlannedDowntimeManager() {
  const { data: causes } = usePlannedCauses();

  const [pdPage, setPdPage] = useState(1);
  const [pdMachine, setPdMachine] = useState('ALL');
  useEffect(() => { setPdPage(1); }, [pdMachine]);
  const { data: plannedResp } = usePlannedDowntime({
    limit: 15,
    page: pdPage,
    machineId: pdMachine === 'ALL' ? undefined : pdMachine,
  });

  const { data: machinesData } = useQuery({
    queryKey: ['machines-list'],
    queryFn: () => api.get('/hierarchy/machines?limit=50'),
    staleTime: 60_000,
  });
  const machines: Array<{ id: string; name: string; code: string }> =
    ((machinesData as any)?.data ?? (Array.isArray(machinesData) ? machinesData : [])) as any[];

  const plannedGenMut = useGeneratePlannedDowntime();
  const addPlannedMut = useAddPlannedDowntime();
  const deletePlannedMut = useDeletePlannedDowntime();

  const todayIso = new Date().toISOString().slice(0, 10);
  const [addPdOpen, setAddPdOpen] = useState(false);
  const [pd, setPd] = useState<{ causeId: string; scope: ScopeSelection | null; date: string; time: string; durationMinutes: string; notes: string }>({
    causeId: '', scope: null, date: todayIso, time: '13:00', durationMinutes: '30', notes: '',
  });
  const patchPd = (p: Partial<typeof pd>) => setPd((s) => ({ ...s, ...p }));
  const openAddPd = () => {
    setPd({ causeId: causes?.[0]?.id ?? '', scope: null, date: todayIso, time: '13:00', durationMinutes: '30', notes: '' });
    setAddPdOpen(true);
  };
  const pdValid = !!pd.causeId && !!pd.scope && !!pd.date && /^([01]\d|2[0-3]):([0-5]\d)$/.test(pd.time) && Number(pd.durationMinutes) > 0;
  const submitPd = () => {
    if (!pd.scope) return;
    addPlannedMut.mutate({
      causeId: pd.causeId,
      scopeType: pd.scope.type,
      scopeId: pd.scope.id,
      startTime: new Date(`${pd.date}T${pd.time}:00`).toISOString(),
      durationMinutes: Number(pd.durationMinutes),
      notes: pd.notes.trim() || undefined,
    }, { onSuccess: () => setAddPdOpen(false) });
  };

  const generatePlannedWeek = () => plannedGenMut.mutate(weekRange());

  const plannedEvents = plannedResp?.data ?? [];
  const totalPlannedMinutes = plannedResp?.totalPlannedMinutes ?? 0;

  return (
    <div className="space-y-4">
      <InlineFormSlot />

      <div className="rounded-xl border border-border/60 bg-card p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="max-w-xl">
            <h3 className="font-semibold flex items-center gap-2"><ShieldOff size={16} className="text-emerald-400" /> Planned Downtime</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Break and cleaning time from each shift is materialised as planned downtime events linked to downtime
              reason codes. They are <strong>excluded from OEE availability loss</strong> and the unplanned Pareto, but
              remain visible in the Downtime module.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" onClick={generatePlannedWeek} disabled={plannedGenMut.isPending}>
              <CalendarPlus size={16} className="mr-2" />
              Generate (this week)
            </Button>
            <Button onClick={openAddPd}>
              <Plus size={16} className="mr-2" />
              Add Planned Downtime
            </Button>
          </div>
        </div>

        {/* Linked reason codes */}
        <div className="mt-4 flex flex-wrap gap-2">
          {(causes ?? []).map((c) => {
            const Icon = causeIcon(c.category);
            return (
              <span key={c.id} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-xs">
                <Icon size={13} className="text-muted-foreground" />
                <span className="font-medium">{c.name}</span>
                <Badge variant="outline" className="text-[10px] font-mono ml-1">{c.code}</Badge>
              </span>
            );
          })}
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 px-2.5 py-1 text-xs">
            <Timer size={13} /> {totalPlannedMinutes} planned min logged
          </span>
        </div>
      </div>

      {/* Machine filter */}
      <div className="flex items-center gap-2">
        <SelectMenu
          value={pdMachine}
          onValueChange={setPdMachine}
          menuLabel="Machine"
          options={[
            { value: 'ALL', label: 'All machines' },
            ...machines.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` })),
          ]}
        />
        <span className="ml-auto text-xs text-muted-foreground">
          {(plannedResp as any)?.total ?? plannedEvents.length} event{(((plannedResp as any)?.total ?? plannedEvents.length) !== 1) ? 's' : ''}
        </span>
      </div>

      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              <th className="px-4 py-2 font-medium">Start</th>
              <th className="px-4 py-2 font-medium">Machine</th>
              <th className="px-4 py-2 font-medium">Reason</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium text-right">Minutes</th>
              <th className="px-4 py-2 font-medium w-10"></th>
            </tr>
          </thead>
          <tbody>
            {plannedEvents.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                No planned downtime yet. Click <strong>Add Planned Downtime</strong> or <strong>Generate (this week)</strong>.
              </td></tr>
            ) : plannedEvents.map((e) => {
              const Icon = causeIcon(e.category);
              return (
                <tr key={e.id} className="border-t border-border/50">
                  <td className="px-4 py-2 tabular-nums">{e.startTime.slice(0, 16).replace('T', ' ')}</td>
                  <td className="px-4 py-2">{e.machine?.name ?? '—'} <span className="text-muted-foreground font-mono text-xs">{e.machine?.code}</span></td>
                  <td className="px-4 py-2">{e.cause?.name ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon size={13} className="text-muted-foreground" />
                      <span className="text-xs">{e.category.replace('PLANNED_', '').toLowerCase()}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{e.durationMinutes ?? '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                      onClick={() => deletePlannedMut.mutate(e.id)} disabled={deletePlannedMut.isPending}>
                      <Trash2 size={14} />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {(((plannedResp as any)?.total ?? 0) > 15) && (
          <div className="border-t border-border/50 px-4 py-2">
            <TablePagination page={pdPage} total={(plannedResp as any)?.total ?? 0} limit={15} onPageChange={setPdPage} />
          </div>
        )}
      </div>

      {/* Add Planned Downtime (manual) */}
      <FormDialog
        open={addPdOpen}
        onClose={() => setAddPdOpen(false)}
        title="Add Planned Downtime"
        onSubmit={submitPd}
        submitLabel="Add"
        isSubmitting={addPlannedMut.isPending}
        isValid={pdValid}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <SelectMenu
              size="md"
              fullWidth
              value={pd.causeId}
              onValueChange={(v) => patchPd({ causeId: v })}
              placeholder="Select a downtime reason…"
              options={(causes ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Apply to (hierarchy scope)</Label>
            {pd.scope && (
              <div className="text-xs mb-1.5 inline-flex items-center gap-1.5 rounded bg-primary/10 text-primary px-2 py-1">
                <span className="font-mono uppercase text-[10px]">{pd.scope.type}</span>
                <span className="font-medium">{pd.scope.name}</span>
                <span className="font-mono text-[10px] opacity-70">{pd.scope.code}</span>
              </div>
            )}
            <ScopeTreePicker value={pd.scope} onSelect={(sel) => patchPd({ scope: sel })} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={pd.date} onChange={(e) => patchPd({ date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Start time</Label>
              <Input type="time" value={pd.time} onChange={(e) => patchPd({ time: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Duration (min)</Label>
              <Input type="number" value={pd.durationMinutes} onChange={(e) => patchPd({ durationMinutes: e.target.value })} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Input value={pd.notes} onChange={(e) => patchPd({ notes: e.target.value })} placeholder="e.g. Weekly deep clean" />
          </div>

          <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            Creates planned downtime for{' '}
            <strong className="text-foreground">
              {pd.scope ? (pd.scope.type === 'MACHINE' ? '1 machine' : pd.scope.type === 'LINE' ? 'every machine in the line' : 'every machine in the area') : '…'}
            </strong>. Excluded from OEE availability loss; visible in the Downtime module.
          </div>
        </div>
      </FormDialog>
    </div>
  );
}
