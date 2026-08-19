'use client';
/**
 * Performance Analytics — charts only.
 *
 * Performance is earned time over run time: of the minutes a machine genuinely
 * ran, how many were spent producing at the rate it is capable of. The rest is
 * speed loss.
 *
 * The page leads with a warning it would be dishonest to bury. Performance is
 * capped at 100%, and on this plant several machines sit at the cap because the
 * configured ideal cycle times are mutually inconsistent — 1,800 / 1,200 / 2,400
 * pieces per hour on one serial line. Where that happens the indicator carries no
 * information, and saying so is more useful than drawing a flat green line. It is
 * raised with NCC as tracker item 27.
 *
 * No stat tiles and no table: a value read as a value belongs on a live page.
 * Figures live in the tooltips, where they belong when the point is the shape.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, AlertTriangle } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Legend, ReferenceLine, BarChart, Bar, Cell,
} from 'recharts';

import {
  useOeeAnalytics, PageHeader, Empty, Failed, Note, Chart, AXIS, SEGMENT_GAP,
  fmtMin, fmtNum, fmtDay, CHART_TOOLTIP, FACTOR_COLORS, LOSS_COLORS,
} from './oee-analytics-shared';

export function PerformanceAnalyticsView() {
  const { t } = useTranslation(['production', 'common']);
  const { data, isLoading, error, refetch, scope, window: win } = useOeeAnalytics();

  const body = () => {
    if (error) return <Failed onRetry={refetch} />;
    if (isLoading) return <Empty text={t('common:loading')} />;
    if (!data?.machines?.length) return <Empty text={t('machineStatus.noMachines')} />;

    const x = data.totals;
    const trend = (data.trend ?? []).map((d) => ({ ...d, label: fmtDay(d.date) }));
    const capped = data.machines.filter((m) => m.performance >= 100);
    const ranked = [...data.machines].sort((a, b) => a.performance - b.performance);

    // Run time split into the part that earned output and the part that did not.
    const split = [{
      name: t('oeeAn.runTimeSplit'),
      earned: x.idealRunMin,
      speedLoss: x.performanceLossMin,
    }];

    // Per machine, the same split — where the pace was actually lost.
    const byMachine = ranked.map((m) => ({
      name: m.code,
      earned: m.idealRunMin,
      speedLoss: m.performanceLossMin,
    }));

    return (
      <div className="space-y-6">
        {capped.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm flex gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <b>{t('oeeAn.cappedTitle', { count: capped.length })}</b>
              <p className="text-xs text-muted-foreground mt-1">{t('oeeAn.cappedBody')}</p>
              <p className="text-xs font-mono mt-1">{capped.map((m) => m.code).join(', ')}</p>
            </div>
          </div>
        )}

        <Chart title={t('oeeAn.performanceTrend')} help={t('oeeAn.trendHelp')} height={280}>
          <LineChart data={trend}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="label" {...AXIS} />
            <YAxis domain={[0, 100]} unit="%" {...AXIS} />
            <RTooltip {...CHART_TOOLTIP} formatter={(v: any) => [`${v}%`, t('oeeAn.performance')]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={95} stroke={FACTOR_COLORS.quality} strokeDasharray="4 4"
              label={{ value: t('oeeAn.target95'), fontSize: 9, fill: 'hsl(var(--muted-foreground))', position: 'insideTopRight' }} />
            <Line type="monotone" dataKey="performance" name={t('oeeAn.performance')}
              stroke={FACTOR_COLORS.performance} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </Chart>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Chart title={t('oeeAn.runTimeSplit')} help={t('oeeAn.performanceSplitHelp')} height={200}>
            <BarChart data={split} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} horizontal={false} />
              <XAxis type="number" {...AXIS} tickFormatter={(v: number) => fmtMin(v)} />
              <YAxis type="category" dataKey="name" hide />
              <RTooltip {...CHART_TOOLTIP} formatter={(v: any, n: any) => [fmtMin(Number(v)), n]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="earned" stackId="a" name={t('oeeAn.idealTime')}
                fill={LOSS_COLORS.productive} {...SEGMENT_GAP} />
              <Bar dataKey="speedLoss" stackId="a" name={t('oeeAn.speedLoss')}
                fill={LOSS_COLORS.speedLoss} {...SEGMENT_GAP} radius={[0, 4, 4, 0]} />
            </BarChart>
          </Chart>

          <Chart title={t('oeeAn.paceByMachine')} help={t('oeeAn.paceHelp')} height={200}>
            <BarChart data={ranked} layout="vertical" margin={{ left: 8, right: 28 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} horizontal={false} />
              <XAxis type="number" domain={[0, 100]} unit="%" {...AXIS} />
              <YAxis type="category" dataKey="code" width={54} {...AXIS} />
              <RTooltip {...CHART_TOOLTIP} formatter={(v: any) => [`${v}%`, t('oeeAn.performance')]} />
              <ReferenceLine x={95} stroke={FACTOR_COLORS.quality} strokeDasharray="4 4" />
              <Bar dataKey="performance" radius={[0, 4, 4, 0]}>
                {ranked.map((m, i) => (
                  <Cell key={i} fill={m.performance >= 95 ? LOSS_COLORS.productive
                    : m.performance >= 60 ? LOSS_COLORS.external : LOSS_COLORS.breakdowns} />
                ))}
              </Bar>
            </BarChart>
          </Chart>
        </div>

        <Chart title={t('oeeAn.wherePaceLost')} help={t('oeeAn.wherePaceLostHelp')}
               height={Math.max(200, byMachine.length * 46)}>
          <BarChart data={byMachine} layout="vertical" margin={{ left: 8, right: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} horizontal={false} />
            <XAxis type="number" {...AXIS} tickFormatter={(v: number) => fmtMin(v)} />
            <YAxis type="category" dataKey="name" width={54} {...AXIS} />
            <RTooltip {...CHART_TOOLTIP} formatter={(v: any, n: any) => [fmtMin(Number(v)), n]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="earned" stackId="b" name={t('oeeAn.idealTime')}
              fill={LOSS_COLORS.productive} {...SEGMENT_GAP} />
            <Bar dataKey="speedLoss" stackId="b" name={t('oeeAn.speedLoss')}
              fill={LOSS_COLORS.speedLoss} {...SEGMENT_GAP} radius={[0, 4, 4, 0]} />
          </BarChart>
        </Chart>

        <Note>{t('oeeAn.performanceNote')}</Note>
        <Note>{t('oeeAn.valuesLiveNote')}</Note>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={t('oeeAn.performanceTitle')}
        subtitle={t('oeeAn.performanceSubtitle')}
        icon={Gauge}
        scope={scope}
        window={win}
      />
      {body()}
    </div>
  );
}
