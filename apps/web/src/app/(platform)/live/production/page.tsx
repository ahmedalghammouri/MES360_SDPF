import type { Metadata } from 'next';
import { LiveProductionView } from '@/features/live/live-production-view';

export const metadata: Metadata = { title: 'Live Production | MES360°' };

export default function Page() { return <LiveProductionView />; }
