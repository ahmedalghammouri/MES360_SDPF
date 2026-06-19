'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  RefreshCw,
  LayoutGrid,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Zap,
  TrendingUp,
} from 'lucide-react';
import { format } from 'date-fns';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { TimeRangeFilter } from '@/components/ui/time-range-filter';
import { KPICard } from '@/components/widgets/kpi-card';
import { OEEGauge } from '@/components/charts/oee-gauge';
import { ProductionTrendChart } from '@/components/charts/production-trend';
import { MachineStatusGrid } from '@/components/widgets/machine-status-grid';
import { AlarmList } from '@/components/widgets/alarm-list';
import { ProductionStatusBar } from '@/components/widgets/production-status-bar';
import { ShiftSummaryCard } from '@/components/widgets/shift-summary-card';
import { DowntimePareto } from '@/components/charts/downtime-pareto';
import { QualityTrendChart } from '@/components/charts/quality-trend';
import { useDashboardData } from './use-dashboard-data';
import { cn } from '@/lib/utils';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

export function DashboardView() {
  const { t } = useTranslation(['dashboard', 'common']);
  const { data, isLoading, refetch } = useDashboardData();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dateLabel, setDateLabel] = useState('');

  useEffect(() => {
    setDateLabel(format(new Date(), 'EEEE, MMMM d, yyyy'));
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold text-foreground">{t('home')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {dateLabel || ' '} · {t('realtimeOverview')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Live indicator */}
          <div className="realtime-badge">
            <span className="w-1.5 h-1.5 rounded-full bg-success-400 animate-pulse" />
            {t('common:status.live')}
          </div>

          {/* Smart time-range filter — same control used across Performance & KPIs */}
          <TimeRangeFilter />

          <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" onClick={handleRefresh}>
            <RefreshCw size={13} className={cn(isRefreshing && 'animate-spin')} />
            {t('common:actions.refresh')}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" asChild>
            <Link href="/dashboard-center">
              <LayoutGrid size={13} />
              {t('dashboardCenter')}
            </Link>
          </Button>
        </div>
      </div>

      {/* Dashboard content */}
      <div className="flex-1 overflow-auto p-6">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-5"
        >
          {/* Production Status Bar */}
          <motion.div variants={itemVariants}>
            <ProductionStatusBar data={data?.productionStatus} isLoading={isLoading} />
          </motion.div>

          {/* KPI Row */}
          <motion.div variants={itemVariants} className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
            <KPICard
              title={t('kpi.oee')}
              value={data?.kpis?.oee ?? 0}
              unit="%"
              trend={data?.kpis?.oeeTrend}
              target={85}
              colorMode="oee"
              isLoading={isLoading}
              icon={<Zap size={16} />}
            />
            <KPICard
              title={t('kpi.availability')}
              value={data?.kpis?.availability ?? 0}
              unit="%"
              trend={data?.kpis?.availabilityTrend}
              target={90}
              colorMode="oee"
              isLoading={isLoading}
              icon={<Activity size={16} />}
            />
            <KPICard
              title={t('kpi.performance')}
              value={data?.kpis?.performance ?? 0}
              unit="%"
              trend={data?.kpis?.performanceTrend}
              target={95}
              colorMode="oee"
              isLoading={isLoading}
              icon={<TrendingUp size={16} />}
            />
            <KPICard
              title={t('kpi.quality')}
              value={data?.kpis?.quality ?? 0}
              unit="%"
              trend={data?.kpis?.qualityTrend}
              target={99}
              colorMode="oee"
              isLoading={isLoading}
              icon={<CheckCircle2 size={16} />}
            />
            <KPICard
              title={t('kpi.output')}
              value={data?.kpis?.totalOutput ?? 0}
              unit={t('units')}
              trend={data?.kpis?.outputTrend}
              isLoading={isLoading}
              icon={<Activity size={16} />}
            />
            <KPICard
              title={t('kpi.alarms')}
              value={data?.kpis?.activeAlarms ?? 0}
              trend={data?.kpis?.alarmTrend}
              colorMode="alarm"
              isLoading={isLoading}
              icon={<AlertTriangle size={16} />}
            />
          </motion.div>

          {/* Time-Based (AT-OEE) — shown beside the schedule-based KPIs above */}
          <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground -mt-1 px-1">
            <span>{t('atOee')}: <b className="text-foreground">{(data?.kpis?.oeeTb ?? 0).toFixed(1)}%</b></span>
            <span>{t('availabilityTb')}: <b className="text-foreground">{(data?.kpis?.availabilityTb ?? 0).toFixed(1)}%</b></span>
            <span className="opacity-70">{t('atNote')}</span>
          </motion.div>

          {/* Main grid */}
          <div className="grid grid-cols-12 gap-4">
            {/* OEE Gauges */}
            <motion.div variants={itemVariants} className="col-span-12 lg:col-span-4">
              <OEEGauge
                oee={data?.kpis?.oee ?? 0}
                availability={data?.kpis?.availability ?? 0}
                performance={data?.kpis?.performance ?? 0}
                quality={data?.kpis?.quality ?? 0}
                isLoading={isLoading}
              />
            </motion.div>

            {/* Production Trend */}
            <motion.div variants={itemVariants} className="col-span-12 lg:col-span-8">
              <ProductionTrendChart data={data?.productionTrend} isLoading={isLoading} />
            </motion.div>

            {/* Machine Status Grid */}
            <motion.div variants={itemVariants} className="col-span-12 lg:col-span-7">
              <MachineStatusGrid machines={data?.machines} isLoading={isLoading} />
            </motion.div>

            {/* Right column */}
            <div className="col-span-12 lg:col-span-5 space-y-4">
              {/* Shift Summary */}
              <motion.div variants={itemVariants}>
                <ShiftSummaryCard data={data?.shiftSummary} isLoading={isLoading} />
              </motion.div>

              {/* Active Alarms */}
              <motion.div variants={itemVariants}>
                <AlarmList alarms={data?.alarms} isLoading={isLoading} />
              </motion.div>
            </div>

            {/* Downtime Pareto */}
            <motion.div variants={itemVariants} className="col-span-12 lg:col-span-6">
              <DowntimePareto data={data?.downtimePareto} isLoading={isLoading} />
            </motion.div>

            {/* Quality Trend */}
            <motion.div variants={itemVariants} className="col-span-12 lg:col-span-6">
              <QualityTrendChart data={data?.qualityTrend} isLoading={isLoading} />
            </motion.div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
