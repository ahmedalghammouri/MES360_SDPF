'use client';
/**
 * Equipment — one subject, three readings.
 *
 * ── What this page absorbed ─────────────────────────────────────────────────
 * Machine Status and Availability Analytics were two routes with two entries in
 * the sidebar, and they already rendered the SAME live view: both opened on
 * LiveMachinesView and differed only in the analytical half beneath it. A reader
 * comparing them saw one screen twice and two charts once, with nothing saying
 * the live figures were identical by construction.
 *
 * Now the subject is the page and the readings are its tabs:
 *
 *   Now         every machine at this instant, sorted by trouble
 *   Status      the state timeline and its composition over the period
 *   Availability  the trend, the ranking and the attribution of lost time
 *
 * Nothing was dropped in the merge — both analytical views are here in full.
 * They read the same store, so the two can no longer be compared and found to
 * disagree; they are two cuts of one set of minutes.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

import { LiveAnalyticsTabs } from '@/components/layout/live-analytics-tabs';
import { LiveMachinesView } from '@/features/live/live-machines-view';
import { AvailabilityAnalyticsView } from '@/features/production/availability-analytics-view';
import { MachineStatusView } from './machine-status-view';

export function MachineStatusPage() {
  const { t } = useTranslation(['production', 'common']);
  return (
    <LiveAnalyticsTabs
      subTabKey="equipment"
      live={<LiveMachinesView />}
      analytics={[
        { id: 'status', label: t('live.equipment.viewStatus'), node: <MachineStatusView /> },
        { id: 'availability', label: t('live.equipment.viewAvailability'), node: <AvailabilityAnalyticsView /> },
      ]}
    />
  );
}
