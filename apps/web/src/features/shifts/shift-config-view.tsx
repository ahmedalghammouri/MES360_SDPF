'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Clock, CalendarDays, Gauge, Target, Plus, Pencil, Trash2,
  CalendarPlus, Moon, Sun, AlertTriangle,
} from 'lucide-react';

import { TablePagination } from '@/components/ui/table-pagination';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { FormDialog } from '@/components/ui/form-dialog';
import { InlineFormSlot } from '@/components/ui/inline-form-panel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  DOW_LABELS, DOW_ORDER, type ShiftTemplate, type ShiftTemplateInput,
} from '@/services/shift.service';
import {
  useShiftConfig, useShiftTemplates, useShiftInstances,
  useCreateTemplate, useUpdateTemplate, useDeleteTemplate, useGenerateInstances,
} from './use-shifts';

// ── Form state ───────────────────────────────────────────────────────────────
type FormState = {
  code: string; name: string; nameAr: string;
  startTime: string; endTime: string;
  shiftDurationHours: string; plannedProductionHours: string;
  breakMinutes: string; cleaningMinutes: string;
  days: number[]; targetQtyPerShift: string; targetUnit: string; isActive: boolean;
};

const EMPTY: FormState = {
  code: '', name: '', nameAr: '',
  startTime: '07:30', endTime: '19:30',
  shiftDurationHours: '12', plannedProductionHours: '11',
  breakMinutes: '30', cleaningMinutes: '30',
  days: [6, 0, 1, 2, 3, 4], targetQtyPerShift: '3000', targetUnit: 'CARTON', isActive: true,
};

function toForm(t: ShiftTemplate): FormState {
  return {
    code: t.code, name: t.name, nameAr: t.nameAr ?? '',
    startTime: t.startTime, endTime: t.endTime,
    shiftDurationHours: String(t.shiftDurationHours),
    plannedProductionHours: String(t.plannedProductionHours),
    breakMinutes: String(t.breakMinutes), cleaningMinutes: String(t.cleaningMinutes),
    days: t.days ?? [], targetQtyPerShift: t.targetQtyPerShift != null ? String(t.targetQtyPerShift) : '',
    targetUnit: (t as any).targetUnit ?? 'CARTON',
    isActive: t.isActive,
  };
}

function toPayload(f: FormState): ShiftTemplateInput {
  return {
    code: f.code.trim(), name: f.name.trim(),
    nameAr: f.nameAr.trim() || undefined,
    startTime: f.startTime, endTime: f.endTime,
    shiftDurationHours: Number(f.shiftDurationHours),
    plannedProductionHours: Number(f.plannedProductionHours),
    breakMinutes: Number(f.breakMinutes) || 0,
    cleaningMinutes: Number(f.cleaningMinutes) || 0,
    days: f.days,
    targetQtyPerShift: f.targetQtyPerShift ? Number(f.targetQtyPerShift) : undefined,
    targetUnit: f.targetUnit,
    isActive: f.isActive,
  };
}

