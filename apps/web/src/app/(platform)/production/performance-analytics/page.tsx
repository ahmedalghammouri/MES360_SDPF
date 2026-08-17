import type { Metadata } from 'next';
import { PerformanceAnalyticsView } from '@/features/production/performance-analytics-view';

export const metadata: Metadata = { title: 'Performance Analytics | MES360°' };

export default function Page() { return <PerformanceAnalyticsView />; }
