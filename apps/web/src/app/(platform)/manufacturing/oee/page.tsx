import type { Metadata } from 'next';
import { OeePage } from '@/features/production/oee-page';

export const metadata: Metadata = { title: 'OEE | INDUSTRY360 MES' };

/**
 * Machine OEE moved onto the OEE page as a sub-tab — same store, same window,
 * a different cut. This route stays so written-down links keep working; the
 * sidebar carries the subject once.
 */
export default function Page() { return <OeePage />; }
