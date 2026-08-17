'use client';
/**
 * Performance Analytics — the pace loss inside the run time.
 *
 * Performance is ideal time over actual run time: of the minutes the machine was
 * genuinely running, how many were spent producing at the rate it is capable of.
 * The rest is speed loss and micro stops.
 *
 * The page leads with a warning it would be dishonest to bury. Performance is
 * capped at 100%, and on this plant several machines sit at the cap because the
 * configured ideal cycle times are mutually inconsistent — 1,800 / 1,200 / 2,400
 * pieces per hour on one serial line. Where that happens the indicator carries no
 * information at all, and saying so is more useful than drawing a flat green
 * line. It is raised with NCC as tracker item 27.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, AlertTriangle } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Legend, ReferenceLine, BarChart, Bar, Cell,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  useOeeAnalytics, PageHeader, Stat, Pct, Empty, Failed, Note, LossBar,
  fmtMin, fmtNum, fmtDay, CHART_TOOLTIP, FACTOR_COLORS,
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

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label={t('oeeAn.performance')} value={`${x.performance}%`} tone="primary" />
          <Stat label={t('oeeAn.runTime')} value={fmtMin(x.runMin)} sub={t('oeeAn.theDenominator')} />
          <Stat label={t('oeeAn.idealTime')} value={fmtMin(x.idealRunMin)} tone="good" />
          <Stat label={t('oeeAn.speedLoss')} value={fmtMin(x.performanceLossMin)} tone="bad" />
          <Stat label={t('oeeAn.output')} value={fmtNum(x.output)} />
        </div>

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

        <div className="rounded-lg border border-border/50 p-4">
          <h2 className="text-sm font-semibold mb-1">{t('oeeAn.runTimeSplit')}</h2>
          <p className="text-[11px] text-muted-foreground mb-4">{t('oeeAn.performanceSplitHelp')}</p>
          <LossBar
            total={x.runMin}
            segments={[
              { label: t('oeeAn.idealTime'), minutes: x.idealRunMin, color: FACTOR_COLORS.quality },
              { label: t('oeeAn.speedLoss'), minutes: x.performanceLossMin, color: FACTOR_COLORS.performance },
            ]}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-lg border border-border/50 p-4">
            <h2 className="text-sm font-semibold mb-3">{t('oeeAn.performanceTrend')}</h2>
            {trend.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                  <RTooltip {...CHART_TOOLTIP} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={95} stroke="#008300" strokeDasharray="4 4"
                    label={{ value: t('oeeAn.target95'), fontSize: 9, fill: '#008300', position: 'insideTopRight' }} />
                  <Line type="monotone" dataKey="performance" name={t('oeeAn.performance')}
                    stroke={FACTOR_COLORS.performance} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <Empty text={t('machineStatus.noSnapshots')} />}
          </div>

          <div className="rounded-lg border border-border/50 p-4">
            <h2 className="text-sm font-semibold mb-1">{t('oeeAn.paceByMachine')}</h2>
            <p className="text-[11px] text-muted-foreground mb-3">{t('oeeAn.paceHelp')}</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={ranked} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                <YAxis type="category" dataKey="code" width={54} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                <RTooltip {...CHART_TOOLTIP} formatter={(v: any) => [`${v}%`, t('oeeAn.performance')]} />
                <Bar dataKey="performance" radius={[0, 4, 4, 0]}>
                  {ranked.map((m, i) => (
                    <Cell key={i} fill={m.performance >= 95 ? '#008300' : m.performance >= 60 ? '#eda100' : '#d03b3b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-border/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/50 text-sm font-semibold">{t('oeeAn.perMachine')}</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('oeeAn.machine')}</TableHead>
                <TableHead className="text-right">{t('oeeAn.performance')}</TableHead>
                <TableHead className="text-right">{t('oeeAn.runTime')}</TableHead>
                <TableHead className="text-right">{t('oeeAn.idealTime')}</TableHead>
                <TableHead className="text-right">{t('oeeAn.speedLoss')}</TableHead>
                <TableHead className="text-right">{t('oeeAn.output')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.machines.map((m) => (
                <TableRow key={m.machineId}>
                  <TableCell className="text-sm">
                    <div className="font-medium">{m.code}</div>
                    <div className="text-[11px] text-muted-foreground">{m.name}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Pct v={m.performance} good={95} />
                    {m.performance >= 100 && (
                      <Badge variant="outline" className="ms-1.5 text-[9px] border-amber-500/40 text-amber-500">
                        {t('oeeAn.capped')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs">{fmtMin(m.runMin)}</TableCell>
                  <TableCell className="text-right text-xs">{fmtMin(m.idealRunMin)}</TableCell>
                  <TableCell className="text-right text-xs text-amber-400">{fmtMin(m.performanceLossMin)}</TableCell>
                  <TableCell className="text-right text-xs">{fmtNum(m.output)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Note>{t('oeeAn.performanceNote')}</Note>
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
