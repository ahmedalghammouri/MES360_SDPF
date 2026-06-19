'use client';
import { useTranslation } from 'react-i18next';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, ChevronDown, ChevronRight,
  Clock, Package, AlertTriangle, CheckCircle2, Circle,
  RefreshCw, PauseCircle, Cpu, ArrowRight, SendHorizonal, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';

type POStatus  = 'PLANNED' | 'RELEASED' | 'IN_PROGRESS' | 'COMPLETED' | 'ON_HOLD' | 'CANCELLED';
type WOStatus  = 'PLANNED' | 'RELEASED' | 'IN_PROGRESS' | 'COMPLETED' | 'ON_HOLD' | 'CANCELLED';

interface WorkOrderRef {
  id: string;
  orderNumber: string;
  status: WOStatus;
  priority: string;
  plannedQty: number;
  actualQty: number;
  goodQty: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  machine?: { name: string };
  operator?: { name: string };
}

interface ProductionOrder {
  id: string;
  orderNumber: string;
  status: POStatus;
  priority: string;
  targetQty: number;
  completedQty: number;
  unit: string;
  customer?: string;
  plannedStart: string;
  plannedEnd: string;
  sku?: { name: string; code: string };
  workOrders: WorkOrderRef[];
}

// Standalone Work Orders (not linked to a PO)
interface WorkOrder {
  id: string;
  orderNumber: string;
  status: WOStatus;
  priority: string;
  plannedQty: number;
  actualQty: number;
  goodQty: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  productionOrderId?: string | null;
  sku?: { name: string; code: string } | null;
  machine?: { name: string } | null;
}

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────

const PO_STATUS_CONFIG: Record<POStatus, { label: string; color: string; dot: string; icon: any }> = {
  PLANNED:     { label: 'Planned',     color: 'text-slate-400',  dot: 'bg-slate-400',  icon: Circle        },
  RELEASED:    { label: 'Released',    color: 'text-blue-400',   dot: 'bg-blue-400',   icon: SendHorizonal },
  IN_PROGRESS: { label: 'Running',     color: 'text-brand-400',  dot: 'bg-brand-400',  icon: RefreshCw     },
  COMPLETED:   { label: 'Completed',   color: 'text-green-400',  dot: 'bg-green-400',  icon: CheckCircle2  },
  ON_HOLD:     { label: 'On Hold',     color: 'text-amber-400',  dot: 'bg-amber-400',  icon: PauseCircle   },
  CANCELLED:   { label: 'Cancelled',   color: 'text-red-400',    dot: 'bg-red-400',    icon: XCircle       },
};

