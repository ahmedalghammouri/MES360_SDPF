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

/**
 * One analytical view, when a subject has more than one.
 *
 * Two pages that answer the same question with different charts are two pages a
 * reader has to reconcile. Folding them into sub-tabs under one subject keeps
 * every view that existed while leaving exactly one place to look — which is the
 * whole point of the consolidation, and why the answer was tabs and not a
 * deletion: no chart anybody relied on disappears.
 */
export interface AnalyticsPanel {
  id: string;
  label: string;
  node: React.ReactNode;
}

export interface TabbedPageProps {
  /** Rendered on the "Now" tab. No time filter is available to it. */
  live: React.ReactNode;
  /**
   * Rendered on the "Analytics" tab, with the full filter set. Pass an ARRAY
   * when the subject has several analytical views; they become sub-tabs.
   */
  analytics: React.ReactNode | AnalyticsPanel[];
  /** Optional page-level header shown above the tabs, on both. */
  header?: React.ReactNode;
  /**
   * Distinguishes one page's sub-tab memory from another's. Without it every
   * merged page would share a single stored choice and land the reader on a
   * sub-tab that belongs to a different subject.
   */
  subTabKey?: string;
}

export function LiveAnalyticsTabs({ live, analytics, header, subTabKey }: TabbedPageProps) {
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

  const panels: AnalyticsPanel[] | null = Array.isArray(analytics) ? analytics : null;
  const [sub, setSub] = React.useState<string | null>(null);
  const subStore = `${STORAGE_KEY}:sub:${subTabKey ?? 'default'}`;

  React.useEffect(() => {
    if (!panels || panels.length < 2) return;
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(subStore); } catch { /* private mode */ }
    setSub(panels.some((p) => p.id === saved) ? saved : panels[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subStore, panels?.length]);

  const chooseSub = (id: string) => {
    setSub(id);
    try { window.localStorage.setItem(subStore, id); } catch { /* private mode */ }
  };

  const analyticsNode = !panels
    ? (analytics as React.ReactNode)
    : panels.length === 1
      ? panels[0].node
      : (panels.find((p) => p.id === sub) ?? panels[0]).node;

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

        {/*
          The analytical views of one subject. Rendered as a quieter strip than
          the Now/Analytics switch above it, because it is a narrower choice: the
          reader has already decided they are looking at a period, and is now
          picking which cut of it.
        */}
        {mode === 'analytics' && panels && panels.length > 1 && (
          <div role="tablist" aria-label={t('live.viewsLabel')} className="flex items-center gap-4 mt-3 border-b border-border/60">
            {panels.map((p) => {
              const active = (sub ?? panels[0].id) === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => chooseSub(p.id)}
                  className={cn(
                    '-mb-px border-b-2 px-0.5 pb-2 text-xs font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {mode === 'live' ? live : analyticsNode}
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

/**
 * Sub-tabs for a page that is wholly analytical.
 *
 * Some subjects have several period views and no live one — the KPI sheets and
 * the report packs. They were separate routes with separate menu entries,
 * answering one question in several layouts, which reads as several questions.
 * This gives them the same "one subject, several cuts" shape as the tabbed pages
 * without inventing a live half that has nothing to show.
 *
 * It declares the analytics view mode itself, so the period control stays
 * available — that is the whole point of these pages.
 */
export function AnalyticsViewTabs({ views, storageKey }: { views: AnalyticsPanel[]; storageKey: string }) {
  const { t } = useTranslation(['production', 'common']);
  useDeclareViewMode('analytics');
  const store = `${STORAGE_KEY}:sub:${storageKey}`;
  const [sub, setSub] = React.useState<string | null>(null);

  React.useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(store); } catch { /* private mode */ }
    setSub(views.some((v) => v.id === saved) ? saved : views[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, views.length]);

  const choose = (id: string) => {
    setSub(id);
    try { window.localStorage.setItem(store, id); } catch { /* private mode */ }
  };

  if (views.length === 0) return null;
  if (views.length === 1) return <>{views[0].node}</>;
  const current = views.find((v) => v.id === sub) ?? views[0];

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-4 shrink-0">
        <div role="tablist" aria-label={t('live.viewsLabel')}
             className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-muted/20 p-1">
          {views.map((v) => {
            const active = v.id === current.id;
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => choose(v.id)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {v.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 overflow-auto">{current.node}</div>
    </div>
  );
}
