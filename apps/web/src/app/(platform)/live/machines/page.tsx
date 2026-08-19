import type { Metadata } from 'next';
import { LiveMachinesView } from '@/features/live/live-machines-view';

export const metadata: Metadata = { title: 'Live Machines | MES360°' };

export default function Page() { return <LiveMachinesView />; }
