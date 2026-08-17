import type { Metadata } from 'next';
import { AvailabilityAnalyticsView } from '@/features/production/availability-analytics-view';

export const metadata: Metadata = { title: 'Availability Analytics | MES360°' };

export default function Page() { return <AvailabilityAnalyticsView />; }
