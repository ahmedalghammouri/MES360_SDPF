'use client';
/**
 * Availability — one subject, two readings.
 *
 * The Now half answers "how is it going this shift"; the Analytics half answers
 * "how has it gone over the period you chose". They were the same screen once,
 * and nothing told a reader which figure was which.
 *
 * The Now half here is LiveMachinesView, because availability is an equipment question, so its Now half is the machine floor.
 *
 * Switching to Now hides the period control: on a live view the window is the
 * running shift and the browser has no say in it.
 */
import React from 'react';

import { LiveAnalyticsTabs } from '@/components/layout/live-analytics-tabs';
import { LiveMachinesView } from '@/features/live/live-machines-view';
import { AvailabilityAnalyticsView } from './availability-analytics-view';

export function AvailabilityPage() {
  return (
    <LiveAnalyticsTabs
      live={<LiveMachinesView />}
      analytics={<AvailabilityAnalyticsView />}
    />
  );
}
