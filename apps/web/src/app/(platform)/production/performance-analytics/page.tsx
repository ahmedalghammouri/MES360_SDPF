import type { Metadata } from 'next';
import { PerformancePage } from '@/features/production/performance-page';

export const metadata: Metadata = { title: 'Performance | MES360°' };

export default function Page() { return <PerformancePage />; }
