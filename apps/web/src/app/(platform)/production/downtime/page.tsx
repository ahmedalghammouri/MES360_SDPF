import type { Metadata } from 'next';
import { ProductionDowntimeView } from '@/features/production/production-downtime-view';

export const metadata: Metadata = { title: 'Downtime Management | MES360°' };

export default function DowntimePage() {
  return <ProductionDowntimeView />;
}
