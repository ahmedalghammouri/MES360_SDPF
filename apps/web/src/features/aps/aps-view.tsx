'use client';

import React, { useState } from 'react';
import {
  Zap, Gauge, Clock, AlertTriangle, Cpu, CalendarClock, PackageX,
  CheckCircle2, XCircle, Loader2, Sparkles, Undo2, Redo2, Save,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EntityPicker } from '@/components/ui/entity-picker';
import { Badge } from '@/components/ui/badge';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';
import { cn } from '@/lib/utils';
import { api } from '@/services/api.client';
import { useQuery } from '@tanstack/react-query';
import {
  FactoryGantt, type FactoryTask, type FactoryZoom,
  type SupplyMarker, type DemandMarker, type GanttTreeNode, type DepType,
} from '@/components/charts/factory-gantt';
import { toast } from '@/components/ui/use-toast';
import { apsService, type CtpResult, type RunScheduleResult } from '@/services/aps.service';
import { useApsPlan, useApsMrp, useRunScheduleDry, useSaveSchedule } from './use-aps';

function KpiTile({ icon: Icon, label, value, unit, color, hint }: {
  icon: React.ElementType; label: string; value: string | number; unit?: string; color: string; hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon size={16} style={{ color }} />
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums" style={{ color }}>
        {value}{unit && <span className="text-sm font-medium text-muted-foreground ml-1">{unit}</span>}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

// ── Capable-to-Promise dialog ────────────────────────────────────
function CtpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [skuId, setSkuId] = useState('');
  const [quantity, setQuantity] = useState(1000);
  const [dueDate, setDueDate] = useState('');
  const [result, setResult] = useState<CtpResult | null>(null);
  const [loading, setLoading] = useState(false);

  const { data: skuResp } = useQuery({
    queryKey: ['aps', 'skus'],
    queryFn: () => api.get<{ data: { id: string; code: string; name: string }[] }>('/inventory/products', { params: { limit: 500 } }),
    enabled: open,
    staleTime: 300_000,
  });
  const skus = skuResp?.data ?? [];

  const run = async () => {
    if (!skuId) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await apsService.ctp({ skuId, quantity, dueDate: dueDate || undefined });
      setResult(res);
    } finally {
      setLoading(false);
    }
  };

  return (
    <InlineFormPanel
      open={open}
      onClose={() => onOpenChange(false)}
      icon={CalendarClock}
      title="Capable-to-Promise"
      description="Check whether a quantity can be delivered by a requested date"
      footer={(
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={run} disabled={!skuId || loading}>
            {loading ? <><Loader2 size={15} className="mr-2 animate-spin" /> Checking…</> : 'Check availability'}
          </Button>
        </>
      )}
    >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Product (SKU)</Label>
            <EntityPicker
              items={skus}
              value={skuId}
              onChange={(id) => setSkuId(id ?? '')}
              getId={(s) => s.id}
              getPrimary={(s) => s.name}
              getSecondary={(s) => s.code}
              placeholder="Select a SKU…"
              searchPlaceholder="Search by code or name…"
              clearable={false}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Quantity</Label>
              <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Requested date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          {result && (
            <div className={cn('rounded-lg border p-3 text-sm', result.feasible ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-destructive/30 bg-destructive/10')}>
              {result.reason ? (
                <div className="flex items-center gap-2 text-destructive"><XCircle size={16} /> {result.reason}</div>
              ) : (
                <>
                  <div className={cn('flex items-center gap-2 font-semibold', result.feasible ? 'text-emerald-500' : 'text-destructive')}>
                    {result.feasible ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                    {result.feasible ? 'Deliverable on time' : 'Cannot meet requested date'}
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <div>Promise date: <span className="font-medium text-foreground">{new Date(result.promiseDate!).toLocaleString()}</span></div>
                    <div>On machine: <span className="font-medium text-foreground">{result.machine?.name}</span> · {result.runtimeHours}h run</div>
                    {result.slackHours !== null && result.slackHours !== undefined && (
                      <div>Slack vs requested: <span className={cn('font-medium', result.slackHours >= 0 ? 'text-emerald-500' : 'text-destructive')}>{result.slackHours}h</span></div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
    </InlineFormPanel>
  );
}

// A reviewed-but-unsaved plan snapshot (dry-run result kept client-side).
// `overrides` are the manual drag/resize pins that produced this snapshot.
interface PlanSnapshot {
  map: Record<string, { start: string; end: string }>;
  metrics: RunScheduleResult;
  overrides: Record<string, { start: string; end: string }>;
}

export function ApsView() {
  const { data: plan, isLoading } = useApsPlan();
  const { data: mrp } = useApsMrp();
  const runDry = useRunScheduleDry();
  const saveSchedule = useSaveSchedule();

  const [zoom, setZoom] = useState<FactoryZoom>('week');
  const [ctpOpen, setCtpOpen] = useState(false);
  const [tab, setTab] = useState<'mrp' | 'late'>('mrp');

  // ── Dry-run preview history (undo/redo). histIdx = -1 → the saved server plan. ──
  const [history, setHistory] = useState<PlanSnapshot[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const overlay = histIdx >= 0 ? history[histIdx] : null;
  const dirty = histIdx >= 0;
  const canUndo = histIdx >= 0;
  const canRedo = histIdx < history.length - 1;

  const currentOverrides = overlay?.overrides ?? {};

  // Append a snapshot and advance the cursor. Both state updates are PURE and
  // separate (no setState inside an updater — that breaks under StrictMode).
  const pushSnapshot = (res: RunScheduleResult, overrides: Record<string, { start: string; end: string }>) => {
    const map: Record<string, { start: string; end: string }> = {};
    for (const u of res.updates ?? []) map[u.id] = { start: u.start, end: u.end };
    setHistory((h) => [...h.slice(0, histIdx + 1), { map, metrics: res, overrides }]);
    setHistIdx(histIdx + 1);
  };

  // Full auto recompute — clears any manual drag pins.
  const recalcPreview = () => {
    runDry.mutate({}, {
      onSuccess: (res) => {
        if (!res.updates || res.updates.length === 0) {
          toast({ title: 'Nothing to replan', description: 'All operations are already running or fixed.' });
          return;
        }
        pushSnapshot(res, {});
      },
    });
  };
  const undo = () => canUndo && setHistIdx((i) => i - 1);
  const redo = () => canRedo && setHistIdx((i) => i + 1);
  const discard = () => { setHistory([]); setHistIdx(-1); };
  const commitPlan = () => {
    const updates = overlay ? Object.entries(overlay.map).map(([id, w]) => ({ id, start: w.start, end: w.end })) : [];
    if (updates.length === 0) {
      toast({ title: 'No plan changes to save', description: 'Recalculate or drag an operation first.' });
      return;
    }
    if (!window.confirm(`Save this plan? ${updates.length} operation(s) will be rescheduled in the database.`)) return;
    saveSchedule.mutate(updates, { onSuccess: discard });
  };

  // Server metrics, or the active preview's metrics while reviewing.
  const m = dirty ? overlay!.metrics : plan?.metrics;
  // Apply the preview overlay onto the server plan items for the Gantt.
  const items = (() => {
    const base = plan?.items ?? [];
    if (!overlay) return base;
    return base.map((it) => (overlay.map[it.id] ? { ...it, start: overlay.map[it.id].start, end: overlay.map[it.id].end } : it));
  })();

  // Range must cover the (possibly longer) previewed plan so the Gantt visibly
  // reflects the recalculation, not just the saved server window.
  const ganttRange = (() => {
    const base = plan?.range;
    if (!base) return base;
    const times = items.flatMap((it) => [+new Date(it.start), +new Date(it.end)]);
    if (times.length === 0) return base;
    const from = Math.min(+new Date(base.from), ...times);
    const to = Math.max(+new Date(base.to), ...times);
    return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
  })();

  // Drag / resize on the Gantt is a PREVIEW edit: pin the moved op at its new
  // window and reflow the rest through the same engine (relationships + calendar
  // + late-date recompute). Nothing is written until Save Plan.
  const handleMove = (task: FactoryTask, start: Date, end: Date) => {
    const overrides = { ...currentOverrides, [task.id]: { start: start.toISOString(), end: end.toISOString() } };
    runDry.mutate(
      { overrides: Object.entries(overrides).map(([id, w]) => ({ id, ...w })) },
      { onSuccess: (res) => pushSnapshot(res, overrides) },
    );
  };

  const shortages = mrp?.requirements.filter((r) => r.shortage > 0) ?? [];

  // ── FactoryGantt data mapping ──
  const DEP_SHORT: Record<string, DepType> = {
    FINISH_TO_START: 'FS', START_TO_START: 'SS', START_TO_FINISH: 'SF', FINISH_TO_FINISH: 'FF',
  };

  const tasks: FactoryTask[] = items.map((it) => {
    const dep = DEP_SHORT[it.predecessorType] ?? 'FS';
    const depNote = it.predecessorId ? `\nLink: ${dep}${it.predecessorLagMins ? ` ${it.predecessorLagMins > 0 ? '+' : ''}${it.predecessorLagMins}m` : ''}` : '';
    return {
      id: it.id,
      resourceId: it.resourceId,
      start: it.start,
      end: it.end,
      color: it.color,
      statusColor: it.statusColor,
      label: `[ ${it.orderNumber} ] · ${it.operation}`,
      tooltip: `${it.orderNumber} · ${it.operation} @ ${it.resourceName}\n${new Date(it.start).toLocaleString()} → ${new Date(it.end).toLocaleString()}${it.qty ? `\nQty ${it.qty}` : ''}\nStatus: ${it.status}${depNote}`,
      predecessorId: it.predecessorId,
      predecessorType: dep,
      orderKey: it.orderNumber,
      status: it.status,
      progress: it.progress,
    };
  });

  // Expandable order tree: Production Order → Work Order → Job Order steps.
  const tree: GanttTreeNode[] = (() => {
    const poMap = new Map<string, { label: string; wos: Map<string, typeof items> }>();
    for (const it of items) {
      const poKey = it.productionOrderId ?? '__direct';
      const poLabel = it.productionOrderNumber ?? 'Direct Work Orders';
      if (!poMap.has(poKey)) poMap.set(poKey, { label: poLabel, wos: new Map() });
      const po = poMap.get(poKey)!;
      if (!po.wos.has(it.workOrderId)) po.wos.set(it.workOrderId, []);
      po.wos.get(it.workOrderId)!.push(it);
    }
    return [...poMap.entries()].map(([poKey, po]) => ({
      id: `po:${poKey}`,
      label: po.label,
      sub: `${po.wos.size} work order${po.wos.size === 1 ? '' : 's'}`,
      children: [...po.wos.entries()].map(([woId, ops]) => {
        const sorted = [...ops].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
        return {
          id: `wo:${woId}`,
          label: sorted[0].orderNumber,
          sub: `${sorted.length} steps · ${sorted[0].priority}`,
          children: sorted.map((op) => ({
            id: `jo:${op.id}`,
            label: `${op.sequenceOrder}. ${op.operation}`,
            sub: `${op.resourceName}${op.predecessorId ? ` · ${DEP_SHORT[op.predecessorType] ?? 'FS'}${op.predecessorLagMins ? `+${op.predecessorLagMins}m` : ''}` : ''}`,
            taskId: op.id,
          })),
        };
      }),
    }));
  })();

  const ganttResources = (plan?.machines ?? []).map((mc) => ({ id: mc.id, name: mc.name, sub: mc.code }));

  const supplyMarkers: SupplyMarker[] = (mrp?.requirements ?? []).map((r) => ({
    id: r.materialId,
    date: r.requiredDate,
    color: r.shortage > 0 ? '#ef4444' : '#f59e0b',
    label: `${r.code} — required ${r.required} ${r.unit}, available ${r.available}${r.shortage > 0 ? ` · SHORT ${r.shortage} ${r.unit}` : ' · OK'}${r.suggestedOrderDate ? `\nOrder by ${new Date(r.suggestedOrderDate).toLocaleDateString()}` : ''}`,
  }));

  const demandMarkers: DemandMarker[] = (plan?.demand ?? []).map((d) => ({
    id: d.orderNumber,
    orderKey: d.orderNumber,
    color: d.color,
    dueDate: d.dueDate,
    finish: d.scheduledFinish,
    late: d.late,
    label: `${d.orderNumber} (${d.priority})`,
  }));

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles size={22} className="text-primary" /> Production Schedule — APS
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Factory Navigator · finite-capacity planning, Capable-to-Promise and MRP, updated from live machine &amp; operator events.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setCtpOpen(true)}>
            <CalendarClock size={16} className="mr-2" /> Capable-to-Promise
          </Button>
          {/* Undo / Redo over dry-run previews */}
          <div className="flex items-center rounded-md border border-border overflow-hidden">
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-none" onClick={undo} disabled={!canUndo} title="Undo">
              <Undo2 size={16} />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-none border-l border-border" onClick={redo} disabled={!canRedo} title="Redo">
              <Redo2 size={16} />
            </Button>
          </div>
          {dirty && (
            <Button variant="ghost" onClick={discard} className="text-muted-foreground">Discard</Button>
          )}
          <Button variant={dirty ? 'outline' : 'default'} onClick={recalcPreview} disabled={runDry.isPending}>
            {runDry.isPending ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Zap size={16} className="mr-2" />}
            Recalculate Plan
          </Button>
          <Button onClick={commitPlan} disabled={!dirty || saveSchedule.isPending}>
            {saveSchedule.isPending ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Save size={16} className="mr-2" />}
            Save Plan
          </Button>
        </div>
      </div>

      <InlineFormSlot />

      {dirty && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle size={14} className="shrink-0" />
          Preview only — this plan is <strong>not saved</strong>. Review the Gantt, then <strong>Save Plan</strong> to commit, or Undo/Discard.
        </div>
      )}

      {/* KPI bar */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiTile icon={Clock} label="Makespan" value={m?.makespanHours ?? '—'} unit="h" color="#6366f1" />
        <KpiTile icon={CheckCircle2} label="On-time" value={m?.onTimePct ?? '—'} unit="%" color="#22c55e" hint={`${m?.onTimeOrders ?? 0} orders`} />
        <KpiTile icon={AlertTriangle} label="Late orders" value={m?.lateOrderCount ?? '—'} color={(m?.lateOrderCount ?? 0) > 0 ? '#ef4444' : '#22c55e'} />
        <KpiTile icon={Gauge} label="Utilization" value={m?.utilizationPct ?? '—'} unit="%" color="#a855f7" />
        <KpiTile icon={Cpu} label="Machines" value={m?.machinesUsed ?? '—'} color="#0ea5e9" />
        <KpiTile icon={PackageX} label="Unscheduled" value={plan?.unscheduled ?? '—'} color={(plan?.unscheduled ?? 0) > 0 ? '#f59e0b' : '#22c55e'} hint="ops without slot" />
      </div>

      {/* Factory Navigator Gantt */}
      {isLoading ? (
        <div className="rounded-xl border border-border/60 bg-card p-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="shimmer h-7 rounded" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">No scheduled operations yet.</p>
          <Button className="mt-3" onClick={recalcPreview} disabled={runDry.isPending}>
            <Zap size={16} className="mr-2" /> Generate the plan
          </Button>
        </div>
      ) : (
        <FactoryGantt
          title="Factory Navigator"
          tasks={tasks}
          resources={ganttResources}
          tree={tree}
          supply={supplyMarkers}
          demand={demandMarkers}
          rangeFrom={ganttRange!.from}
          rangeTo={ganttRange!.to}
          zoom={zoom}
          onZoomChange={setZoom}
          onTaskMove={handleMove}
          actions={[
            { label: 'Recalculate (preview)', icon: Zap, onClick: recalcPreview, disabled: runDry.isPending },
            { label: 'Undo', icon: Undo2, onClick: undo, disabled: !canUndo },
            { label: 'Redo', icon: Redo2, onClick: redo, disabled: !canRedo },
            { label: dirty ? 'Save Plan' : 'Saved', icon: Save, onClick: commitPlan, disabled: !dirty || saveSchedule.isPending },
          ]}
          insights={
            <div className="space-y-1.5 text-xs">
              <div className="font-semibold text-sm mb-2">Schedule KPIs</div>
              <div className="flex justify-between"><span className="text-muted-foreground">Makespan</span><strong>{m?.makespanHours ?? '—'} h</strong></div>
              <div className="flex justify-between"><span className="text-muted-foreground">On-time</span><strong className="text-emerald-500">{m?.onTimePct ?? '—'}%</strong></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Late orders</span><strong className={cn((m?.lateOrderCount ?? 0) > 0 ? 'text-destructive' : 'text-emerald-500')}>{m?.lateOrderCount ?? 0}</strong></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Utilization</span><strong>{m?.utilizationPct ?? '—'}%</strong></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Material shortages</span><strong className={cn(shortages.length > 0 ? 'text-destructive' : 'text-emerald-500')}>{shortages.length}</strong></div>
            </div>
          }
          onCtp={() => setCtpOpen(true)}
          statusExtra={`Not Scheduled: ${plan!.unscheduled} · drag = move · edge = resize · ◆ due · ● finish`}
        />
      )}

      {/* MRP / Late tabs */}
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <div className="flex items-center gap-1 border-b border-border/60 px-3 pt-2">
          <button onClick={() => setTab('mrp')}
            className={cn('px-3 py-2 text-sm rounded-t-md', tab === 'mrp' ? 'bg-muted/60 font-medium' : 'text-muted-foreground hover:bg-muted/30')}>
            <PackageX size={14} className="inline mr-1.5" /> Material Shortages {shortages.length > 0 && <Badge variant="destructive" className="ml-1.5 text-[10px]">{shortages.length}</Badge>}
          </button>
          <button onClick={() => setTab('late')}
            className={cn('px-3 py-2 text-sm rounded-t-md', tab === 'late' ? 'bg-muted/60 font-medium' : 'text-muted-foreground hover:bg-muted/30')}>
            <AlertTriangle size={14} className="inline mr-1.5" /> Late Orders {(m?.lateOrderCount ?? 0) > 0 && <Badge variant="destructive" className="ml-1.5 text-[10px]">{m?.lateOrderCount}</Badge>}
          </button>
        </div>

        {tab === 'mrp' ? (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">Material</th>
                <th className="px-4 py-2 font-medium text-right">Required</th>
                <th className="px-4 py-2 font-medium text-right">Available</th>
                <th className="px-4 py-2 font-medium text-right">Shortage</th>
                <th className="px-4 py-2 font-medium">Need by</th>
                <th className="px-4 py-2 font-medium">Order by</th>
              </tr>
            </thead>
            <tbody>
              {(mrp?.requirements ?? []).length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No open orders requiring materials.</td></tr>
              ) : mrp!.requirements.map((r) => (
                <tr key={r.materialId} className="border-t border-border/50">
                  <td className="px-4 py-2">{r.name} <span className="text-muted-foreground font-mono text-xs">{r.code}</span></td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.required} {r.unit}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.available} {r.unit}</td>
                  <td className={cn('px-4 py-2 text-right tabular-nums font-semibold', r.shortage > 0 ? 'text-destructive' : 'text-emerald-500')}>
                    {r.shortage > 0 ? `${r.shortage} ${r.unit}` : 'OK'}
                  </td>
                  <td className="px-4 py-2 text-xs">{new Date(r.requiredDate).toLocaleDateString()}</td>
                  <td className="px-4 py-2 text-xs">{r.suggestedOrderDate ? new Date(r.suggestedOrderDate).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">Work Order</th>
                <th className="px-4 py-2 font-medium">Finishes</th>
                <th className="px-4 py-2 font-medium">Due</th>
                <th className="px-4 py-2 font-medium text-right">Late by</th>
              </tr>
            </thead>
            <tbody>
              {(m?.lateOrders ?? []).length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-emerald-500">All scheduled orders are on time.</td></tr>
              ) : m!.lateOrders.map((o) => (
                <tr key={o.orderNumber} className="border-t border-border/50">
                  <td className="px-4 py-2 font-mono text-xs">{o.orderNumber}</td>
                  <td className="px-4 py-2 text-xs">{new Date(o.finish).toLocaleString()}</td>
                  <td className="px-4 py-2 text-xs">{o.due ? new Date(o.due).toLocaleString() : '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-destructive font-semibold">{o.lateHours}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CtpDialog open={ctpOpen} onOpenChange={setCtpOpen} />
    </div>
  );
}
