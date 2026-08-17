'use client';
/**
 * Quality Analytics — good units against everything the line produced.
 *
 * One definition matters here and it is not obvious, so the page states it: GOOD
 * counts only units that made it through the FINAL routing step, while SCRAP
 * counts rejections at EVERY step. A unit thrown out at the filler is a
 * rejection even though it never reached the wrapper.
 *
 * Quantities are in the product's smallest packaging unit, so a filler that
 * counts pieces and a palletiser that counts pallets can be compared on one
 * chart without one of them appearing 160 times larger than it is.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Legend, ReferenceLine, BarChart, Bar, Cell,
} from 'recharts';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  useOeeAnalytics, PageHeader, Stat, Pct, Empty, Failed, Note,
  fmtNum, fmtMin, fmtDay, CHART_TOOLTIP, FACTOR_COLORS,
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

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label={t('oeeAn.quality')} value={`${x.quality}%`} tone="primary" />
          <Stat label={t('oeeAn.good')} value={fmtNum(x.goodOutput)} tone="good" />
          <Stat label={t('oeeAn.scrap')} value={fmtNum(x.scrap)} tone="bad" />
          <Stat label={t('oeeAn.scrapRate')} value={`${x.output > 0 ? Math.round((x.scrap / x.output) * 1000) / 10 : 0}%`} />
          <Stat label={t('oeeAn.qualityLossTime')} value={fmtMin(x.qualityLossMin)} sub={t('oeeAn.timeMakingRejects')} tone="warn" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-lg border border-border/50 p-4">
            <h2 className="text-sm font-semibold mb-3">{t('oeeAn.qualityTrend')}</h2>
            {trend.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                  {/* Zoomed to the band quality actually lives in — a 0–100 axis
                      renders every real change as a flat line. */}
                  <YAxis domain={[90, 100]} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                  <RTooltip {...CHART_TOOLTIP} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={99} stroke="#008300" strokeDasharray="4 4"
                    label={{ value: t('oeeAn.target99'), fontSize: 9, fill: '#008300', position: 'insideTopRight' }} />
                  <Line type="monotone" dataKey="quality" name={t('oeeAn.quality')}
                    stroke={FACTOR_COLORS.quality} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <Empty text={t('machineStatus.noSnapshots')} />}
          </div>

          <div className="rounded-lg border border-border/50 p-4">
            <h2 className="text-sm font-semibold mb-1">{t('oeeAn.scrapByMachine')}</h2>
            <p className="text-[11px] text-muted-foreground mb-3">{t('oeeAn.scrapByMachineHelp')}</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={byScrap}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="code" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                <RTooltip {...CHART_TOOLTIP} formatter={(v: any) => [fmtNum(Number(v)), t('oeeAn.scrap')]} />
                <Bar dataKey="scrap" radius={[4, 4, 0, 0]}>
                  {byScrap.map((m, i) => (
                    <Cell key={i} fill={m.quality >= 99 ? '#eda100' : '#d03b3b'} />
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
                <TableHead className="text-right">{t('oeeAn.quality')}</TableHead>
                <TableHead className="text-right">{t('oeeAn.good')}</TableHead>
                <TableHead className="text-right">{t('oeeAn.scrap')}</TableHead>
                <TableHead className="text-right">{t('oeeAn.output')}</TableHead>
                <TableHead className="text-right">{t('oeeAn.qualityLossTime')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.machines.map((m) => (
                <TableRow key={m.machineId}>
                  <TableCell className="text-sm">
                    <div className="font-medium">{m.code}</div>
                    <div className="text-[11px] text-muted-foreground">{m.name}</div>
                  </TableCell>
                  <TableCell className="text-right"><Pct v={m.quality} good={99} /></TableCell>
                  <TableCell className="text-right text-xs">{fmtNum(m.goodOutput)}</TableCell>
                  <TableCell className="text-right text-xs text-red-400">{fmtNum(m.scrap)}</TableCell>
                  <TableCell className="text-right text-xs">{fmtNum(m.output)}</TableCell>
                  <TableCell className="text-right text-xs text-amber-400">{fmtMin(m.qualityLossMin)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Note>{t('oeeAn.qualityDefinitionNote')}</Note>
        <Note>{t('oeeAn.unitNote')}</Note>
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
