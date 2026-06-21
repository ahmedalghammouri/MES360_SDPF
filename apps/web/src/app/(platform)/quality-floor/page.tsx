import type { Metadata } from 'next';
import { QualityFloorView } from '@/features/quality-floor/quality-floor-view';

export const metadata: Metadata = { title: 'Quality Floor | MES360°' };

export default function QualityFloorPage() {
  return <QualityFloorView />;
}
