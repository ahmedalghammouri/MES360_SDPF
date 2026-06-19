import type { Metadata } from 'next';
import { ArchiveView } from '@/features/archive/archive-view';

export const metadata: Metadata = { title: 'Archive | MES360°' };

export default function ArchivePage() {
  return <ArchiveView />;
}
