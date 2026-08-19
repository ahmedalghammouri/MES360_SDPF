import type { Metadata } from 'next';
import { QualityPage } from '@/features/production/quality-page';

export const metadata: Metadata = { title: 'Quality | MES360°' };

export default function Page() { return <QualityPage />; }
