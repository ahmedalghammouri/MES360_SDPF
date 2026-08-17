'use client';
/**
 * Availability Analytics — where the planned production time went.
 *
 * Availability is run time over planned production time, so this page's job is
 * to account for the gap: how much was breakdown, how much was the machine
 * waiting on the line, and which machines carry it.
 *
 * The external split is the point of the page. Starvation and blockage are
 * losses the machine did not cause, and they are excluded from its own
 * availability — showing them beside the breakdowns is what stops a plant
 * "fixing" a machine that was only ever waiting for material.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Legend, ReferenceLine, BarChart, Bar, Cell,
} from 'recharts';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  useOeeAnalytics, PageHeader, Stat, Pct, Empty, Failed, Note, LossBar,
  fmtMin, fmtDay, CHART_TOOLTIP, FACTOR_COLORS,
} from './oee-analytics-shared';

export function AvailabilityAnalyticsView() {
  const { t } = useTranslation(['production', 'common']);
  const { data, isLoading, error, refetch, scope, window: win } = useOeeAnalytics();

  const body = () => {
    if (error) return <Failed onRetry={refetch} />;
    if (isLoading) return <Empty text={t('common:loading')} />;
    if (!data?.machines?.length) return <Empty text={t('machineStatus.noMachines')} />;

    const x = data.totals;
    const trend = (data.trend ?? []).map((d) => ({ ...d, label: fmtDay(d.date) }));
    const worst = [...data.machines].sort((a, b) => a.availability - b.availability);

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label={t('oeeAn.availability')} value={`${x.availability}%`} tone="primary" />
          <Stat label={t('oeeAn.plannedProduction')} value={fmtMin(x.plannedProductionMin)} sub={t('oeeAn.theDenominator')} />
          <Stat label={t('oeeAn.runTime')} value={fmtMin(x.runMin)} tone="good" />
          <Stat label={t('oeeAn.breakdowns')} value={fmtMin(x.unplannedStopMin)} tone="bad" />
          <Stat label={t('oeeAn.external')} value={fmtMin(x.externalMin)} tone="warn" sub={t('oeeAn.notCharged')} />
        </div>

        <div className="rounded-lg border border-border/50 p-4">
          <h2 className="text-sm font-semibold mb-1">{t('oeeAn.whereTimeWent')}</h2>
          <p className="text-[11px] text-muted-foreground mb-4">{t('oeeAn.availabilitySplitHelp')}</p>
          <LossBar
            total={x.plannedProductionMin}
            segments={[
              { label: t('oeeAn.runTime'), minutes: x.runMin, color: FACTOR_COLORS.quality },
              { label: t('oeeAn.breakdowns'), minutes: x.unplannedStopMin, color: '#d03b3b' },
              { label: t('oeeAn.external'), minutes: x.externalMin, color: '#eda100' },
            ]}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-lg border border-border/50 p-4">
            <h2 className="text-sm font-semibold mb-3">{t('oeeAn.availabilityTrend')}</h2>
            {trend.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                  <RTooltip {...CHART_TOOLTIP} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={90} stroke="#008300" strokeDasharray="4 4"
                    label={{ value: t('oeeAn.target90'), fontSize: 9, fill: '#008300', position: 'insideTopRight' }} />
                  <Line type="monotone" dataKey="availability" name={t('oeeAn.availability')}
                    stroke={FACTOR_COLORS.availability} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <Empty text={t('machineStatus.noSnapshots')} />}
          </div>

          <div className="rounded-lg border border-border/50 p-4">
            <h2 className="text-sm font-semibold mb-1">{t('oeeAn.worstMachines')}</h2>
            <p className="text-[11px] text-muted-foreground mb-3">{t('oeeAn.worstHelp')}</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={worst} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                <YAxis type="category" dataKey="code" width={54} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                <RTooltip {...CHART_TOOLTIP} formatter={(v: any) => [`${v}%`, t('oeeAn.availability')]} />
                <Bar dataKey="availability" radius={[0, 4, 4, 0]}>
                  {worst.map((m, i) => (
                    <Cell key={i} fill={m.availability >= 90 ? '#008300' : m.availability >= 70 ? '#eda100' : '#d03b3b'} />
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
                <TableHead className="text-right">{t('oeeAn.availability')}</TableHead>
                <TableHead className="text-right">{t('oeeAn.plannedProduction')}</TableHead>
                <TableHead className="text-right">{t('oeeAn.runTime')}</TableHead>
                <TableHead className="text-right">{t('oeeAn.breakdowns')}</TableHead>
                <TableHead className="text-right">{t('oeeAn.external')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.machines.map((m) => (
                <TableRow key={m.machineId}>
                  <TableCell className="text-sm">
                    <div className="font-medium">{m.code}</div>
                    <div className="text-[11px] text-muted-foreground">{m.name}</div>
                  </TableCell>
                  <TableCell className="text-right"><Pct v={m.availability} good={90} /></TableCell>
                  <TableCell className="text-right text-xs">{fmtMin(m.plannedProductionMin)}</TableCell>
                  <TableCell className="text-right text-xs">{fmtMin(m.runMin)}</TableCell>
                  <TableCell className="text-right text-xs text-red-400">{fmtMin(m.unplannedStopMin)}</TableCell>
                  <TableCell className="text-right text-xs text-amber-400">{fmtMin(m.externalMin)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Note>{t('oeeAn.externalNote')}</Note>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={t('oeeAn.availabilityTitle')}
        subtitle={t('oeeAn.availabilitySubtitle')}
        icon={Clock}
        scope={scope}
        window={win}
      />
      {body()}
    </div>
  );
}
