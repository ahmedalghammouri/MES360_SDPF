'use client';
import { DashboardInfo } from '@/components/ui/dashboard-info';

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  BarChart,
  Bar,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Gauge, TrendingUp, TrendingDown, Award, AlertTriangle, Download } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { useOeeMode } from '@/hooks/use-oee-mode';
import { format, parseISO } from 'date-fns';

import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// ── TypeScript interfaces ──────────────────────────────────────────────────────

interface EquipmentBreakdownItem {
  machineId: string;
  machineName: string;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
}

interface OeeCalculateResponse {
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  // Time-based (OEE-TB) variant emitted by the backend alongside schedule-based OEE.
  oeeTb?: number;
  availabilityTb?: number;
  totalCount: number;
  goodCount: number;
  downtime: number;
  trend: number;
  equipmentBreakdown: EquipmentBreakdownItem[];
}

interface OeeRecord {
  id: string;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  // Time-based (OEE-TB) variant now emitted per record by the backend.
  oeeTb?: number;
  availabilityTb?: number;
  totalOutput: number;
  recordDate: string;
  machineId: string;
  machine: { name: string };
}

interface MachineOverview {
  id: string;
  name: string;
  code: string;
  state: string;
  oee: number;
  area: string;
}

interface DashboardOverviewResponse {
  machines: MachineOverview[];
}

// ── Color helpers ──────────────────────────────────────────────────────────────

function getOeeColor(v: number): string {
  if (v >= 85) return 'text-green-400';
  if (v >= 65) return 'text-blue-400';
  if (v >= 45) return 'text-yellow-400';
  return 'text-red-400';
}

function getBgColor(v: number): string {
  if (v >= 85) return 'bg-green-400';
  if (v >= 65) return 'bg-blue-400';
  if (v >= 45) return 'bg-yellow-400';
  return 'bg-red-400';
}

function getBarFill(v: number): string {
  if (v >= 85) return '#4ade80';
  if (v >= 65) return '#60a5fa';
  if (v >= 45) return '#facc15';
  return '#f87171';
}

function getStateBadgeVariant(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const map: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    RUNNING: 'default',
    IDLE: 'secondary',
    STOPPED: 'destructive',
    FAULT: 'destructive',
    MAINTENANCE: 'outline',
    OFFLINE: 'outline',
  };
  return map[state?.toUpperCase()] ?? 'outline';
}

// ── Sub-components ─────────────────────────────────────────────────────────────


// ── Custom recharts tooltip ────────────────────────────────────────────────────

interface TooltipPayloadItem {
  name: string;
  value: number;
  color?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}

function ChartTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border/60 rounded-lg px-3 py-2 shadow-lg text-xs">
      {label && <p className="text-muted-foreground mb-1">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="font-semibold" style={{ color: p.color ?? '#fff' }}>
          {p.name}: {typeof p.value === 'number' ? `${p.value.toFixed(1)}%` : p.value}
        </p>
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ManufacturingOeeView() {
  const { t } = useTranslation('modules');
  const { filter: scopeFilter, key: scopeKey } = useScope();
  const { params: timeParams, key: timeKey, dateFrom, dateTo } = useTimeRange();
  const oeeMode = useOeeMode();

  // Query: OEE calculation
  const { data: oeeData, isLoading: oeeLoading } = useQuery<OeeCalculateResponse>({
    queryKey: ['oee', 'calculate', timeKey, scopeKey],
    queryFn: () =>
      api.get<OeeCalculateResponse>('/production/oee/calculate', { params: { ...timeParams, ...scopeFilter } }),
    refetchInterval: 30_000,
  });

  // Query: OEE records history
  const { data: oeeRecords, isLoading: recordsLoading } = useQuery<OeeRecord[]>({
    queryKey: ['oee', 'records', scopeKey, timeKey],
    // Endpoint is paginated → unwrap the `data` array (guard non-array shapes)
    queryFn: async () => {
      const res = await api.get<{ data: OeeRecord[] } | OeeRecord[]>('/production/oee-records', { params: { limit: 50, ...scopeFilter, dateFrom, dateTo } });
      if (Array.isArray(res)) return res;
      return Array.isArray(res?.data) ? res.data : [];
    },
    refetchInterval: 30_000,
  });

  // Query: Dashboard overview (machines list)
  const { data: overviewData, isLoading: overviewLoading } = useQuery<DashboardOverviewResponse>({
    queryKey: ['dashboard', 'overview', scopeKey],
    queryFn: () => api.get<DashboardOverviewResponse>('/dashboard/overview', { params: scopeFilter }),
    refetchInterval: 30_000,
  });

  // Merge equipmentBreakdown with machines to get area + state
  const mergedEquipment = useMemo(() => {
    const breakdown = oeeData?.equipmentBreakdown ?? [];
    const machines = overviewData?.machines ?? [];
    const machineMap = new Map(machines.map((m) => [m.id, m]));
    return breakdown
      .map((eq) => {
        const machine = machineMap.get(eq.machineId);
        return {
          ...eq,
          area: machine?.area ?? '—',
          state: machine?.state ?? 'OFFLINE',
        };
      })
      .sort((a, b) => b.oee - a.oee);
  }, [oeeData, overviewData]);

  // Waterfall / comparison bar data
  const waterfallData = useMemo(
    () => [
      { name: t('mfgOee.availability'), value: oeeData?.availability ?? 0 },
      { name: t('mfgOee.performance'), value: oeeData?.performance ?? 0 },
      { name: t('mfgOee.quality'), value: oeeData?.quality ?? 0 },
      { name: t('mfgOee.oee'), value: oeeData?.oee ?? 0 },
    ],
    [oeeData],
  );

  // History chart data
  const historyData = useMemo(() => {
    if (!Array.isArray(oeeRecords)) return [];
    return [...oeeRecords]
      .sort((a, b) => new Date(a.recordDate).getTime() - new Date(b.recordDate).getTime())
      .map((r) => ({
        date: format(parseISO(r.recordDate), 'MM/dd HH:mm'),
        oee: Number(r.oee.toFixed(1)),
        oeeTb: r.oeeTb != null ? Number(r.oeeTb.toFixed(1)) : null,
      }));
  }, [oeeRecords]);

  // Benchmark progress position (clamped 0-100)
  const currentOee = oeeData?.oee ?? 0;
  const benchmarkPosition = Math.min(Math.max(currentOee, 0), 100);

  const isAnyLoading = oeeLoading || overviewLoading;

  const handleExport = () => {
    const rows = [
      ['Metric', 'Value'],
      ['OEE', `${oeeData?.oee.toFixed(1)}%`],
      ['Availability', `${oeeData?.availability.toFixed(1)}%`],
      ['Performance', `${oeeData?.performance.toFixed(1)}%`],
      ['Quality', `${oeeData?.quality.toFixed(1)}%`],
      ['Total Count', String(oeeData?.totalCount ?? 0)],
      ['Acceptance Count', String(oeeData?.goodCount ?? 0)],
      ['Downtime (min)', String(oeeData?.downtime ?? 0)],
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `oee-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <Gauge size={20} className="text-primary" />
          <div>
            <h1 className="text-lg font-bold leading-tight flex items-center gap-2">{t('mfgOee.dashboardTitle')}
            <DashboardInfo id="production-oee" />
          </h1>
            <p className="text-xs text-muted-foreground">{t('mfgOee.oeeFull')}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={handleExport}>
            <Download size={13} />
            {t('mfgOee.export')}
          </Button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto p-6 space-y-6">

        {/* The four headline boxes that used to open this page are gone. They were
            the same shape as the live cards and read the same way, so nothing told
            a reader whether they described this moment or the selected window.
            The waterfall and the charts below carry the same figures as shape, and
            Operations Now → Live Production carries them as values. */}

        {/* The OTHER basis, always shown alongside — the toggle decides which one
            is the headline, never which one exists. Comparing them is the point. */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground px-1">
          {oeeMode.atOee ? (
            <>
              <span>{t('mfgOee.oee')} ({t('atOee.schedule', { ns: 'common' })}): <b className="text-foreground">{(oeeData?.oee ?? 0).toFixed(1)}%</b></span>
              <span>{t('mfgOee.availability')}: <b className="text-foreground">{(oeeData?.availability ?? 0).toFixed(1)}%</b></span>
            </>
          ) : (
            <>
              <span>{t('mfgOee.atOee')}: <b className="text-foreground">{(oeeData?.oeeTb ?? 0).toFixed(1)}%</b></span>
              <span>{t('mfgOee.availabilityTb')}: <b className="text-foreground">{(oeeData?.availabilityTb ?? 0).toFixed(1)}%</b></span>
            </>
          )}
          <span className="opacity-70">{t('mfgOee.scheduleNote')}</span>
        </div>

        {/* 2. OEE Waterfall bar chart */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          className="industrial-card p-4"
        >
          <h2 className="text-sm font-semibold mb-4">{t('mfgOee.componentComparison')}</h2>
          {isAnyLoading ? (
            <div className="shimmer h-[250px] rounded" />
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={waterfallData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={72}>
                  {waterfallData.map((entry, index) => (
                    <Cell key={`bar-${index}`} fill={getBarFill(entry.value)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        {/* 3. Equipment OEE Table */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.15 }}
          className="industrial-card p-4"
        >
          <h2 className="text-sm font-semibold mb-4">{t('mfgOee.equipmentBreakdown')}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40">
                  <th className="text-start py-2 pe-4 text-muted-foreground font-medium">{t('mfgOee.colMachine')}</th>
                  <th className="text-start py-2 pe-4 text-muted-foreground font-medium">{t('mfgOee.colArea')}</th>
                  <th className="text-start py-2 pe-4 text-muted-foreground font-medium">{t('mfgOee.colState')}</th>
                  <th className="text-end py-2 pe-4 text-muted-foreground font-medium">{t('mfgOee.colOeePct')}</th>
                  <th className="text-right py-2 pr-4 text-muted-foreground font-medium">A %</th>
                  <th className="text-right py-2 pr-4 text-muted-foreground font-medium">P %</th>
                  <th className="text-right py-2 text-muted-foreground font-medium">Q %</th>
                </tr>
              </thead>
              <tbody>
                {isAnyLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/20">
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td key={j} className="py-2.5 pr-4">
                          <div className="shimmer h-4 w-full rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : mergedEquipment.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      <AlertTriangle size={16} className="inline mr-1.5 text-yellow-400" />
                      No equipment data available
                    </td>
                  </tr>
                ) : (
                  mergedEquipment.map((eq) => (
                    <tr
                      key={eq.machineId}
                      className="border-b border-border/20 hover:bg-muted/10 transition-colors"
                    >
                      <td className="py-2.5 pr-4 font-medium">{eq.machineName}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{eq.area}</td>
                      <td className="py-2.5 pr-4">
                        <Badge variant={getStateBadgeVariant(eq.state)} className="text-[10px] px-1.5 py-0">
                          {eq.state}
                        </Badge>
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        <Badge
                          className={cn(
                            'text-[10px] px-1.5 py-0 font-semibold',
                            eq.oee >= 85
                              ? 'bg-green-400/15 text-green-400 border-green-400/30'
                              : eq.oee >= 65
                              ? 'bg-blue-400/15 text-blue-400 border-blue-400/30'
                              : eq.oee >= 45
                              ? 'bg-yellow-400/15 text-yellow-400 border-yellow-400/30'
                              : 'bg-red-400/15 text-red-400 border-red-400/30',
                          )}
                          variant="outline"
                        >
                          {eq.oee.toFixed(1)}%
                        </Badge>
                      </td>
                      <td className={cn('py-2.5 pr-4 text-right font-medium tabular-nums', getOeeColor(eq.availability))}>
                        {eq.availability.toFixed(1)}%
                      </td>
                      <td className={cn('py-2.5 pr-4 text-right font-medium tabular-nums', getOeeColor(eq.performance))}>
                        {eq.performance.toFixed(1)}%
                      </td>
                      <td className={cn('py-2.5 text-right font-medium tabular-nums', getOeeColor(eq.quality))}>
                        {eq.quality.toFixed(1)}%
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* 4. OEE History AreaChart */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.2 }}
          className="industrial-card p-4"
        >
          <h2 className="text-sm font-semibold mb-1">{t('mfgOee.historyTitle')}</h2>
          <p className="text-xs text-muted-foreground mb-3">{t('mfgOee.historySub')}</p>
          {recordsLoading ? (
            <div className="shimmer h-[200px] rounded" />
          ) : historyData.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-muted-foreground text-xs">
              No history records available
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={historyData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="oeeGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="oee"
                  name="OEE (Schedule)"
                  stroke="#60a5fa"
                  strokeWidth={2}
                  fill="url(#oeeGradient)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#60a5fa' }}
                />
                {/* Time-based OEE (OEE-TB) overlay — dashed, no fill */}
                <Area
                  type="monotone"
                  dataKey="oeeTb"
                  name="OEE (Time-Based)"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  fill="none"
                  dot={false}
                  activeDot={{ r: 4, fill: '#22d3ee' }}
                  connectNulls
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        {/* 5. World-class benchmark row */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.25 }}
          className="industrial-card p-4"
        >
          <div className="flex items-center gap-2 mb-4">
            <Award size={16} className="text-yellow-400" />
            <h2 className="text-sm font-semibold">{t('mfgOee.benchmarkTitle')}</h2>
          </div>

          {/* Gradient progress bar */}
          <div className="relative w-full h-6 rounded-full overflow-hidden bg-muted/20">
            {/* Gradient track */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  'linear-gradient(to right, #f87171 0%, #f87171 44%, #facc15 44%, #facc15 64%, #60a5fa 64%, #60a5fa 84%, #4ade80 84%, #4ade80 100%)',
              }}
            />
            {/* Pointer */}
            <div
              className="absolute top-0 bottom-0 w-1 bg-foreground shadow-md transition-all duration-700"
              style={{ left: `calc(${benchmarkPosition}% - 2px)` }}
            />
          </div>

          {/* Benchmark labels */}
          <div className="flex justify-between mt-2 text-[10px] text-muted-foreground select-none">
            <span className="text-red-400 font-medium">{t('mfgOee.bmPoor')}</span>
            <span className="text-yellow-400 font-medium">{t('mfgOee.bmAcceptable')}</span>
            <span className="text-blue-400 font-medium">{t('mfgOee.bmGood')}</span>
            <span className="text-green-400 font-medium">{t('mfgOee.bmWorldClass')}</span>
          </div>

          {/* Current value callout */}
          <div className="mt-3 flex items-center gap-2">
            <span className={cn('text-2xl font-extrabold tabular-nums', getOeeColor(currentOee))}>
              {currentOee.toFixed(1)}%
            </span>
            <div className="text-xs text-muted-foreground">
              {currentOee >= 85 ? (
                <span className="flex items-center gap-1 text-green-400">
                  <Award size={12} /> {t('mfgOee.worldClassPerf')}
                </span>
              ) : currentOee >= 65 ? (
                <span className="flex items-center gap-1 text-blue-400">
                  <TrendingUp size={12} /> {t('mfgOee.goodBelow', { gap: (85 - currentOee).toFixed(1) })}
                </span>
              ) : currentOee >= 45 ? (
                <span className="flex items-center gap-1 text-yellow-400">
                  <AlertTriangle size={12} /> {t('mfgOee.acceptableImprove')}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-red-400">
                  <TrendingDown size={12} /> {t('mfgOee.belowThreshold')}
                </span>
              )}
            </div>
          </div>
        </motion.div>

      </div>
    </div>
  );
}
