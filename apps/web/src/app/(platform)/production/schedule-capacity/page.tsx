import type { Metadata } from 'next';
import { ScheduleCapacityView } from '@/features/production/schedule-capacity-view';

export const metadata: Metadata = { title: 'Schedule & Capacity Analytics | MES360°' };

export default function Page() { return <ScheduleCapacityView />; }
