import type { Metadata } from 'next';
import { OeeStandardView } from '@/features/oee-standard/oee-standard-view';

export const metadata: Metadata = { title: 'OEE Standard Engine | MES360°' };

export default function Page() { return <OeeStandardView />; }
