'use client';
/**
 * OEE Loss Tree — the whole calendar accounted for, and TEEP.
 *
 * The three factor pages each explain one term. This one puts them in order and
 * shows what the other three never can: the time the plant chose NOT to run.
 *
 * ── Why TEEP is the number to argue about ───────────────────────────────────
 * OEE measures the plant against the hours it planned to work, so a plant that
 * runs one shift a day can post a fine OEE while three quarters of its capacity
 * sits idle. TEEP measures the same output against the CALENDAR — every hour
 * that exists. The gap between them is capacity the company has already paid
 * for. It is usually the largest single number on this page and the one nobody
 * is looking at.
 *
 * The waterfall is drawn as a descending cascade rather than a stacked bar: each
 * step is a subtraction from the one above, and a cascade is the only shape that
 * shows a subtraction as a subtraction.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, TrendingDown } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Legend, BarChart, Bar, Cell,
} from 'recharts';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  useOeeAnalytics, PageHeader, Stat, Pct, Empty, Failed, Note,
  fmtMin, fmtNum, fmtDay, CHART_TOOLTIP, FACTOR_COLORS,
} from './oee-analytics-shared';
import { cn } from '@/lib/utils';

/** Colour by who owns the loss, matching the factor pages. */
const LOSS_COLOR: Record<string, string> = {
  scheduleLoss: '#8a8a85',
  plannedStops: FACTOR_COLORS.availability,
  breakdowns: '#d03b3b',
  external: '#eda100',
  speedLoss: FACTOR_COLORS.performance,
  qualityLoss: '#4a3aa7',
};

