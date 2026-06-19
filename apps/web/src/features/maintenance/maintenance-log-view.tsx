'use client';
import { useTranslation } from 'react-i18next';

import { useState } from 'react';
import {
  History, Search, Wrench, Clock, CheckCircle2, AlertTriangle, Download,
  Calendar, User, Factory, Package, DollarSign, FileText, Timer,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { KPICard } from '@/components/widgets/kpi-card';
import { TablePagination } from '@/components/ui/table-pagination';
import { MachinePicker } from '@/components/ui/machine-picker';
import { ExportMenu } from '@/components/ui/export-menu';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { exportRecordToPDF } from '@/lib/export-utils';

const STATUS_CFG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; tone: string }> = {
  OPEN:           { label: 'Open',           variant: 'destructive', tone: 'text-red-400' },
  ASSIGNED:       { label: 'Assigned',       variant: 'secondary',   tone: 'text-blue-400' },
  IN_PROGRESS:    { label: 'In Progress',    variant: 'default',     tone: 'text-amber-400' },
  ON_HOLD:        { label: 'On Hold',        variant: 'outline',     tone: 'text-orange-400' },
  AWAITING_PARTS: { label: 'Awaiting Parts', variant: 'outline',     tone: 'text-purple-400' },
  COMPLETED:      { label: 'Completed',      variant: 'secondary',   tone: 'text-green-400' },
  CANCELLED:      { label: 'Cancelled',      variant: 'outline',     tone: 'text-muted-foreground' },
};

const TYPE_LABELS: Record<string, string> = {
  PREVENTIVE: 'Preventive', CORRECTIVE: 'Corrective', EMERGENCY: 'Emergency',
  PREDICTIVE: 'Predictive', INSPECTION: 'Inspection', LUBRICATION: 'Lubrication',
};

const PRIORITY_TONE: Record<string, string> = {
  LOW: 'text-muted-foreground', MEDIUM: 'text-blue-400', HIGH: 'text-amber-400', CRITICAL: 'text-red-400',
};

function fmt(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
}
function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}
function money(v?: number | null): string {
  return v != null ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—';
}

