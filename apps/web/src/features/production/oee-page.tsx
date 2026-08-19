'use client';
/**
 * OEE — one subject, two readings.
 *
 * ── Why the tabs ────────────────────────────────────────────────────────────
 * "How is OEE?" is two questions wearing one name: how is the line running right
 * now, and how has it run over a period. They were answered on the same screen,
 * by cards and charts under one time filter, and nothing told a reader which was
 * which — so when they disagreed, neither was believed.
 *
 * Separate pages fixed the arithmetic but scattered the navigation: somebody
 * asking about OEE had to know in advance which of two menu entries held the
 * reading they wanted. Tabs keep the subject together and the two readings apart,
 * which is the arrangement that matches how the question is actually asked.
 *
 * The tab component hides the period control on the live half, because there the
 * window is the running shift and the browser has no say in it.
 *
 * This is the pattern the rest of the dashboards follow.
 */
import React from 'react';

import { LiveAnalyticsTabs } from '@/components/layout/live-analytics-tabs';
import { LiveProductionView } from '@/features/live/live-production-view';
import { ProductionOEEView } from './production-oee-view';

export function OeePage() {
  return (
    <LiveAnalyticsTabs
      live={<LiveProductionView />}
      analytics={<ProductionOEEView />}
    />
  );
}
