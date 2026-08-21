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
 *
 * ── What the Analytics half absorbed ────────────────────────────────────────
 * "OEE" and "Machine OEE" were two menu entries and two routes. Both answered
 * the same question over the same window from the same store; they differed in
 * how they cut it — one by factor and trend, one by machine and record. Two
 * entries for one question is the duplication this consolidation exists to
 * remove, and a reader who found both had no way to know they were the same
 * measurement twice.
 *
 * They are sub-tabs now. Neither view lost a chart, and the old
 * /manufacturing/oee URL still resolves here.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

import { LiveAnalyticsTabs } from '@/components/layout/live-analytics-tabs';
import { LiveProductionView } from '@/features/live/live-production-view';
import ManufacturingOeeView from '@/features/manufacturing/manufacturing-oee-view';
import { ProductionOEEView } from './production-oee-view';

export function OeePage() {
  const { t } = useTranslation(['production', 'common']);
  return (
    <LiveAnalyticsTabs
      subTabKey="oee"
      live={<LiveProductionView />}
      analytics={[
        { id: 'line', label: t('live.oeeViewLine'), node: <ProductionOEEView /> },
        { id: 'machine', label: t('live.oeeViewMachine'), node: <ManufacturingOeeView /> },
      ]}
    />
  );
}
