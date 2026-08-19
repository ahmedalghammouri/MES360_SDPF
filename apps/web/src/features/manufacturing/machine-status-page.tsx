'use client';
/**
 * Machine Status — one subject, two readings.
 *
 * Now is the state of every machine at this instant, sorted by trouble. Analytics
 * is the state timeline and the charts behind it over the period you choose.
 *
 * They used to be one screen carrying both, with a time filter that governed half
 * of it. A reader could not tell whether "0% availability" described the moment
 * or the month.
 */
import React from 'react';

import { LiveAnalyticsTabs } from '@/components/layout/live-analytics-tabs';
import { LiveMachinesView } from '@/features/live/live-machines-view';
import { MachineStatusView } from './machine-status-view';

export function MachineStatusPage() {
  return (
    <LiveAnalyticsTabs
      live={<LiveMachinesView />}
      analytics={<MachineStatusView />}
    />
  );
}
