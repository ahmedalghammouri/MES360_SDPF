import type { Metadata } from 'next';
import { ProductionOrdersView } from '@/features/production/production-orders-view';

export const metadata: Metadata = { title: 'Production Orders | MES360°' };

export default function ProductionOrdersPage() {
  return <ProductionOrdersView />;
}
