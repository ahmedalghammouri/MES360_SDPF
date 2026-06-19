'use client';
import { useTranslation } from 'react-i18next';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Plus, Search, ChevronRight, ArrowRight, AlertCircle,
  CheckCircle2, Clock, Package, Cpu, SendHorizonal,
  ClipboardList, RefreshCw, PauseCircle, XCircle, Trash2,
  Pencil, Play, MoreHorizontal, Zap, Eye, ChevronDown,
  BarChart3, User, TrendingUp, Info, Layers, GitBranch,
  CheckSquare, Circle, Loader2, AlertTriangle, CalendarClock,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EntityPicker } from '@/components/ui/entity-picker';
import { useScope } from '@/hooks/use-scope';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { AutoGenerateWODialog } from './auto-generate-wo-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { SortableHeader } from '@/components/ui/sortable-header';
import { useSortedData } from '@/lib/use-sorted-data';
import { TablePagination } from '@/components/ui/table-pagination';
import { ExportMenu } from '@/components/ui/export-menu';
import { ArchiveFilter, type ArchiveScope } from '@/components/ui/archive-filter';
import { useArchive } from '@/hooks/use-archive';
import { Archive as ArchiveIcon, RotateCcw } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { useRowSelection } from '@/hooks/use-row-selection';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type POStatus = 'PLANNED' | 'RELEASED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'ON_HOLD';
type WOStatus = 'PLANNED' | 'RELEASED' | 'IN_PROGRESS' | 'COMPLETED' | 'ON_HOLD' | 'CANCELLED';
type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface WorkOrderRef {
  id: string; orderNumber: string; status: WOStatus;
  plannedQty: number; actualQty: number; goodQty: number;
  machine?: { name: string }; operator?: { name: string };
  plannedStart: string | null; plannedEnd: string | null;
}

interface ProductionOrder {
  id: string; orderNumber: string; sapOrderNumber?: string;
  status: POStatus; priority: Priority;
  targetQty: number; completedQty: number; unit: string;
  customer?: string; plannedStart: string; plannedEnd: string;
  actualStart?: string; actualEnd?: string; notes?: string;
  sku?: { id: string; name: string; code: string; itemNumber: string };
  workOrders: WorkOrderRef[];
  createdAt: string;
}

type JOStatus = 'SCHEDULED' | 'READY' | 'EXECUTING' | 'PAUSED' | 'COMPLETE' | 'CANCELLED';

interface JobOrder {
  id: string;
  sequenceOrder: number;
  operationName: string;
  status: JOStatus;
  machine?: { name: string; code: string };
  workCenter?: { name: string; code: string };
  plannedStart?: string | null;
  plannedEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  plannedQtyIn?: number | null;
  plannedQtyOut?: number | null;
  outputUnit?: string | null;
  actualQtyGood: number;
  actualQtyRejected: number;
  handoverQty: number;
  idealCycleTimeSec?: number | null;
  notes?: string | null;
}

// ─────────────────────────────────────────────────────────────
// Status / Priority config
// ─────────────────────────────────────────────────────────────

const PO_STATUS: Record<POStatus, { label: string; color: string; bg: string; icon: any }> = {
  PLANNED:     { label: 'Planned',     color: 'text-slate-400',  bg: 'bg-slate-500/15',  icon: Clock        },
  RELEASED:    { label: 'Released',    color: 'text-blue-400',   bg: 'bg-blue-500/15',   icon: SendHorizonal },
  IN_PROGRESS: { label: 'In Progress', color: 'text-brand-400',  bg: 'bg-brand-500/15',  icon: RefreshCw    },
  COMPLETED:   { label: 'Completed',   color: 'text-green-400',  bg: 'bg-green-500/15',  icon: CheckCircle2 },
  ON_HOLD:     { label: 'On Hold',     color: 'text-amber-400',  bg: 'bg-amber-500/15',  icon: PauseCircle  },
  CANCELLED:   { label: 'Cancelled',   color: 'text-red-400',    bg: 'bg-red-500/15',    icon: XCircle      },
};

const WO_STATUS: Record<WOStatus, { label: string; color: string; bar: string }> = {
  PLANNED:     { label: 'Planned',     color: 'text-slate-400', bar: 'bg-slate-500'  },
  RELEASED:    { label: 'Released',    color: 'text-blue-400',  bar: 'bg-blue-500'   },
  IN_PROGRESS: { label: 'Running',     color: 'text-brand-400', bar: 'bg-brand-500'  },
  COMPLETED:   { label: 'Completed',   color: 'text-green-400', bar: 'bg-green-500'  },
  ON_HOLD:     { label: 'On Hold',     color: 'text-amber-400', bar: 'bg-amber-500'  },
  CANCELLED:   { label: 'Cancelled',   color: 'text-red-400',   bar: 'bg-red-500'    },
};

const PRI_CLS: Record<Priority, string> = {
  CRITICAL: 'border-red-500 text-red-400',
  HIGH:     'border-orange-500 text-orange-400',
  MEDIUM:   'border-yellow-500 text-yellow-400',
  LOW:      'border-slate-500 text-slate-400',
};

