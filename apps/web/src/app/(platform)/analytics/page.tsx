import type { Metadata } from 'next';
import { FactoryAnalyticsView } from '@/features/analytics/factory-analytics-view';

export const metadata: Metadata = { title: 'Factory Analytics | MES360°' };

export default function AnalyticsPage() {
  return <FactoryAnalyticsView />;
}
