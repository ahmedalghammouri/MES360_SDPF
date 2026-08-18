'use client';
/**
 * Shared foundation for the four OEE analytics pages.
 *
 * Availability, Performance, Quality and the combined view all read ONE
 * endpoint and slice the same payload. None of them computes a factor, a loss
 * or a total of its own — that is the rule this whole project has been enforcing
 * since the first complaint, which was that the same filter produced different
 * numbers on different screens.
 *
 * The hook is shared too, so all four also agree on which machines and which
 * seconds they are describing: one scope, one window, one query key.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Info } from 'lucide-react';

import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { DataModeBadge } from '@/components/ui/data-mode-badge';
import { cn } from '@/lib/utils';

export interface FactorTotals {
  calendarMin: number; loadingMin: number; scheduleLossMin: number;
  plannedProductionMin: number; plannedStopMin: number;
  runMin: number; unplannedStopMin: number; externalMin: number;
  netOperatingMin: number; performanceLossMin: number; microStopMin: number; idealRunMin: number;
  fullyProductiveMin: number; qualityLossMin: number;
  output: number; goodOutput: number; scrap: number;
  availability: number; performance: number; quality: number;
  oee: number; utilization: number; teep: number;
}

export interface AnalyticsPayload {
  from: string; to: string;
  totals: FactorTotals;
  machines: Array<FactorTotals & { machineId: string; code: string; name: string; line: string | null }>;
  waterfall: Array<{ key: string; minutes: number; kind: 'base' | 'loss' | 'result' }>;
  losses: Array<{ key: string; minutes: number; factor: string }>;
  trend: Array<{
    date: string; availability: number; performance: number; quality: number;
    oee: number; utilization: number; teep: number; output: number; good: number;
  }>;
}

/** One query, one cache entry — every page that calls this shares the result. */
export function useOeeAnalytics() {
  const { filter, key: scopeKey, scope } = useScope();
  const { params, key: timeKey } = useTimeRange();

  const query = useQuery({
    queryKey: ['oee-analytics', scopeKey, timeKey],
    queryFn: () => api.get('/machine-status/analytics', {
      // The whole params object, `timeframe` included. Sending only the dates made
      // the sidebar's "Shift" resolve to the calendar day on all four analytics
      // pages while the OEE page resolved the real shift, so the same machine
      // reported two availabilities depending on which page you were looking at.
      params: { ...filter, ...params },
    }),
    staleTime: 20_000,
    retry: 2,
  });

  const data = ((query.data as any)?.data ?? query.data) as AnalyticsPayload | undefined;
  return { ...query, data, scope, window: { from: params.dateFrom, to: params.dateTo } };
}

export const fmtMin = (m?: number) => {
  if (!m || m < 1) return '0m';
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${r}m` : `${r}m`;
};

export const fmtNum = (n?: number) => Math.round(n ?? 0).toLocaleString();

export const fmtDay = (d: string) =>
  new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });

export const CHART_TOOLTIP = {
  // contentStyle alone is not enough: Recharts paints the tooltip's LABEL and
  // each ITEM with its own default dark colour, so on a dark card the text is
  // near-invisible. All three have to be told about the theme.
  contentStyle: {
    background: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 8,
    fontSize: 12,
    color: 'hsl(var(--foreground))',
  },
  labelStyle: { color: 'hsl(var(--foreground))' },
  itemStyle: { color: 'hsl(var(--foreground))' },
};

/**
 * Factor colours, taken from the validated status palette.
 *
 * These are STATUS roles, not a categorical series: availability, performance
 * and quality are the three things that can go wrong, and the same hue means the
 * same factor on every one of the four pages.
 */
export const FACTOR_COLORS = {
  availability: '#2a78d6',
  performance: '#eda100',
  quality: '#008300',
  utilization: '#8a8a85',
  oee: '#4a3aa7',
} as const;

export function PageHeader({
  title, subtitle, icon: Icon, scope, window: win,
}: {
  title: string; subtitle: string; icon: React.ElementType;
  scope: any; window: { from: string; to: string };
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Icon size={22} /> {title}
        <DataModeBadge mode="live" />
      </h1>
      <p className="text-sm text-muted-foreground mt-0.5">
        {subtitle}
        {scope && scope.type !== 'FACTORY' && <> · <span className="font-medium">{scope.code ?? scope.name}</span></>}
        {' · '}{win.from} → {win.to}
      </p>
    </div>
  );
}

export function Stat({
  label, value, sub, tone,
}: {
  label: string; value: string; sub?: string;
  tone?: 'good' | 'bad' | 'warn' | 'primary';
}) {
  return (
    <div className="rounded-lg border border-border/50 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn(
        'text-xl font-bold mt-0.5',
        tone === 'good' && 'text-emerald-500',
        tone === 'bad' && 'text-red-400',
        tone === 'warn' && 'text-amber-500',
      )}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export function Pct({ v, good = 85 }: { v?: number; good?: number }) {
  const n = v ?? 0;
  return (
    <span className={cn('text-sm font-semibold',
      n >= good ? 'text-emerald-500' : n >= good * 0.7 ? 'text-amber-500' : 'text-red-400')}>
      {n}%
    </span>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="text-sm text-muted-foreground text-center py-12">{text}</div>;
}

export function Failed({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation(['production', 'common']);
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
      <AlertTriangle className="h-8 w-8 text-amber-500/70" />
      <div className="text-sm text-muted-foreground max-w-sm">{t('machineStatus.loadFailed')}</div>
      {onRetry && (
        <button type="button" onClick={onRetry}
          className="text-xs px-3 py-1.5 rounded-md border border-border/60 hover:border-border transition-colors">
          {t('machineStatus.retry')}
        </button>
      )}
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] text-muted-foreground flex gap-1.5">
      <Info className="h-3.5 w-3.5 shrink-0 mt-px" /> {children}
    </p>
  );
}

/**
 * A horizontal loss bar: what the factor started with, and what each loss took.
 *
 * Shown as minutes rather than percentages because minutes are what a plant
 * manager can act on — "we lost four hours to changeovers" leads somewhere,
 * "availability was 94%" does not.
 */
export function LossBar({
  segments, total,
}: {
  segments: Array<{ label: string; minutes: number; color: string }>;
  total: number;
}) {
  const span = Math.max(1, total);
  return (
    <div>
      <div className="flex h-7 rounded-md overflow-hidden border border-border/40 bg-muted/25">
        {segments.filter((s) => s.minutes > 0).map((s, i) => (
          <div
            key={i}
            // A 2px surface gap separates touching marks, so the boundary is
            // read as a division rather than as a colour change.
            style={{ width: `calc(${(s.minutes / span) * 100}% - 2px)`, backgroundColor: s.color, minWidth: 2 }}
            className="h-full"
            title={`${s.label} — ${fmtMin(s.minutes)}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mt-2">
        {segments.filter((s) => s.minutes > 0).map((s, i) => (
          <span key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label} <span className="text-foreground font-medium">{fmtMin(s.minutes)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
