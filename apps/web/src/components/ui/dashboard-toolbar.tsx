'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';

import { Button } from './button';
import { TimeRangeFilter } from './time-range-filter';
import { ScopeBadge } from './scope-badge';
import { cn } from '@/lib/utils';

export type TrendType = 'area' | 'line' | 'bar';

/** Segmented control to switch a trend's render style. */
export function TrendTypeToggle({ value, onChange }: { value: TrendType; onChange: (t: TrendType) => void }) {
  const opts: TrendType[] = ['area', 'line', 'bar'];
  return (
    <div className="inline-flex items-center rounded-md border border-border/60 bg-card/60 p-0.5">
      {opts.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn(
            'px-2 py-0.5 text-[10px] rounded capitalize transition-colors',
            value === o ? 'bg-primary/15 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/**
 * Shared cockpit toolbar — one consistent right-hand control cluster for every
 * dashboard: live badge, active-scope chip, time range, optional trend-type and
 * OEE/AT-OEE switches, an optional extra slot, and refresh. Each cockpit opts into
 * the controls it needs; the header title/icon stays page-specific.
 */
export function DashboardToolbar({
  scope = true,
  time = false,
  refreshing,
  onRefresh,
  trendType,
  onTrendType,
  atOee,
  onAtOee,
  extra,
}: {
  scope?: boolean;
  time?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  trendType?: TrendType;
  onTrendType?: (t: TrendType) => void;
  atOee?: boolean;
  onAtOee?: (v: boolean) => void;
  extra?: React.ReactNode;
}) {
  const { t } = useTranslation('common');
  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <div className="realtime-badge">
        <span className="w-1.5 h-1.5 rounded-full bg-success-400 animate-pulse" />
        {t('status.live')}
      </div>
      {scope && <ScopeBadge />}
      {time && <TimeRangeFilter />}
      {trendType && onTrendType && <TrendTypeToggle value={trendType} onChange={onTrendType} />}
      {onAtOee && (
        <button
          onClick={() => onAtOee(!atOee)}
          title={t('atOee.hint')}
          className={cn(
            'h-8 rounded-md border px-2 text-[11px] font-semibold transition-colors',
            atOee ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border/60 bg-card/60 text-muted-foreground hover:text-foreground',
          )}
        >
          {atOee ? t('atOee.tb') : t('atOee.schedule')}
        </button>
      )}
      {extra}
      {onRefresh && (
        <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs" onClick={onRefresh}>
          <RefreshCw size={13} className={cn(refreshing && 'animate-spin')} />
          {t('actions.refresh')}
        </Button>
      )}
    </div>
  );
}