const WO_STATUS_CONFIG: Record<WOStatus, { label: string; color: string; barColor: string }> = {
  PLANNED:     { label: 'Planned',     color: 'text-slate-400',  barColor: 'bg-slate-500'  },
  RELEASED:    { label: 'Released',    color: 'text-blue-400',   barColor: 'bg-blue-500'   },
  IN_PROGRESS: { label: 'Running',     color: 'text-brand-400',  barColor: 'bg-brand-500'  },
  COMPLETED:   { label: 'Completed',   color: 'text-green-400',  barColor: 'bg-green-500'  },
  ON_HOLD:     { label: 'On Hold',     color: 'text-amber-400',  barColor: 'bg-amber-500'  },
  CANCELLED:   { label: 'Cancelled',   color: 'text-red-400',    barColor: 'bg-red-500'    },
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function fmtTime(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function poProgress(po: ProductionOrder): number {
  if (po.status === 'COMPLETED') return 100;
  if (po.status === 'PLANNED' || po.status === 'CANCELLED') return 0;
  const qty = po.workOrders.reduce((s, w) => s + (w.goodQty || w.actualQty || 0), 0);
  if (po.targetQty > 0 && qty > 0) return Math.min(99, Math.round((qty / po.targetQty) * 100));
  return po.status === 'IN_PROGRESS' ? 5 : 0;
}

function woProgress(wo: WorkOrderRef | WorkOrder): number {
  if (wo.status === 'COMPLETED') return 100;
  const done = (wo as any).goodQty || (wo as any).actualQty || 0;
  if (wo.plannedQty > 0 && done > 0) return Math.min(99, Math.round((done / wo.plannedQty) * 100));
  return wo.status === 'IN_PROGRESS' ? 5 : 0;
}

// ─────────────────────────────────────────────────────────────
// PO Row with expandable WOs
// ─────────────────────────────────────────────────────────────

function POScheduleRow({ po, idx }: { po: ProductionOrder; idx: number }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = PO_STATUS_CONFIG[po.status];
  const StatusIcon = cfg.icon;
  const progress = poProgress(po);
  const activeWOs = po.workOrders.filter(w => w.status !== 'CANCELLED').length;

  return (
    <>
      <motion.tr
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: idx * 0.04 }}
        onClick={() => setExpanded(e => !e)}
        className="border-b border-border/50 hover:bg-foreground/5 cursor-pointer transition-colors"
      >
        {/* Expand toggle */}
        <td className="p-3 w-8">
          {po.workOrders.length > 0 ? (
            expanded
              ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          ) : <span className="w-3.5 h-3.5 block" />}
        </td>

        {/* PO Number + type badge */}
        <td className="p-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-brand-400 font-semibold">{po.orderNumber}</span>
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-purple-400 border-purple-500/30">PO</Badge>
          </div>
          {po.customer && <div className="text-[10px] text-muted-foreground mt-0.5">{po.customer}</div>}
        </td>

        {/* Product */}
        <td className="p-3">
          <div className="flex items-center gap-1.5">
            <Package className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="text-xs truncate max-w-[160px]">{po.sku?.name ?? '—'}</span>
          </div>
          {po.sku?.code && <div className="text-[10px] text-muted-foreground">{po.sku.code}</div>}
        </td>

        {/* Dates */}
        <td className="p-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            {fmt(po.plannedStart)}
          </div>
        </td>
        <td className="p-3 text-xs text-muted-foreground">{fmt(po.plannedEnd)}</td>

        {/* Qty */}
        <td className="p-3">
          <span className="text-xs">{po.targetQty.toLocaleString()}</span>
          <span className="text-[10px] text-muted-foreground ml-1">{po.unit}</span>
        </td>

        {/* Progress */}
        <td className="p-3 w-36">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
              <div className={cn('h-full rounded-full transition-all', {
                'bg-green-500': po.status === 'COMPLETED',
                'bg-brand-500': po.status === 'IN_PROGRESS',
                'bg-blue-500': po.status === 'RELEASED',
                'bg-amber-500': po.status === 'ON_HOLD',
                'bg-slate-500': po.status === 'PLANNED' || po.status === 'CANCELLED',
              })} style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[10px] text-muted-foreground w-7 shrink-0">{progress}%</span>
          </div>
        </td>

        {/* Status */}
        <td className="p-3">
          <div className={cn('flex items-center gap-1.5 text-xs', cfg.color)}>
            <StatusIcon className="w-3.5 h-3.5" />
            {cfg.label}
          </div>
        </td>

        {/* WO count */}
        <td className="p-3 text-xs text-muted-foreground">{activeWOs} WO{activeWOs !== 1 ? 's' : ''}</td>
      </motion.tr>

      {/* Expanded WO children */}
      <AnimatePresence>
        {expanded && po.workOrders.map((wo, wi) => {
          const woCfg = WO_STATUS_CONFIG[wo.status] ?? { label: wo.status, color: 'text-muted-foreground', barColor: 'bg-slate-500' };
          const woProg = woProgress(wo);
          return (
            <motion.tr
              key={wo.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ delay: wi * 0.03 }}
              className="border-b border-border/20 bg-foreground/[0.02]"
            >
              <td className="p-2" />
              <td className="p-2 pl-6">
                <div className="flex items-center gap-2">
                  <ArrowRight className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                  <span className="font-mono text-xs text-blue-300">{wo.orderNumber}</span>
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-blue-400 border-blue-500/30">WO</Badge>
                </div>
              </td>
              <td className="p-2">
                {wo.machine && (
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Cpu className="w-3 h-3" /> {wo.machine.name}
                  </div>
                )}
              </td>
              <td className="p-2 text-[10px] text-muted-foreground">{fmt(wo.plannedStart)} {fmtTime(wo.plannedStart)}</td>
              <td className="p-2 text-[10px] text-muted-foreground">{fmt(wo.plannedEnd)} {fmtTime(wo.plannedEnd)}</td>
              <td className="p-2 text-[10px] text-muted-foreground">{wo.plannedQty.toLocaleString()}</td>
              <td className="p-2 w-36">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1 rounded-full bg-foreground/10 overflow-hidden">
                    <div className={cn('h-full rounded-full', woCfg.barColor)} style={{ width: `${woProg}%` }} />
                  </div>
                  <span className="text-[10px] text-muted-foreground w-7 shrink-0">{woProg}%</span>
                </div>
              </td>
              <td className="p-2">
                <span className={cn('text-[10px] font-medium', woCfg.color)}>{woCfg.label}</span>
              </td>
              <td className="p-2" />
            </motion.tr>
          );
        })}
      </AnimatePresence>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Standalone WO Row
// ─────────────────────────────────────────────────────────────

function StandaloneWORow({ wo, idx }: { wo: WorkOrder; idx: number }) {
  const cfg = WO_STATUS_CONFIG[wo.status] ?? { label: wo.status, color: 'text-muted-foreground', barColor: 'bg-slate-500' };
  const progress = woProgress(wo as any);

  return (
    <motion.tr
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.03 }}
      className="border-b border-border/30 hover:bg-foreground/5"
    >
      <td className="p-3 w-8" />
      <td className="p-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-blue-300">{wo.orderNumber}</span>
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-blue-400 border-blue-500/30">WO</Badge>
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">No PO linked</div>
      </td>
      <td className="p-3">
        {wo.sku && (
          <div className="flex items-center gap-1.5">
            <Package className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="text-xs truncate max-w-[160px]">{wo.sku.name}</span>
          </div>
        )}
      </td>
      <td className="p-3">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          {fmt(wo.plannedStart)} {fmtTime(wo.plannedStart)}
        </div>
      </td>
      <td className="p-3 text-xs text-muted-foreground">{fmt(wo.plannedEnd)}</td>
      <td className="p-3 text-xs">{wo.plannedQty.toLocaleString()}</td>
      <td className="p-3 w-36">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
            <div className={cn('h-full rounded-full', cfg.barColor)} style={{ width: `${progress}%` }} />
          </div>
          <span className="text-[10px] text-muted-foreground w-7 shrink-0">{progress}%</span>
        </div>
      </td>
      <td className="p-3">
        <span className={cn('text-xs', cfg.color)}>{cfg.label}</span>
      </td>
      <td className="p-3 text-xs text-muted-foreground">{wo.machine?.name ?? '—'}</td>
    </motion.tr>
  );
}

