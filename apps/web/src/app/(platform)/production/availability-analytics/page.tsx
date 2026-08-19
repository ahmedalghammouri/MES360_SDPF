import type { Metadata } from 'next';
import { AvailabilityPage } from '@/features/production/availability-page';

export const metadata: Metadata = { title: 'Availability | MES360°' };

export default function Page() { return <AvailabilityPage />; }
