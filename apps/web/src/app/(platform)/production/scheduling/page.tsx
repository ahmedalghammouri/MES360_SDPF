import type { Metadata } from 'next';
import { ProductionSchedulingView } from '@/features/production/production-scheduling-view';

export const metadata: Metadata = { title: 'Production Scheduling | MES360°' };

export default function ProductionSchedulingPage() {
  return <ProductionSchedulingView />;
}
