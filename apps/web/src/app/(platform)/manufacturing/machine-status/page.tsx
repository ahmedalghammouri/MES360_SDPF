import type { Metadata } from 'next';
import { MachineStatusPage } from '@/features/manufacturing/machine-status-page';

export const metadata: Metadata = { title: 'Machine Status | MES360°' };

export default function Page() { return <MachineStatusPage />; }
