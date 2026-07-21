import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TrendType = 'area' | 'line' | 'bar';

interface DashboardPrefsState {
  /** Render style for every time-series chart across the app. */
  trendType: TrendType;
  setTrendType: (t: TrendType) => void;
  /** Show time-based (Time Base-OEE) instead of schedule-based OEE everywhere. */
  atOee: boolean;
  setAtOee: (v: boolean) => void;
}

/**
 * Global dashboard view preferences, driven from the unified ScopePanel and read
 * by every chart/cockpit. Persisted so the chosen trend style + OEE mode follow
 * the user across pages — the single source for what used to be per-page toolbars.
 */
export const useDashboardPrefsStore = create<DashboardPrefsState>()(
  persist(
    (set) => ({
      trendType: 'area',
      setTrendType: (trendType) => set({ trendType }),
      atOee: false,
      setAtOee: (atOee) => set({ atOee }),
    }),
    { name: 'mes-dashboard-prefs' },
  ),
);
