'use client';
import { DashboardInfo } from '@/components/ui/dashboard-info';
import { DataModeBadge } from '@/components/ui/data-mode-badge';
import { useTranslation } from 'react-i18next';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Download, RefreshCw, TrendingUp, TrendingDown, Cpu, Lightbulb,
  AlertTriangle, Trophy, Activity, Gauge as GaugeIcon, Layers,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HierarchyOEE } from './hierarchy-oee';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { useDashboardPrefsStore } from '@/store/dashboard-prefs-store';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  ResponsiveContainer, BarChart, Bar, Cell, ReferenceLine,
  ComposedChart, Line,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SelectMenu } from '@/components/ui/select-menu';
import { KPICard } from '@/components/widgets/kpi-card';
import { OEEGauge } from '@/components/charts/oee-gauge';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';

interface EquipmentOee {
  name: string;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
}

interface OeeCalcResponse {
  // Schedule-based (classic) + time-based (AT-OEE) — both emitted by the backend.
  current: { oee: number; availability: number; performance: number; quality: number; oeeTb?: number; availabilityTb?: number };
  trend: { period: string; oee: number; oeeTb?: number }[];
  byEquipment: EquipmentOee[];
}

const WORLD_CLASS = 85;

function weakestFactor(eq: EquipmentOee): { name: string; value: number } {
  const f = [
    { name: 'Availability', value: eq.availability },
    { name: 'Performance', value: eq.performance },
    { name: 'Quality', value: eq.quality },
  ];
  return f.sort((a, b) => a.value - b.value)[0];
}

function oeeBarColor(v: number): string {
  if (v >= WORLD_CLASS) return '#22c55e';
  if (v >= 65) return '#eab308';
  return '#ef4444';
}

// Theme-aware chart colours — adapt to light/dark instead of hardcoded dark hex.
const AXIS_TICK = { fontSize: 10, fill: 'hsl(var(--muted-foreground))' } as const;
const AXIS_TICK_STRONG = { fontSize: 10, fill: 'hsl(var(--foreground))' } as const;
const TOOLTIP_STYLE = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12, color: 'hsl(var(--popover-foreground))' } as const;
const TOOLTIP_LABEL = { color: 'hsl(var(--popover-foreground))' } as const;
const GRID_STROKE = 'hsl(var(--border))';

const GROUP_OPTIONS = [
  { value: 'time', labelKey: 'oeev.groupBy.time' },
  { value: 'productionOrder', labelKey: 'oeev.groupBy.po' },
  { value: 'workOrder', labelKey: 'oeev.groupBy.wo' },
  { value: 'shift', labelKey: 'oeev.groupBy.shift' },
  { value: 'machine', labelKey: 'oeev.groupBy.machine' },
] as const;
type GroupBy = (typeof GROUP_OPTIONS)[number]['value'];

