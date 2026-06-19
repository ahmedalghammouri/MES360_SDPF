'use client';

import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, CheckCircle2, XCircle, AlertCircle, ClipboardList, FlaskConical,
  Factory, Boxes, User, CalendarClock, FileText, Hash, Gauge, Link2, Download,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { exportRecordToPDF } from '@/lib/export-utils';

const RESULT_CONFIG: Record<string, { label: string; color: string; icon: any; bg: string }> = {
  PASS:        { label: 'Pass',        color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/30',  icon: CheckCircle2 },
  FAIL:        { label: 'Fail',        color: 'text-red-400',   bg: 'bg-red-500/10 border-red-500/30',      icon: XCircle      },
  CONDITIONAL: { label: 'Conditional', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30',  icon: AlertCircle  },
  PENDING:     { label: 'Pending',     color: 'text-blue-400',  bg: 'bg-blue-500/10 border-blue-500/30',    icon: AlertCircle  },
};

const TYPE_LABELS: Record<string, string> = {
  INCOMING: 'Incoming', IN_PROCESS: 'In-Process', FINAL: 'Final', PATROL: 'Patrol', AUDIT: 'Audit', SPC: 'SPC',
};

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

interface Param {
  id: string; name: string; unit?: string; nominalValue?: number;
  lsl?: number; usl?: number; lcl?: number; ucl?: number; checkMethod?: string;
}
interface Measurement {
  parameterId?: string; parameterName?: string; value?: number; unit?: string; pass?: boolean; notes?: string;
}

export function InspectionDetailView({ inspectionId }: { inspectionId: string }) {
  const { t } = useTranslation('quality');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['quality', 'inspection', inspectionId],
    queryFn: () => api.get<any>(`/quality/inspections/${inspectionId}`),
    staleTime: 15_000,
  });

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading inspection…</div>;
  }
  if (isError || !data) {
    return (
      <div className="p-6 space-y-4">
        <Link href="/quality/records"><Button variant="outline" size="sm"><ArrowLeft size={14} className="mr-1.5" /> Back to records</Button></Link>
        <div className="text-sm text-red-400">Inspection not found or failed to load.</div>
      </div>
    );
  }

  const insp = data;
  const cfg = RESULT_CONFIG[insp.result] ?? RESULT_CONFIG.PENDING;
  const measurements: Measurement[] = Array.isArray(insp.measurements) ? insp.measurements : [];
  const params: Param[] = insp.plan?.parameters ?? [];
  const fpy = insp.totalQty > 0 ? Math.round((insp.passQty / insp.totalQty) * 1000) / 10 : 0;

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <Link href="/quality/records" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft size={13} className="mr-1" /> Back to Quality Records
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2 font-mono">
            <ClipboardList size={20} className="text-primary" /> {insp.inspectionNumber}
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">{TYPE_LABELS[insp.type] ?? insp.type}</Badge>
            <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border', cfg.bg, cfg.color)}>
              <cfg.icon size={13} /> {cfg.label}
            </span>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => exportRecordToPDF(
          `Inspection ${insp.inspectionNumber}`,
          insp.plan?.name ?? '',
          [
            { heading: 'Summary', fields: [
              { label: 'Inspection #', value: insp.inspectionNumber }, { label: 'Type', value: TYPE_LABELS[insp.type] ?? insp.type },
              { label: 'Result', value: cfg.label }, { label: 'Total / Pass / Fail', value: `${insp.totalQty} / ${insp.passQty} / ${insp.failQty}` },
              { label: 'First-Pass Yield', value: `${fpy}%` },
            ]},
            { heading: 'Context', fields: [
              { label: 'Work Order', value: insp.workOrder?.orderNumber ?? '—' },
              { label: 'Machine', value: insp.machine ? `${insp.machine.name} (${insp.machine.code})` : '—' },
              { label: 'Batch / Lot', value: insp.batchRecord?.batchNumber ?? '—' },
              { label: 'Quality Plan', value: insp.plan ? `${insp.plan.name} (${insp.plan.code})` : '—' },
              { label: 'Inspector', value: insp.inspector?.name ?? '—' }, { label: 'Inspected At', value: fmtDateTime(insp.inspectedAt) },
            ]},
            { heading: 'Quality Check Points', fields: measurements.length
              ? measurements.map((m, i) => ({ label: m.parameterName ?? `Param ${i + 1}`, value: `${m.value ?? '—'}${m.unit ? ' ' + m.unit : ''} — ${m.pass === true ? 'Pass' : m.pass === false ? 'Fail' : '—'}${m.notes ? ` (${m.notes})` : ''}` }))
              : [{ label: 'Measurements', value: 'None' }] },
            ...(insp.notes ? [{ heading: 'Notes', fields: [{ label: 'Notes', value: insp.notes }] }] : []),
          ],
        )}>
          <Download size={13} /> PDF
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label={t('qd.totalInspected')} value={String(insp.totalQty)} />
        <Kpi label={t('qd.pass')} value={String(insp.passQty)} tone="green" />
        <Kpi label={t('qd.fail')} value={String(insp.failQty)} tone="red" />
        <Kpi label={t('qd.fpy')} value={`${fpy}%`} tone={fpy >= 95 ? 'green' : fpy >= 80 ? 'amber' : 'red'} />
      </div>

      {/* Context */}
      <div className="rounded-xl border border-border/60 p-4">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><Link2 size={14} className="text-primary" /> Context</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <Field icon={Link2} label={t('qd.workOrder')} value={insp.workOrder?.orderNumber}
            href={insp.workOrder?.id ? `/production/orders` : undefined} />
          <Field icon={Factory} label={t('qd.machine')} value={insp.machine ? `${insp.machine.name} (${insp.machine.code})` : null} />
          <Field icon={Boxes} label={t('qd.batchLot')} value={insp.batchRecord?.batchNumber} />
          <Field icon={ClipboardList} label={t('qd.qualityPlan')} value={insp.plan ? `${insp.plan.name} (${insp.plan.code})` : null} />
          <Field icon={User} label={t('qd.inspector')} value={insp.inspector?.name} />
          <Field icon={CalendarClock} label={t('qd.inspectedAt')} value={fmtDateTime(insp.inspectedAt)} />
          <Field icon={Hash} label={t('qd.created')} value={fmtDateTime(insp.createdAt)} />
          {insp.approvedAt && <Field icon={CheckCircle2} label={t('qd.approvedAt')} value={fmtDateTime(insp.approvedAt)} />}
        </div>
      </div>

      {/* Measurements */}
      <div className="rounded-xl border border-border/60 p-4">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
          <FlaskConical size={14} className="text-primary" /> Quality Check Points
          {measurements.length > 0 && <span className="text-xs font-normal text-muted-foreground">({measurements.length})</span>}
        </h2>
        {measurements.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('qd.noParams')}</p>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left p-2.5 font-medium text-muted-foreground">Parameter</th>
                  <th className="text-left p-2.5 font-medium text-muted-foreground">Spec</th>
                  <th className="text-left p-2.5 font-medium text-muted-foreground">Measured</th>
                  <th className="text-center p-2.5 font-medium text-muted-foreground">Result</th>
                  <th className="text-left p-2.5 font-medium text-muted-foreground">Notes</th>
                </tr>
              </thead>
              <tbody>
                {measurements.map((m, i) => {
                  const p = params.find(x => x.id === m.parameterId);
                  const spec = p && (p.lsl != null || p.usl != null)
                    ? `[${p.lsl ?? '—'}, ${p.usl ?? '—'}]${p.unit ? ` ${p.unit}` : ''}`
                    : p?.nominalValue != null ? `Nominal ${p.nominalValue}${p.unit ? ` ${p.unit}` : ''}` : '—';
                  return (
                    <tr key={i} className="border-t">
                      <td className="p-2.5">
                        <div className="font-medium">{m.parameterName ?? p?.name ?? '—'}</div>
                        {p?.checkMethod && <div className="text-[11px] text-muted-foreground">{p.checkMethod}</div>}
                      </td>
                      <td className="p-2.5 text-muted-foreground text-xs">{spec}</td>
                      <td className="p-2.5 font-mono">{m.value ?? '—'}{m.unit ? ` ${m.unit}` : ''}</td>
                      <td className="p-2.5 text-center">
                        {m.pass === true ? (
                          <span className="inline-flex items-center gap-1 text-green-400 text-xs"><CheckCircle2 size={13} /> Pass</span>
                        ) : m.pass === false ? (
                          <span className="inline-flex items-center gap-1 text-red-400 text-xs"><XCircle size={13} /> Fail</span>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="p-2.5 text-muted-foreground text-xs">{m.notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {measurements.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
            <Gauge size={12} /> {measurements.filter(m => m.pass === true).length}/{measurements.length} parameters passing
          </p>
        )}
      </div>

      {/* Notes */}
      {insp.notes && (
        <div className="rounded-xl border border-border/60 p-4">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><FileText size={14} className="text-primary" /> Notes</h2>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{insp.notes}</p>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' | 'amber' }) {
  const color = tone === 'green' ? 'text-green-400' : tone === 'red' ? 'text-red-400' : tone === 'amber' ? 'text-amber-400' : 'text-foreground';
  return (
    <div className="rounded-xl border border-border/60 p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-2xl font-bold mt-1', color)}>{value}</div>
    </div>
  );
}

function Field({ icon: Icon, label, value, href }: { icon: any; label: string; value?: string | null; href?: string }) {
  const content = (
    <>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Icon size={11} /> {label}</div>
      <div className={cn('font-medium mt-0.5', href && value ? 'text-primary hover:underline' : '')}>{value || '—'}</div>
    </>
  );
  if (href && value) return <Link href={href} className="block">{content}</Link>;
  return <div>{content}</div>;
}
