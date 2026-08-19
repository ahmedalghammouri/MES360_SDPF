'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { RadioTower, LineChart } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useViewModeStore, type ViewMode } from '@/store/view-mode-store';

/**
 * The two halves of every dashboard page: what is happening NOW, and what
 * happened OVER A PERIOD.
 *
 * ── Why a component rather than a convention ────────────────────────────────
 * Those two questions were answered on the same screen, by cards and charts
 * sitting side by side under one time filter, and a reader could not tell which
 * was which. Splitting them into separate pages fixed the arithmetic but scattered
 * the navigation; splitting them into tabs on one page keeps a subject together
 * while keeping its two readings apart.
 *
 * The component owns the rule rather than asking pages to remember it:
 *
 *   · switching to Now tells the filter panel to hide the period control, because
 *     on a live view the window is the running shift and the browser has no say
 *     in it. A period selector there invites a change that does nothing.
 *   · switching to Analytics brings it back.
 *   · the choice survives a reload, so somebody who lives on the live tab is not
 *     handed the analytics one every morning.
 *
 * A page that is entirely one or the other does not use this — it calls
 * `useDeclareViewMode` instead.
 */

const STORAGE_KEY = 'mes360-view-mode';

export interface TabbedPageProps {
  /** Rendered on the "Now" tab. No time filter is available to it. */
  live: React.ReactNode;
  /** Rendered on the "Analytics" tab, with the full filter set. */
  analytics: React.ReactNode;
  /** Optional page-level header shown above the tabs, on both. */
  header?: React.ReactNode;
}

export function LiveAnalyticsTabs({ live, analytics, header }: TabbedPageProps) {
  const { t } = useTranslation(['production', 'common']);
  const mode = useViewModeStore((s) => s.mode);
  const setMode = useViewModeStore((s) => s.setMode);

  // Restore the reader's last choice once, on mount. Reading localStorage during
  // render would differ between server and client and hydrate wrong.
  React.useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    setMode(saved === 'live' || saved === 'analytics' ? saved : 'live');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (m: ViewMode) => {
    setMode(m);
    try { window.localStorage.setItem(STORAGE_KEY, m); } catch { /* private mode */ }
  };

  const tabs: Array<{ id: ViewMode; label: string; icon: React.ElementType }> = [
    { id: 'live', label: t('live.tabNow'), icon: RadioTower },
    { id: 'analytics', label: t('live.tabAnalytics'), icon: LineChart },
  ];

  return (
    <div className="flex flex-col h-full">
      {header}

      <div className="px-6 pt-4 shrink-0">
        <div role="tablist" aria-label={t('live.tabsLabel')}
             className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-muted/20 p-1">
          {tabs.map(({ id, label, icon: Icon }) => {
            const active = mode === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => choose(id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon size={13} className={cn(active && id === 'live' && 'text-emerald-500')} />
                {label}
              </button>
            );
          })}
        </div>
        {/* Says what the tab measures, so the two are never mistaken for one
            another even by somebody who arrived mid-scroll. */}
        <p className="text-[11px] text-muted-foreground mt-2">
          {mode === 'live' ? t('live.tabNowHelp') : t('live.tabAnalyticsHelp')}
        </p>
      </div>

      <div className="flex-1 overflow-auto">
        {mode === 'live' ? live : analytics}
      </div>
    </div>
  );
}

/**
 * For a page that is wholly live or wholly analytical.
 *
 * Declaring the mode is what hides or shows the period control, so a page that
 * skips this gets whatever the last page set — which is how a live screen ends up
 * offering a date range it cannot honour.
 */
export function useDeclareViewMode(mode: ViewMode) {
  const setMode = useViewModeStore((s) => s.setMode);
  React.useEffect(() => { setMode(mode); }, [mode, setMode]);
}