export function ProductionOEEView() {
  const { t } = useTranslation(['production', 'common']);
  const qc = useQueryClient();
  const { filter, key } = useScope();
  const { params: timeParams, key: timeKey, preset: timeframe } = useTimeRange();
  const { atOee, trendType } = useDashboardPrefsStore();
  const [machineFilter, setMachineFilter] = useState<string>('ALL');
  const [groupBy, setGroupBy] = useState<GroupBy>('time');

  const { data: oeeData, isLoading, isFetching } = useQuery({
    queryKey: ['production', 'oee', timeKey, key],
    queryFn: () => api.get<OeeCalcResponse>('/production/oee/calculate', { params: { ...timeParams, ...filter } }),
    refetchInterval: 30_000,
  });

  // Grouped OEE (per PO / WO / shift / machine) for the trend chart's "Group by".
  const { data: groupedResp, isFetching: groupedLoading } = useQuery({
    queryKey: ['production', 'oee-trend', groupBy, timeKey, key],
    queryFn: () => api.get<{ rows: { key: string; label: string; oee: number; availability: number; performance: number; quality: number; output: number }[] }>('/production/oee/trend', { params: { groupBy, ...timeParams, ...filter } }),
    enabled: groupBy !== 'time',
    refetchInterval: 30_000,
  });
  const groupedRows = (groupedResp as any)?.rows ?? [];

  const equipment: EquipmentOee[] = oeeData?.byEquipment ?? [];
  const filteredEq = machineFilter === 'ALL' ? equipment : equipment.filter(e => e.name === machineFilter);
  const trend = oeeData?.trend ?? [];

  // ── Smart analysis — computed from the live numbers, no static data ──
  const insights = useMemo(() => {
    const out: { icon: React.ElementType; tone: string; text: string }[] = [];
    if (!equipment.length) return out;

    const ranked = [...equipment].sort((a, b) => b.oee - a.oee);
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    if (best && best.oee > 0) {
      out.push({ icon: Trophy, tone: 'text-emerald-400', text: best.oee >= WORLD_CLASS
        ? t('oeev.bestLeadsWorldClass', { name: best.name, oee: best.oee.toFixed(1) })
        : t('oeev.bestLeads', { name: best.name, oee: best.oee.toFixed(1) }) });
    }
    if (worst && worst !== best) {
      const wf = weakestFactor(worst);
      out.push({ icon: AlertTriangle, tone: 'text-amber-400', text: t('oeev.bottleneck', { name: worst.name, oee: worst.oee.toFixed(1), factor: t(`oeev.factorLower.${wf.name}`), value: wf.value.toFixed(1) }) });
    }
    const cur = oeeData?.current;
    if (cur) {
      const gf = weakestFactor({ name: 'plant', ...cur });
      const gap = WORLD_CLASS - cur.oee;
      out.push({
        icon: gap > 0 ? TrendingDown : TrendingUp,
        tone: gap > 0 ? 'text-sky-400' : 'text-emerald-400',
        text: gap > 0
          ? t('oeev.plantBelowTarget', { gap: gap.toFixed(1), target: WORLD_CLASS, factor: t(`oeev.factorLower.${gf.name}`), value: gf.value.toFixed(1) })
          : t('oeev.plantExceedsTarget', { target: WORLD_CLASS }),
      });
    }
    if (trend.length >= 2) {
      const delta = trend[trend.length - 1].oee - trend[0].oee;
      if (Math.abs(delta) >= 1) {
        out.push({
          icon: delta > 0 ? TrendingUp : TrendingDown,
          tone: delta > 0 ? 'text-emerald-400' : 'text-red-400',
          text: delta > 0
            ? t('oeev.trendImproved', { delta: Math.abs(delta).toFixed(1), timeframe })
            : t('oeev.trendDeclined', { delta: Math.abs(delta).toFixed(1), timeframe }),
        });
      }
    }
    return out;
  }, [equipment, oeeData, trend, timeframe, t]);

  const exportCsv = () => {
    const rows = [
      ['Machine', 'OEE %', 'Availability %', 'Performance %', 'Quality %', 'Weakest factor'],
      ...equipment.map(e => {
        const wf = weakestFactor(e);
        return [e.name, e.oee.toFixed(1), e.availability.toFixed(1), e.performance.toFixed(1), e.quality.toFixed(1), `${wf.name} ${wf.value.toFixed(1)}%`];
      }),
    ];
    const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `oee-${timeframe}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0 flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-lg font-bold">{t('headers.oee.title')}</h1><DashboardInfo id="production-oee" /><DataModeBadge mode="period" /></div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('headers.oee.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Machine filter */}
          <SelectMenu
            value={machineFilter}
            onValueChange={setMachineFilter}
            menuLabel={t('oeev.machine')}
            options={[
              { value: 'ALL', label: t('oeev.allMachines') },
              ...equipment.map(e => ({ value: e.name, label: e.name })),
            ]}
          />
          <Link
            href="/analytics"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-xs font-medium hover:bg-muted/50 transition-colors"
          >
            <Layers size={13} className="text-brand-400" />
            {t('oeev.deepAnalysis')}
          </Link>
          <Button
            variant="outline" size="sm" className="gap-1.5 h-8 text-xs"
            onClick={() => qc.invalidateQueries({ queryKey: ['production', 'oee'] })}
          >
            <RefreshCw size={13} className={cn(isFetching && 'animate-spin')} />
            {t('po.refresh')}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={exportCsv} disabled={!equipment.length}>
            <Download size={13} />
            {t('oeev.exportCsv')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title={atOee ? `${t('cards.oee')} (AT)` : t('cards.oee')} value={(atOee ? oeeData?.current.oeeTb : oeeData?.current.oee) ?? 0} unit="%" target={WORLD_CLASS} colorMode="oee" isLoading={isLoading} />
          <KPICard title={atOee ? `${t('cards.availability')} (AT)` : t('cards.availability')} value={(atOee ? oeeData?.current.availabilityTb : oeeData?.current.availability) ?? 0} unit="%" colorMode="default" isLoading={isLoading} />
          <KPICard title={t('cards.performance')} value={oeeData?.current.performance ?? 0} unit="%" colorMode="default" isLoading={isLoading} />
          <KPICard title={t('cards.quality')} value={oeeData?.current.quality ?? 0} unit="%" colorMode="default" isLoading={isLoading} />
        </div>

        {/* Time-Based (AT-OEE) — shown beside the schedule-based numbers above */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground -mt-2 px-1">
          <span>Time-Based OEE (AT-OEE): <b className="text-foreground">{(oeeData?.current.oeeTb ?? 0).toFixed(1)}%</b></span>
          <span>Availability (Time-Based): <b className="text-foreground">{(oeeData?.current.availabilityTb ?? 0).toFixed(1)}%</b></span>
          <span className="opacity-70">Schedule-based above · time-based = uptime ÷ (uptime + downtime)</span>
        </div>

        {/* Smart insights — derived live from the data */}
        {insights.length > 0 && (
          <div className="industrial-card rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2.5">
              <Lightbulb size={14} className="text-amber-400" />
              <span className="text-sm font-semibold">Smart Insights</span>
              <Badge variant="outline" className="text-[9px] h-4">live analysis</Badge>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {insights.map((ins, i) => (
                <div key={i} className="flex items-start gap-2 text-xs p-2 rounded-lg bg-muted/20 border border-border/30">
                  <ins.icon size={13} className={cn('mt-0.5 shrink-0', ins.tone)} />
                  <span>{ins.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-12 gap-4">
          {/* Gauge */}
          <div className="col-span-12 lg:col-span-4">
            <OEEGauge
              oee={(atOee ? oeeData?.current.oeeTb : oeeData?.current.oee) ?? 0}
              availability={(atOee ? oeeData?.current.availabilityTb : oeeData?.current.availability) ?? 0}
              performance={oeeData?.current.performance ?? 0}
              quality={oeeData?.current.quality ?? 0}
              isLoading={isLoading}
            />
          </div>

          {/* OEE trend */}
          <div className="col-span-12 lg:col-span-8">
            <div className="industrial-card rounded-xl p-4 h-full">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <Activity size={14} className="text-primary" />
                <h3 className="text-sm font-semibold">{t('oeev.oeeTrend', { defaultValue: 'OEE Trend' })}</h3>
                {/* Group-by: time line, or OEE per PO / WO / Shift / Machine */}
                <div className="flex items-center gap-0.5 rounded-lg border border-border/50 p-0.5 ml-auto">
                  {GROUP_OPTIONS.map(o => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setGroupBy(o.value)}
                      className={cn('px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors',
                        groupBy === o.value ? 'bg-brand-500/20 text-brand-300' : 'text-muted-foreground hover:text-foreground')}
                    >
                      {t(o.labelKey)}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-muted-foreground">{t('oeev.target', { defaultValue: 'target' })} {WORLD_CLASS}%</span>
              </div>
              {groupBy === 'time' ? (
                isLoading ? (
                  <div className="shimmer h-52 rounded" />
                ) : trend.length === 0 ? (
                  <div className="h-52 flex items-center justify-center text-xs text-muted-foreground">{t('oeev.noTrend', { defaultValue: 'No trend data for this timeframe' })}</div>
                ) : (
                  <ResponsiveContainer width="100%" height={210}>
                    <ComposedChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                      <defs>
                        <linearGradient id="oeeFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#4c7571" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="#4c7571" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} strokeOpacity={0.4} />
                      <XAxis dataKey="period" tick={AXIS_TICK} />
                      <YAxis domain={[0, 100]} tick={AXIS_TICK} />
                      <ReTooltip
                        contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL} itemStyle={TOOLTIP_LABEL}
                        formatter={(v: any, name: any) => [`${Number(v).toFixed(1)}%`, name === 'oeeTb' ? 'OEE (Time-Based)' : 'OEE (Schedule)']}
                      />
                      <ReferenceLine y={WORLD_CLASS} stroke="#22c55e" strokeDasharray="6 4" strokeOpacity={0.6} />
                      {/* Primary OEE series — render style follows the ScopePanel View toggle */}
                      {trendType === 'bar' ? (
                        <Bar dataKey="oee" name="oee" fill="#4c7571" radius={[3, 3, 0, 0]} maxBarSize={28} />
                      ) : trendType === 'line' ? (
                        <Line type="monotone" dataKey="oee" name="oee" stroke="#4c7571" strokeWidth={2} dot={false} />
                      ) : (
                        <Area type="monotone" dataKey="oee" name="oee" stroke="#4c7571" strokeWidth={2} fill="url(#oeeFill)" />
                      )}
                      {/* Time-based OEE (AT-OEE) overlaid as a dashed line for comparison */}
                      <Line type="monotone" dataKey="oeeTb" name="oeeTb" stroke="#22d3ee" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )
              ) : (
                groupedLoading && groupedRows.length === 0 ? (
                  <div className="shimmer h-52 rounded" />
                ) : groupedRows.length === 0 ? (
                  <div className="h-52 flex items-center justify-center text-xs text-muted-foreground">{t('oeev.noGroupData', { defaultValue: 'No production in this window for the selected grouping' })}</div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(210, Math.min(groupedRows.length, 12) * 34)}>
                    <BarChart data={groupedRows.slice(0, 12)} layout="vertical" margin={{ top: 0, right: 30, bottom: 0, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} strokeOpacity={0.4} horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} tick={AXIS_TICK} />
                      <YAxis type="category" dataKey="label" width={130} tick={AXIS_TICK_STRONG} />
                      <ReTooltip
                        contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL} itemStyle={TOOLTIP_LABEL}
                        formatter={(v: any, n: any) => [`${Number(v).toFixed(1)}%`, n === 'oee' ? 'OEE' : n]}
                      />
                      <ReferenceLine x={WORLD_CLASS} stroke="#22c55e" strokeDasharray="6 4" strokeOpacity={0.6} />
                      <Bar dataKey="oee" radius={[0, 4, 4, 0]} barSize={16}>
                        {groupedRows.slice(0, 12).map((r: any) => <Cell key={r.key} fill={oeeBarColor(r.oee)} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )
              )}
            </div>
          </div>

          {/* Machine ranking bar chart */}
          <div className="col-span-12 lg:col-span-5">
            <div className="industrial-card rounded-xl p-4 h-full">
              <div className="flex items-center gap-2 mb-3">
                <GaugeIcon size={14} className="text-primary" />
                <h3 className="text-sm font-semibold">Machine Ranking</h3>
              </div>
              {isLoading ? (
                <div className="shimmer h-56 rounded" />
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(180, filteredEq.length * 38)}>
                  <BarChart data={filteredEq} layout="vertical" margin={{ top: 0, right: 28, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} strokeOpacity={0.4} horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={AXIS_TICK} />
                    <YAxis type="category" dataKey="name" width={120} tick={AXIS_TICK_STRONG} />
                    <ReTooltip
                      contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL} itemStyle={TOOLTIP_LABEL}
                      formatter={(v: any) => [`${Number(v).toFixed(1)}%`, 'OEE']}
                    />
                    <ReferenceLine x={WORLD_CLASS} stroke="#22c55e" strokeDasharray="6 4" strokeOpacity={0.6} />
                    <Bar dataKey="oee" radius={[0, 4, 4, 0]} barSize={18}>
                      {filteredEq.map(e => <Cell key={e.name} fill={oeeBarColor(e.oee)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Per-machine factor breakdown */}
          <div className="col-span-12 lg:col-span-7">
            <div className="industrial-card rounded-xl p-4 h-full">
              <div className="flex items-center gap-2 mb-3">
                <Cpu size={14} className="text-primary" />
                <h3 className="text-sm font-semibold">Loss Factor Breakdown</h3>
                <span className="text-[10px] text-muted-foreground ml-auto">weakest factor highlighted</span>
              </div>
              <div className="space-y-2.5">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => <div key={i} className="shimmer h-14 rounded" />)
                ) : filteredEq.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">No OEE records — complete work orders to generate data.</div>
                ) : filteredEq.map(eq => {
                  const wf = weakestFactor(eq);
                  return (
                    <div key={eq.name} className="p-3 rounded-lg border border-border/30 hover:bg-muted/20">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium">{eq.name}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[9px] h-4 text-amber-400 border-amber-500/30">
                            ▼ {wf.name}
                          </Badge>
                          <span className={cn('text-sm font-bold', eq.oee >= WORLD_CLASS ? 'text-emerald-400' : eq.oee >= 65 ? 'text-yellow-400' : 'text-red-400')}>
                            {eq.oee.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {([['Availability', eq.availability], ['Performance', eq.performance], ['Quality', eq.quality]] as const).map(([label, v]) => (
                          <div key={label}>
                            <div className="flex items-center justify-between text-[10px] mb-0.5">
                              <span className={cn('text-muted-foreground', wf.name === label && 'text-amber-400 font-semibold')}>{label}</span>
                              <span className="font-semibold tabular-nums">{v.toFixed(1)}%</span>
                            </div>
                            <div className="h-1 rounded-full bg-muted/40 overflow-hidden">
                              <div
                                className={cn('h-full rounded-full', wf.name === label ? 'bg-amber-400' : 'bg-primary/70')}
                                style={{ width: `${Math.min(100, v)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* OEE rolled up Factory → Area → Line → Machine + losses + Pareto */}
        <HierarchyOEE />
      </div>
    </div>
  );
}