export function LossTreeView() {
  const { t } = useTranslation(['production', 'common']);
  const { data, isLoading, error, refetch, scope, window: win } = useOeeAnalytics();

  const body = () => {
    if (error) return <Failed onRetry={refetch} />;
    if (isLoading) return <Empty text={t('common:loading')} />;
    if (!data?.machines?.length) return <Empty text={t('machineStatus.noMachines')} />;

    const x = data.totals;
    const trend = (data.trend ?? []).map((d) => ({ ...d, label: fmtDay(d.date) }));
    const losses = (data.losses ?? []).map((l) => ({
      ...l,
      label: t(`oeeAn.loss.${l.key}`),
      color: LOSS_COLOR[l.key] ?? '#8a8a85',
    }));
    const calendar = Math.max(1, x.calendarMin);

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Stat label={t('oeeAn.oee')} value={`${x.oee}%`} tone="primary" sub={t('oeeAn.vsPlanned')} />
          <Stat label={t('oeeAn.teep')} value={`${x.teep}%`} tone="warn" sub={t('oeeAn.vsCalendar')} />
          <Stat label={t('oeeAn.utilization')} value={`${x.utilization}%`} sub={t('oeeAn.ofCalendar')} />
          <Stat label={t('oeeAn.availability')} value={`${x.availability}%`} />
          <Stat label={t('oeeAn.performance')} value={`${x.performance}%`} />
          <Stat label={t('oeeAn.quality')} value={`${x.quality}%`} />
        </div>

        {/* The headline the page exists for — but only when there IS a gap.
            With utilisation at 100% TEEP equals OEE, and a banner announcing a
            difference between two identical numbers is simply untrue. */}
        {x.utilization < 99 ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex gap-3">
            <TrendingDown className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold">
                {t('oeeAn.teepHeadline', { oee: x.oee, teep: x.teep })}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{t('oeeAn.teepExplain')}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border/50 p-4 flex gap-3">
            <Layers className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold">{t('oeeAn.fullyLoadedTitle')}</div>
              <p className="text-xs text-muted-foreground mt-1">{t('oeeAn.fullyLoadedBody')}</p>
            </div>
          </div>
        )}

        {/* Waterfall */}
        <div className="rounded-lg border border-border/50 p-4">
          <h2 className="text-sm font-semibold mb-1">{t('oeeAn.waterfall')}</h2>
          <p className="text-[11px] text-muted-foreground mb-4">{t('oeeAn.waterfallHelp')}</p>
          <div className="space-y-1.5">
            {(data.waterfall ?? []).map((step) => {
              const pct = (step.minutes / calendar) * 100;
              const isLoss = step.kind === 'loss';
              return (
                <div key={step.key} className="flex items-center gap-3">
                  <div className={cn(
                    'w-44 shrink-0 text-xs',
                    isLoss ? 'text-muted-foreground ps-4' : 'font-medium',
                    step.kind === 'result' && 'text-emerald-500 font-semibold',
                  )}>
                    {isLoss ? '− ' : ''}{t(`oeeAn.step.${step.key}`)}
                  </div>
                  <div className="flex-1 h-6 rounded-md bg-muted/25 overflow-hidden relative">
                    <div
                      className="h-full rounded-md"
                      style={{
                        width: `${Math.max(0.4, Math.min(100, pct))}%`,
                        backgroundColor: isLoss
                          ? (LOSS_COLOR[step.key] ?? '#8a8a85')
                          : step.kind === 'result' ? '#008300' : '#2a78d6',
                        opacity: isLoss ? 0.85 : 1,
                      }}
                    />
                  </div>
                  <div className="w-28 shrink-0 text-end text-xs tabular-nums">
                    {fmtMin(step.minutes)}
                  </div>
                  <div className="w-14 shrink-0 text-end text-[11px] text-muted-foreground tabular-nums">
                    {Math.round(pct * 10) / 10}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-lg border border-border/50 p-4">
            <h2 className="text-sm font-semibold mb-1">{t('oeeAn.biggestLosses')}</h2>
            <p className="text-[11px] text-muted-foreground mb-3">{t('oeeAn.biggestLossesHelp')}</p>
            {losses.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={losses} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                  <RTooltip {...CHART_TOOLTIP} formatter={(v: any) => [fmtMin(Number(v)), t('oeeAn.lost')]} />
                  <Bar dataKey="minutes" radius={[0, 4, 4, 0]}>
                    {losses.map((l, i) => <Cell key={i} fill={l.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty text={t('oeeAn.noLosses')} />}
          </div>

          <div className="rounded-lg border border-border/50 p-4">
            <h2 className="text-sm font-semibold mb-3">{t('oeeAn.oeeVsTeep')}</h2>
            {trend.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                  <RTooltip {...CHART_TOOLTIP} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="oee" name={t('oeeAn.oee')}
                    stroke={FACTOR_COLORS.oee} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="teep" name={t('oeeAn.teep')}
                    stroke={FACTOR_COLORS.performance} strokeWidth={2} strokeDasharray="5 3" dot={false} />
                  <Line type="monotone" dataKey="utilization" name={t('oeeAn.utilization')}
                    stroke={FACTOR_COLORS.utilization} strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <Empty text={t('machineStatus.noSnapshots')} />}
          </div>
        </div>

        <div className="rounded-lg border border-border/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/50 text-sm font-semibold">{t('oeeAn.perMachine')}</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('oeeAn.machine')}</TableHead>
                <TableHead className="text-right">{t('oeeAn.oee')}</TableHead>
                <TableHead className="text-right">{t('oeeAn.teep')}</TableHead>
                <TableHead className="text-right">A</TableHead>
                <TableHead className="text-right">P</TableHead>
                <TableHead className="text-right">Q</TableHead>
                <TableHead className="text-right">{t('oeeAn.utilization')}</TableHead>
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
                  <TableCell className="text-right"><Pct v={m.oee} /></TableCell>
                  <TableCell className="text-right"><Pct v={m.teep} good={50} /></TableCell>
                  <TableCell className="text-right text-xs">{m.availability}%</TableCell>
                  <TableCell className="text-right text-xs">{m.performance}%</TableCell>
                  <TableCell className="text-right text-xs">{m.quality}%</TableCell>
                  <TableCell className="text-right text-xs">{m.utilization}%</TableCell>
                  <TableCell className="text-right text-xs">{fmtNum(m.output)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Note>{t('oeeAn.lossTreeNote')}</Note>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={t('oeeAn.lossTreeTitle')}
        subtitle={t('oeeAn.lossTreeSubtitle')}
        icon={Layers}
        scope={scope}
        window={win}
      />
      {body()}
    </div>
  );
}
