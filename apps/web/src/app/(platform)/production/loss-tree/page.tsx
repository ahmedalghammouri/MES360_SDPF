import type { Metadata } from 'next';
import { LossTreeView } from '@/features/production/loss-tree-view';

export const metadata: Metadata = { title: 'OEE Loss Tree | MES360°' };

export default function Page() { return <LossTreeView />; }
