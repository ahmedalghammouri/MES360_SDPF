import type { Metadata } from 'next';
import { AppsLauncherView } from '@/features/apps/apps-launcher-view';

export const metadata: Metadata = { title: 'Apps | MES360°' };

export default function AppsPage() {
  return <AppsLauncherView />;
}
