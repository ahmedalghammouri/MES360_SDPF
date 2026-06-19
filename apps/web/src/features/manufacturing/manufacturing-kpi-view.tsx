'use client';

import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Target,
  Award,
  Gauge,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { useScope } from '@/hooks/use-scope';

import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// ─── Types ────────────────────────────────────────────────────────────────────

type Timeframe = 'today' | 'week' | 'month';

interface DashboardKpis {
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  // Time-based (AT-OEE) variant emitted by the backend alongside schedule-based OEE.
  oeeTb?: number;
  availabilityTb?: number;
  totalOutput: number;
  activeAlarms: number;
  oeeTrend: number;
  availabilityTrend: number;
  performanceTrend: number;
  qualityTrend: number;
  outputTrend: number;
  alarmTrend: number;
}

interface OeeRecord {
  id: string;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  // Time-based (AT-OEE) variant now emitted per record by the backend.
  oeeTb?: number;
  availabilityTb?: number;
  totalOutput: number;
  recordDate: string;
  machineId: string;
  machine: { name: string };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOeeColorClass(value: number): string {
  if (value >= 85) return 'text-emerald-400';
  if (value >= 65) return 'text-sky-400';
  if (value >= 45) return 'text-amber-400';
  return 'text-red-400';
}

function getOeeBgClass(value: number): string {
  if (value >= 85) return 'bg-emerald-500/15 border-emerald-500/30';
  if (value >= 65) return 'bg-sky-500/15 border-sky-500/30';
  if (value >= 45) return 'bg-amber-500/15 border-amber-500/30';
  return 'bg-red-500/15 border-red-500/30';
}

function getOeeLabel(value: number): string {
  if (value >= 85) return 'World Class';
  if (value >= 65) return 'Good';
  if (value >= 45) return 'Acceptable';
  return 'Poor';
}

function getOeeStatusColor(value: number): string {
  if (value >= 85) return 'bg-emerald-500';
  if (value >= 65) return 'bg-sky-500';
  if (value >= 45) return 'bg-amber-500';
  return 'bg-red-500';
}


// ─── Sub-components ───────────────────────────────────────────────────────────

interface KpiCardProps {
  title: string;
  value: number;
  trend: number;
  target: number;
  icon: React.ReactNode;
  isLoading: boolean;
}

function KpiCard({ title, value, trend, target, icon, isLoading }: KpiCardProps) {
  const trendUp = trend >= 0;
  const gap = value - target;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={cn(
        'industrial-card p-5 flex flex-col gap-3 border rounded-xl',
        getOeeBgClass(value),
      )}
    >
      {isLoading ? (
        <div className="space-y-3">
          <div className="shimmer h-4 w-24 rounded" />
          <div className="shimmer h-10 w-16 rounded" />
          <div className="shimmer h-3 w-32 rounded" />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {title}
            </span>
            <span className="text-muted-foreground/60">{icon}</span>
          </div>

          <div className="flex items-end gap-3">
            <span className={cn('text-4xl font-bold tabular-nums leading-none', getOeeColorClass(value))}>
              {value.toFixed(1)}
              <span className="text-xl ml-0.5">%</span>
            </span>
            <div
              className={cn(
                'flex items-center gap-0.5 text-xs font-semibold mb-1',
                trendUp ? 'text-emerald-400' : 'text-red-400',
              )}
            >
              {trendUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {Math.abs(trend).toFixed(1)}%
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">
              Target: <span className="font-semibold text-foreground">{target}%</span>
            </span>
            <span className={cn('font-semibold', gap >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {gap >= 0 ? '+' : ''}{gap.toFixed(1)}%
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className={cn('inline-block w-2 h-2 rounded-full', getOeeStatusColor(value))}
            />
            <span className="text-[11px] text-muted-foreground">{getOeeLabel(value)}</span>
          </div>
        </>
      )}
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ManufacturingKpiView() {
  const { t } = useTranslation('modules');
  const { filter, key } = useScope();
  const [timeframe, setTimeframe] = useState<Timeframe>('today');

  // Map the local timeframe selector to an actual date range so the backend KPI
  // window changes (RC-6) — previously the selector never reached the API.
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const timeParams = (() => {
    const now = new Date();
    const from = new Date(now);
    if (timeframe === 'week') from.setDate(now.getDate() - 7);
    else if (timeframe === 'month') from.setDate(now.getDate() - 30);
    else from.setHours(0, 0, 0, 0);
    return { timeframe, dateFrom: iso(from), dateTo: iso(now) };
  })();

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['dashboard', 'kpis', timeframe, key],
    queryFn: () => api.get<DashboardKpis>('/dashboard/kpis', { params: { ...filter, ...timeParams } }),
    refetchInterval: 30_000,
  });

  const { data: oeeRecords, isLoading: recordsLoading } = useQuery({
    queryKey: ['production', 'oee-records', timeframe, key],
    // Endpoint is paginated → unwrap the `data` array (guard non-array shapes)
    queryFn: async () => {
      const res = await api.get<{ data: OeeRecord[] } | OeeRecord[]>('/production/oee-records', { params: { limit: 30, ...filter, dateFrom: timeParams.dateFrom, dateTo: timeParams.dateTo } });
      if (Array.isArray(res)) return res;
      return Array.isArray(res?.data) ? res.data : [];
    },
    refetchInterval: 60_000,
  });

  // Always work with a guaranteed array — never trust the query result shape.
  const records: OeeRecord[] = Array.isArray(oeeRecords) ? oeeRecords : [];

  // ── Chart data: sort records by date ────────────────────────────────────────
  const chartData = useMemo(() => {
    return [...records]
      .sort((a, b) => new Date(a.recordDate).getTime() - new Date(b.recordDate).getTime())
      .map((r) => ({
        // Include time so multiple records on the same day are distinguishable on the axis.
        date: new Date(r.recordDate).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        oee: parseFloat(r.oee.toFixed(1)),
        oeeTb: r.oeeTb != null ? parseFloat(r.oeeTb.toFixed(1)) : null,
        availability: parseFloat(r.availability.toFixed(1)),
        availabilityTb: r.availabilityTb != null ? parseFloat(r.availabilityTb.toFixed(1)) : null,
        quality: parseFloat(r.quality.toFixed(1)),
      }));
  }, [records]);

  // ── Machine leaderboard: group & average by machineId ───────────────────────
  const leaderboard = useMemo(() => {
    const map = new Map<
      string,
      { name: string; oeeSum: number; oeeTbSum: number; availSum: number; perfSum: number; qualSum: number; count: number }
    >();

    for (const r of records) {
      const existing = map.get(r.machineId);
      if (existing) {
        existing.oeeSum += r.oee;
        existing.oeeTbSum += r.oeeTb ?? 0;
        existing.availSum += r.availability;
        existing.perfSum += r.performance;
        existing.qualSum += r.quality;
        existing.count += 1;
      } else {
        map.set(r.machineId, {
          name: r.machine?.name ?? r.machineId,
          oeeSum: r.oee,
          oeeTbSum: r.oeeTb ?? 0,
          availSum: r.availability,
          perfSum: r.performance,
          qualSum: r.quality,
          count: 1,
        });
      }
    }

    return Array.from(map.values())
      .map((m) => ({
        name: m.name,
        oee: m.oeeSum / m.count,
        oeeTb: m.oeeTbSum / m.count,
        availability: m.availSum / m.count,
        performance: m.perfSum / m.count,
        quality: m.qualSum / m.count,
      }))
      .sort((a, b) => b.oee - a.oee);
  }, [records]);

  // ── Classification counts ────────────────────────────────────────────────────
  const classifications = useMemo(() => {
    const worldClass = leaderboard.filter((m) => m.oee >= 85).length;
    const good = leaderboard.filter((m) => m.oee >= 65 && m.oee < 85).length;
    const acceptable = leaderboard.filter((m) => m.oee >= 45 && m.oee < 65).length;
    const poor = leaderboard.filter((m) => m.oee < 45).length;
    return { worldClass, good, acceptable, poor };
  }, [leaderboard]);

  // ── KPI summary rows for the side table ─────────────────────────────────────
  const kpiRows = useMemo(() => {
    if (!kpis) return [];
    return [
      { metric: t('mfgKpi.metric.oee'), actual: kpis.oee, target: 85 },
      { metric: t('mfgKpi.metric.availability'), actual: kpis.availability, target: 90 },
      { metric: t('mfgKpi.metric.performance'), actual: kpis.performance, target: 95 },
      { metric: t('mfgKpi.metric.quality'), actual: kpis.quality, target: 99 },
    ];
  }, [kpis]);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: 14 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35 } },
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-brand-500/10 text-brand-400">
            <BarChart3 size={18} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">{t('mfgKpi.title')}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              OEE monitoring &amp; machine performance
            </p>
          </div>
        </div>

        {/* Timeframe selector */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border/40">
          {(['today', 'week', 'month'] as Timeframe[]).map((tf) => (
            <Button
              key={tf}
              variant="ghost"
              size="sm"
              onClick={() => setTimeframe(tf)}
              className={cn(
                'h-7 px-3 text-xs capitalize transition-colors',
                timeframe === tf
                  ? 'bg-background text-foreground shadow-sm font-semibold'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tf === 'today' ? 'Today' : tf === 'week' ? 'This Week' : 'This Month'}
            </Button>
          ))}
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto p-6">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-6"
        >
          {/* ── 1. Four OEE component cards ─────────────────────────────────── */}
          <motion.div
            variants={itemVariants}
            className="grid grid-cols-2 xl:grid-cols-4 gap-4"
          >
            <KpiCard
              title="Overall OEE"
              value={kpis?.oee ?? 0}
              trend={kpis?.oeeTrend ?? 0}
              target={85}
              icon={<Gauge size={16} />}
              isLoading={kpisLoading}
            />
            <KpiCard
              title="Availability"
              value={kpis?.availability ?? 0}
              trend={kpis?.availabilityTrend ?? 0}
              target={90}
              icon={<Target size={16} />}
              isLoading={kpisLoading}
            />
            <KpiCard
              title="Performance"
              value={kpis?.performance ?? 0}
              trend={kpis?.performanceTrend ?? 0}
              target={95}
              icon={<TrendingUp size={16} />}
              isLoading={kpisLoading}
            />
            <KpiCard
              title="Quality"
              value={kpis?.quality ?? 0}
              trend={kpis?.qualityTrend ?? 0}
              target={99}
              icon={<Award size={16} />}
              isLoading={kpisLoading}
            />
          </motion.div>

          {/* Time-Based (AT-OEE) — shown beside the schedule-based KPIs above */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground px-1">
            <span>Time-Based OEE (AT-OEE): <b className="text-foreground">{(kpis?.oeeTb ?? 0).toFixed(1)}%</b></span>
            <span>Availability (Time-Based): <b className="text-foreground">{(kpis?.availabilityTb ?? 0).toFixed(1)}%</b></span>
            <span className="opacity-70">Cards above are schedule-based · time-based = uptime ÷ (uptime + downtime)</span>
          </div>

          {/* ── 2. Trend chart + KPI summary table ──────────────────────────── */}
          <motion.div variants={itemVariants} className="grid grid-cols-3 gap-4">
            {/* Line chart (2/3) */}
            <div className="col-span-3 lg:col-span-2 industrial-card p-5 rounded-xl border border-border/40">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold">OEE Trend — Last 30 Records</h2>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className="inline-block w-2 h-2 rounded-full bg-brand-400" />
                  OEE
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 ml-2" />
                  Availability
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400 ml-2" />
                  Quality
                </div>
              </div>

              {recordsLoading ? (
                <div className="shimmer h-[300px] rounded-lg" />
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: '11px',
                      }}
                      formatter={(value: number) => [`${value.toFixed(1)}%`]}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <ReferenceLine
                      y={85}
                      stroke="#10b981"
                      strokeDasharray="5 3"
                      strokeWidth={1.5}
                      label={{
                        value: 'World Class',
                        fill: '#10b981',
                        fontSize: 10,
                        position: 'insideTopRight',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="oee"
                      name="OEE (Schedule)"
                      stroke="#6366f1"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    {/* Time-based OEE (AT-OEE) overlay */}
                    <Line
                      type="monotone"
                      dataKey="oeeTb"
                      name="OEE (Time-Based)"
                      stroke="#22d3ee"
                      strokeWidth={2}
                      strokeDasharray="5 3"
                      dot={false}
                      activeDot={{ r: 4 }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="availability"
                      name="Availability"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="quality"
                      name="Quality"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* KPI summary table (1/3) */}
            <div className="col-span-3 lg:col-span-1 industrial-card p-5 rounded-xl border border-border/40 flex flex-col">
              <h2 className="text-sm font-semibold mb-4">{t('mfgKpi.summary')}</h2>

              {kpisLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="shimmer h-10 rounded" />
                  ))}
                </div>
              ) : (
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/40">
                        <th className="text-start py-2 text-muted-foreground font-medium">{t('mfgKpi.colMetric')}</th>
                        <th className="text-end py-2 text-muted-foreground font-medium">{t('mfgKpi.colActual')}</th>
                        <th className="text-end py-2 text-muted-foreground font-medium">{t('mfgKpi.colTarget')}</th>
                        <th className="text-right py-2 text-muted-foreground font-medium">Gap</th>
                        <th className="text-end py-2 text-muted-foreground font-medium">{t('mfgKpi.colStatus')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kpiRows.map((row) => {
                        const gap = row.actual - row.target;
                        const met = gap >= 0;
                        return (
                          <tr
                            key={row.metric}
                            className="border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors"
                          >
                            <td className="py-2.5 font-medium">{row.metric}</td>
                            <td
                              className={cn(
                                'py-2.5 text-right font-semibold tabular-nums',
                                getOeeColorClass(row.actual),
                              )}
                            >
                              {row.actual.toFixed(1)}%
                            </td>
                            <td className="py-2.5 text-right text-muted-foreground tabular-nums">
                              {row.target}%
                            </td>
                            <td
                              className={cn(
                                'py-2.5 text-right font-semibold tabular-nums',
                                met ? 'text-emerald-400' : 'text-red-400',
                              )}
                            >
                              {met ? '+' : ''}{gap.toFixed(1)}%
                            </td>
                            <td className="py-2.5 text-right">
                              <span
                                className={cn(
                                  'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold',
                                  met
                                    ? 'bg-emerald-500/15 text-emerald-400'
                                    : 'bg-red-500/15 text-red-400',
                                )}
                              >
                                {met ? 'MET' : 'MISS'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* Alarm & output callouts */}
                  {kpis && (
                    <div className="mt-4 space-y-2 pt-4 border-t border-border/30">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{t('mfgKpi.totalOutput')}</span>
                        <span className="font-semibold tabular-nums">
                          {kpis.totalOutput.toLocaleString()} units
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{t('mfgKpi.activeAlarms')}</span>
                        <span
                          className={cn(
                            'font-semibold tabular-nums',
                            kpis.activeAlarms > 0 ? 'text-red-400' : 'text-emerald-400',
                          )}
                        >
                          {kpis.activeAlarms}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>

          {/* ── 3. Machine OEE Leaderboard ──────────────────────────────────── */}
          <motion.div variants={itemVariants} className="industrial-card p-5 rounded-xl border border-border/40">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Award size={16} className="text-amber-400" />
                <h2 className="text-sm font-semibold">{t('mfgKpi.leaderboard')}</h2>
              </div>
              <Badge variant="outline" className="text-[10px]">
                {leaderboard.length} machines
              </Badge>
            </div>

            {recordsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="shimmer h-10 rounded" />
                ))}
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">
                No OEE records found for this period.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="text-left py-2 px-2 text-muted-foreground font-medium w-10">#</th>
                      <th className="text-start py-2 px-2 text-muted-foreground font-medium">{t('mfgKpi.colMachine')}</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">OEE%</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">OEE-TB%</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">Avail%</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">Perf%</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">Quality%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((machine, idx) => (
                      <tr
                        key={machine.name}
                        className="border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors"
                      >
                        {/* Rank */}
                        <td className="py-2.5 px-2">
                          <span
                            className={cn(
                              'inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold',
                              idx === 0
                                ? 'bg-amber-500/20 text-amber-400'
                                : idx === 1
                                ? 'bg-slate-400/20 text-slate-400'
                                : idx === 2
                                ? 'bg-orange-600/20 text-orange-400'
                                : 'bg-muted/40 text-muted-foreground',
                            )}
                          >
                            {idx + 1}
                          </span>
                        </td>

                        {/* Machine name */}
                        <td className="py-2.5 px-2 font-medium">{machine.name}</td>

                        {/* OEE with color badge */}
                        <td className="py-2.5 px-2 text-center">
                          <span
                            className={cn(
                              'inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[11px] font-bold border',
                              getOeeBgClass(machine.oee),
                              getOeeColorClass(machine.oee),
                            )}
                          >
                            {machine.oee.toFixed(1)}%
                          </span>
                        </td>

                        {/* Time-based OEE (AT-OEE) */}
                        <td className="py-2.5 px-2 text-center font-semibold tabular-nums text-cyan-400">
                          {machine.oeeTb.toFixed(1)}%
                        </td>

                        {/* Availability */}
                        <td
                          className={cn(
                            'py-2.5 px-2 text-center font-semibold tabular-nums',
                            getOeeColorClass(machine.availability),
                          )}
                        >
                          {machine.availability.toFixed(1)}%
                        </td>

                        {/* Performance */}
                        <td
                          className={cn(
                            'py-2.5 px-2 text-center font-semibold tabular-nums',
                            getOeeColorClass(machine.performance),
                          )}
                        >
                          {machine.performance.toFixed(1)}%
                        </td>

                        {/* Quality */}
                        <td
                          className={cn(
                            'py-2.5 px-2 text-center font-semibold tabular-nums',
                            getOeeColorClass(machine.quality),
                          )}
                        >
                          {machine.quality.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>

          {/* ── 4. OEE Classification chips ─────────────────────────────────── */}
          <motion.div variants={itemVariants}>
            <div className="flex items-center gap-2 mb-3">
              <Gauge size={14} className="text-muted-foreground" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                OEE Classification Breakdown
              </h2>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* World Class */}
              <div className="flex items-center gap-3 p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10">
                <div className="w-3 h-3 rounded-full bg-emerald-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">{t('mfgKpi.bmWorldClass')}</p>
                  <p className="text-sm font-bold text-emerald-400">
                    {classifications.worldClass} machine{classifications.worldClass !== 1 ? 's' : ''}
                  </p>
                  <p className="text-[10px] text-muted-foreground/70">OEE &ge; 85%</p>
                </div>
              </div>

              {/* Good */}
              <div className="flex items-center gap-3 p-3.5 rounded-xl border border-sky-500/30 bg-sky-500/10">
                <div className="w-3 h-3 rounded-full bg-sky-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">{t('mfgKpi.bmGood')}</p>
                  <p className="text-sm font-bold text-sky-400">
                    {classifications.good} machine{classifications.good !== 1 ? 's' : ''}
                  </p>
                  <p className="text-[10px] text-muted-foreground/70">65% – 84%</p>
                </div>
              </div>

              {/* Acceptable */}
              <div className="flex items-center gap-3 p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10">
                <div className="w-3 h-3 rounded-full bg-amber-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">{t('mfgKpi.bmAcceptable')}</p>
                  <p className="text-sm font-bold text-amber-400">
                    {classifications.acceptable} machine{classifications.acceptable !== 1 ? 's' : ''}
                  </p>
                  <p className="text-[10px] text-muted-foreground/70">45% – 64%</p>
                </div>
              </div>

              {/* Poor */}
              <div className="flex items-center gap-3 p-3.5 rounded-xl border border-red-500/30 bg-red-500/10">
                <div className="w-3 h-3 rounded-full bg-red-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">{t('mfgKpi.bmPoor')}</p>
                  <p className="text-sm font-bold text-red-400">
                    {classifications.poor} machine{classifications.poor !== 1 ? 's' : ''}
                  </p>
                  <p className="text-[10px] text-muted-foreground/70">OEE &lt; 45%</p>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
