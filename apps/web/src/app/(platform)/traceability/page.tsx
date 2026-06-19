import { TraceabilityView } from '@/features/traceability/traceability-view';

export const metadata = { title: 'Trace Log | MES360°' };

export default function TraceabilityPage() {
  return <TraceabilityView fixedTab="log" />;
}
