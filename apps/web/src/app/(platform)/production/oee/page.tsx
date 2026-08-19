import type { Metadata } from 'next';
import { OeePage } from '@/features/production/oee-page';

export const metadata: Metadata = { title: 'OEE | MES360°' };

export default function Page() {
  return <OeePage />;
}
