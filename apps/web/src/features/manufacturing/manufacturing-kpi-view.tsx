'use client';
import { DashboardInfo } from '@/components/ui/dashboard-info';

import React, { useMemo } from 'react';
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
import { useTimeRange } from '@/hooks/use-time-range';
import { useDashboardPrefsStore } from '@/store/dashboard-prefs-store';

import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardKpis {
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  // Time-based (OEE-TB) variant emitted by the backend alongside schedule-based OEE.
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

/** One machine row from /production/oee/calculate — already time-weighted. */
interface MachineOeeRow {
  machineId: string;
  name: string;
  code: string | null;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  oeeTb?: number;
  availabilityTb?: number;
  output: number;
}

/** The single OEE response that feeds the headline, the chart AND the leaderboard. */
interface OeeCalcResponse {
  byEquipment?: MachineOeeRow[];
  trend?: Array<{
    period: string;
    oee?: number;
    oeeTb?: number;
    availability?: number;
    availabilityTb?: number;
    quality?: number;
  }>;
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

function getOeeLabelKey(value: number): string {
  if (value >= 85) return 'bmWorldClass';
  if (value >= 65) return 'bmGood';
  if (value >= 45) return 'bmAcceptable';
  return 'bmPoor';
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
  const { t } = useTranslation('modules');
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
              {t('mfgKpi.target')}: <span className="font-semibold text-foreground">{target}%</span>
            </span>
            <span className={cn('font-semibold', gap >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {gap >= 0 ? '+' : ''}{gap.toFixed(1)}%
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className={cn('inline-block w-2 h-2 rounded-full', getOeeStatusColor(value))}
            />
            <span className="text-[11px] text-muted-foreground">{t(`mfgKpi.${getOeeLabelKey(value)}`)}</span>
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
  // Time range + view prefs now come from the unified ScopePanel (global stores).
  const { params: timeParams, key: timeframe } = useTimeRange();
  const { atOee } = useDashboardPrefsStore();

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['dashboard', 'kpis', timeframe, key],
    queryFn: () => api.get<DashboardKpis>('/dashboard/kpis', { params: { ...filter, ...timeParams } }),
    refetchInterval: 30_000,
  });

  /**
   * The leaderboard reads the SAME engine as the KPI summary above it.
   *
   * It used to call /production/oee-records — the live job-order scan — while the
   * summary called /dashboard/kpis, which reads the persisted fact store. Two
   * engines, two answers, side by side on one page: 80.8% vs 79.4% OEE and 100.0%
   * vs 98.7% Availability for the same machine in the same second. Neither was
   * "wrong"; they were answering with different data.
   *
   * /production/oee/calculate returns per-machine rows in `byEquipment` from the
   * identical aggregation that produces the headline, so the two now cannot drift.
   * It is also already time-weighted — the old client-side code averaged the
   * percentages of each record, which is not how OEE rolls up.
   */
  const { data: oeeCalc, isLoading: recordsLoading } = useQuery({
    queryKey: ['production', 'oee', 'calculate', timeframe, key],
    queryFn: () => api.get<OeeCalcResponse>('/production/oee/calculate', { params: { ...filter, ...timeParams } }),
    refetchInterval: 30_000,
  });

  /**
   * The trend chart is fed by the SAME response as the headline and the
   * leaderboard. It used to plot /production/oee-records, so a third series on this
   * page could disagree with the two above it.
   */
  const chartData = useMemo(
    () => (oeeCalc?.trend ?? []).map((b) => ({
      date: b.period,
      oee: parseFloat((b.oee ?? 0).toFixed(1)),
      oeeTb: b.oeeTb != null ? parseFloat(b.oeeTb.toFixed(1)) : null,
      availability: parseFloat((b.availability ?? 0).toFixed(1)),
      availabilityTb: b.availabilityTb != null ? parseFloat(b.availabilityTb.toFixed(1)) : null,
      quality: parseFloat((b.quality ?? 0).toFixed(1)),
    })),
    [oeeCalc],
  );

  /**
   * No client-side aggregation any more. The API already returns one row per
   * machine, time-weighted, from the same engine as the headline — re-averaging
   * those percentages here is what let the two disagree.
   */
  const leaderboard = useMemo(
    () => [...(oeeCalc?.byEquipment ?? [])].sort((a, b) => b.oee - a.oee),
    [oeeCalc],
  );


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
            <h1 className="text-lg font-bold text-foreground flex items-center gap-2">{t('mfgKpi.title')}
            <DashboardInfo id="production-kpi" />
          </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('mfgKpi.subtitle')}
            </p>
          </div>
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
              title={atOee ? `${t('mfgKpi.overallOee')} (OEE-TB)` : t('mfgKpi.overallOee')}
              value={(atOee ? kpis?.oeeTb : kpis?.oee) ?? 0}
              trend={kpis?.oeeTrend ?? 0}
              target={85}
              icon={<Gauge size={16} />}
              isLoading={kpisLoading}
            />
            <KpiCard
              title={atOee ? `${t('mfgKpi.metric.availability')} (OEE-TB)` : t('mfgKpi.metric.availability')}
              value={(atOee ? kpis?.availabilityTb : kpis?.availability) ?? 0}
              trend={kpis?.availabilityTrend ?? 0}
              target={90}
              icon={<Target size={16} />}
              isLoading={kpisLoading}
            />
            <KpiCard
              title={t('mfgKpi.metric.performance')}
              value={kpis?.performance ?? 0}
              trend={kpis?.performanceTrend ?? 0}
              target={95}
              icon={<TrendingUp size={16} />}
              isLoading={kpisLoading}
            />
            <KpiCard
              title={t('mfgKpi.metric.quality')}
              value={kpis?.quality ?? 0}
              trend={kpis?.qualityTrend ?? 0}
              target={99}
              icon={<Award size={16} />}
              isLoading={kpisLoading}
            />
          </motion.div>

          {/* Time-Based (OEE-TB) — shown beside the schedule-based KPIs above */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground px-1">
            <span>{t('mfgKpi.atOee')}: <b className="text-foreground">{(kpis?.oeeTb ?? 0).toFixed(1)}%</b></span>
            <span>{t('mfgKpi.availabilityTb')}: <b className="text-foreground">{(kpis?.availabilityTb ?? 0).toFixed(1)}%</b></span>
            <span className="opacity-70">{t('mfgKpi.scheduleNote')}</span>
          </div>

          {/* ── 2. Trend chart + KPI summary table ──────────────────────────── */}
          <motion.div variants={itemVariants} className="grid grid-cols-3 gap-4">
            {/* OEE-over-time lives in OEE Analytics & Machine OEE — this app
                focuses on the Machine OEE leaderboard + KPI summary (full width). */}

            {/* KPI summary table */}
            <div className="col-span-3 industrial-card p-5 rounded-xl border border-border/40 flex flex-col">
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
                        <th className="text-right py-2 text-muted-foreground font-medium">{t('mfgKpi.colGap')}</th>
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
                                {met ? t('mfgKpi.met') : t('mfgKpi.miss')}
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
                          {t('mfgKpi.unitsValue', { value: kpis.totalOutput.toLocaleString() })}
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
                {t('mfgKpi.machinesCount', { count: leaderboard.length })}
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
                {t('mfgKpi.noRecords')}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="text-left py-2 px-2 text-muted-foreground font-medium w-10">#</th>
                      <th className="text-start py-2 px-2 text-muted-foreground font-medium">{t('mfgKpi.colMachine')}</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">{t('mfgKpi.colOeePct')}</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">{t('mfgKpi.colOeeTbPct')}</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">{t('mfgKpi.colAvailPct')}</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">{t('mfgKpi.colPerfPct')}</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">{t('mfgKpi.colQualityPct')}</th>
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

                        {/* Time-based OEE (OEE-TB) */}
                        <td className="py-2.5 px-2 text-center font-semibold tabular-nums text-cyan-400">
                          {/* An em dash when the API has no time-based figure — better
                              than rendering the schedule number under a TB heading. */}
                          {machine.oeeTb != null ? `${machine.oeeTb.toFixed(1)}%` : '—'}
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
                {t('mfgKpi.classificationTitle')}
              </h2>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* World Class */}
              <div className="flex items-center gap-3 p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10">
                <div className="w-3 h-3 rounded-full bg-emerald-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">{t('mfgKpi.bmWorldClass')}</p>
                  <p className="text-sm font-bold text-emerald-400">
                    {t('mfgKpi.machinesCount', { count: classifications.worldClass })}
                  </p>
                  <p className="text-[10px] text-muted-foreground/70">{t('mfgKpi.rangeWorldClass')}</p>
                </div>
              </div>

              {/* Good */}
              <div className="flex items-center gap-3 p-3.5 rounded-xl border border-sky-500/30 bg-sky-500/10">
                <div className="w-3 h-3 rounded-full bg-sky-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">{t('mfgKpi.bmGood')}</p>
                  <p className="text-sm font-bold text-sky-400">
                    {t('mfgKpi.machinesCount', { count: classifications.good })}
                  </p>
                  <p className="text-[10px] text-muted-foreground/70">{t('mfgKpi.rangeGood')}</p>
                </div>
              </div>

              {/* Acceptable */}
              <div className="flex items-center gap-3 p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10">
                <div className="w-3 h-3 rounded-full bg-amber-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">{t('mfgKpi.bmAcceptable')}</p>
                  <p className="text-sm font-bold text-amber-400">
                    {t('mfgKpi.machinesCount', { count: classifications.acceptable })}
                  </p>
                  <p className="text-[10px] text-muted-foreground/70">{t('mfgKpi.rangeAcceptable')}</p>
                </div>
              </div>

              {/* Poor */}
              <div className="flex items-center gap-3 p-3.5 rounded-xl border border-red-500/30 bg-red-500/10">
                <div className="w-3 h-3 rounded-full bg-red-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">{t('mfgKpi.bmPoor')}</p>
                  <p className="text-sm font-bold text-red-400">
                    {t('mfgKpi.machinesCount', { count: classifications.poor })}
                  </p>
                  <p className="text-[10px] text-muted-foreground/70">{t('mfgKpi.rangePoor')}</p>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
