'use client';

import { useTimeRangeStore } from '@/store/time-range-store';

/**
 * Derives API params + a query-key fragment from the global analysis time range.
 * `params` carries BOTH `timeframe` (bucket hint) and resolved `dateFrom`/`dateTo`
 * so it works uniformly with every OEE/KPI endpoint. Put `key` in the queryKey so
 * changing the range refetches.
 *
 *   const { params, key } = useTimeRange();
 *   useQuery({ queryKey: ['production','oee', key, scopeKey],
 *              queryFn: () => api.get('/production/oee/calculate', { params: { ...params, ...scopeFilter } }) });
 */
export function useTimeRange() {
  const { preset, from, to } = useTimeRangeStore();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();

  let dateFrom: string;
  let dateTo = iso(now);
  if (preset === 'custom' && from && to) {
    dateFrom = from;
    dateTo = to;
  } else {
    const d = new Date(now);
    if (preset === 'week') d.setDate(now.getDate() - 7);
    else if (preset === 'month') d.setDate(now.getDate() - 30);
    else d.setHours(0, 0, 0, 0); // today / shift
    dateFrom = iso(d);
  }

  const params = { timeframe: preset, dateFrom, dateTo };
  const key = preset === 'custom' ? `custom:${from}:${to}` : preset;
  const label = preset === 'custom' && from && to ? `${from} → ${to}` : preset.charAt(0).toUpperCase() + preset.slice(1);

  return { preset, params, key, label, dateFrom, dateTo };
}
