'use client';
import { useTranslation } from 'react-i18next';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, ResponsiveContainer,
  Cell, ReferenceLine, AreaChart, Area, Legend,
} from 'recharts';
import { Sparkles, Gauge, Package, CheckCircle2, Activity, Layers, Clock } from 'lucide-react';
import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { cn } from '@/lib/utils';
import { DashboardInfo } from '@/components/ui/dashboard-info';
import { DataModeBadge } from '@/components/ui/data-mode-badge';

// Theme-aware chart colours (adapt to light/dark).
const AXIS = { fontSize: 10, fill: 'hsl(var(--muted-foreground))' } as const;
const AXIS_STRONG = { fontSize: 10, fill: 'hsl(var(--foreground))' } as const;
const TT = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12, color: 'hsl(var(--popover-foreground))' } as const;
const TTL = { color: 'hsl(var(--popover-foreground))' } as const;
const GRID = 'hsl(var(--border))';
const WORLD_CLASS = 85;

const oeeColor = (v: number) => (v >= 85 ? '#22c55e' : v >= 65 ? '#3b82f6' : v >= 45 ? '#f59e0b' : '#ef4444');

const GROUPS = [
  { value: 'shift', labelKey: 'insights.group.shift', icon: Clock },
  { value: 'productionOrder', labelKey: 'insights.group.po', icon: Layers },
  { value: 'workOrder', labelKey: 'insights.group.wo', icon: Layers },
  { value: 'machine', labelKey: 'insights.group.machine', icon: Activity },
  { value: 'time', labelKey: 'insights.group.time', icon: Clock },
] as const;
type GroupBy = (typeof GROUPS)[number]['value'];

interface GroupRow { key: string; label: string; oee: number; availability: number; performance: number; quality: number; output: number; good: number; }

