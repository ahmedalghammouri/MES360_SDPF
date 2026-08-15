import type { Metadata } from 'next';
import { MachineStatusView } from '@/features/manufacturing/machine-status-view';

export const metadata: Metadata = { title: 'Machine Status | MES360°' };

export default function MachineStatusPage() {
  return <MachineStatusView />;
}
