'use client';
import { useTranslation } from 'react-i18next';

/**
 * FactoryAnalyticsView — a JO-live-style RICH analytics screen at the selected scope
 * (Factory → Area → Line → Machine), from SAVED data, respecting the global scope +
 * date-range filters. Composes existing endpoints (no new backend):
 *   • GET /production/oee/calculate  → KPIs (both OEE methods), trend, per-machine
 *   • GET /production/oee/hierarchy  → rollup tree + six-loss + downtime Pareto (HierarchyOEE)
 *   • GET /production/downtime/summary → downtime classification
 *   • GET /maintenance/kpis          → reliability (MTTR / MTBF)
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  ResponsiveContainer, ReferenceLine, Legend, ComposedChart, Line, Bar,
} from 'recharts';
import { Activity, Gauge, Layers, Cpu, ShieldAlert, Wrench, TrendingUp } from 'lucide-react';

import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { useDashboardPrefsStore } from '@/store/dashboard-prefs-store';
import { KPICard } from '@/components/widgets/kpi-card';
import { HierarchyOEE } from '@/features/production/hierarchy-oee';
import { cn } from '@/lib/utils';

const WORLD_CLASS = 85;

interface EquipRow {
  machineId: string; name: string; code?: string | null;
  oee: number; availability: number; performance: number; quality: number;
  oeeTb?: number; availabilityTb?: number; output: number;
}
interface OeeCalc {
  current: { oee: number; availability: number; performance: number; quality: number; oeeTb?: number; availabilityTb?: number };
  trend: { period: string; oee: number; oeeTb?: number }[];
  byEquipment: EquipRow[];
  totalCount: number; goodCount: number; downtime: number;
}
interface DowntimeSummary {
  totalEvents: number; totalMinutes: number; oeeImpactMinutes: number; plannedMinutes: number;
  byCategory: Record<string, number>;
}
interface MaintKpis { mttr: number; mtbf: number; availabilityRate: number }

const oeeText = (v: number) => (v >= 85 ? 'text-green-400' : v >= 65 ? 'text-brand-400' : v >= 45 ? 'text-amber-400' : 'text-red-400');
const prettyCat = (c: string) => c.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

export function FactoryAnalyticsView() {
  const { t } = useTranslation('modules');
  const { filter, key, scope } = useScope();
  const { params: timeParams, key: timeKey, label: timeLabel, dateFrom, dateTo } = useTimeRange();
  const { atOee, trendType } = useDashboardPrefsStore();
  const scopeParams = { ...filter, dateFrom, dateTo };

  const { data: oee, isLoading: oeeLoading } = useQuery({
    queryKey: ['analytics', 'oee', key, timeKey],
    queryFn: () => api.get<OeeCalc>('/production/oee/calculate', { params: { ...timeParams, ...filter } }),
    staleTime: 30_000,
  });
  const { data: downtime } = useQuery({
    queryKey: ['analytics', 'downtime', key, timeKey],
    queryFn: () => api.get<DowntimeSummary>('/production/downtime/summary', { params: scopeParams }),
    staleTime: 30_000,
  });
  const { data: maint } = useQuery({
    queryKey: ['analytics', 'maint', key],
    queryFn: () => api.get<MaintKpis>('/maintenance/kpis', { params: filter }),
    staleTime: 60_000,
  });

  const cur = oee?.current;
  const trend = oee?.trend ?? [];
  const equip = [...(oee?.byEquipment ?? [])].sort((a, b) => b.oee - a.oee);
  const scopeName = scope?.name ?? t('analytics.wholeFactory');
  const dtCats = Object.entries(downtime?.byCategory ?? {}).sort(([, a], [, b]) => b - a);
  const dtCatMax = dtCats[0]?.[1] || 1;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <Layers className="text-brand-400" size={22} />
          <div>
            <h1 className="text-lg font-bold tracking-tight text-foreground">{t('analytics.title')}</h1>
            <p className="text-xs text-muted-foreground">
              {t('analytics.subtitlePre')} — <span className="text-foreground">{scopeName}</span> · {timeLabel}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title={atOee ? `${t('analytics.oee')} (AT)` : t('analytics.oee')} value={(atOee ? cur?.oeeTb : cur?.oee) ?? 0} unit="%" target={WORLD_CLASS} colorMode="oee" isLoading={oeeLoading} />
          <KPICard title={atOee ? `${t('analytics.availability')} (AT)` : t('analytics.availability')} value={(atOee ? cur?.availabilityTb : cur?.availability) ?? 0} unit="%" colorMode="default" isLoading={oeeLoading} />
          <KPICard title={t('analytics.performance')} value={cur?.performance ?? 0} unit="%" colorMode="default" isLoading={oeeLoading} />
          <KPICard title={t('analytics.quality')} value={cur?.quality ?? 0} unit="%" colorMode="default" isLoading={oeeLoading} />
        </div>

        {/* Time-Based (AT-OEE) + reliability strip */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground -mt-1 px-1">
          <span>{t('analytics.atOee')}: <b className="text-foreground">{(cur?.oeeTb ?? 0).toFixed(1)}%</b></span>
          <span>{t('analytics.availabilityTb')}: <b className="text-foreground">{(cur?.availabilityTb ?? 0).toFixed(1)}%</b></span>
          <span className="opacity-70">·</span>
          <span>{t('analytics.mttr')}: <b className="text-foreground">{(maint?.mttr ?? 0).toFixed(1)}h</b></span>
          <span>{t('analytics.mtbf')}: <b className="text-foreground">{(maint?.mtbf ?? 0).toFixed(0)}h</b></span>
          <span>{t('analytics.maintAvailability')}: <b className="text-foreground">{(maint?.availabilityRate ?? 0).toFixed(1)}%</b></span>
        </div>

        {/* OEE-over-time lives in OEE Analytics & Machine OEE (no duplicate here).
            Factory Analytics focuses on the hierarchy rollup, six-loss & Pareto. */}

        {/* Hierarchy rollup + six-loss + downtime Pareto (reused) */}
        <HierarchyOEE />

        <div className="grid grid-cols-12 gap-4">
          {/* Per-machine breakdown */}
          <div className="col-span-12 lg:col-span-7">
            <div className="industrial-card rounded-xl p-4 h-full">
              <div className="flex items-center gap-2 mb-3">
                <Cpu size={14} className="text-brand-400" />
                <h3 className="text-sm font-semibold">{t('analytics.perMachine')}</h3>
                <span className="ml-auto text-[10px] text-muted-foreground">{t('analytics.machinesCount', { count: equip.length })}</span>
              </div>
              {equip.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-8">{t('analytics.noMachineOee')}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/40 text-muted-foreground">
                        <th className="text-left py-2 px-2 font-medium">{t('analytics.colMachine')}</th>
                        <th className="text-center py-2 px-2 font-medium">{t('analytics.oee')}</th>
                        <th className="text-center py-2 px-2 font-medium">{t('analytics.colOeeTb')}</th>
                        <th className="text-center py-2 px-2 font-medium">{t('analytics.colA')}</th>
                        <th className="text-center py-2 px-2 font-medium">{t('analytics.colATb')}</th>
                        <th className="text-center py-2 px-2 font-medium">{t('analytics.colP')}</th>
                        <th className="text-center py-2 px-2 font-medium">{t('analytics.colQ')}</th>
                        <th className="text-right py-2 px-2 font-medium">{t('analytics.colOutput')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {equip.map((m, idx) => (
                        <tr key={m.machineId ?? m.name ?? idx} className="border-b border-border/20 last:border-0 hover:bg-muted/10">
                          <td className="py-2 px-2 font-medium text-foreground">{m.name}</td>
                          <td className={cn('py-2 px-2 text-center font-bold tabular-nums', oeeText(m.oee ?? 0))}>{(m.oee ?? 0).toFixed(1)}%</td>
                          <td className="py-2 px-2 text-center tabular-nums text-cyan-400">{(m.oeeTb ?? 0).toFixed(1)}%</td>
                          <td className="py-2 px-2 text-center tabular-nums text-muted-foreground">{(m.availability ?? 0).toFixed(1)}%</td>
                          <td className="py-2 px-2 text-center tabular-nums text-cyan-400/70">{(m.availabilityTb ?? 0).toFixed(1)}%</td>
                          <td className="py-2 px-2 text-center tabular-nums text-muted-foreground">{(m.performance ?? 0).toFixed(1)}%</td>
                          <td className="py-2 px-2 text-center tabular-nums text-muted-foreground">{(m.quality ?? 0).toFixed(1)}%</td>
                          <td className="py-2 px-2 text-right tabular-nums text-foreground">{(m.output ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Downtime classification */}
          <div className="col-span-12 lg:col-span-5 space-y-4">
            <div className="industrial-card rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <ShieldAlert size={14} className="text-brand-400" />
                <h3 className="text-sm font-semibold">{t('analytics.downtimeClassification')}</h3>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {[
                  { label: t('analytics.dtTotal'), value: downtime?.totalMinutes ?? 0, color: 'text-foreground' },
                  { label: t('analytics.dtOeeImpact'), value: downtime?.oeeImpactMinutes ?? 0, color: 'text-red-400' },
                  { label: t('analytics.dtPlanned'), value: downtime?.plannedMinutes ?? 0, color: 'text-emerald-400' },
                ].map((s) => (
                  <div key={s.label} className="text-center p-2 rounded-lg bg-muted/20">
                    <div className={cn('text-sm font-bold tabular-nums', s.color)}>{Math.round(s.value)}<span className="text-[10px] font-normal text-muted-foreground"> {t('analytics.min')}</span></div>
                    <div className="text-[10px] text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>
              {dtCats.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-4">{t('analytics.noDowntime')}</div>
              ) : (
                <div className="space-y-2">
                  {dtCats.slice(0, 8).map(([cat, min]) => (
                    <div key={cat}>
                      <div className="flex items-center justify-between text-[11px] mb-0.5">
                        <span className="text-muted-foreground truncate">{prettyCat(cat)}</span>
                        <span className="font-semibold tabular-nums shrink-0 ml-2">{Math.round(min)} {t('analytics.min')}</span>
                      </div>
                      <div className="h-2 rounded-full bg-foreground/10 overflow-hidden">
                        <div className="h-full rounded-full bg-amber-500/70" style={{ width: `${(min / dtCatMax) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Output summary */}
            <div className="industrial-card rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={14} className="text-brand-400" />
                <h3 className="text-sm font-semibold">{t('analytics.outputPeriod')}</h3>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 rounded-lg bg-muted/20">
                  <div className="text-sm font-bold tabular-nums text-foreground">{(oee?.totalCount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}</div>
                  <div className="text-[10px] text-muted-foreground">{t('analytics.outTotal')}</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-muted/20">
                  <div className="text-sm font-bold tabular-nums text-emerald-400">{(oee?.goodCount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}</div>
                  <div className="text-[10px] text-muted-foreground">{t('analytics.outGood')}</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-muted/20">
                  <div className="text-sm font-bold tabular-nums text-red-400">{Math.max(0, (oee?.totalCount ?? 0) - (oee?.goodCount ?? 0)).toLocaleString(undefined, { maximumFractionDigits: 1 })}</div>
                  <div className="text-[10px] text-muted-foreground">{t('analytics.outScrap')}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
