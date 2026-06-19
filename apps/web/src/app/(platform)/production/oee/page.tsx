import type { Metadata } from 'next';
import { ProductionOEEView } from '@/features/production/production-oee-view';

export const metadata: Metadata = { title: 'OEE Analysis | MES360°' };

export default function OEEPage() {
  return <ProductionOEEView />;
}
