'use client';
/**
 * Availability Analytics — charts only.
 *
 * ── Why there are no cards here ─────────────────────────────────────────────
 * This page used to open with five stat tiles and close with a per-machine
 * table, with two charts in between. Those tiles were the same shape as the ones
 * on the live screens and were read the same way, so a reader could not tell
 * whether "Run time 7m" meant right now or across the selected month — and the
 * two genuinely differ.
 *
 * The split is now absolute: a value shown AS A VALUE belongs to a live page. An
 * analytics page shows change, comparison and composition — shapes, not
 * readings. Every number is still available, in the tooltip of the mark that
 * carries it, which is where a number belongs when the point is the trend.
 *
 * Four charts, four different questions:
 *   · trend        — is availability moving, and against target?
 *   · composition  — where did the planned time go, over the whole window?
 *   · ranking      — which machine is worst?
 *   · attribution  — for each machine, how much was its own fault?
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Legend, ReferenceLine, BarChart, Bar, Cell,
} from 'recharts';

import {
  useOeeAnalytics, PageHeader, Empty, Failed, Note, Chart, AXIS, SEGMENT_GAP,
  fmtMin, fmtDay, CHART_TOOLTIP, FACTOR_COLORS, LOSS_COLORS,
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

    // Where the planned time went, as one composition bar for the window.
    const composition = [{
      name: t('oeeAn.whereTimeWent'),
      run: x.runMin,
      breakdowns: x.unplannedStopMin,
      external: x.externalMin,
      planned: x.plannedStopMin,
    }];

    // Worst first — the machine to look at is at the top.
    const ranked = [...data.machines].sort((a, b) => a.availability - b.availability);

    // Attribution: own fault against waiting on the line, per machine. Minutes,
    // not percentages, because minutes are what somebody can act on.
    const attribution = ranked.map((m) => ({
      name: m.code,
      breakdowns: m.unplannedStopMin,
      external: m.externalMin,
    }));

    return (
      <div className="space-y-6">
        <Chart
          title={t('oeeAn.availabilityTrend')}
          help={t('oeeAn.trendHelp')}
          height={280}
        >
          <LineChart data={trend}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="label" {...AXIS} />
            <YAxis domain={[0, 100]} unit="%" {...AXIS} />
            <RTooltip {...CHART_TOOLTIP} formatter={(v: any) => [`${v}%`, t('oeeAn.availability')]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={90} stroke={FACTOR_COLORS.quality} strokeDasharray="4 4"
              label={{ value: t('oeeAn.target90'), fontSize: 9, fill: 'hsl(var(--muted-foreground))', position: 'insideTopRight' }} />
            <Line type="monotone" dataKey="availability" name={t('oeeAn.availability')}
              stroke={FACTOR_COLORS.availability} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </Chart>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Chart title={t('oeeAn.whereTimeWent')} help={t('oeeAn.whereTimeWentHelp')} height={200}>
            {/* Stacked, horizontal: the window's planned time divided by what it
                became. A 2px surface gap separates touching segments so the
                boundary reads as a division rather than a colour change. */}
            <BarChart data={composition} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} horizontal={false} />
              <XAxis type="number" {...AXIS} tickFormatter={(v: number) => fmtMin(v)} />
              <YAxis type="category" dataKey="name" hide />
              <RTooltip {...CHART_TOOLTIP} formatter={(v: any, n: any) => [fmtMin(Number(v)), n]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="run" stackId="a" name={t('oeeAn.runTime')}
                fill={LOSS_COLORS.productive} {...SEGMENT_GAP} />
              <Bar dataKey="breakdowns" stackId="a" name={t('oeeAn.breakdowns')}
                fill={LOSS_COLORS.breakdowns} {...SEGMENT_GAP} />
              <Bar dataKey="external" stackId="a" name={t('oeeAn.external')}
                fill={LOSS_COLORS.external} {...SEGMENT_GAP} />
              <Bar dataKey="planned" stackId="a" name={t('oeeAn.plannedStops')}
                fill={LOSS_COLORS.plannedStops} {...SEGMENT_GAP}
                radius={[0, 4, 4, 0]} />
            </BarChart>
          </Chart>

          <Chart title={t('oeeAn.worstMachines')} help={t('oeeAn.worstMachinesHelp')} height={200}>
            <BarChart data={ranked} layout="vertical" margin={{ left: 8, right: 28 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} horizontal={false} />
              <XAxis type="number" domain={[0, 100]} unit="%" {...AXIS} />
              <YAxis type="category" dataKey="code" width={54} {...AXIS} />
              <RTooltip {...CHART_TOOLTIP} formatter={(v: any) => [`${v}%`, t('oeeAn.availability')]} />
              <ReferenceLine x={90} stroke={FACTOR_COLORS.quality} strokeDasharray="4 4" />
              <Bar dataKey="availability" radius={[0, 4, 4, 0]}>
                {/* Status colour, not a series colour: the bar says how bad it is. */}
                {ranked.map((m, i) => (
                  <Cell key={i} fill={m.availability >= 90 ? LOSS_COLORS.productive
                    : m.availability >= 60 ? LOSS_COLORS.external : LOSS_COLORS.breakdowns} />
                ))}
              </Bar>
            </BarChart>
          </Chart>
        </div>

        <Chart title={t('oeeAn.attribution')} help={t('oeeAn.attributionHelp')} height={Math.max(200, attribution.length * 46)}>
          <BarChart data={attribution} layout="vertical" margin={{ left: 8, right: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} horizontal={false} />
            <XAxis type="number" {...AXIS} tickFormatter={(v: number) => fmtMin(v)} />
            <YAxis type="category" dataKey="name" width={54} {...AXIS} />
            <RTooltip {...CHART_TOOLTIP} formatter={(v: any, n: any) => [fmtMin(Number(v)), n]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="breakdowns" stackId="b" name={t('oeeAn.breakdowns')}
              fill={LOSS_COLORS.breakdowns} {...SEGMENT_GAP} />
            <Bar dataKey="external" stackId="b" name={t('oeeAn.external')}
              fill={LOSS_COLORS.external} {...SEGMENT_GAP}
              radius={[0, 4, 4, 0]} />
          </BarChart>
        </Chart>

        <Note>{t('oeeAn.externalNote')}</Note>
        <Note>{t('oeeAn.valuesLiveNote')}</Note>
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
