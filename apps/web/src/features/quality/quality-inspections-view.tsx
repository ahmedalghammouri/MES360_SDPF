'use client';
import { useTranslation } from 'react-i18next';

import { useState, useMemo, useEffect } from 'react';
import {
  Plus, Search, Filter, ChevronDown, CheckCircle2,
  XCircle, AlertCircle, MoreHorizontal, Pencil, Trash2,
  ClipboardList, Link2, FlaskConical, ChevronRight, Archive as ArchiveIcon, RotateCcw,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EntityPicker } from '@/components/ui/entity-picker';
import { FormDialog } from '@/components/ui/form-dialog';
import { InlineFormSlot } from '@/components/ui/inline-form-panel';
import { DeleteDialog } from '@/components/ui/delete-dialog';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api.client';
import { cn, formatDate } from '@/lib/utils';
import { TablePagination } from '@/components/ui/table-pagination';
import { SortableHeader } from '@/components/ui/sortable-header';
import { useSortedData } from '@/lib/use-sorted-data';
import { ExportMenu } from '@/components/ui/export-menu';
import { ArchiveFilter, type ArchiveScope } from '@/components/ui/archive-filter';
import { useArchive } from '@/hooks/use-archive';
import { Checkbox } from '@/components/ui/checkbox';
import { useRowSelection } from '@/hooks/use-row-selection';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';

const RESULT_CONFIG = {
  PASS:        { label: 'Pass',        color: 'text-green-400',  icon: CheckCircle2 },
  FAIL:        { label: 'Fail',        color: 'text-red-400',    icon: XCircle      },
  CONDITIONAL: { label: 'Conditional', color: 'text-amber-400',  icon: AlertCircle  },
} as const;

const TYPE_LABELS: Record<string, string> = {
  INCOMING: 'Incoming', IN_PROCESS: 'In-Process', FINAL: 'Final', PATROL: 'Patrol',
};

interface QualityParameter {
  id: string;
  name: string;
  unit?: string;
  nominalValue?: number;
  ucl?: number;
  lcl?: number;
  usl?: number;
  lsl?: number;
  checkMethod?: string;
}

interface QualityPlan {
  id: string;
  code: string;
  name: string;
  type: string;
  parameters: QualityParameter[];
}

interface ChecklistItem {
  parameterId: string;
  parameterName: string;
  measuredValue: string;
  pass: boolean | null;
  notes: string;
}

interface Inspection {
  id: string;
  inspectionNumber: string;
  type: string;
  result: 'PASS' | 'FAIL' | 'CONDITIONAL';
  totalQty: number;
  passQty: number;
  failQty: number;
  inspector?: { name: string };
  workOrder?: { orderNumber: string };
  plan?: { name: string; code: string };
  inspectedAt: string;
  notes?: string;
}