// ─────────────────────────────────────────────────────────────
// Main View
// ─────────────────────────────────────────────────────────────

export function ProductionSchedulingView() {
  const { t } = useTranslation(['production', 'common']);
  const [statusFilter, setStatusFilter] = useState<POStatus | 'all'>('all');

  const { data: poData, isLoading: poLoading } = useQuery({
    queryKey: ['production-orders-schedule'],
    queryFn: () => api.get('/production/production-orders', { params: { limit: 100 } }),
    staleTime: 30_000,
  });

  const { data: woData, isLoading: woLoading } = useQuery({
    queryKey: ['work-orders-schedule'],
    queryFn: () => api.get('/production/work-orders', { params: { limit: 100 } }),
    staleTime: 30_000,
  });

  const allPOs: ProductionOrder[] = (poData as any)?.data ?? (poData as any) ?? [];
  const allWOs: WorkOrder[] = (woData as any)?.data ?? (woData as any) ?? [];

  // WOs not linked to any PO
  const linkedWOIds = new Set(allPOs.flatMap(p => p.workOrders.map(w => w.id)));
  const standaloneWOs = allWOs.filter(w => !w.productionOrderId && !linkedWOIds.has(w.id));

  const filteredPOs = statusFilter === 'all' ? allPOs : allPOs.filter(p => p.status === statusFilter);

  const isLoading = poLoading || woLoading;

  const summary = [
    { label: 'Planned POs',    value: allPOs.filter(p => p.status === 'PLANNED').length,     color: 'text-slate-300'  },
    { label: 'Released POs',   value: allPOs.filter(p => p.status === 'RELEASED').length,    color: 'text-blue-400'   },
    { label: 'Running POs',    value: allPOs.filter(p => p.status === 'IN_PROGRESS').length,  color: 'text-brand-400'  },
    { label: 'Completed POs',  value: allPOs.filter(p => p.status === 'COMPLETED').length,    color: 'text-green-400'  },
    { label: 'Running WOs',    value: allWOs.filter(w => w.status === 'IN_PROGRESS').length,  color: 'text-brand-400'  },
    { label: 'Standalone WOs', value: standaloneWOs.length,                                   color: 'text-amber-400'  },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('headers.scheduling.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t('headers.scheduling.subtitle')}
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        {summary.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass-card rounded-xl p-4"
          >
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</div>
          </motion.div>
        ))}
      </div>

      {/* Legend */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <CalendarDays className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm">Schedule Legend</span>
        </div>
        <div className="flex items-center gap-4 flex-wrap text-xs">
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[9px] h-4 px-1.5 text-purple-400 border-purple-500/30">PO</Badge>
            <span className="text-muted-foreground">Production Order (ERP Level)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[9px] h-4 px-1.5 text-blue-400 border-blue-500/30">WO</Badge>
            <span className="text-muted-foreground">Work Order (Shop Floor Level)</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <ArrowRight className="w-3 h-3" />
            <span>Child WOs expand under parent PO</span>
          </div>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'PLANNED', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED'] as const).map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter(s)}
          >
            {s === 'all' ? 'All Orders' : PO_STATUS_CONFIG[s as POStatus]?.label ?? s}
          </Button>
        ))}
      </div>

      {/* Schedule table */}
      <div className="glass-card rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {['', 'Order', 'Product / Machine', 'Planned Start', 'Planned End', 'Qty', 'Progress', 'Status', 'WOs'].map((h) => (
                <th key={h} className="text-left p-3 text-muted-foreground font-medium text-xs">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-border/30">
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} className="p-3"><div className="shimmer h-4 rounded w-20" /></td>
                  ))}
                </tr>
              ))
            ) : filteredPOs.length === 0 && standaloneWOs.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-12 text-center text-muted-foreground">No orders found</td>
              </tr>
            ) : (
              <>
                {filteredPOs.map((po, i) => (
                  <POScheduleRow key={po.id} po={po} idx={i} />
                ))}

                {statusFilter === 'all' && standaloneWOs.length > 0 && (
                  <>
                    <tr className="bg-foreground/[0.02]">
                      <td colSpan={9} className="px-4 py-2 text-[10px] text-muted-foreground uppercase tracking-wider font-semibold border-t border-border">
                        Standalone Work Orders (no PO)
                      </td>
                    </tr>
                    {standaloneWOs.map((wo, i) => (
                      <StandaloneWORow key={wo.id} wo={wo} idx={i} />
                    ))}
                  </>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
