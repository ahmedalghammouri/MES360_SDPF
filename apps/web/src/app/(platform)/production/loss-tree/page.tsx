import type { Metadata } from 'next';
import { LossTreePage } from '@/features/production/loss-tree-page';

export const metadata: Metadata = { title: 'Loss Tree & TEEP | MES360°' };

export default function Page() { return <LossTreePage />; }
