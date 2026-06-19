'use client';

/**
 * HierarchyOEE — weighted OEE rolled up Factory→Area→Line→Machine, with a six-loss
 * waterfall and a downtime Pareto by ISA-95 reason code. Consumes
 * GET /production/oee/hierarchy (KpiService). See docs/DESIGN-oee-kpi-engine.md.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LayoutGrid, GitBranch, Cpu, ChevronRight, ChevronDown, Layers } from 'lucide-react';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';

interface OeeNode {
  id: string; name: string; code: string | null; type: 'AREA' | 'LINE' | 'MACHINE';
  oee: number; availability: number; performance: number; quality: number;
  output: number; good: number;
  losses: { availabilityLossMin: number; performanceLossMin: number; qualityLossMin: number };
  children: OeeNode[];
}
interface HierResp {
  range: { from: string; to: string };
  plant: { oee: number; availability: number; performance: number; quality: number; output: number; good: number; losses: OeeNode['losses'] };
  pareto: { reasonCode: string; minutes: number; events: number }[];
  tree: OeeNode[];
}

const TYPE_ICON: Record<string, React.ElementType> = { AREA: LayoutGrid, LINE: GitBranch, MACHINE: Cpu };
const oeeText = (v: number) => v >= 85 ? 'text-green-400' : v >= 65 ? 'text-brand-400' : v >= 45 ? 'text-amber-400' : 'text-red-400';
const oeeBar = (v: number) => v >= 85 ? 'bg-green-500' : v >= 65 ? 'bg-brand-500' : v >= 45 ? 'bg-amber-500' : 'bg-red-500';
const prettyReason = (c: string) => c.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-foreground/5 px-2 py-1 text-center min-w-[58px]">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('text-xs font-semibold tabular-nums', oeeText(value))}>{value}%</div>
    </div>
  );
}

function NodeRow({ node, depth }: { node: OeeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const Icon = TYPE_ICON[node.type] ?? Cpu;
  const hasChildren = node.children?.length > 0;
  return (
    <>
      <div
        className={cn('flex items-center gap-2 py-1.5 pr-2 rounded-md hover:bg-muted/30 transition-colors', hasChildren && 'cursor-pointer')}
        style={{ paddingLeft: `${8 + depth * 18}px` }}
        onClick={() => hasChildren && setOpen(o => !o)}
      >
        <span className="w-4 shrink-0 text-muted-foreground">
          {hasChildren ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
        </span>
        <Icon size={14} className={cn('shrink-0', node.type === 'AREA' ? 'text-violet-400' : node.type === 'LINE' ? 'text-orange-400' : 'text-green-400')} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate">{node.name}</div>
          {node.code && <div className="text-[10px] text-muted-foreground font-mono">{node.code}</div>}
        </div>
        {/* OEE bar */}
        <div className="hidden sm:flex items-center gap-2 w-40 shrink-0">
          <div className="flex-1 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
            <div className={cn('h-full rounded-full', oeeBar(node.oee))} style={{ width: `${node.oee}%` }} />
          </div>
          <span className={cn('text-xs font-bold tabular-nums w-11 text-right', oeeText(node.oee))}>{node.oee}%</span>
        </div>
        <div className="hidden md:flex items-center gap-1">
          <Metric label="A" value={node.availability} />
          <Metric label="P" value={node.performance} />
          <Metric label="Q" value={node.quality} />
        </div>
      </div>
      {open && hasChildren && node.children.map(c => <NodeRow key={c.id} node={c} depth={depth + 1} />)}
    </>
  );
}

export function HierarchyOEE() {
  const { filter, key } = useScope();
  const { dateFrom, dateTo, key: timeKey } = useTimeRange();
  const { data, isLoading } = useQuery({
    queryKey: ['production', 'oee-hierarchy', key, timeKey],
    queryFn: () => api.get<HierResp>('/production/oee/hierarchy', { params: { ...filter, dateFrom, dateTo } }),
    staleTime: 30_000,
  });

  if (isLoading) {
    return <div className="industrial-card rounded-xl p-4"><div className="shimmer h-40 rounded" /></div>;
  }
  if (!data) return null;

  const { plant, pareto, tree } = data;
  const losses = plant.losses;
  const lossMax = Math.max(losses.availabilityLossMin, losses.performanceLossMin, losses.qualityLossMin, 1);
  const paretoMax = pareto[0]?.minutes || 1;

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Hierarchy tree */}
      <div className="col-span-12 lg:col-span-7">
        <div className="industrial-card rounded-xl p-4 h-full">
          <div className="flex items-center gap-2 mb-3">
            <Layers size={14} className="text-brand-400" />
            <span className="text-sm font-semibold">OEE by hierarchy</span>
            <span className="ml-auto text-[11px] text-muted-foreground">Plant <span className={cn('font-bold', oeeText(plant.oee))}>{plant.oee}%</span></span>
          </div>
          {tree.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-8">No OEE records in range yet.</div>
          ) : (
            <div className="space-y-0.5">{tree.map(n => <NodeRow key={n.id} node={n} depth={0} />)}</div>
          )}
        </div>
      </div>

      {/* Six-loss waterfall + Pareto */}
      <div className="col-span-12 lg:col-span-5 space-y-4">
        <div className="industrial-card rounded-xl p-4">
          <span className="text-sm font-semibold">Loss breakdown (plant, minutes)</span>
          <div className="mt-3 space-y-2.5">
            {([
              ['Availability loss', losses.availabilityLossMin, 'bg-red-500'],
              ['Performance loss', losses.performanceLossMin, 'bg-amber-500'],
              ['Quality loss', losses.qualityLossMin, 'bg-violet-500'],
            ] as const).map(([label, min, bar]) => (
              <div key={label}>
                <div className="flex items-center justify-between text-[11px] mb-0.5">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-semibold tabular-nums">{min} min</span>
                </div>
                <div className="h-2 rounded-full bg-foreground/10 overflow-hidden">
                  <div className={cn('h-full rounded-full', bar)} style={{ width: `${(min / lossMax) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="industrial-card rounded-xl p-4">
          <span className="text-sm font-semibold">Downtime Pareto (unplanned)</span>
          {pareto.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-6">No unplanned downtime in range.</div>
          ) : (
            <div className="mt-3 space-y-2">
              {pareto.slice(0, 7).map(p => (
                <div key={p.reasonCode}>
                  <div className="flex items-center justify-between text-[11px] mb-0.5">
                    <span className="text-muted-foreground truncate">{prettyReason(p.reasonCode)} <span className="opacity-60">· {p.events}×</span></span>
                    <span className="font-semibold tabular-nums shrink-0 ml-2">{p.minutes} min</span>
                  </div>
                  <div className="h-2 rounded-full bg-foreground/10 overflow-hidden">
                    <div className="h-full rounded-full bg-red-500/70" style={{ width: `${(p.minutes / paretoMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
