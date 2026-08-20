import type { Metadata } from 'next';
import { OeeScheduleView } from '@/features/oee-schedule/oee-schedule-view';

export const metadata: Metadata = { title: 'OEE Schedule Basis | MES360°' };

export default function Page() { return <OeeScheduleView />; }
