'use client';
/**
 * Quality — one subject, two readings.
 *
 * The Now half answers "how is it going this shift"; the Analytics half answers
 * "how has it gone over the period you chose". They were the same screen once,
 * and nothing told a reader which figure was which.
 *
 * The Now half here is LiveProductionView, because good against scrap is about output, so its Now half is the running orders.
 *
 * Switching to Now hides the period control: on a live view the window is the
 * running shift and the browser has no say in it.
 */
import React from 'react';

import { LiveAnalyticsTabs } from '@/components/layout/live-analytics-tabs';
import { LiveProductionView } from '@/features/live/live-production-view';
import { QualityAnalyticsView } from './quality-analytics-view';

export function QualityPage() {
  return (
    <LiveAnalyticsTabs
      live={<LiveProductionView />}
      analytics={<QualityAnalyticsView />}
    />
  );
}