// ── Summary card ─────────────────────────────────────────────────────────────
function SummaryCard({ icon: Icon, label, value, hint, accent }: {
  icon: React.ElementType; label: string; value: React.ReactNode; hint?: string; accent: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', accent)}>
          <Icon size={16} />
        </div>
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function DayChips({ days }: { days: number[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {DOW_ORDER.map((d) => (
        <span
          key={d}
          className={cn(
            'text-[10px] px-1.5 py-0.5 rounded font-medium',
            days.includes(d) ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground/50',
          )}
        >
          {DOW_LABELS[d]}
        </span>
      ))}
    </div>
  );
}

// ── 24h coverage timeline: where every active shift sits in the day ─────────
function CoverageBar({ templates }: { templates: ShiftTemplate[] }) {
  const active = templates.filter((t) => t.isActive);
  if (active.length === 0) return null;
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const palette = ['bg-amber-500/70', 'bg-indigo-500/70', 'bg-emerald-500/70', 'bg-rose-500/70'];
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">24h Coverage</span>
        <span className="text-[10px] text-muted-foreground">
          {active.length} active shift{active.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="relative h-9 rounded-lg bg-muted/30 overflow-hidden">
        {/* hour ticks */}
        {[0, 6, 12, 18, 24].map((h) => (
          <div key={h} className="absolute top-0 bottom-0 border-l border-border/40" style={{ left: `${(h / 24) * 100}%` }} />
        ))}
        {active.map((t, i) => {
          const s = toMin(t.startTime);
          const e = toMin(t.endTime);
          const color = palette[i % palette.length];
          const seg = (left: number, width: number, rounded: string) => (
            <div
              key={`${t.id}-${left}`}
              title={`${t.name} ${t.startTime}–${t.endTime}`}
              className={cn('absolute top-1 bottom-1 flex items-center justify-center text-[9px] font-bold text-white/90 truncate px-1', color, rounded)}
              style={{ left: `${(left / 1440) * 100}%`, width: `${(width / 1440) * 100}%` }}
            >
              {width > 150 ? t.code : ''}
            </div>
          );
          // crosses midnight → two segments
          return e <= s
            ? [seg(s, 1440 - s, 'rounded-l-md'), seg(0, e, 'rounded-r-md')]
            : seg(s, e - s, 'rounded-md');
        })}
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground mt-1 px-0.5">
        {['00:00', '06:00', '12:00', '18:00', '24:00'].map((l) => <span key={l}>{l}</span>)}
      </div>
    </div>
  );
}

const INSTANCE_STATUSES = ['ALL', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;

// ── Main view ────────────────────────────────────────────────────────────────
export function ShiftConfigView() {
  const { data: config } = useShiftConfig();
  const { data: templates, isLoading } = useShiftTemplates(true);

  // Scheduled-shifts filters + server pagination
  const [instPage, setInstPage] = useState(1);
  const [instStatus, setInstStatus] = useState<(typeof INSTANCE_STATUSES)[number]>('ALL');
  useEffect(() => { setInstPage(1); }, [instStatus]);
  const { data: instancesResp } = useShiftInstances({
    limit: 15,
    page: instPage,
    status: instStatus === 'ALL' ? undefined : (instStatus as any),
  });

  const createMut = useCreateTemplate();
  const updateMut = useUpdateTemplate();
  const deleteMut = useDeleteTemplate();
  const generateMut = useGenerateInstances();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ShiftTemplate | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [deleting, setDeleting] = useState<ShiftTemplate | null>(null);

  const patch = (p: Partial<FormState>) => setForm((s) => ({ ...s, ...p }));

  const openCreate = () => { setEditing(null); setForm(EMPTY); setFormOpen(true); };
  const openEdit = (t: ShiftTemplate) => { setEditing(t); setForm(toForm(t)); setFormOpen(true); };

  const duration = Number(form.shiftDurationHours);
  const planned = Number(form.plannedProductionHours);
  const isValid =
    form.code.trim().length > 0 &&
    form.name.trim().length > 0 &&
    /^([01]\d|2[0-3]):([0-5]\d)$/.test(form.startTime) &&
    /^([01]\d|2[0-3]):([0-5]\d)$/.test(form.endTime) &&
    duration > 0 && planned >= 0 && planned <= duration &&
    form.days.length > 0;

  const submit = () => {
    const payload = toPayload(form);
    if (editing) {
      updateMut.mutate({ id: editing.id, body: payload }, { onSuccess: () => setFormOpen(false) });
    } else {
      createMut.mutate(payload, { onSuccess: () => setFormOpen(false) });
    }
  };

  const weekRange = () => {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { dateFrom: iso(today), dateTo: iso(new Date(today.getTime() + 6 * 86_400_000)) };
  };
  const generateWeek = () => generateMut.mutate({ ...weekRange(), withPlannedDowntime: true });

  const crossesMidnight = useMemo(
    () => form.endTime <= form.startTime,
    [form.startTime, form.endTime],
  );
  const plannedMinutes = Math.max(0, duration * 60 - (Number(form.breakMinutes) || 0) - (Number(form.cleaningMinutes) || 0));

  const instances = instancesResp?.data ?? [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Shift Configuration</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Define the shift model that segments every OEE, availability and production report.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={generateWeek} disabled={generateMut.isPending}>
            <CalendarPlus size={16} className="mr-2" />
            Generate this week
          </Button>
          <Button onClick={openCreate}>
            <Plus size={16} className="mr-2" />
            New Shift
          </Button>
        </div>
      </div>

      <InlineFormSlot />

      {/* Config summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard icon={Clock} label="Shifts / day" value={config?.shiftsPerDay ?? '—'}
          accent="bg-indigo-500/15 text-indigo-400" />
        <SummaryCard icon={CalendarDays} label="Working days / week" value={config?.workingDaysPerWeek ?? '—'}
          hint={config ? config.workingDays.map((d) => DOW_LABELS[d]).join(' · ') : undefined}
          accent="bg-emerald-500/15 text-emerald-400" />
        <SummaryCard icon={Gauge} label="Planned production hrs / day" value={config?.plannedProductionHoursPerDay ?? '—'}
          accent="bg-amber-500/15 text-amber-400" />
        <SummaryCard icon={Target} label="Target / shift"
          value={config?.shifts?.[0]?.targetQtyPerShift ?? '—'}
          hint="boxes / packs" accent="bg-rose-500/15 text-rose-400" />
      </div>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates">Shift Templates</TabsTrigger>
          <TabsTrigger value="instances">Scheduled Shifts</TabsTrigger>
        </TabsList>

        {/* Templates */}
        <TabsContent value="templates" className="space-y-3 mt-4">
          <CoverageBar templates={templates ?? []} />
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading shifts…</div>
          ) : (templates ?? []).length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
              No shift templates yet. Click <strong>New Shift</strong> to define one.
            </div>
          ) : (
            (templates ?? []).map((t) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'rounded-xl border bg-card p-4 flex items-center gap-4',
                  t.isActive ? 'border-border/60' : 'border-border/40 opacity-60',
                )}
              >
                <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
                  t.crossesMidnight ? 'bg-indigo-500/15 text-indigo-400' : 'bg-amber-500/15 text-amber-400')}>
                  {t.crossesMidnight ? <Moon size={18} /> : <Sun size={18} />}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{t.name}</span>
                    <Badge variant="outline" className="text-[10px] font-mono">{t.code}</Badge>
                    {!t.isActive && <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}
                    {t.crossesMidnight && <Badge variant="secondary" className="text-[10px]">Crosses midnight</Badge>}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1 flex-wrap">
                    <span className="flex items-center gap-1"><Clock size={12} />{t.startTime}–{t.endTime}</span>
                    <span>{t.plannedProductionHours}h planned / {t.shiftDurationHours}h</span>
                    <span>Break {t.breakMinutes}m · Clean {t.cleaningMinutes}m</span>
                    {t.targetQtyPerShift != null && <span className="flex items-center gap-1"><Target size={12} />{t.targetQtyPerShift}</span>}
                    <span>{t.instanceCount} scheduled</span>
                  </div>
                  <div className="mt-2"><DayChips days={t.days} /></div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)}>
                    <Pencil size={15} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleting(t)}>
                    <Trash2 size={15} />
                  </Button>
                </div>
              </motion.div>
            ))
          )}
        </TabsContent>

        {/* Instances */}
        <TabsContent value="instances" className="mt-4 space-y-3">
          {/* Status filter */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {INSTANCE_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setInstStatus(s)}
                className={cn(
                  'px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors',
                  instStatus === s
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {s === 'ALL' ? 'All' : s.replace('_', ' ').toLowerCase()}
              </button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground">
              {(instancesResp as any)?.total ?? instances.length} shift instance{(((instancesResp as any)?.total ?? instances.length) !== 1) ? 's' : ''}
            </span>
          </div>
          <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr className="text-left">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Shift</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium text-right">Target</th>
                  <th className="px-4 py-2 font-medium text-right">Actual</th>
                  <th className="px-4 py-2 font-medium text-right">OEE</th>
                  <th className="px-4 py-2 font-medium">Operator</th>
                </tr>
              </thead>
              <tbody>
                {instances.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No scheduled shifts. Use <strong>Generate this week</strong>.
                  </td></tr>
                ) : instances.map((i) => (
                  <tr key={i.id} className="border-t border-border/50">
                    <td className="px-4 py-2 tabular-nums">{i.shiftDate.slice(0, 10)}</td>
                    <td className="px-4 py-2">{i.shiftTemplate.name} <span className="text-muted-foreground font-mono text-xs">{i.shiftTemplate.code}</span></td>
                    <td className="px-4 py-2">
                      <Badge variant={i.status === 'COMPLETED' ? 'secondary' : i.status === 'IN_PROGRESS' ? 'default' : 'outline'} className="text-[10px]">
                        {i.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{i.targetQty ?? '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{i.actualQty}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{i.oee != null ? `${i.oee}%` : '—'}</td>
                    <td className="px-4 py-2">{i.operator?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(((instancesResp as any)?.total ?? 0) > 15) && (
              <div className="border-t border-border/50 px-4 py-2">
                <TablePagination page={instPage} total={(instancesResp as any)?.total ?? 0} limit={15} onPageChange={setInstPage} />
              </div>
            )}
          </div>
        </TabsContent>

      </Tabs>

      {/* Create / Edit form */}
      <FormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit Shift — ${editing.name}` : 'New Shift'}
        onSubmit={submit}
        submitLabel={editing ? 'Save changes' : 'Create shift'}
        isSubmitting={createMut.isPending || updateMut.isPending}
        isValid={isValid}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Code</Label>
            <Input value={form.code} onChange={(e) => patch({ code: e.target.value })} placeholder="S1" />
          </div>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Day Shift" />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label>Name (Arabic)</Label>
            <Input value={form.nameAr} onChange={(e) => patch({ nameAr: e.target.value })} placeholder="الوردية الصباحية" dir="rtl" />
          </div>

          <div className="space-y-1.5">
            <Label>Start time</Label>
            <Input type="time" value={form.startTime} onChange={(e) => patch({ startTime: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>End time</Label>
            <Input type="time" value={form.endTime} onChange={(e) => patch({ endTime: e.target.value })} />
          </div>

          <div className="space-y-1.5">
            <Label>Shift duration (hrs)</Label>
            <Input type="number" step="0.5" value={form.shiftDurationHours} onChange={(e) => patch({ shiftDurationHours: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Planned production (hrs)</Label>
            <Input type="number" step="0.5" value={form.plannedProductionHours} onChange={(e) => patch({ plannedProductionHours: e.target.value })} />
          </div>

          <div className="space-y-1.5">
            <Label>Break (min)</Label>
            <Input type="number" value={form.breakMinutes} onChange={(e) => patch({ breakMinutes: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Cleaning (min)</Label>
            <Input type="number" value={form.cleaningMinutes} onChange={(e) => patch({ cleaningMinutes: e.target.value })} />
          </div>

          <div className="space-y-1.5 col-span-2">
            <Label>Target qty / shift</Label>
            <Input type="number" value={form.targetQtyPerShift} onChange={(e) => patch({ targetQtyPerShift: e.target.value })} placeholder="3000" />
            {/* Unit of the target — used to convert per-step targets & finished output */}
            <div className="flex items-center gap-2 pt-1">
              {[
                { value: 'PIECE', label: 'PCS' },
                { value: 'INNER', label: 'INNER' },
                { value: 'CARTON', label: 'CARTON' },
                { value: 'PALLET', label: 'PALLET' },
              ].map((u) => (
                <button
                  key={u.value}
                  type="button"
                  onClick={() => patch({ targetUnit: u.value })}
                  className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                    form.targetUnit === u.value
                      ? 'border-brand-400 bg-brand-500/15 text-brand-400'
                      : 'border-border bg-muted/40 text-muted-foreground hover:border-brand-400/40'
                  }`}
                >
                  {u.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              The target unit defines the finished-goods unit. Per-step targets are auto-converted
              from this via the product packaging (e.g. cartons → inners / pallets).
            </p>
          </div>

          <div className="space-y-2 col-span-2">
            <Label>Working days</Label>
            <div className="flex flex-wrap gap-1.5">
              {DOW_ORDER.map((d) => {
                const on = form.days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => patch({ days: on ? form.days.filter((x) => x !== d) : [...form.days, d] })}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                      on ? 'bg-primary/15 text-primary border-primary/40' : 'bg-muted/40 text-muted-foreground border-border',
                    )}
                  >
                    {DOW_LABELS[d]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 col-span-2">
            <Checkbox id="isActive" checked={form.isActive} onCheckedChange={(v) => patch({ isActive: !!v })} />
            <Label htmlFor="isActive" className="font-normal cursor-pointer">Active</Label>
          </div>
        </div>

        {/* Live computed feedback */}
        <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
          <div>Planned production window: <strong className="text-foreground">{plannedMinutes} min</strong> (duration − break − cleaning) — this is the OEE availability denominator.</div>
          {crossesMidnight && <div className="flex items-center gap-1 text-indigo-400"><Moon size={12} /> This shift crosses midnight.</div>}
          {planned > duration && <div className="flex items-center gap-1 text-destructive"><AlertTriangle size={12} /> Planned hours cannot exceed shift duration.</div>}
        </div>
      </FormDialog>

      {/* Delete confirm */}
      <FormDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'shift'}?`}
        onSubmit={() => deleting && deleteMut.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
        submitLabel="Delete"
        isSubmitting={deleteMut.isPending}
      >
        <p className="text-sm text-muted-foreground">
          {deleting && deleting.instanceCount > 0
            ? `This shift has ${deleting.instanceCount} scheduled instance(s), so it will be deactivated (history preserved) rather than deleted.`
            : 'This shift template will be permanently deleted.'}
        </p>
      </FormDialog>

    </div>
  );
}