/** ISO timestamp → value for a <input type="datetime-local"> (local time, no tz suffix). */
function toLocalInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function QualityInspectionsView() {
  const { t } = useTranslation(['quality', 'common']);
  const { toast } = useToast()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [resultFilter, setResultFilter] = useState<string | null>(null)
  const [archived, setArchived] = useState<ArchiveScope>('active')
  const { archive: archiveInsp, restore: restoreInsp, bulkArchive, bulkRestore } = useArchive('inspections', [['quality', 'inspections']], 'Inspection')
  const [formOpen, setFormOpen] = useState(false)
  const [editInspection, setEditInspection] = useState<Inspection | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; number: string } | null>(null)
  const [expandedWorkOrder, setExpandedWorkOrder] = useState<string | null>(null)
  const [form, setForm] = useState({
    inspectionNumber: '', type: 'INCOMING', totalQty: '', passQty: '', failQty: '',
    workOrderId: '', planId: '', machineId: '', batchRecordId: '', inspectedAt: '', notes: '',
  })
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])

  const { data, isLoading } = useQuery({
    queryKey: ['quality', 'inspections', { search, type: typeFilter, result: resultFilter, archived, page }],
    queryFn: () => api.get('/quality/inspections', {
      params: { search: search || undefined, type: typeFilter || undefined, result: resultFilter || undefined, archived: archived !== 'active' ? archived : undefined, limit: 20, page },
    }),
    staleTime: 20_000,
  })

  const { data: workOrdersData } = useQuery({
    queryKey: ['production', 'work-orders', 'inspection-dropdown'],
    queryFn: () => api.get('/production/work-orders', { params: { limit: 100 } }),
    staleTime: 60_000,
    enabled: formOpen,
  })

  const { data: plansData } = useQuery({
    queryKey: ['quality', 'plans'],
    queryFn: () => api.get('/quality/plans'),
    staleTime: 120_000,
    enabled: formOpen,
  })

  const { data: machinesData } = useQuery({
    queryKey: ['hierarchy', 'machines', 'inspection-dropdown'],
    queryFn: () => api.get('/hierarchy/machines'),
    staleTime: 60_000,
    enabled: formOpen,
  })

  const { data: batchesData } = useQuery({
    queryKey: ['production', 'batches', 'inspection-dropdown'],
    queryFn: () => api.get('/production/batches', { params: { limit: 100 } }),
    staleTime: 60_000,
    enabled: formOpen,
  })

  const workOrders: Array<{ id: string; orderNumber: string; sku?: { name: string } }> = (workOrdersData as any)?.data ?? []
  const plans: QualityPlan[] = (plansData as any) ?? []
  const machines: Array<{ id: string; name: string; code: string }> = (machinesData as any) ?? []
  const batches: Array<{ id: string; batchNumber: string }> = (batchesData as any)?.data ?? []
  const inspections: Inspection[] = (data as any)?.data ?? (data as any) ?? [];
  const sel = useRowSelection(inspections);
  const total: number = (data as any)?.total ?? 0;

  const selectedPlan = plans.find(p => p.id === form.planId)

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/quality/inspections', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quality', 'inspections'] })
      toast({ title: 'Inspection created successfully' })
      handleCloseForm()
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed to create inspection', variant: 'destructive' }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/quality/inspections/${id}`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quality', 'inspections'] })
      toast({ title: 'Inspection updated successfully' })
      handleCloseForm()
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed to update inspection', variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/quality/inspections/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quality', 'inspections'] })
      toast({ title: 'Inspection deleted successfully' })
      setDeleteDialog(null)
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed to delete inspection', variant: 'destructive' }),
  })

  const handleOpenCreate = () => {
    setEditInspection(null)
    setForm({
      inspectionNumber: '', type: 'INCOMING', totalQty: '', passQty: '', failQty: '',
      workOrderId: '', planId: '', machineId: '', batchRecordId: '', inspectedAt: '', notes: '',
    })
    setChecklist([])
    setFormOpen(true)
  };

  const handleOpenEdit = async (inspection: Inspection) => {
    setEditInspection(inspection)
    setChecklist([])
    setFormOpen(true)
    // The list row only carries display relations — fetch the full record so the
    // form can repopulate every model field (WO, plan, machine, batch, measurements).
    try {
      const full = await api.get<any>(`/quality/inspections/${inspection.id}`)
      setForm({
        inspectionNumber: full.inspectionNumber ?? inspection.inspectionNumber,
        type: full.type ?? inspection.type,
        totalQty: String(full.totalQty ?? inspection.totalQty),
        passQty: String(full.passQty ?? inspection.passQty),
        failQty: String(full.failQty ?? inspection.failQty),
        workOrderId: full.workOrderId ?? '',
        planId: full.planId ?? '',
        machineId: full.machineId ?? '',
        batchRecordId: full.batchRecordId ?? '',
        inspectedAt: toLocalInput(full.inspectedAt),
        notes: full.notes ?? inspection.notes ?? '',
      })
      // Rebuild the check-point grid: prefer the plan's parameters and merge in any
      // recorded measurement; fall back to whatever measurements were stored.
      const measured: any[] = Array.isArray(full.measurements) ? full.measurements : []
      const params: QualityParameter[] = full.plan?.parameters ?? []
      if (params.length > 0) {
        setChecklist(params.map(p => {
          const m = measured.find(x => x.parameterId === p.id)
          return {
            parameterId: p.id,
            parameterName: p.name,
            measuredValue: m?.value != null ? String(m.value) : '',
            pass: typeof m?.pass === 'boolean' ? m.pass : null,
            notes: m?.notes ?? '',
          }
        }))
      } else if (measured.length > 0) {
        setChecklist(measured.map(m => ({
          parameterId: m.parameterId ?? m.parameterName ?? '',
          parameterName: m.parameterName ?? '',
          measuredValue: m.value != null ? String(m.value) : '',
          pass: typeof m.pass === 'boolean' ? m.pass : null,
          notes: m.notes ?? '',
        })))
      }
    } catch {
      // Fall back to the list snapshot so the form is at least partially usable.
      setForm(f => ({
        ...f,
        inspectionNumber: inspection.inspectionNumber,
        type: inspection.type,
        totalQty: String(inspection.totalQty),
        passQty: String(inspection.passQty),
        failQty: String(inspection.failQty),
        notes: inspection.notes || '',
      }))
    }
  };

  const handleCloseForm = () => {
    setFormOpen(false)
    setEditInspection(null)
    setChecklist([])
  };

  // Auto-open the create dialog when arriving via "New Inspection" (?new=1).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('new') === '1') {
      handleOpenCreate()
      window.history.replaceState(null, '', window.location.pathname)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handlePlanSelect = (planId: string) => {
    setForm(f => ({ ...f, planId }))
    if (planId && planId !== '__none__') {
      const plan = plans.find(p => p.id === planId)
      if (plan) {
        setChecklist(plan.parameters.map(p => ({
          parameterId: p.id,
          parameterName: p.name,
          measuredValue: '',
          pass: null,
          notes: '',
        })))
      }
    } else {
      setChecklist([])
    }
  }

  const updateChecklistItem = (idx: number, field: keyof ChecklistItem, value: any) => {
    setChecklist(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  const handleSubmit = () => {
    const filledChecklist = checklist.filter(c => c.measuredValue.trim() !== '');
    const measurements = filledChecklist.length > 0
      ? filledChecklist.map(c => ({
          parameterId: c.parameterId,
          parameterName: c.parameterName,
          value: Number(c.measuredValue),
          pass: c.pass ?? undefined,
          notes: c.notes || undefined,
        }))
      : undefined;

    const pick = (v: string) => (v && v !== '__none__' ? v : undefined)
    const dto: any = {
      type: form.type,
      totalQty: parseInt(form.totalQty),
      passQty: parseInt(form.passQty),
      failQty: form.failQty ? parseInt(form.failQty) : undefined,
      workOrderId: pick(form.workOrderId),
      planId: pick(form.planId),
      machineId: pick(form.machineId),
      batchRecordId: pick(form.batchRecordId),
      inspectedAt: form.inspectedAt ? new Date(form.inspectedAt).toISOString() : undefined,
      notes: form.notes || undefined,
      measurements,
    };
    if (editInspection) {
      updateMutation.mutate({ id: editInspection.id, dto })
    } else {
      createMutation.mutate(dto)
    }
  };

  const isValid = !!(form.type && form.totalQty && form.passQty)

  const summary = {
    total: inspections.length,
    pass: inspections.filter((i) => i.result === 'PASS').length,
    fail: inspections.filter((i) => i.result === 'FAIL').length,
    conditional: inspections.filter((i) => i.result === 'CONDITIONAL').length,
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('headers.inspections.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('headers.inspections.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu
            filename="quality-inspections"
            title="Quality Inspections"
            rows={inspections}
            columns={[
              { key: 'inspectionNumber', label: 'Inspection #' },
              { key: 'type', label: 'Type' },
              { key: 'result', label: 'Result' },
              { key: 'totalQty', label: 'Total' },
              { key: 'passQty', label: 'Pass' },
              { key: 'failQty', label: 'Fail' },
              { key: 'workOrder', label: 'Work Order', value: (r: any) => r.workOrder?.orderNumber ?? '' },
              { key: 'plan', label: 'Quality Plan', value: (r: any) => r.planName ?? r.plan?.name ?? '' },
              { key: 'inspector', label: 'Inspector', value: (r: any) => (typeof r.inspector === 'string' ? r.inspector : r.inspector?.name) ?? '' },
              { key: 'date', label: 'Date', value: (r: any) => (r.date ?? r.inspectedAt) ? new Date(r.date ?? r.inspectedAt).toLocaleDateString() : '' },
            ]}
          />
          <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={handleOpenCreate}>
            <Plus size={13} /> New Inspection
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        <InlineFormSlot />

        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-3">
          <div className="industrial-card p-4">
            <p className="text-xs text-muted-foreground">Total Today</p>
            <p className="text-2xl font-bold mt-1">{summary.total}</p>
          </div>
          <div className="industrial-card p-4">
            <p className="text-xs text-muted-foreground">Pass</p>
            <p className="text-2xl font-bold mt-1 text-green-400">{summary.pass}</p>
          </div>
          <div className="industrial-card p-4">
            <p className="text-xs text-muted-foreground">Conditional</p>
            <p className="text-2xl font-bold mt-1 text-amber-400">{summary.conditional}</p>
          </div>
          <div className="industrial-card p-4">
            <p className="text-xs text-muted-foreground">Failed</p>
            <p className="text-2xl font-bold mt-1 text-red-400">{summary.fail}</p>
          </div>
        </div>

        {/* Table */}
        <div className="industrial-card p-4">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="text-sm font-semibold">{t('inspections.records')}</h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder={t('inspections.search')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="h-8 ps-7 w-40 text-xs" />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                    <Filter size={12} />
                    {typeFilter ? t(`inspections.type.${typeFilter}`) : t('inspections.allTypes')}
                    <ChevronDown size={11} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => { setTypeFilter(null); setPage(1); }}>{t('inspections.allTypes')}</DropdownMenuItem>
                  {Object.keys(TYPE_LABELS).map((k) => (
                    <DropdownMenuItem key={k} onClick={() => { setTypeFilter(k); setPage(1); }}>{t(`inspections.type.${k}`)}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                    <Filter size={12} />
                    {resultFilter ? t(`inspections.result.${resultFilter}`) : t('inspections.allResults')}
                    <ChevronDown size={11} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => { setResultFilter(null); setPage(1); }}>{t('inspections.allResults')}</DropdownMenuItem>
                  {Object.keys(RESULT_CONFIG).map((k) => (
                    <DropdownMenuItem key={k} onClick={() => { setResultFilter(k); setPage(1); }}>{t(`inspections.result.${k}`)}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <ArchiveFilter value={archived} onChange={(v) => { setArchived(v); setPage(1); }} />
            </div>
          </div>

          <div className="rounded-lg border border-border/30 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/30">
                  <TableHead className="w-10"><Checkbox checked={sel.allSelected} onCheckedChange={sel.toggleAll} aria-label={t('inspections.selectAll')} /></TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('inspections.col.inspection')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('inspections.col.type')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('inspections.col.result')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('inspections.col.total')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('inspections.col.pass')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('inspections.col.fail')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('inspections.col.workOrder')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('inspections.col.qualityPlan')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('inspections.col.inspector')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('inspections.col.date')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i} className="border-border/20">
                      {Array.from({ length: 12 }).map((_, j) => (
                        <TableCell key={j}><div className="shimmer h-3.5 rounded w-16" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : inspections.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-8 text-muted-foreground text-sm">
                      {t('inspections.noInspections')}
                    </TableCell>
                  </TableRow>
                ) : (
                  inspections.map((ins) => {
                    const result = RESULT_CONFIG[ins.result];
                    const ResultIcon = result?.icon;
                    return (
                      <TableRow key={ins.id} className={cn('border-border/20 hover:bg-muted/20', sel.isSelected(ins.id) && 'bg-primary/5')}>
                        <TableCell><Checkbox checked={sel.isSelected(ins.id)} onCheckedChange={() => sel.toggle(ins.id)} aria-label={t('inspections.selectAll')} /></TableCell>
                        <TableCell className="font-mono text-xs font-semibold text-primary">{ins.inspectionNumber}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{t(`inspections.type.${ins.type}`, { defaultValue: ins.type })}</TableCell>
                        <TableCell>
                          {result && (
                            <div className={cn('flex items-center gap-1 text-xs font-semibold', result.color)}>
                              <ResultIcon size={12} />
                              {t(`inspections.result.${ins.result}`, { defaultValue: result.label })}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{ins.totalQty}</TableCell>
                        <TableCell className="text-xs text-green-400">{ins.passQty}</TableCell>
                        <TableCell className="text-xs text-red-400">{ins.failQty > 0 ? ins.failQty : '—'}</TableCell>
                        <TableCell className="text-xs">
                          {ins.workOrder ? (
                            <span className="flex items-center gap-1 font-mono text-primary/80">
                              <Link2 size={10} />
                              {ins.workOrder.orderNumber}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {ins.plan ? (
                            <span className="flex items-center gap-1">
                              <ClipboardList size={10} className="text-primary/60" />
                              {ins.plan.name}
                            </span>
                          ) : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{ins.inspector?.name ?? '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDate(ins.inspectedAt)}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <MoreHorizontal size={13} />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleOpenEdit(ins)}>
                                <Pencil className="w-3.5 h-3.5 mr-2" />Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {(ins as any).archivedAt ? (
                                <DropdownMenuItem onClick={() => restoreInsp.mutate(ins.id)}>
                                  <RotateCcw className="w-3.5 h-3.5 mr-2" />Restore
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={() => archiveInsp.mutate(ins.id)}>
                                  <ArchiveIcon className="w-3.5 h-3.5 mr-2" />Archive
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteDialog({ id: ins.id, number: ins.inspectionNumber })}>
                                <Trash2 className="w-3.5 h-3.5 mr-2" />Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <TablePagination page={page} total={total} limit={20} onPageChange={setPage} isLoading={isLoading} />
        </div>
      </div>

      <FormDialog
        open={formOpen}
        onClose={handleCloseForm}
        title={editInspection ? 'Edit Inspection' : 'New Inspection'}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        isValid={isValid}
      >
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          {/* Base fields */}
          <div className="grid grid-cols-2 gap-4">
            {editInspection && (
              <div>
                <Label>Inspection Number</Label>
                <Input value={form.inspectionNumber} disabled className="mt-1 font-mono text-xs bg-muted/50" />
              </div>
            )}
            <div className={editInspection ? '' : 'col-span-2'}>
              <Label>Type *</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Total Quantity *</Label>
              <Input type="number" value={form.totalQty} onChange={e => setForm(v => ({ ...v, totalQty: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Pass Quantity *</Label>
              <Input type="number" value={form.passQty} onChange={e => setForm(v => ({ ...v, passQty: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Fail Quantity</Label>
              <Input type="number" value={form.failQty} onChange={e => setForm(v => ({ ...v, failQty: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Work Order</Label>
              <EntityPicker
                items={workOrders}
                value={form.workOrderId === '__none__' ? null : (form.workOrderId || null)}
                onChange={id => setForm(f => ({ ...f, workOrderId: id ?? '__none__' }))}
                getId={wo => wo.id}
                getPrimary={wo => wo.orderNumber}
                getSecondary={wo => wo.sku?.name ?? ''}
                searchText={wo => `${wo.orderNumber} ${wo.sku?.name ?? ''}`}
                placeholder="Link to work order..."
                searchPlaceholder="Search work orders…"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Machine</Label>
              <EntityPicker
                items={machines}
                value={form.machineId === '__none__' ? null : (form.machineId || null)}
                onChange={id => setForm(f => ({ ...f, machineId: id ?? '__none__' }))}
                getId={m => m.id}
                getPrimary={m => m.name}
                getSecondary={m => m.code}
                searchText={m => `${m.name} ${m.code}`}
                placeholder="Link to machine..."
                searchPlaceholder="Search machines…"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Batch / Lot</Label>
              <EntityPicker
                items={batches}
                value={form.batchRecordId === '__none__' ? null : (form.batchRecordId || null)}
                onChange={id => setForm(f => ({ ...f, batchRecordId: id ?? '__none__' }))}
                getId={b => b.id}
                getPrimary={b => b.batchNumber}
                getSecondary={() => ''}
                searchText={b => b.batchNumber}
                placeholder="Link to batch..."
                searchPlaceholder="Search batches…"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Inspected At</Label>
              <Input
                type="datetime-local"
                value={form.inspectedAt}
                onChange={e => setForm(v => ({ ...v, inspectedAt: e.target.value }))}
                className="mt-1"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Leave blank to use the current time.</p>
            </div>
          </div>

          {/* Quality Plan */}
          <div>
            <Label className="flex items-center gap-1.5">
              <ClipboardList size={12} className="text-primary" />
              Quality Plan
            </Label>
            <EntityPicker
              items={plans}
              value={form.planId === '__none__' ? null : (form.planId || null)}
              onChange={id => handlePlanSelect(id ?? '__none__')}
              getId={p => p.id}
              getPrimary={p => p.name}
              getSecondary={p => p.code}
              getMeta={p => <span className="text-muted-foreground">{p.type}</span>}
              placeholder="Select plan..."
              searchPlaceholder="Search plans…"
              className="mt-1"
            />
          </div>

          {/* Quality Checklist (quality parameters from plan) */}
          {checklist.length > 0 && (
            <div>
              <Label className="flex items-center gap-1.5 mb-2">
                <FlaskConical size={12} className="text-primary" />
                Quality Check Points ({checklist.length} parameters)
              </Label>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left p-2 font-medium text-muted-foreground">Parameter</th>
                      <th className="text-left p-2 font-medium text-muted-foreground w-28">Measured Value</th>
                      <th className="text-center p-2 font-medium text-muted-foreground w-24">Result</th>
                      <th className="text-left p-2 font-medium text-muted-foreground">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checklist.map((item, idx) => {
                      const param = selectedPlan?.parameters.find(p => p.id === item.parameterId)
                      return (
                        <tr key={item.parameterId} className="border-t">
                          <td className="p-1.5">
                            <div className="font-medium">{item.parameterName}</div>
                            {param && (
                              <div className="text-[10px] text-muted-foreground">
                                {param.nominalValue != null && `Nominal: ${param.nominalValue}`}
                                {param.unit && ` ${param.unit}`}
                                {(param.lsl != null || param.usl != null) && ` | Spec: [${param.lsl ?? '—'}, ${param.usl ?? '—'}]`}
                              </div>
                            )}
                          </td>
                          <td className="p-1.5">
                            <Input
                              value={item.measuredValue}
                              onChange={e => updateChecklistItem(idx, 'measuredValue', e.target.value)}
                              className="h-7 text-xs w-full"
                              placeholder="Enter value"
                            />
                          </td>
                          <td className="p-1.5">
                            <div className="flex gap-1 justify-center">
                              <button
                                type="button"
                                onClick={() => updateChecklistItem(idx, 'pass', true)}
                                className={cn(
                                  'flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors',
                                  item.pass === true
                                    ? 'bg-green-500/20 text-green-400 border border-green-500/40'
                                    : 'bg-muted/30 text-muted-foreground hover:bg-green-500/10',
                                )}
                              >
                                <CheckCircle2 size={10} /> Pass
                              </button>
                              <button
                                type="button"
                                onClick={() => updateChecklistItem(idx, 'pass', false)}
                                className={cn(
                                  'flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors',
                                  item.pass === false
                                    ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                                    : 'bg-muted/30 text-muted-foreground hover:bg-red-500/10',
                                )}
                              >
                                <XCircle size={10} /> Fail
                              </button>
                            </div>
                          </td>
                          <td className="p-1.5">
                            <Input
                              value={item.notes}
                              onChange={e => updateChecklistItem(idx, 'notes', e.target.value)}
                              className="h-7 text-xs w-full"
                              placeholder="Optional..."
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {checklist.filter(c => c.pass === true).length}/{checklist.length} parameters passing
              </p>
            </div>
          )}

          <div>
            <Label>Notes</Label>
            <Input value={form.notes} onChange={e => setForm(v => ({ ...v, notes: e.target.value }))} className="mt-1" />
          </div>
        </div>
      </FormDialog>

      <DeleteDialog
        open={!!deleteDialog}
        onClose={() => setDeleteDialog(null)}
        onConfirm={() => deleteDialog && deleteMutation.mutate(deleteDialog.id)}
        title={`Delete inspection ${deleteDialog?.number}?`}
        description="This will permanently delete this inspection record."
        isDeleting={deleteMutation.isPending}
      />

      <BulkActionsBar
        count={sel.count}
        onClear={sel.clear}
        actions={archived === 'archived'
          ? [{ label: 'Restore', icon: RotateCcw, onClick: () => { bulkRestore.mutate(sel.selectedIds); sel.clear(); } }]
          : [{ label: 'Archive', icon: ArchiveIcon, onClick: () => { bulkArchive.mutate(sel.selectedIds); sel.clear(); } }]}
      />
    </div>
  )
}
