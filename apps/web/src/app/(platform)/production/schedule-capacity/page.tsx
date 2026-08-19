import type { Metadata } from 'next';
import { ScheduleCapacityPage } from '@/features/production/schedule-capacity-page';

export const metadata: Metadata = { title: 'Schedule & Capacity | MES360°' };

export default function Page() { return <ScheduleCapacityPage />; }