export function MaintenanceLogView() {
  const { t } = useTranslation(['maintenance', 'common']);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('ALL');
  const [type, setType] = useState<string>('ALL');
  const [machineId, setMachineId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['maintenance', 'log', { search, status, type, machineId, page }],
    queryFn: () => api.get('/maintenance/work-orders', {
      params: {
        search: search || undefined,
        status: status !== 'ALL' ? status : undefined,
        type: type !== 'ALL' ? type : undefined,
        machineId: machineId || undefined,
        limit: 20,
        page,
      },
    }),
    staleTime: 15_000,
  });

  const { data: kpis } = useQuery({
    queryKey: ['maintenance', 'kpis', 'log'],
    queryFn: () => api.get('/maintenance/kpis'),
    refetchInterval: 60_000,
  });

  const rows: any[] = (data as any)?.data ?? [];
  const total: number = (data as any)?.total ?? 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><History size={18} className="text-primary" /> {t('headers.log.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('headers.log.subtitle')}
          </p>
        </div>
        <ExportMenu
          filename="maintenance-log"
          title="Maintenance Log"
          rows={rows}
          columns={[
            { key: 'woNumber', label: 'WO #' },
            { key: 'title', label: 'Title' },
            { key: 'type', label: 'Type' },
            { key: 'asset', label: 'Machine' },
            { key: 'status', label: 'Status' },
            { key: 'assignedTo', label: 'Assigned', value: (r: any) => r.assignedTo ?? '' },
            { key: 'requestedBy', label: 'Requested By', value: (r: any) => r.requestedBy ?? '' },
            { key: 'createdAt', label: 'Created', value: (r: any) => r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '' },
            { key: 'dueDate', label: 'Due', value: (r: any) => r.dueDate ? new Date(r.dueDate).toLocaleDateString() : '' },
            { key: 'completedAt', label: 'Completed', value: (r: any) => r.completedAt ? new Date(r.completedAt).toLocaleDateString() : '' },
            { key: 'estimatedHours', label: 'Est. Hrs', value: (r: any) => r.estimatedHours ?? '' },
            { key: 'actualHours', label: 'Actual Hrs', value: (r: any) => r.actualHours ?? '' },
            { key: 'totalCost', label: 'Total Cost', value: (r: any) => r.totalCost ?? '' },
          ]}
        />
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title="Open Work Orders" value={(kpis as any)?.openWOs ?? 0} colorMode="alarm" />
          <KPICard title="Overdue" value={(kpis as any)?.overdueWOs ?? 0} colorMode="alarm" />
          <KPICard title="Completion Rate" value={`${(kpis as any)?.completionRate ?? 0}%`} />
          <KPICard title="MTTR (hrs)" value={(kpis as any)?.mttr ?? 0} />
        </div>

        {/* Filters */}
        <div className="industrial-card p-4 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder={t('mlog.search')} value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="h-8 ps-7 w-60 text-xs" />
            </div>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder={t('col.status')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('mlog.allStatuses')}</SelectItem>
                {Object.keys(STATUS_CFG).map(s => <SelectItem key={s} value={s}>{t(`woStatus.${s}`, { defaultValue: STATUS_CFG[s].label })}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}>
              <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder={t('col.type')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('mlog.allTypes')}</SelectItem>
                {Object.keys(TYPE_LABELS).map(k => <SelectItem key={k} value={k}>{t(`type.${k}`, { defaultValue: TYPE_LABELS[k] })}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="w-52">
              <MachinePicker value={machineId} onChange={(id) => { setMachineId(id); setPage(1); }} placeholder={t('mlog.allMachines')} className="h-8" />
            </div>
          </div>

          <div className="rounded-lg border border-border/30 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/30">
                  <TableHead className="text-[11px] font-semibold">{t('mlog.col.wo')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('mlog.col.title')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('mlog.col.type')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('mlog.col.machine')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('mlog.col.status')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('mlog.col.assigned')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('mlog.col.created')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('mlog.col.completed')}</TableHead>
                  <TableHead className="text-[11px] font-semibold text-end">{t('mlog.col.hours')}</TableHead>
                  <TableHead className="text-[11px] font-semibold text-end">{t('mlog.col.cost')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i} className="border-border/20">
                      {Array.from({ length: 10 }).map((_, j) => (
                        <TableCell key={j}><div className="shimmer h-3.5 rounded w-16" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground text-sm">{t('mlog.noRecords')}</TableCell></TableRow>
                ) : (
                  rows.map((wo) => (
                    <TableRow key={wo.id} className="border-border/20 hover:bg-muted/20 cursor-pointer" onClick={() => setDetailId(wo.id)}>
                      <TableCell className="text-xs font-mono">{wo.woNumber}</TableCell>
                      <TableCell className="text-xs font-medium max-w-[200px] truncate">{wo.title}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{TYPE_LABELS[wo.type] ?? wo.type}</TableCell>
                      <TableCell className="text-xs">{wo.asset}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_CFG[wo.status]?.variant ?? 'outline'} className="text-[10px] h-5">
                          {STATUS_CFG[wo.status]?.label ?? wo.status}
                        </Badge>
                        {wo.isOverdue && <span className="ml-1 text-[10px] text-red-400">overdue</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{wo.assignedTo ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(wo.createdAt)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(wo.completedAt)}</TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">
                        {wo.actualHours != null ? `${wo.actualHours}` : '—'}{wo.estimatedHours != null ? ` / ${wo.estimatedHours}` : ''}
                      </TableCell>
                      <TableCell className="text-xs text-right">{money(wo.totalCost)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <TablePagination page={page} total={total} limit={20} onPageChange={setPage} isLoading={isLoading} />
        </div>
      </div>

      <MaintenanceLogDetail id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

function MaintenanceLogDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['maintenance', 'work-order', id],
    queryFn: () => api.get<any>(`/maintenance/work-orders/${id}`),
    enabled: !!id,
  });

  const wo = data as any;

  const exportPdf = () => exportRecordToPDF(`Maintenance Order ${wo.woNumber}`, wo.title ?? '', [
    { heading: 'Summary', fields: [
      { label: 'WO #', value: wo.woNumber }, { label: 'Title', value: wo.title },
      { label: 'Type', value: TYPE_LABELS[wo.type] ?? wo.type }, { label: 'Priority', value: wo.priority },
      { label: 'Status', value: STATUS_CFG[wo.status]?.label ?? wo.status }, { label: 'Description', value: wo.description ?? '—' },
    ]},
    { heading: 'Context', fields: [
      { label: 'Machine', value: wo.machine ? `${wo.machine.name} (${wo.machine.code})` : '—' },
      { label: 'Requested By', value: wo.requestedBy?.name ?? '—' }, { label: 'Assigned To', value: wo.assignedTo?.name ?? '—' },
      { label: 'Production WO', value: wo.productionWO?.orderNumber ?? '—' },
    ]},
    { heading: 'Timeline', fields: [
      { label: 'Created', value: fmt(wo.createdAt) }, { label: 'Due', value: fmt(wo.dueDate) },
      { label: 'Started', value: fmt(wo.startedAt) }, { label: 'Completed', value: fmt(wo.completedAt) },
    ]},
    { heading: 'Effort & Cost', fields: [
      { label: 'Estimated Hours', value: wo.estimatedHours != null ? String(wo.estimatedHours) : '—' },
      { label: 'Actual Hours', value: wo.actualHours != null ? String(wo.actualHours) : '—' },
      { label: 'Labor Cost', value: money(wo.laborCost) }, { label: 'Parts Cost', value: money(wo.partsCost) },
      { label: 'Total Cost', value: money(wo.totalCost) },
    ]},
    { heading: 'Spare Parts', fields: (Array.isArray(wo.sparesUsed) && wo.sparesUsed.length)
      ? wo.sparesUsed.map((s: any, i: number) => ({ label: `Part ${i + 1}`, value: `${s.sparePart?.name ?? s.sparePart?.partNumber ?? '—'} — req ${s.quantityRequested}, issued ${s.quantityIssued} (${s.status})` }))
      : [{ label: 'Parts', value: 'None' }] },
    ...(wo.notes ? [{ heading: 'Notes', fields: [{ label: 'Notes', value: wo.notes }] }] : []),
  ]);

  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {isLoading || !wo ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wrench size={17} className="text-primary" />
                <span className="font-mono">{wo.woNumber}</span>
                <Badge variant={STATUS_CFG[wo.status]?.variant ?? 'outline'} className="text-[10px] h-5">
                  {STATUS_CFG[wo.status]?.label ?? wo.status}
                </Badge>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 ml-auto mr-6" onClick={exportPdf}>
                  <Download size={12} /> PDF
                </Button>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              <div>
                <div className="font-semibold">{wo.title}</div>
                {wo.description && <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{wo.description}</p>}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Detail icon={Wrench} label="Type" value={TYPE_LABELS[wo.type] ?? wo.type} />
                <Detail icon={AlertTriangle} label="Priority" value={wo.priority} tone={PRIORITY_TONE[wo.priority]} />
                <Detail icon={Factory} label="Machine" value={wo.machine ? `${wo.machine.name} (${wo.machine.code})` : '—'} />
                <Detail icon={User} label="Requested By" value={wo.requestedBy?.name} />
                <Detail icon={User} label="Assigned To" value={wo.assignedTo?.name} />
                <Detail icon={Package} label="Production WO" value={wo.productionWO?.orderNumber} />
              </div>

              {/* Timeline */}
              <div className="rounded-lg border border-border/60 p-3">
                <h3 className="text-xs font-semibold mb-2 flex items-center gap-1.5"><Calendar size={12} className="text-primary" /> Timeline</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <Detail icon={Calendar} label="Created" value={fmt(wo.createdAt)} />
                  <Detail icon={Clock} label="Due" value={fmt(wo.dueDate)} />
                  <Detail icon={Timer} label="Started" value={fmt(wo.startedAt)} />
                  <Detail icon={CheckCircle2} label="Completed" value={fmt(wo.completedAt)} />
                </div>
              </div>

              {/* Effort & cost */}
              <div className="rounded-lg border border-border/60 p-3">
                <h3 className="text-xs font-semibold mb-2 flex items-center gap-1.5"><DollarSign size={12} className="text-primary" /> Effort &amp; Cost</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <Detail icon={Timer} label="Est. Hours" value={wo.estimatedHours != null ? String(wo.estimatedHours) : '—'} />
                  <Detail icon={Timer} label="Actual Hours" value={wo.actualHours != null ? String(wo.actualHours) : '—'} />
                  <Detail icon={DollarSign} label="Labor Cost" value={money(wo.laborCost)} />
                  <Detail icon={DollarSign} label="Parts Cost" value={money(wo.partsCost)} />
                  <Detail icon={DollarSign} label="Total Cost" value={money(wo.totalCost)} />
                  {wo.runtimeHoursAtService != null && <Detail icon={Timer} label="Runtime @ Service" value={String(wo.runtimeHoursAtService)} />}
                </div>
              </div>

              {/* Spare parts */}
              {Array.isArray(wo.sparesUsed) && wo.sparesUsed.length > 0 && (
                <div className="rounded-lg border border-border/60 p-3">
                  <h3 className="text-xs font-semibold mb-2 flex items-center gap-1.5"><Package size={12} className="text-primary" /> Spare Parts ({wo.sparesUsed.length})</h3>
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="text-left py-1">Part</th>
                        <th className="text-right py-1">Req.</th>
                        <th className="text-right py-1">Issued</th>
                        <th className="text-right py-1">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wo.sparesUsed.map((s: any) => (
                        <tr key={s.id} className="border-t border-border/30">
                          <td className="py-1">{s.sparePart?.name ?? s.sparePart?.partNumber ?? '—'}</td>
                          <td className="py-1 text-right">{s.quantityRequested}</td>
                          <td className="py-1 text-right">{s.quantityIssued}</td>
                          <td className="py-1 text-right">{s.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {wo.notes && (
                <div className="rounded-lg border border-border/60 p-3">
                  <h3 className="text-xs font-semibold mb-1 flex items-center gap-1.5"><FileText size={12} className="text-primary" /> Notes</h3>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">{wo.notes}</p>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Detail({ icon: Icon, label, value, tone }: { icon: any; label: string; value?: string | null; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Icon size={10} /> {label}</div>
      <div className={cn('font-medium mt-0.5', tone)}>{value || '—'}</div>
    </div>
  );
}
