'use client';
/**
 * KPI sheets — one subject, two cuts.
 *
 * ── What this merged ────────────────────────────────────────────────────────
 * "Production KPIs" and "Machine KPIs" were two routes and two menu entries.
 * Both read the same window from the same store and both open with an OEE
 * headline; they differ in what they break it down by. The machine sheet's
 * endpoints are a strict SUBSET of the production sheet's — two of nine — so a
 * reader who opened the wrong one saw a thinner version of the same page and no
 * indication that was what had happened.
 *
 * They are cuts of one sheet now. Neither lost a card, and /manufacturing/kpi
 * still resolves here.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

import { AnalyticsViewTabs } from '@/components/layout/live-analytics-tabs';
import ManufacturingKpiView from '@/features/manufacturing/manufacturing-kpi-view';
import ProductionKpiView from './production-kpi-view';

export function KpiPage() {
  const { t } = useTranslation(['production', 'common']);
  return (
    <AnalyticsViewTabs
      storageKey="kpi"
      views={[
        { id: 'production', label: t('live.kpiViewProduction'), node: <ProductionKpiView /> },
        { id: 'machine', label: t('live.kpiViewMachine'), node: <ManufacturingKpiView /> },
      ]}
    />
  );
}