export function InsightsStudioView() {
  const { t } = useTranslation(['production', 'common']);
  const { filter, key } = useScope();
  const { params: timeParams, key: timeKey, label: timeLabel } = useTimeRange();
  const [groupBy, setGroupBy] = useState<GroupBy>('shift');

  const { data: oeeCalc, isFetching: kpiLoading } = useQuery({
    queryKey: ['insights', 'oee-calc', timeKey, key],
    queryFn: () => api.get<any>('/production/oee/calculate', { params: { ...timeParams, ...filter } }),
    refetchInterval: 60_000,
  });
  const { data: grouped, isFetching: groupLoading } = useQuery({
    queryKey: ['insights', 'trend', groupBy, timeKey, key],
    queryFn: () => api.get<{ rows: GroupRow[] }>('/production/oee/trend', { params: { groupBy, ...timeParams, ...filter } }),
    enabled: groupBy !== 'time',
    refetchInterval: 60_000,
  });

  const c: any = oeeCalc ?? {};
  const rows: GroupRow[] = ((grouped as any)?.rows ?? []).slice(0, 14);
  const trend = c.trend ?? [];
  const totalOutput = Math.round(Number(c.totalCount ?? 0));
  const goodOutput = Math.round(Number(c.goodCount ?? 0));
  const scrap = Math.max(0, totalOutput - goodOutput);
  const r1 = (v: any) => Math.round((Number(v) || 0) * 10) / 10;

  const kpis = [
    { label: t('cards.oee'), value: `${r1(c.oee)}%`, icon: Gauge, color: 'text-brand-400' },
    { label: t('cards.availability'), value: `${r1(c.availability)}%`, icon: Activity, color: 'text-sky-400' },
    { label: t('cards.performance'), value: `${r1(c.performance)}%`, icon: Activity, color: 'text-violet-400' },
    { label: t('cards.quality'), value: `${r1(c.quality)}%`, icon: CheckCircle2, color: 'text-emerald-400' },
    { label: t('insights.output'), value: r1(totalOutput).toLocaleString(), icon: Package, color: 'text-amber-400' },
    { label: t('insights.scrap'), value: r1(scrap).toLocaleString(), icon: Package, color: scrap > 0 ? 'text-red-400' : 'text-muted-foreground' },
  ];

  // Output good-vs-scrap per group (stacked)
  const outputRows = rows.map((r) => ({ label: r.label, good: r.good, scrap: Math.max(0, r.output - r.good) }));

  const barHeight = Math.max(220, Math.min(rows.length, 14) * 34);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0 flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-brand-400" />
            <h1 className="text-lg font-bold">{t('insights.title')}</h1>
            <DashboardInfo id="insights-studio" />
            <DataModeBadge mode="period" label={timeLabel} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{t('insights.subtitle')}</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* KPI strip (period) */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('insights.periodSummary')}</h3>
            <DataModeBadge mode="period" label={timeLabel} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {kpis.map((k) => (
              <div key={k.label} className="glass-card p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-muted-foreground">{k.label}</span>
                  <k.icon size={13} className={k.color} />
                </div>
                <p className={cn('text-xl font-bold tabular-nums', k.color)}>{kpiLoading && !oeeCalc ? '—' : k.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Group-by control */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground">{t('insights.groupBy')}</span>
          <div className="flex items-center gap-1 rounded-lg border border-border/50 p-0.5">
            {GROUPS.map((g) => (
              <button
                key={g.value}
                type="button"
                onClick={() => setGroupBy(g.value)}
                className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                  groupBy === g.value ? 'bg-brand-500/20 text-brand-300' : 'text-muted-foreground hover:text-foreground')}
              >
                <g.icon size={12} />{t(g.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {groupBy === 'time' ? (
          /* Time trend (line) */
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity size={14} className="text-brand-400" />
              <h3 className="text-sm font-semibold">{t('insights.oeeTrend')}</h3>
              <DataModeBadge mode="period" label={timeLabel} className="ml-auto" />
            </div>
            {trend.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-xs text-muted-foreground">{t('insights.noData')}</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="isOee" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} strokeOpacity={0.4} />
                  <XAxis dataKey="period" tick={AXIS} />
                  <YAxis domain={[0, 100]} tick={AXIS} />
                  <ReTooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTL} formatter={(v: any, n: any) => [`${Number(v).toFixed(1)}%`, n === 'oeeTb' ? 'OEE (Time-Based)' : 'OEE']} />
                  <ReferenceLine y={WORLD_CLASS} stroke="#22c55e" strokeDasharray="6 4" strokeOpacity={0.6} />
                  <Area type="monotone" dataKey="oee" stroke="#818cf8" strokeWidth={2} fill="url(#isOee)" />
                  <Area type="monotone" dataKey="oeeTb" stroke="#22d3ee" strokeWidth={2} strokeDasharray="5 3" fill="none" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        ) : groupLoading && rows.length === 0 ? (
          <div className="glass-card p-4"><div className="shimmer h-64 rounded" /></div>
        ) : rows.length === 0 ? (
          <div className="glass-card p-4 h-64 flex items-center justify-center text-xs text-muted-foreground">{t('insights.noGroupData')}</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* OEE by group */}
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Gauge size={14} className="text-brand-400" />
                <h3 className="text-sm font-semibold">{t('insights.oeeBy')}</h3>
                <span className="text-[10px] text-muted-foreground ml-auto">{t('oeev.target', { defaultValue: 'target' })} {WORLD_CLASS}%</span>
              </div>
              <ResponsiveContainer width="100%" height={barHeight}>
                <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 30, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} strokeOpacity={0.4} horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={AXIS} />
                  <YAxis type="category" dataKey="label" width={130} tick={AXIS_STRONG} />
                  <ReTooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTL} formatter={(v: any) => [`${Number(v).toFixed(1)}%`, 'OEE']} />
                  <ReferenceLine x={WORLD_CLASS} stroke="#22c55e" strokeDasharray="6 4" strokeOpacity={0.6} />
                  <Bar dataKey="oee" radius={[0, 4, 4, 0]} barSize={15}>
                    {rows.map((r) => <Cell key={r.key} fill={oeeColor(r.oee)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Output (good vs scrap) by group */}
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Package size={14} className="text-amber-400" />
                <h3 className="text-sm font-semibold">{t('insights.outputBy')}</h3>
              </div>
              <ResponsiveContainer width="100%" height={barHeight}>
                <BarChart data={outputRows} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} strokeOpacity={0.4} horizontal={false} />
                  <XAxis type="number" tick={AXIS} />
                  <YAxis type="category" dataKey="label" width={130} tick={AXIS_STRONG} />
                  <ReTooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTL} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="good" name={t('insights.good')} stackId="o" fill="#22c55e" radius={[0, 0, 0, 0]} barSize={15} />
                  <Bar dataKey="scrap" name={t('insights.scrap')} stackId="o" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={15} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* A / P / Q by group */}
            <div className="glass-card p-4 lg:col-span-2">
              <div className="flex items-center gap-2 mb-3">
                <Activity size={14} className="text-violet-400" />
                <h3 className="text-sm font-semibold">{t('insights.apqBy')}</h3>
              </div>
              <ResponsiveContainer width="100%" height={Math.max(240, rows.length * 28)}>
                <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} strokeOpacity={0.4} horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={AXIS} />
                  <YAxis type="category" dataKey="label" width={130} tick={AXIS_STRONG} />
                  <ReTooltip contentStyle={TT} labelStyle={TTL} itemStyle={TTL} formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="availability" name={t('cards.availability')} fill="#0ea5e9" barSize={9} />
                  <Bar dataKey="performance" name={t('cards.performance')} fill="#a855f7" barSize={9} />
                  <Bar dataKey="quality" name={t('cards.quality')} fill="#22c55e" barSize={9} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Detail table */}
            <div className="glass-card p-4 lg:col-span-2 overflow-x-auto">
              <h3 className="text-sm font-semibold mb-3">{t('insights.detail')}</h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border/40">
                    <th className="text-start font-medium py-1.5">{t('insights.group.label')}</th>
                    <th className="text-end font-medium">OEE</th>
                    <th className="text-end font-medium">A</th>
                    <th className="text-end font-medium">P</th>
                    <th className="text-end font-medium">Q</th>
                    <th className="text-end font-medium">{t('insights.output')}</th>
                    <th className="text-end font-medium">{t('insights.good')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="border-b border-border/20">
                      <td className="py-1.5 font-medium truncate max-w-[200px]">{r.label}</td>
                      <td className="text-end font-bold tabular-nums" style={{ color: oeeColor(r.oee) }}>{r.oee.toFixed(1)}%</td>
                      <td className="text-end tabular-nums text-muted-foreground">{r.availability.toFixed(1)}%</td>
                      <td className="text-end tabular-nums text-muted-foreground">{r.performance.toFixed(1)}%</td>
                      <td className="text-end tabular-nums text-muted-foreground">{r.quality.toFixed(1)}%</td>
                      <td className="text-end tabular-nums">{r1(r.output).toLocaleString()}</td>
                      <td className="text-end tabular-nums text-green-400">{r1(r.good).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
