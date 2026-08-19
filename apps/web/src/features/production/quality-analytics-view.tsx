'use client';
/**
 * Quality Analytics — charts only.
 *
 * One definition matters here and it is not obvious, so the page states it: GOOD
 * counts only units that made it through the FINAL routing step, while SCRAP
 * counts rejections at EVERY step. A unit thrown out at the filler is a rejection
 * even though it never reached the wrapper.
 *
 * Quantities are in the product's smallest packaging unit, so a filler counting
 * pieces and a palletiser counting pallets can share one chart without one of
 * them appearing 160 times larger than it is.
 *
 * No stat tiles and no table — a value read as a value belongs on a live page.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Legend, ReferenceLine, BarChart, Bar, Cell,
} from 'recharts';

import {
  useOeeAnalytics, PageHeader, Empty, Failed, Note, Chart, AXIS, SEGMENT_GAP,
  fmtNum, fmtDay, CHART_TOOLTIP, FACTOR_COLORS, LOSS_COLORS,
} from './oee-analytics-shared';

export function QualityAnalyticsView() {
  const { t } = useTranslation(['production', 'common']);
  const { data, isLoading, error, refetch, scope, window: win } = useOeeAnalytics();

  const body = () => {
    if (error) return <Failed onRetry={refetch} />;
    if (isLoading) return <Empty text={t('common:loading')} />;
    if (!data?.machines?.length) return <Empty text={t('machineStatus.noMachines')} />;

    const x = data.totals;
    const trend = (data.trend ?? []).map((d) => ({ ...d, label: fmtDay(d.date) }));

    // Sorted by scrap, not by rate: the machine to look at first is the one
    // throwing away the most units, which a percentage on a small run hides.
    const byScrap = [...data.machines].sort((a, b) => b.scrap - a.scrap);

    const composition = [{
      name: t('oeeAn.output'),
      good: x.goodOutput,
      scrap: x.scrap,
    }];

    return (
      <div className="space-y-6">
        <Chart title={t('oeeAn.qualityTrend')} help={t('oeeAn.trendHelp')} height={280}>
          <LineChart data={trend}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis dataKey="label" {...AXIS} />
            {/* Zoomed to the band quality actually lives in — a 0–100 axis renders
                every real change as a flat line. */}
            <YAxis domain={[90, 100]} unit="%" {...AXIS} />
            <RTooltip {...CHART_TOOLTIP} formatter={(v: any) => [`${v}%`, t('oeeAn.quality')]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine y={99} stroke={FACTOR_COLORS.quality} strokeDasharray="4 4"
              label={{ value: t('oeeAn.target99'), fontSize: 9, fill: 'hsl(var(--muted-foreground))', position: 'insideTopRight' }} />
            <Line type="monotone" dataKey="quality" name={t('oeeAn.quality')}
              stroke={FACTOR_COLORS.quality} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </Chart>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Chart title={t('oeeAn.outputSplit')} help={t('oeeAn.outputSplitHelp')} height={200}>
            <BarChart data={composition} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} horizontal={false} />
              <XAxis type="number" {...AXIS} tickFormatter={(v: number) => fmtNum(v)} />
              <YAxis type="category" dataKey="name" hide />
              <RTooltip {...CHART_TOOLTIP} formatter={(v: any, n: any) => [fmtNum(Number(v)), n]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="good" stackId="a" name={t('oeeAn.good')}
                fill={LOSS_COLORS.productive} {...SEGMENT_GAP} />
              <Bar dataKey="scrap" stackId="a" name={t('oeeAn.scrap')}
                fill={LOSS_COLORS.qualityLoss} {...SEGMENT_GAP} radius={[0, 4, 4, 0]} />
            </BarChart>
          </Chart>

          <Chart title={t('oeeAn.scrapByMachine')} help={t('oeeAn.scrapByMachineHelp')} height={200}>
            <BarChart data={byScrap} layout="vertical" margin={{ left: 8, right: 28 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} horizontal={false} />
              <XAxis type="number" {...AXIS} tickFormatter={(v: number) => fmtNum(v)} />
              <YAxis type="category" dataKey="code" width={54} {...AXIS} />
              <RTooltip {...CHART_TOOLTIP} formatter={(v: any) => [fmtNum(Number(v)), t('oeeAn.scrap')]} />
              <Bar dataKey="scrap" radius={[0, 4, 4, 0]}>
                {byScrap.map((m, i) => (
                  <Cell key={i} fill={m.quality >= 99 ? LOSS_COLORS.external : LOSS_COLORS.breakdowns} />
                ))}
              </Bar>
            </BarChart>
          </Chart>
        </div>

        <Chart title={t('oeeAn.qualityByMachine')} help={t('oeeAn.qualityByMachineHelp')}
               height={Math.max(200, data.machines.length * 46)}>
          <BarChart data={[...data.machines].sort((a, b) => a.quality - b.quality)}
                    layout="vertical" margin={{ left: 8, right: 28 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} horizontal={false} />
            <XAxis type="number" domain={[90, 100]} unit="%" {...AXIS} />
            <YAxis type="category" dataKey="code" width={54} {...AXIS} />
            <RTooltip {...CHART_TOOLTIP} formatter={(v: any) => [`${v}%`, t('oeeAn.quality')]} />
            <ReferenceLine x={99} stroke={FACTOR_COLORS.quality} strokeDasharray="4 4" />
            <Bar dataKey="quality" fill={FACTOR_COLORS.quality} radius={[0, 4, 4, 0]} />
          </BarChart>
        </Chart>

        <Note>{t('oeeAn.qualityDefinitionNote')}</Note>
        <Note>{t('oeeAn.unitNote')}</Note>
        <Note>{t('oeeAn.valuesLiveNote')}</Note>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={t('oeeAn.qualityTitle')}
        subtitle={t('oeeAn.qualitySubtitle')}
        icon={ShieldCheck}
        scope={scope}
        window={win}
      />
      {body()}
    </div>
  );
}
