import type { Metadata } from 'next';
import { QualitySpcView } from '@/features/quality/quality-spc-view';
export const metadata: Metadata = { title: 'SPC Charts | MES360°' };
export default function SpcPage() { return <QualitySpcView />; }
