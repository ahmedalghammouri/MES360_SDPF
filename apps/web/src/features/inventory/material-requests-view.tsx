'use client';
import { useTranslation } from 'react-i18next';

import React, { useState } from 'react';
import {
  PackageCheck, AlertTriangle, Truck, Search, Package, FlaskConical,
  MapPin, Calendar, ChevronDown, Filter, AlertCircle, Ban, CheckCircle2, Clock,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { api } from '@/services/api.client';
import { cn, formatDate } from '@/lib/utils';
import { TablePagination } from '@/components/ui/table-pagination';

// ── Types ────────────────────────────────────────────────────

type MatReqStatus = 'PENDING' | 'ACKNOWLEDGED' | 'PARTIALLY_FULFILLED' | 'FULFILLED' | 'CANCELLED';

interface MaterialRequest {
  id: string;
  requestNumber: string;
  status: MatReqStatus;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  workOrderId: string | null;
  woNumber: string | null;
  woStatus: string | null;
  woPlannedStart: string | null;
  materialReadyDate: string | null;
  productName: string | null;
  poNumber: string | null;
  rawMaterialId: string;
  materialCode: string | null;
  materialName: string | null;
  unit: string;
  currentStock: number;
  reservedStock: number;
  liveAvailable: number;
  minStock: number;
  storageLocation: string | null;
  supplierName: string | null;
  leadTimeDays: number | null;
  quantityNeeded: number;
  quantityAvailable: number;
  quantityShort: number;
  quantityFulfilled: number;
  stillShort: number;
  deliveryDate: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  notes: string | null;
  responseNotes: string | null;
}

interface ListResponse { data: MaterialRequest[]; total: number; page: number; limit: number; totalPages: number; }
interface Stats { openCount: number; awaitingResponse: number; scheduled: number; highCritical: number; totalShortQty: number; }

type RespondAction = 'FULFILL' | 'SET_DELIVERY' | 'CANCEL';

// ── Constants ────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<string, { labelKey: string; bg: string; text: string; border: string }> = {
  CRITICAL: { labelKey: 'spareRequestsView.priority.critical', bg: 'bg-red-500/10',  text: 'text-red-400',  border: 'border-red-500/30'  },
  HIGH:     { labelKey: 'spareRequestsView.priority.high',     bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' },
  MEDIUM:   { labelKey: 'spareRequestsView.priority.medium',   bg: 'bg-blue-500/10',  text: 'text-blue-400',  border: 'border-blue-500/30'  },
  LOW:      { labelKey: 'spareRequestsView.priority.low',      bg: 'bg-muted/20',     text: 'text-muted-foreground', border: 'border-border' },
};
const PRIORITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const STATUS_CONFIG: Record<MatReqStatus, { labelKey: string; text: string; bg: string }> = {
  PENDING:             { labelKey: 'matReqView.status.pending',    text: 'text-amber-400',  bg: 'bg-amber-500/10' },
  ACKNOWLEDGED:        { labelKey: 'matReqView.status.scheduled',  text: 'text-blue-400',   bg: 'bg-blue-500/10' },
  PARTIALLY_FULFILLED: { labelKey: 'matReqView.status.partial',    text: 'text-cyan-400',   bg: 'bg-cyan-500/10' },
  FULFILLED:           { labelKey: 'matReqView.status.fulfilled',  text: 'text-green-400',  bg: 'bg-green-500/10' },
  CANCELLED:           { labelKey: 'matReqView.status.cancelled',  text: 'text-muted-foreground', bg: 'bg-muted/20' },
};

const STATUS_FILTERS: Array<{ value: string; labelKey: string }> = [
  { value: 'OPEN',                labelKey: 'matReqView.filter.open' },
  { value: 'PENDING',             labelKey: 'matReqView.status.pending' },
  { value: 'ACKNOWLEDGED',        labelKey: 'matReqView.status.scheduled' },
  { value: 'PARTIALLY_FULFILLED', labelKey: 'matReqView.status.partial' },
  { value: 'FULFILLED',           labelKey: 'matReqView.status.fulfilled' },
  { value: 'CANCELLED',           labelKey: 'matReqView.status.cancelled' },
];

// ── Component ────────────────────────────────────────────────

export function MaterialRequestsView() {
  const { t } = useTranslation(['inventory', 'common']);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('OPEN');
  const [page, setPage] = useState(1);
  const [panel, setPanel] = useState<MaterialRequest | null>(null);
  const [action, setAction] = useState<RespondAction>('FULFILL');
  const [qty, setQty] = useState('');
  const [eta, setEta] = useState('');
  const [notes, setNotes] = useState('');

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['material-requests', { search, status: statusFilter }, page],
    queryFn: () =>
      api.get<ListResponse>('/production/material-requests', {
        params: { search: search || undefined, status: statusFilter === 'OPEN' ? undefined : statusFilter, page, limit: 20 },
      }),
    staleTime: 15_000,
  });
  const { data: stats } = useQuery({
    queryKey: ['material-requests', 'stats'],
    queryFn: () => api.get<Stats>('/production/material-requests/stats'),
    staleTime: 15_000,
  });

  const rows: MaterialRequest[] = (data as unknown as ListResponse)?.data ?? [];
  const total: number = (data as unknown as ListResponse)?.total ?? 0;
  const s = stats as unknown as Stats | undefined;

  const filtered = rows.slice().sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3));

  const respondMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: { action: RespondAction; quantity?: number; deliveryDate?: string; notes?: string } }) =>
      api.post(`/production/material-requests/${id}/respond`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['material-requests'] });
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      toast({ title: t('matReqView.respondSuccess'), variant: 'success' });
      closePanel();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast({ title: t('matReqView.respondFailed'), description: msg, variant: 'destructive' });
    },
  });

  const openPanel = (r: MaterialRequest) => {
    setPanel(r);
    setAction('FULFILL');
    setQty(r.stillShort > 0 ? String(r.stillShort) : '');
    setEta('');
    setNotes('');
  };
  const closePanel = () => { setPanel(null); setQty(''); setEta(''); setNotes(''); };

  const confirm = () => {
    if (!panel) return;
    const dto: { action: RespondAction; quantity?: number; deliveryDate?: string; notes?: string } = { action, notes: notes || undefined };
    if (action === 'FULFILL') dto.quantity = parseFloat(qty);
    if (action === 'SET_DELIVERY') dto.deliveryDate = eta ? new Date(eta).toISOString() : undefined;
    respondMutation.mutate({ id: panel.id, dto });
  };

  const qtyNum = parseFloat(qty);
  const valid =
    action === 'FULFILL' ? !!qty && qtyNum > 0 :
    action === 'SET_DELIVERY' ? !!eta :
    true;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('headers.materialRequests.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('headers.materialRequests.subtitle')}</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        <InlineFormSlot />

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{t('matReqView.kpi.open')}</span>
              <Package size={14} className="text-brand-400" />
            </div>
            <p className="text-2xl font-bold text-brand-400">{s?.openCount ?? 0}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t('matReqView.kpi.openHint')}</p>
          </div>
          <div className={cn('glass-card p-4', (s?.awaitingResponse ?? 0) > 0 && 'border-amber-500/30')}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{t('matReqView.kpi.awaiting')}</span>
              <Clock size={14} className={(s?.awaitingResponse ?? 0) > 0 ? 'text-amber-400' : 'text-muted-foreground'} />
            </div>
            <p className={cn('text-2xl font-bold', (s?.awaitingResponse ?? 0) > 0 ? 'text-amber-400' : 'text-muted-foreground')}>{s?.awaitingResponse ?? 0}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t('matReqView.kpi.awaitingHint')}</p>
          </div>
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{t('matReqView.kpi.scheduled')}</span>
              <Truck size={14} className="text-blue-400" />
            </div>
            <p className="text-2xl font-bold text-blue-400">{s?.scheduled ?? 0}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t('matReqView.kpi.scheduledHint')}</p>
          </div>
          <div className={cn('glass-card p-4', (s?.highCritical ?? 0) > 0 && 'border-red-500/30')}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{t('matReqView.kpi.highCritical')}</span>
              <AlertTriangle size={14} className={(s?.highCritical ?? 0) > 0 ? 'text-red-400' : 'text-muted-foreground'} />
            </div>
            <p className={cn('text-2xl font-bold', (s?.highCritical ?? 0) > 0 ? 'text-red-400' : 'text-muted-foreground')}>{s?.highCritical ?? 0}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t('matReqView.kpi.highCriticalHint')}</p>
          </div>
        </div>

        {/* Table */}
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="text-sm font-semibold">{t('matReqView.tableTitle')}</h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t('matReqView.search')}
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  className="h-8 pl-7 w-44 text-xs"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                    <Filter size={12} />
                    {t(STATUS_FILTERS.find(f => f.value === statusFilter)?.labelKey ?? 'matReqView.filter.open')}
                    <ChevronDown size={11} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {STATUS_FILTERS.map(f => (
                    <DropdownMenuItem key={f.value} onClick={() => { setStatusFilter(f.value); setPage(1); }}>
                      {t(f.labelKey)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="rounded-lg border border-border/30 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/30">
                  {[t('matReqView.col.request'), t('matReqView.col.wo'), t('matReqView.col.material'), t('matReqView.col.needed'), t('matReqView.col.available'), t('matReqView.col.short'), t('matReqView.col.status'), t('matReqView.col.eta'), t('matReqView.col.supplier'), ''].map((h, i) => (
                    <TableHead key={i} className="text-[11px] font-semibold whitespace-nowrap">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i} className="border-border/20">
                      {Array.from({ length: 10 }).map((_, j) => (
                        <TableCell key={j}><div className="shimmer h-3.5 rounded w-20" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                      <CheckCircle2 size={32} className="mx-auto mb-2 opacity-30" />
                      <p className="text-sm">{t('matReqView.empty')}</p>
                      <p className="text-xs mt-1">{t('matReqView.emptyHint')}</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map(r => {
                    const priority = PRIORITY_CONFIG[r.priority];
                    const st = STATUS_CONFIG[r.status];
                    const closed = r.status === 'FULFILLED' || r.status === 'CANCELLED';
                    return (
                      <TableRow key={r.id} className={cn('border-border/20 hover:bg-muted/20', r.stillShort > 0 && !closed && 'bg-red-500/5')}>
                        <TableCell>
                          <div className="font-mono text-xs font-semibold text-primary">{r.requestNumber}</div>
                          {priority && (
                            <span className={cn('inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded-full border mt-0.5', priority.text, priority.bg, priority.border)}>
                              {t(priority.labelKey)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="font-mono text-xs font-semibold">{r.woNumber ?? '—'}</div>
                          {r.productName && <div className="text-[10px] text-muted-foreground max-w-[140px] truncate">{r.productName}</div>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-xs font-medium max-w-[160px] truncate">
                            <FlaskConical size={11} className="text-muted-foreground shrink-0" />{r.materialName}
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground">{r.materialCode}</div>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs font-semibold tabular-nums">{r.quantityNeeded}</span>
                          <span className="text-[10px] text-muted-foreground ml-1">{r.unit}</span>
                        </TableCell>
                        <TableCell>
                          <span className={cn('text-xs font-bold tabular-nums', r.liveAvailable >= r.quantityNeeded ? 'text-green-400' : 'text-amber-400')}>{r.liveAvailable}</span>
                        </TableCell>
                        <TableCell>
                          {r.stillShort > 0 ? (
                            <span className="flex items-center gap-0.5 text-[11px] font-bold text-red-400">
                              <AlertTriangle size={9} />{r.stillShort}
                            </span>
                          ) : (
                            <span className="text-[11px] text-green-400">0</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={cn('inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full', st.text, st.bg)}>
                            {t(st.labelKey)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {r.deliveryDate ? (
                            <div className="flex items-center gap-1 text-xs text-blue-400"><Calendar size={10} />{formatDate(r.deliveryDate)}</div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {r.supplierName ? (
                            <div className="text-xs text-muted-foreground max-w-[120px] truncate">
                              {r.supplierName}
                              {r.leadTimeDays != null && <span className="text-[10px] block">{t('matReqView.leadDays', { count: r.leadTimeDays })}</span>}
                            </div>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" className="h-7 text-xs gap-1" onClick={() => openPanel(r)} disabled={closed}>
                            <PackageCheck size={11} />{t('matReqView.respond')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <TablePagination page={page} total={total} limit={20} onPageChange={setPage} isLoading={isLoading} />
        </div>
      </div>

      {/* ── Respond inline form ─────────────────────────────── */}
      {panel && (
        <InlineFormPanel
          open={!!panel}
          onClose={closePanel}
          icon={PackageCheck}
          iconClassName="text-brand-400"
          iconWrapClassName="bg-brand-500/15"
          title={t('matReqView.respondTitle')}
          description={t('matReqView.respondDesc', { material: panel.materialName ?? '', wo: panel.woNumber ?? '' })}
          footer={(
            <>
              <Button variant="outline" size="sm" onClick={closePanel}>{t('matReqView.cancel')}</Button>
              <Button size="sm" className="gap-1.5" disabled={!valid || respondMutation.isPending} onClick={confirm}>
                <PackageCheck size={12} />
                {respondMutation.isPending ? t('matReqView.submitting') : t('matReqView.submit')}
              </Button>
            </>
          )}
        >
          <div className="space-y-4 py-1">
            {/* Summary */}
            <div className="glass-card rounded-lg p-3 space-y-1.5">
              {[
                { label: t('matReqView.summary.material'), value: `${panel.materialName ?? ''} (${panel.materialCode ?? ''})` },
                { label: t('matReqView.summary.wo'), value: panel.woNumber ?? '—' },
                { label: t('matReqView.summary.needed'), value: `${panel.quantityNeeded} ${panel.unit}` },
                { label: t('matReqView.summary.available'), value: `${panel.liveAvailable} ${panel.unit}` },
                { label: t('matReqView.summary.short'), value: `${panel.stillShort} ${panel.unit}` },
                ...(panel.supplierName ? [{ label: t('matReqView.summary.supplier'), value: panel.supplierName }] : []),
              ].map(row => (
                <div key={row.label} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-medium">{row.value}</span>
                </div>
              ))}
            </div>

            {/* Action selector */}
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: 'FULFILL' as const, icon: PackageCheck, label: t('matReqView.action.fulfill') },
                { key: 'SET_DELIVERY' as const, icon: Truck, label: t('matReqView.action.setEta') },
                { key: 'CANCEL' as const, icon: Ban, label: t('matReqView.action.cancel') },
              ]).map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setAction(opt.key)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border p-2.5 text-[11px] font-medium transition-colors',
                    action === opt.key ? 'border-brand-500/60 bg-brand-500/10 text-brand-300' : 'border-border/40 text-muted-foreground hover:bg-muted/20',
                  )}
                >
                  <opt.icon size={15} />{opt.label}
                </button>
              ))}
            </div>

            {action === 'FULFILL' && (
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {t('matReqView.field.qtyToAdd')} <span className="text-destructive">*</span>
                  <span className="font-normal text-muted-foreground ml-1">{panel.unit}</span>
                </Label>
                <Input type="number" min={0} step="any" value={qty} onChange={e => setQty(e.target.value)} className="h-9" autoFocus />
                <p className="text-[11px] text-muted-foreground">{t('matReqView.field.qtyHint', { count: panel.stillShort, unit: panel.unit })}</p>
              </div>
            )}

            {action === 'SET_DELIVERY' && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t('matReqView.field.eta')} <span className="text-destructive">*</span></Label>
                <Input type="datetime-local" value={eta} onChange={e => setEta(e.target.value)} className="h-9" autoFocus />
                <p className="text-[11px] text-amber-400 flex items-start gap-1">
                  <AlertCircle size={12} className="mt-0.5 shrink-0" />{t('matReqView.field.etaHint')}
                </p>
              </div>
            )}

            {action === 'CANCEL' && (
              <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>{t('matReqView.field.cancelWarn')}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">{t('matReqView.field.notes')}</Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('matReqView.field.notesPlaceholder')} className="h-9" />
            </div>
          </div>
        </InlineFormPanel>
      )}
    </div>
  );
}