const JO_STATUS: Record<JOStatus, { label: string; color: string; bg: string; dot: string }> = {
  SCHEDULED: { label: 'Scheduled', color: 'text-slate-400',  bg: 'bg-slate-500/15',  dot: 'bg-slate-500'  },
  READY:     { label: 'Ready',     color: 'text-blue-400',   bg: 'bg-blue-500/15',   dot: 'bg-blue-500'   },
  EXECUTING: { label: 'Running',   color: 'text-brand-400',  bg: 'bg-brand-500/15',  dot: 'bg-brand-500'  },
  PAUSED:    { label: 'Paused',    color: 'text-amber-400',  bg: 'bg-amber-500/15',  dot: 'bg-amber-500'  },
  COMPLETE:  { label: 'Complete',  color: 'text-green-400',  bg: 'bg-green-500/15',  dot: 'bg-green-500'  },
  CANCELLED: { label: 'Cancelled', color: 'text-red-400',    bg: 'bg-red-500/15',    dot: 'bg-red-500'    },
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function fmt(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function toLocalInput(iso?: string | null) {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 16);
}

function poProgress(po: ProductionOrder) {
  if (po.status === 'COMPLETED') return 100;
  if (po.status === 'PLANNED' || po.status === 'CANCELLED') return 0;
  const qty = po.workOrders.reduce((s, w) => s + (w.goodQty || w.actualQty || 0), 0);
  if (po.targetQty > 0 && qty > 0) return Math.min(99, Math.round((qty / po.targetQty) * 100));
  return po.status === 'IN_PROGRESS' ? 5 : 0;
}

function woProgress(wo: WorkOrderRef) {
  if (wo.status === 'COMPLETED') return 100;
  const done = wo.goodQty || wo.actualQty || 0;
  if (wo.plannedQty > 0 && done > 0) return Math.min(99, Math.round((done / wo.plannedQty) * 100));
  return wo.status === 'IN_PROGRESS' ? 5 : 0;
}

// ─────────────────────────────────────────────────────────────
// PO Form (Create + Edit)
// ─────────────────────────────────────────────────────────────

interface POFormDialogProps {
  open: boolean; onClose: () => void;
  initial?: ProductionOrder | null;
}

function POFormDialog({ open, onClose, initial }: POFormDialogProps) {
  const { t } = useTranslation(['production', 'common']);
  const isEdit = !!initial;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    orderNumber:    initial?.orderNumber ?? '',
    sapOrderNumber: initial?.sapOrderNumber ?? '',
    skuId:          initial?.sku?.id ?? '',
    targetQty:      String(initial?.targetQty ?? ''),
    unit:           initial?.unit ?? 'CARTON',
    priority:       initial?.priority ?? 'MEDIUM',
    plannedStart:   toLocalInput(initial?.plannedStart),
    plannedEnd:     toLocalInput(initial?.plannedEnd),
    customer:       initial?.customer ?? '',
    notes:          initial?.notes ?? '',
  });

  React.useEffect(() => {
    if (open) setForm({
      orderNumber:    initial?.orderNumber ?? '',
      sapOrderNumber: initial?.sapOrderNumber ?? '',
      skuId:          initial?.sku?.id ?? '',
      targetQty:      String(initial?.targetQty ?? ''),
      unit:           initial?.unit ?? 'CARTON',
      priority:       initial?.priority ?? 'MEDIUM',
      plannedStart:   toLocalInput(initial?.plannedStart),
      plannedEnd:     toLocalInput(initial?.plannedEnd),
      customer:       initial?.customer ?? '',
      notes:          initial?.notes ?? '',
    });
  }, [open, initial]);

  const { data: skusData } = useQuery({
    queryKey: ['skus-for-po'],
    queryFn: () => api.get('/inventory/products', { params: { limit: 200 } }),
    enabled: open, staleTime: 60_000,
  });
  const skus: any[] = (skusData as any)?.data ?? (skusData as any) ?? [];

  const mut = useMutation({
    mutationFn: (dto: any) => isEdit
      ? api.patch(`/production/production-orders/${initial!.id}`, dto)
      : api.post('/production/production-orders', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      toast({ title: isEdit ? 'PO updated' : 'PO created', description: form.orderNumber });
      onClose();
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Error', description: e?.response?.data?.message ?? 'Failed' }),
  });

  function handleSubmit() {
    if (!form.orderNumber || !form.skuId || !form.targetQty || !form.plannedStart || !form.plannedEnd) {
      toast({ variant: 'destructive', title: 'Required fields missing' }); return;
    }
    const dto: any = {
      targetQty: parseInt(form.targetQty, 10),
      unit: form.unit, priority: form.priority,
      plannedStart: new Date(form.plannedStart).toISOString(),
      plannedEnd:   new Date(form.plannedEnd).toISOString(),
      customer:     form.customer || undefined,
      notes:        form.notes || undefined,
    };
    if (!isEdit) {
      dto.orderNumber    = form.orderNumber;
      dto.sapOrderNumber = form.sapOrderNumber || undefined;
      dto.skuId          = form.skuId;
    }
    mut.mutate(dto);
  }

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <InlineFormPanel
      open={open}
      onClose={onClose}
      icon={ClipboardList}
      title={isEdit ? t('poform.editTitle', { order: initial?.orderNumber }) : t('poform.createTitle')}
      description={isEdit ? t('poform.editDesc') : t('poform.createDesc')}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('poform.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={mut.isPending}>
            {mut.isPending ? t('poform.saving') : isEdit ? t('poform.saveChanges') : t('poform.createPo')}
          </Button>
        </>
      )}
    >
        <div className="grid grid-cols-2 gap-4">
          {!isEdit && (
            <>
              <div className="space-y-1.5">
                <Label>{t('poform.poNumber')} *</Label>
                <Input placeholder="PO-NCC-1055" value={form.orderNumber} onChange={e => set('orderNumber', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('poform.sapRef')}</Label>
                <Input placeholder="SAP-4500012345" value={form.sapOrderNumber} onChange={e => set('sapOrderNumber', e.target.value)} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>{t('poform.product')} *</Label>
                <EntityPicker
                  items={skus}
                  value={form.skuId}
                  onChange={id => set('skuId', id ?? '')}
                  getId={(s: any) => s.id}
                  getPrimary={(s: any) => s.name}
                  getSecondary={(s: any) => s.itemNumber}
                  placeholder={t('poform.selectProduct')}
                  searchPlaceholder={t('poform.searchProduct')}
                  clearable={false}
                />
              </div>
            </>
          )}

          {isEdit && (
            <div className="col-span-2 p-3 glass-card rounded-lg">
              <p className="text-xs text-muted-foreground">{t('poform.productLabel')}</p>
              <p className="text-sm font-medium mt-0.5">{initial?.sku?.name}</p>
              <p className="text-xs font-mono text-muted-foreground">{initial?.sku?.itemNumber}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{t('poform.targetQty')} *</Label>
            <Input type="number" min={1} placeholder="1000" value={form.targetQty} onChange={e => set('targetQty', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('poform.unit')}</Label>
            <Select value={form.unit} onValueChange={v => set('unit', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['CARTON', 'BOX', 'PALLET', 'KG', 'PIECE'].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t('poform.priority')} *</Label>
            <Select value={form.priority} onValueChange={v => set('priority', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(p => <SelectItem key={p} value={p}>{t(`common:priority.${p}`, { defaultValue: p })}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t('poform.customer')}</Label>
            <Input placeholder={t('poform.customerPlaceholder')} value={form.customer} onChange={e => set('customer', e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>{t('poform.plannedStart')} *</Label>
            <Input type="datetime-local" value={form.plannedStart} onChange={e => set('plannedStart', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('poform.plannedEnd')} *</Label>
            <Input type="datetime-local" value={form.plannedEnd} onChange={e => set('plannedEnd', e.target.value)} />
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label>{t('poform.notes')}</Label>
            <Textarea placeholder={t('poform.notesPlaceholder')} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>
    </InlineFormPanel>
  );
}

// ─────────────────────────────────────────────────────────────
// Confirm-with-reason dialog (hold / cancel)
// ─────────────────────────────────────────────────────────────

interface ReasonDialogProps {
  open: boolean; onClose: () => void;
  title: string; description: string; confirmLabel: string; confirmVariant?: 'default' | 'destructive';
  onConfirm: (reason: string) => void; loading?: boolean;
}

function ReasonDialog({ open, onClose, title, description, confirmLabel, confirmVariant = 'default', onConfirm, loading }: ReasonDialogProps) {
  const { t } = useTranslation(['production', 'common']);
  const [reason, setReason] = useState('');
  React.useEffect(() => { if (!open) setReason(''); }, [open]);
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Label className="mb-1.5 block">{t('poform.reason')} *</Label>
          <Textarea
            rows={3} placeholder={t('poform.reasonPlaceholder')}
            value={reason} onChange={e => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('poform.cancel')}</Button>
          <Button variant={confirmVariant} onClick={() => onConfirm(reason)} disabled={loading || reason.trim().length < 3}>
            {loading ? t('poform.processing') : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Simple confirm dialog (complete / delete / resume)
// ─────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  open: boolean; onClose: () => void;
  title: string; description: string; confirmLabel: string; confirmVariant?: 'default' | 'destructive';
  onConfirm: () => void; loading?: boolean;
}

function ConfirmDialog({ open, onClose, title, description, confirmLabel, confirmVariant = 'default', onConfirm, loading }: ConfirmDialogProps) {
  const { t } = useTranslation(['production', 'common']);
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={onClose}>{t('poform.cancel')}</Button>
          <Button variant={confirmVariant} onClick={onConfirm} disabled={loading}>
            {loading ? t('poform.processing') : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Create WO from PO Dialog (manual)
// ─────────────────────────────────────────────────────────────

interface CreateWODialogProps { po: ProductionOrder; open: boolean; onClose: () => void; }

function CreateWODialog({ po, open, onClose }: CreateWODialogProps) {
  const { t } = useTranslation(['production', 'common']);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    plannedQty: String(po.targetQty), priority: po.priority,
    plannedStart: '', plannedEnd: '', notes: '',
  });

  const mut = useMutation({
    mutationFn: (dto: any) => api.post(`/production/production-orders/${po.id}/work-orders`, dto),
    onSuccess: (wo: any) => {
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: ['production', 'work-orders'] });
      qc.invalidateQueries({ queryKey: ['production', 'kpis'] });
      toast({ title: 'Work order created', description: `${wo?.orderNumber ?? 'WO'} → ${po.orderNumber}` });
      onClose();
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Error', description: e?.response?.data?.message ?? 'Failed' }),
  });

  function handleSubmit() {
    if (!form.plannedQty || !form.plannedStart || !form.plannedEnd) {
      toast({ variant: 'destructive', title: 'Required fields missing' }); return;
    }
    mut.mutate({
      plannedQty: parseInt(form.plannedQty, 10),
      priority: form.priority,
      plannedStart: new Date(form.plannedStart).toISOString(),
      plannedEnd:   new Date(form.plannedEnd).toISOString(),
      notes: form.notes || undefined,
    });
  }

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <InlineFormPanel
      open={open}
      onClose={onClose}
      icon={ClipboardList}
      title={t('mwoform.title', { order: po.orderNumber })}
      description={t('mwoform.desc', { product: po.sku?.name, qty: po.targetQty.toLocaleString(), unit: po.unit })}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('mwoform.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={mut.isPending}>{mut.isPending ? t('mwoform.creating') : t('mwoform.createWo')}</Button>
        </>
      )}
    >
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>{t('mwoform.plannedQty')} *</Label>
            <Input type="number" min={1} value={form.plannedQty} onChange={e => set('plannedQty', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('mwoform.priority')}</Label>
            <Select value={form.priority} onValueChange={v => set('priority', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{['LOW','MEDIUM','HIGH','CRITICAL'].map(p => <SelectItem key={p} value={p}>{t(`common:priority.${p}`, { defaultValue: p })}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t('mwoform.plannedStart')} *</Label>
            <Input type="datetime-local" value={form.plannedStart} onChange={e => set('plannedStart', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('mwoform.plannedEnd')} *</Label>
            <Input type="datetime-local" value={form.plannedEnd} onChange={e => set('plannedEnd', e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>{t('mwoform.notes')}</Label>
            <Input placeholder={t('mwoform.optional')} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>
    </InlineFormPanel>
  );
}

// ─────────────────────────────────────────────────────────────
// Auto-Generate WOs Dialog
// ─────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────
// PO Action Menu (inline in table row and detail sheet)
// ─────────────────────────────────────────────────────────────

interface POActionsProps {
  po: ProductionOrder;
  onEdit: () => void;
  onDelete: () => void;
  onRelease: () => void;
  onHold: () => void;
  onResume: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onCreateWO: () => void;
  onAutoGen: () => void;
  onArchive: () => void;
  onRestore: () => void;
}

function POActionMenu({ po, onEdit, onDelete, onRelease, onHold, onResume, onComplete, onCancel, onCreateWO, onAutoGen, onArchive, onRestore }: POActionsProps) {
  const { t } = useTranslation(['production', 'common']);
  const s = po.status;
  const canEdit    = !['COMPLETED', 'CANCELLED'].includes(s);
  const canDelete  = ['PLANNED', 'CANCELLED'].includes(s);
  const canRelease = s === 'PLANNED';
  const canHold    = ['RELEASED', 'IN_PROGRESS'].includes(s);
  const canResume  = s === 'ON_HOLD';
  const canComplete = s === 'IN_PROGRESS';
  const canCancel  = !['COMPLETED', 'CANCELLED'].includes(s);
  const canAddWO   = ['RELEASED', 'IN_PROGRESS'].includes(s);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => e.stopPropagation()}>
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {canEdit     && <DropdownMenuItem onClick={onEdit}><Pencil className="w-3.5 h-3.5 me-2" />{t('pomenu.editPo')}</DropdownMenuItem>}
        {canRelease  && <DropdownMenuItem onClick={onRelease}><SendHorizonal className="w-3.5 h-3.5 me-2 text-blue-400" />{t('pomenu.release')}</DropdownMenuItem>}
        {canHold     && <DropdownMenuItem onClick={onHold}><PauseCircle className="w-3.5 h-3.5 me-2 text-amber-400" />{t('pomenu.putOnHold')}</DropdownMenuItem>}
        {canResume   && <DropdownMenuItem onClick={onResume}><Play className="w-3.5 h-3.5 me-2 text-green-400" />{t('pomenu.resume')}</DropdownMenuItem>}
        {canComplete && <DropdownMenuItem onClick={onComplete}><CheckCircle2 className="w-3.5 h-3.5 me-2 text-green-400" />{t('pomenu.markCompleted')}</DropdownMenuItem>}
        {canAddWO    && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onCreateWO}><Plus className="w-3.5 h-3.5 me-2" />{t('pomenu.addWoManual')}</DropdownMenuItem>
            <DropdownMenuItem onClick={onAutoGen}><Zap className="w-3.5 h-3.5 me-2 text-yellow-400" />{t('pomenu.autoGenWos')}</DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        {(po as any).archivedAt
          ? <DropdownMenuItem onClick={onRestore}><RotateCcw className="w-3.5 h-3.5 me-2" />{t('pomenu.restore')}</DropdownMenuItem>
          : <DropdownMenuItem onClick={onArchive}><ArchiveIcon className="w-3.5 h-3.5 me-2" />{t('pomenu.archive')}</DropdownMenuItem>}
        {(canCancel || canDelete) && <DropdownMenuSeparator />}
        {canCancel   && <DropdownMenuItem onClick={onCancel} className="text-orange-400 focus:text-orange-400"><XCircle className="w-3.5 h-3.5 me-2" />{t('pomenu.cancelPo')}</DropdownMenuItem>}
        {canDelete   && <DropdownMenuItem onClick={onDelete} className="text-red-400 focus:text-red-400"><Trash2 className="w-3.5 h-3.5 me-2" />{t('pomenu.delete')}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─────────────────────────────────────────────────────────────
// WOs list with expandable dispatch list per WO
// ─────────────────────────────────────────────────────────────

interface WOsWithDispatchProps {
  po: ProductionOrder;
  actions: Omit<POActionsProps, 'po'>;
}

function WOsWithDispatch({ po, actions }: WOsWithDispatchProps) {
  const { t } = useTranslation(['production', 'common']);
  const [expandedWO, setExpandedWO] = useState<string | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold">{t('podetail.workOrders')} ({po.workOrders.length})</p>
        {['RELEASED', 'IN_PROGRESS'].includes(po.status) && (
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={actions.onCreateWO}>
              <Plus className="w-3 h-3 me-1" /> {t('podetail.manual')}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10" onClick={actions.onAutoGen}>
              <Zap className="w-3 h-3 me-1" /> {t('podetail.autoGenerate')}
            </Button>
          </div>
        )}
      </div>

      {po.workOrders.length === 0 ? (
        <div className="glass-card rounded-lg p-4 text-center text-sm text-muted-foreground">
          <ClipboardList className="w-6 h-6 mx-auto mb-2 opacity-40" />
          {po.status === 'PLANNED' ? t('podetail.releaseFirst') : t('podetail.noWosYet')}
        </div>
      ) : (
        <div className="space-y-2">
          {po.workOrders.map(wo => {
            const wcfg = WO_STATUS[wo.status] ?? { label: wo.status, color: 'text-muted-foreground', bar: 'bg-slate-500' };
            const pct = woProgress(wo);
            const isExpanded = expandedWO === wo.id;

            return (
              <div key={wo.id} className={cn(
                'glass-card rounded-lg border transition-colors',
                isExpanded ? 'border-brand-500/30' : 'border-foreground/5',
              )}>
                {/* WO header row */}
                <button
                  className="w-full text-left p-3"
                  onClick={() => setExpandedWO(isExpanded ? null : wo.id)}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <ChevronDown className={cn(
                        'w-3 h-3 text-muted-foreground transition-transform shrink-0',
                        isExpanded && 'rotate-180',
                      )} />
                      <span className="font-mono text-xs text-blue-300">{wo.orderNumber}</span>
                    </div>
                    <span className={cn('text-[10px] font-medium', wcfg.color)}>{t(`podetail.woStatus.${wo.status}`, { defaultValue: wcfg.label })}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-1.5 ps-5">
                    <span>{wo.plannedQty.toLocaleString()} {t('podetail.unitsSuffix')}</span>
                    <span className="flex items-center gap-1 text-brand-400/60">
                      <Layers className="w-3 h-3" />{t('podetail.dispatchList')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pl-5">
                    <div className="flex-1 h-1 rounded-full bg-foreground/10 overflow-hidden">
                      <div className={cn('h-full rounded-full', wcfg.bar)} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground w-7 shrink-0">{pct}%</span>
                  </div>
                </button>

                {/* Expandable dispatch list */}
                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-foreground/5 pt-2">
                    <DispatchListPanel
                      woId={wo.id}
                      woStatus={wo.status}
                      plannedStart={wo.plannedStart}
                      plannedEnd={wo.plannedEnd}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PO Detail Sheet
// ─────────────────────────────────────────────────────────────

interface PODetailSheetProps {
  po: ProductionOrder | null; open: boolean; onClose: () => void;
  actions: Omit<POActionsProps, 'po'>;
}

function PODetailSheet({ po, open, onClose, actions }: PODetailSheetProps) {
  const { t } = useTranslation(['production', 'common']);
  if (!po) return null;
  const cfg = PO_STATUS[po.status];
  const StatusIcon = cfg.icon;
  const progress = poProgress(po);

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-mono">{po.orderNumber}</p>
              {po.sapOrderNumber && <p className="text-[10px] text-muted-foreground">SAP: {po.sapOrderNumber}</p>}
            </div>
            <div className="flex items-center gap-2">
              <div className={cn('flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full', cfg.bg, cfg.color)}>
                <StatusIcon className="w-3.5 h-3.5" /> {t(`po.status.${po.status}`, { defaultValue: cfg.label })}
              </div>
              <POActionMenu po={po} {...actions} />
            </div>
          </div>
          <SheetTitle className="text-lg">{po.sku?.name ?? t('podetail.unknownProduct')}</SheetTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={cn('text-xs', PRI_CLS[po.priority])}>{t(`common:priority.${po.priority}`, { defaultValue: po.priority })}</Badge>
            {po.customer && <Badge variant="secondary" className="text-xs">{po.customer}</Badge>}
            <Badge variant="outline" className="text-xs font-mono">{po.sku?.itemNumber}</Badge>
          </div>
        </SheetHeader>

        <div className="py-4 space-y-4">
          {/* Progress */}
          <div className="glass-card rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{t('podetail.overallProgress')}</span>
              <span className="text-sm font-bold">{progress}%</span>
            </div>
            <div className="h-2 rounded-full bg-foreground/10 overflow-hidden">
              <div className={cn('h-full rounded-full transition-all', {
                'bg-green-500': po.status === 'COMPLETED',
                'bg-brand-500': po.status === 'IN_PROGRESS',
                'bg-blue-500': po.status === 'RELEASED',
                'bg-amber-500': po.status === 'ON_HOLD',
                'bg-slate-500': ['PLANNED','CANCELLED'].includes(po.status),
              })} style={{ width: `${progress}%` }} />
            </div>
            <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
              <span>{po.completedQty.toLocaleString()} / {po.targetQty.toLocaleString()} {po.unit}</span>
              <span>{po.workOrders.filter(w => w.status !== 'CANCELLED').length} {t('podetail.wosSuffix')}</span>
            </div>
          </div>

          {/* OEE — rolled up from the PO's work orders (JO→WO→PO engine) */}
          {(po as any).oee != null && (
            <div className="glass-card rounded-lg p-4">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs text-muted-foreground">{t('podetail.oeeRolled')}</span>
                <span className={cn('text-sm font-bold',
                  (po as any).oee >= 85 ? 'text-green-400' : (po as any).oee >= 65 ? 'text-brand-400' : (po as any).oee >= 45 ? 'text-amber-400' : 'text-red-400',
                )}>{(po as any).oee}%</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {([['cards.availability', (po as any).availability], ['cards.performance', (po as any).performance], ['cards.quality', (po as any).quality]] as const).map(([label, val]) => (
                  <div key={label} className="rounded-md bg-foreground/5 py-2">
                    <div className="text-[10px] text-muted-foreground">{t(label)}</div>
                    <div className="text-sm font-semibold">{val != null ? `${val}%` : '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            {[
              { label: t('podetail.plannedStart'), value: fmt(po.plannedStart) },
              { label: t('podetail.plannedEnd'),   value: fmt(po.plannedEnd) },
              ...(po.actualStart ? [{ label: t('podetail.actualStart'), value: fmt(po.actualStart) }] : []),
              ...(po.actualEnd   ? [{ label: t('podetail.actualEnd'),   value: fmt(po.actualEnd)   }] : []),
            ].map(d => (
              <div key={d.label} className="glass-card rounded-lg p-3">
                <div className="text-muted-foreground mb-1">{d.label}</div>
                <div className="font-medium">{d.value}</div>
              </div>
            ))}
          </div>

          {/* Flow */}
          <div className="glass-card rounded-lg p-3 border border-brand-500/20">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">{t('podetail.orderFlow')}</p>
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <span className="px-2 py-0.5 rounded bg-brand-500/20 text-brand-300 font-mono text-[10px]">PO {po.orderNumber}</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              {po.workOrders.length > 0 ? po.workOrders.map(w => (
                <span key={w.id} className={cn('px-2 py-0.5 rounded font-mono text-[10px]', {
                  'bg-green-500/20 text-green-300': w.status === 'COMPLETED',
                  'bg-brand-500/20 text-brand-300': w.status === 'IN_PROGRESS',
                  'bg-blue-500/20 text-blue-300': w.status === 'RELEASED',
                  'bg-slate-500/20 text-slate-300': w.status === 'PLANNED',
                  'bg-amber-500/20 text-amber-300': w.status === 'ON_HOLD',
                  'bg-red-500/20 text-red-300': w.status === 'CANCELLED',
                })}>{w.orderNumber}</span>
              )) : <span className="text-muted-foreground italic text-[10px]">{t('podetail.noWosYet')}</span>}
            </div>
          </div>

          {/* Status action buttons */}
          <div className="flex flex-wrap gap-2 p-3 glass-card rounded-lg border border-foreground/5">
            <p className="w-full text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{t('podetail.statusActions')}</p>
            {po.status === 'PLANNED' && (
              <Button size="sm" variant="outline" className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10" onClick={actions.onRelease}>
                <SendHorizonal className="w-3.5 h-3.5 me-1.5" /> {t('podetail.releaseShop')}
              </Button>
            )}
            {['RELEASED', 'IN_PROGRESS'].includes(po.status) && (
              <Button size="sm" variant="outline" className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10" onClick={actions.onHold}>
                <PauseCircle className="w-3.5 h-3.5 me-1.5" /> {t('podetail.putOnHold')}
              </Button>
            )}
            {po.status === 'ON_HOLD' && (
              <Button size="sm" variant="outline" className="text-green-400 border-green-500/30 hover:bg-green-500/10" onClick={actions.onResume}>
                <Play className="w-3.5 h-3.5 me-1.5" /> {t('podetail.resume')}
              </Button>
            )}
            {po.status === 'IN_PROGRESS' && (
              <Button size="sm" variant="outline" className="text-green-400 border-green-500/30 hover:bg-green-500/10" onClick={actions.onComplete}>
                <CheckCircle2 className="w-3.5 h-3.5 me-1.5" /> {t('podetail.markCompleted')}
              </Button>
            )}
            {!['COMPLETED', 'CANCELLED'].includes(po.status) && (
              <Button size="sm" variant="outline" className="text-red-400 border-red-500/30 hover:bg-red-500/10" onClick={actions.onCancel}>
                <XCircle className="w-3.5 h-3.5 me-1.5" /> {t('podetail.cancelPo')}
              </Button>
            )}
          </div>

          {/* WOs section */}
          <WOsWithDispatch po={po} actions={actions} />

          {po.notes && (
            <div className="text-xs text-muted-foreground p-3 glass-card rounded-lg">
              <span className="font-medium text-foreground">{t('podetail.notes')} </span>{po.notes}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────
// Dispatch List Panel (Job Orders for a single Work Order)
// ─────────────────────────────────────────────────────────────

interface DispatchListPanelProps {
  woId: string;
  woStatus: WOStatus;
  plannedStart?: string | null;
  plannedEnd?: string | null;
}

function DispatchListPanel({ woId, woStatus, plannedStart, plannedEnd }: DispatchListPanelProps) {
  const { t } = useTranslation(['production', 'common']);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery<JobOrder[]>({
    queryKey: ['job-orders', woId],
    queryFn: () => api.get(`/production/work-orders/${woId}/job-orders`) as any,
    staleTime: 30_000,
  });
  const jobs: JobOrder[] = (data as any) ?? [];

  const genMut = useMutation({
    mutationFn: () => api.post(`/production/work-orders/${woId}/job-orders/generate`, {
      plannedStart: plannedStart ? new Date(plannedStart).toISOString() : undefined,
      plannedEnd:   plannedEnd   ? new Date(plannedEnd).toISOString()   : undefined,
      clearExisting: jobs.length > 0,
    }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['job-orders', woId] });
      toast({ title: `${res?.created ?? 0} job orders generated` });
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Error', description: e?.response?.data?.message ?? 'Failed' }),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/production/job-orders/${id}/status`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['job-orders', woId] }); },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Error', description: e?.response?.data?.message }),
  });

  if (isLoading) {
    return (
      <div className="space-y-2 mt-2">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="shimmer h-9 rounded-lg" />)}
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="mt-3 p-3 rounded-lg bg-foreground/3 border border-foreground/8 text-center">
        <GitBranch className="w-5 h-5 mx-auto mb-1.5 text-muted-foreground opacity-40" />
        <p className="text-xs text-muted-foreground mb-2">{t('podetail.noDispatch')}</p>
        {['RELEASED', 'IN_PROGRESS', 'PLANNED'].includes(woStatus) && (
          <Button
            size="sm" variant="outline"
            className="h-7 text-xs text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10"
            onClick={() => genMut.mutate()}
            disabled={genMut.isPending}
          >
            {genMut.isPending
              ? <><Loader2 className="w-3 h-3 me-1 animate-spin" />{t('podetail.generating')}</>
              : <><Zap className="w-3 h-3 me-1" />{t('podetail.generateRouting')}</>}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-1.5">
      {/* Header row */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          {t('podetail.dispatchCount', { count: jobs.length })}
        </span>
        <Button
          size="sm" variant="ghost"
          className="h-6 text-[10px] text-yellow-400 hover:bg-yellow-500/10 px-2"
          onClick={() => genMut.mutate()}
          disabled={genMut.isPending}
        >
          {genMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        </Button>
      </div>

      {/* Chain: each JO as a card */}
      <div className="relative pl-4">
        {/* Vertical connector line */}
        <div className="absolute left-1.5 top-2 bottom-2 w-px bg-foreground/8" />

        {jobs.map((jo, idx) => {
          const cfg = JO_STATUS[jo.status] ?? JO_STATUS.SCHEDULED;
          const canStart    = jo.status === 'READY';
          const canComplete = jo.status === 'EXECUTING';
          const canPause    = jo.status === 'EXECUTING';
          const canResume   = jo.status === 'PAUSED';

          return (
            <div key={jo.id} className="relative mb-1.5 last:mb-0">
              {/* Connector dot */}
              <div className={cn(
                'absolute -left-3 top-3.5 w-2 h-2 rounded-full border border-background',
                cfg.dot,
              )} />

              <div className={cn(
                'rounded-lg px-3 py-2 border transition-colors',
                jo.status === 'EXECUTING' ? 'border-brand-500/40 bg-brand-500/8' : 'border-foreground/6 bg-foreground/3',
              )}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                      {String(jo.sequenceOrder).padStart(2, '0')}
                    </span>
                    <span className="text-xs font-medium truncate">{jo.operationName}</span>
                    {jo.machine && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                        <Cpu className="w-2.5 h-2.5" />{jo.machine.code}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded', cfg.bg, cfg.color)}>
                      {t(`podetail.joStatus.${jo.status}`, { defaultValue: cfg.label })}
                    </span>
                    {canStart && (
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-green-400 hover:bg-green-500/15"
                        onClick={() => statusMut.mutate({ id: jo.id, status: 'EXECUTING' })}>
                        <Play className="w-3 h-3" />
                      </Button>
                    )}
                    {canPause && (
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-amber-400 hover:bg-amber-500/15"
                        onClick={() => statusMut.mutate({ id: jo.id, status: 'PAUSED' })}>
                        <PauseCircle className="w-3 h-3" />
                      </Button>
                    )}
                    {canResume && (
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-blue-400 hover:bg-blue-500/15"
                        onClick={() => statusMut.mutate({ id: jo.id, status: 'EXECUTING' })}>
                        <Play className="w-3 h-3" />
                      </Button>
                    )}
                    {canComplete && (
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-green-400 hover:bg-green-500/15"
                        onClick={() => statusMut.mutate({ id: jo.id, status: 'COMPLETE' })}>
                        <CheckSquare className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Sub-row: qty + cycle time */}
                {(jo.plannedQtyOut || jo.idealCycleTimeSec) && (
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                    {jo.plannedQtyOut && (
                      <span>{t('podetail.plan')} {jo.plannedQtyOut.toLocaleString()} <span className="font-medium text-foreground/70">{jo.outputUnit ?? t('podetail.unitsDefault')}</span></span>
                    )}
                    {jo.actualQtyGood > 0 && (
                      <span className="text-green-400">✓ {jo.actualQtyGood.toLocaleString()} {jo.outputUnit ?? ''}</span>
                    )}
                    {jo.idealCycleTimeSec && (
                      <span>{t('podetail.ict')} {jo.idealCycleTimeSec.toFixed(1)}s</span>
                    )}
                  </div>
                )}
              </div>

              {/* Arrow connector between steps */}
              {idx < jobs.length - 1 && (
                <div className="flex items-center justify-center h-2 -mt-0.5 mb-0.5">
                  <ChevronRight className="w-3 h-3 text-muted-foreground/30" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Table Row
// ─────────────────────────────────────────────────────────────

interface PORowProps { po: ProductionOrder; idx: number; onSelect: () => void; actions: Omit<POActionsProps, 'po'>; selected: boolean; onToggle: () => void; }

function PORow({ po, idx, onSelect, actions, selected, onToggle }: PORowProps) {
  const { t } = useTranslation(['production', 'common']);
  const cfg = PO_STATUS[po.status];
  const StatusIcon = cfg.icon;
  const progress = poProgress(po);

  return (
    <motion.tr
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.03 }}
      onClick={onSelect}
      className={cn('border-b border-border/30 hover:bg-foreground/5 cursor-pointer transition-colors', selected && 'bg-primary/5')}
    >
      <td className="p-3" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onCheckedChange={onToggle} aria-label="Select row" />
      </td>
      <td className="p-3">
        <div className="font-mono text-xs text-brand-400">{po.orderNumber}</div>
        {po.sapOrderNumber && <div className="text-[10px] text-muted-foreground">{po.sapOrderNumber}</div>}
      </td>
      <td className="p-3">
        <div className="text-xs font-medium max-w-[180px] truncate">{po.sku?.name ?? '—'}</div>
        <div className="text-[10px] text-muted-foreground font-mono">{po.sku?.itemNumber}</div>
      </td>
      <td className="p-3">
        <Badge variant="outline" className={cn('text-[10px]', PRI_CLS[po.priority])}>{po.priority}</Badge>
      </td>
      <td className="p-3 text-xs text-muted-foreground max-w-[120px] truncate">{po.customer ?? '—'}</td>
      <td className="p-3">
        <span className="text-xs">{po.targetQty.toLocaleString()}</span>
        <span className="text-[10px] text-muted-foreground ml-1">{po.unit}</span>
      </td>
      <td className="p-3 w-28">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
            <div className={cn('h-full rounded-full', {
              'bg-green-500': po.status === 'COMPLETED',
              'bg-brand-500': po.status === 'IN_PROGRESS',
              'bg-blue-500': po.status === 'RELEASED',
              'bg-amber-500': po.status === 'ON_HOLD',
              'bg-slate-500': ['PLANNED','CANCELLED'].includes(po.status),
            })} style={{ width: `${progress}%` }} />
          </div>
          <span className="text-[10px] text-muted-foreground w-7 shrink-0">{progress}%</span>
        </div>
      </td>
      <td className="p-3">
        <div className={cn('flex items-center gap-1.5 text-xs', cfg.color)}>
          <StatusIcon className="w-3.5 h-3.5" />{t(`po.status.${po.status}`, { defaultValue: cfg.label })}
        </div>
      </td>
      <td className="p-3 text-xs text-muted-foreground">{fmt(po.plannedStart)}</td>
      <td className="p-3 text-xs text-muted-foreground">{fmt(po.plannedEnd)}</td>
      <td className="p-3 text-xs text-muted-foreground">{po.workOrders.length}</td>
      <td className="p-3" onClick={e => e.stopPropagation()}>
        <POActionMenu po={po} {...actions} />
      </td>
    </motion.tr>
  );
}

// ─────────────────────────────────────────────────────────────
// Main View
// ─────────────────────────────────────────────────────────────

export function ProductionOrdersView() {
  const { t } = useTranslation(['production', 'common']);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { archive: archivePO, restore: restorePO, bulkArchive, bulkRestore } = useArchive('production-orders', [['production-orders']], 'Production order');
  const { filter: scopeFilter, key: scopeKey } = useScope();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [archived, setArchived] = useState<ArchiveScope>('active');

  // Dialog states
  const [createOpen, setCreateOpen]     = useState(false);
  const [editTarget, setEditTarget]     = useState<ProductionOrder | null>(null);
  const [detailPO,   setDetailPO]       = useState<ProductionOrder | null>(null);
  const [detailOpen, setDetailOpen]     = useState(false);
  const [createWOFor, setCreateWOFor]   = useState<ProductionOrder | null>(null);
  const [autoGenFor,  setAutoGenFor]    = useState<ProductionOrder | null>(null);
  const [holdFor,     setHoldFor]       = useState<ProductionOrder | null>(null);
  const [cancelFor,   setCancelFor]     = useState<ProductionOrder | null>(null);
  const [deleteFor,   setDeleteFor]     = useState<ProductionOrder | null>(null);
  const [completeFor, setCompleteFor]   = useState<ProductionOrder | null>(null);
  const [resumeFor,   setResumeFor]     = useState<ProductionOrder | null>(null);

  const [page, setPage] = useState(1);
  const LIMIT = 20;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['production-orders', search, statusFilter, archived, scopeKey],
    queryFn: () => api.get('/production/production-orders', {
      params: {
        search: search || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
        archived: archived !== 'active' ? archived : undefined,
        limit: 100,
        ...scopeFilter,
      },
    }),
    staleTime: 30_000,
  });
  const orders: ProductionOrder[] = (data as any)?.data ?? (data as any) ?? [];

  const { sortedData, sortCol, sortDir, handleSort: _handleSort } = useSortedData(orders, 'createdAt', 'desc');

  function handleSort(col: string) {
    _handleSort(col);
    setPage(1);
  }

  useEffect(() => { setPage(1); }, [sortCol, sortDir]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const pageData = useMemo(
    () => sortedData.slice((page - 1) * LIMIT, page * LIMIT),
    [sortedData, page],
  );
  const sel = useRowSelection(pageData);

  // ── Mutations ──────────────────────────────────────────────

  const releaseMut = useMutation({
    mutationFn: (id: string) => api.patch(`/production/production-orders/${id}/release`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production-orders'] }); toast({ title: 'PO Released' }); },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Error', description: e?.response?.data?.message }),
  });

  const holdMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.patch(`/production/production-orders/${id}/hold`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production-orders'] }); toast({ title: 'PO on Hold' }); setHoldFor(null); },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Error', description: e?.response?.data?.message }),
  });

  const resumeMut = useMutation({
    mutationFn: (id: string) => api.patch(`/production/production-orders/${id}/resume`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production-orders'] }); toast({ title: 'PO Resumed' }); setResumeFor(null); },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Error', description: e?.response?.data?.message }),
  });

  const completeMut = useMutation({
    mutationFn: (id: string) => api.patch(`/production/production-orders/${id}/complete`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production-orders'] }); toast({ title: 'PO Completed' }); setCompleteFor(null); },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Error', description: e?.response?.data?.message }),
  });

  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.patch(`/production/production-orders/${id}/cancel`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production-orders'] }); toast({ title: 'PO Cancelled' }); setCancelFor(null); },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Error', description: e?.response?.data?.message }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/production/production-orders/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production-orders'] }); toast({ title: 'PO Deleted' }); setDeleteFor(null); setDetailOpen(false); },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Error', description: e?.response?.data?.message }),
  });

  // ── Helper to build actions object for a PO ────────────────

  function actionsFor(po: ProductionOrder): Omit<POActionsProps, 'po'> {
    return {
      onEdit:     () => setEditTarget(po),
      onDelete:   () => setDeleteFor(po),
      onRelease:  () => releaseMut.mutate(po.id),
      onHold:     () => setHoldFor(po),
      onResume:   () => setResumeFor(po),
      onComplete: () => setCompleteFor(po),
      onCancel:   () => setCancelFor(po),
      onCreateWO: () => setCreateWOFor(po),
      onAutoGen:  () => setAutoGenFor(po),
      onArchive:  () => archivePO.mutate(po.id),
      onRestore:  () => restorePO.mutate(po.id),
    };
  }

  function openDetail(po: ProductionOrder) { setDetailPO(po); setDetailOpen(true); }

  // Keep the open detail sheet in sync with the live list (status/qty change after
  // release/hold/etc.) — the captured `detailPO` would otherwise stay stale until reopened.
  const liveDetailPO = detailPO ? (orders.find(o => o.id === detailPO.id) ?? detailPO) : null;

  // KPI counts
  const planned   = orders.filter(p => p.status === 'PLANNED').length;
  const released  = orders.filter(p => p.status === 'RELEASED').length;
  const running   = orders.filter(p => p.status === 'IN_PROGRESS').length;
  const completed = orders.filter(p => p.status === 'COMPLETED').length;

  const kpis = [
    { label: 'Planned',     value: planned,   color: 'text-slate-300',  icon: Clock        },
    { label: 'Released',    value: released,  color: 'text-blue-400',   icon: SendHorizonal },
    { label: 'In Progress', value: running,   color: 'text-brand-400',  icon: RefreshCw    },
    { label: 'Completed',   value: completed, color: 'text-green-400',  icon: CheckCircle2 },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('headers.productionOrders.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('headers.productionOrders.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu
            filename="production-orders"
            title="Production Orders"
            rows={orders}
            columns={[
              { key: 'orderNumber', label: 'Order #' },
              { key: 'sku', label: 'Product', value: (r: any) => r.sku?.name ?? '' },
              { key: 'status', label: 'Status' },
              { key: 'priority', label: 'Priority' },
              { key: 'targetQty', label: 'Target Qty', value: (r: any) => `${r.targetQty} ${r.unit ?? ''}`.trim() },
              { key: 'completedQty', label: 'Completed', value: (r: any) => String(r.completedQty ?? 0) },
              { key: 'customer', label: 'Customer', value: (r: any) => r.customer ?? '' },
              { key: 'plannedStart', label: 'Planned Start', value: (r: any) => r.plannedStart ? new Date(r.plannedStart).toLocaleDateString() : '' },
              { key: 'plannedEnd', label: 'Planned End', value: (r: any) => r.plannedEnd ? new Date(r.plannedEnd).toLocaleDateString() : '' },
            ]}
          />
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="w-3.5 h-3.5 me-1.5" />{t('po.refresh')}</Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-3.5 h-3.5 me-1.5" />{t('po.newPo')}</Button>
        </div>
      </div>

      <InlineFormSlot />

      {/* Flow banner */}
      <div className="glass-card rounded-xl p-4 border border-brand-500/20">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2.5">{t('po.dataFlow')}</p>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {[
            { label: t('po.flow.erp'), sub: t('po.flow.erpSub'), color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
            { label: t('po.flow.scheduling'), sub: t('po.flow.schedulingSub'), color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
            { label: t('po.flow.mes'), sub: t('po.flow.mesSub'), color: 'bg-brand-500/20 text-brand-300 border-brand-500/30' },
            { label: t('po.flow.shopFloor'), sub: t('po.flow.shopFloorSub'), color: 'bg-green-500/20 text-green-300 border-green-500/30' },
            { label: t('po.flow.quality'), sub: t('po.flow.qualitySub'), color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
            { label: t('po.flow.reporting'), sub: t('po.flow.reportingSub'), color: 'bg-slate-500/20 text-slate-300 border-slate-500/30' },
          ].map((step, i) => (
            <React.Fragment key={step.label}>
              <div className={cn('px-3 py-1.5 rounded-lg border text-center', step.color)}>
                <div className="font-semibold text-[11px]">{step.label}</div>
                <div className="text-[9px] opacity-70">{step.sub}</div>
              </div>
              {i < 5 && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((k, i) => {
          const Icon = k.icon;
          return (
            <motion.div
              key={k.label}
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className="glass-card rounded-xl p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">{k.label}</span>
                <Icon className={cn('w-4 h-4', k.color)} />
              </div>
              <div className={cn('text-3xl font-bold', k.color)}>{k.value}</div>
            </motion.div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder={t('po.search')} className="ps-9 h-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(['all','PLANNED','RELEASED','IN_PROGRESS','COMPLETED','ON_HOLD','CANCELLED'] as const).map(s => (
            <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm" className="h-8 text-xs" onClick={() => setStatusFilter(s)}>
              {s === 'all' ? t('po.all') : t(`po.status.${s}`, { defaultValue: PO_STATUS[s as POStatus]?.label ?? s })}
            </Button>
          ))}
        </div>
        <ArchiveFilter value={archived} onChange={setArchived} />
      </div>

      {/* Table */}
      <div className="glass-card rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 w-10"><Checkbox checked={sel.allSelected} onCheckedChange={sel.toggleAll} aria-label={t('po.selectAll')} /></th>
              <SortableHeader column="orderNumber" label={t('po.col.poNumber')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader column="orderNumber" label={t('po.col.product')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader column="priority" label={t('po.col.priority')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader column="customer" label={t('po.col.customer')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader column="targetQty" label={t('po.col.targetQty')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <th className="px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('po.col.progress')}</th>
              <SortableHeader column="status" label={t('po.col.status')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader column="plannedStart" label={t('po.col.plannedStart')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortableHeader column="plannedEnd" label={t('po.col.plannedEnd')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <th className="px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('po.col.wos')}</th>
              <th className="px-4 py-3 text-end text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('po.col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/30">
                    {Array.from({ length: 12 }).map((_, j) => <td key={j} className="p-3"><div className="shimmer h-4 rounded w-20" /></td>)}
                  </tr>
                ))
              : orders.length === 0
              ? (
                <tr>
                  <td colSpan={12} className="p-12 text-center">
                    <ClipboardList className="w-8 h-8 mx-auto mb-3 text-muted-foreground opacity-40" />
                    <p className="text-muted-foreground text-sm">{t('po.noPos')}</p>
                    <Button size="sm" className="mt-3" onClick={() => setCreateOpen(true)}><Plus className="w-3.5 h-3.5 me-1.5" />{t('po.createFirst')}</Button>
                  </td>
                </tr>
              )
              : pageData.map((po, i) => (
                  <PORow key={po.id} po={po} idx={i} onSelect={() => openDetail(po)} actions={actionsFor(po)} selected={sel.isSelected(po.id)} onToggle={() => sel.toggle(po.id)} />
                ))}
          </tbody>
        </table>
        <TablePagination page={page} total={sortedData.length} limit={LIMIT} onPageChange={setPage} isLoading={isLoading} />
      </div>

      {/* ── Dialogs ── */}

      {/* Create */}
      <POFormDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      {/* Edit */}
      <POFormDialog open={!!editTarget} onClose={() => setEditTarget(null)} initial={editTarget} />

      {/* Detail Sheet */}
      <PODetailSheet
        po={liveDetailPO} open={detailOpen}
        onClose={() => setDetailOpen(false)}
        actions={liveDetailPO ? actionsFor(liveDetailPO) : {
          onEdit: () => {}, onDelete: () => {}, onRelease: () => {},
          onHold: () => {}, onResume: () => {}, onComplete: () => {},
          onCancel: () => {}, onCreateWO: () => {}, onAutoGen: () => {},
          onArchive: () => {}, onRestore: () => {},
        }}
      />

      {/* Manual WO */}
      {createWOFor && <CreateWODialog po={createWOFor} open={!!createWOFor} onClose={() => setCreateWOFor(null)} />}

      {/* Auto-generate WOs */}
      {autoGenFor && <AutoGenerateWODialog po={autoGenFor} open={!!autoGenFor} onClose={() => setAutoGenFor(null)} />}

      {/* Hold */}
      <ReasonDialog
        open={!!holdFor} onClose={() => setHoldFor(null)}
        title={t('poact.holdTitle', { order: holdFor?.orderNumber })}
        description={t('poact.holdDesc')}
        confirmLabel={t('poact.holdConfirm')} confirmVariant="default"
        onConfirm={reason => holdMut.mutate({ id: holdFor!.id, reason })}
        loading={holdMut.isPending}
      />

      {/* Cancel */}
      <ReasonDialog
        open={!!cancelFor} onClose={() => setCancelFor(null)}
        title={t('poact.cancelTitle', { order: cancelFor?.orderNumber })}
        description={t('poact.cancelDesc')}
        confirmLabel={t('poact.cancelConfirm')} confirmVariant="destructive"
        onConfirm={reason => cancelMut.mutate({ id: cancelFor!.id, reason })}
        loading={cancelMut.isPending}
      />

      {/* Complete */}
      <ConfirmDialog
        open={!!completeFor} onClose={() => setCompleteFor(null)}
        title={t('poact.completeTitle', { order: completeFor?.orderNumber })}
        description={t('poact.completeDesc')}
        confirmLabel={t('poact.completeConfirm')} confirmVariant="default"
        onConfirm={() => completeMut.mutate(completeFor!.id)}
        loading={completeMut.isPending}
      />

      {/* Resume */}
      <ConfirmDialog
        open={!!resumeFor} onClose={() => setResumeFor(null)}
        title={t('poact.resumeTitle', { order: resumeFor?.orderNumber })}
        description={t('poact.resumeDesc')}
        confirmLabel={t('poact.resumeConfirm')} confirmVariant="default"
        onConfirm={() => resumeMut.mutate(resumeFor!.id)}
        loading={resumeMut.isPending}
      />

      {/* Delete */}
      <ConfirmDialog
        open={!!deleteFor} onClose={() => setDeleteFor(null)}
        title={t('poact.deleteTitle', { order: deleteFor?.orderNumber })}
        description={t('poact.deleteDesc')}
        confirmLabel={t('poact.deleteConfirm')} confirmVariant="destructive"
        onConfirm={() => deleteMut.mutate(deleteFor!.id)}
        loading={deleteMut.isPending}
      />

      <BulkActionsBar
        count={sel.count}
        onClear={sel.clear}
        actions={archived === 'archived'
          ? [{ label: 'Restore', icon: RotateCcw, onClick: () => { bulkRestore.mutate(sel.selectedIds); sel.clear(); } }]
          : [{ label: 'Archive', icon: ArchiveIcon, onClick: () => { bulkArchive.mutate(sel.selectedIds); sel.clear(); } }]}
      />
    </div>
  );
}
