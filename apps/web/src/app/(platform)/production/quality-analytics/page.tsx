import type { Metadata } from 'next';
import { QualityAnalyticsView } from '@/features/production/quality-analytics-view';

export const metadata: Metadata = { title: 'Quality Analytics | MES360°' };

export default function Page() { return <QualityAnalyticsView />; }
