'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ShieldCheck, User, CalendarClock, FileText, Plus, CheckCircle2,
  Circle, Download, ClipboardList, AlertTriangle, Gauge,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { exportRecordToPDF } from '@/lib/export-utils';

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  OPEN: { label: 'Open', cls: 'text-red-400 border-red-500/30 bg-red-500/10' },
  IN_PROGRESS: { label: 'In Progress', cls: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
  VERIFIED: { label: 'Verified', cls: 'text-blue-400 border-blue-500/30 bg-blue-500/10' },
  CLOSED: { label: 'Closed', cls: 'text-green-400 border-green-500/30 bg-green-500/10' },
};
const fmt = (iso?: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleString(); };

export function CapaDetailView({ capaId }: { capaId: string }) {
  const { t } = useTranslation('quality');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [newAction, setNewAction] = useState('');
  const [effectiveness, setEffectiveness] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['quality', 'capa-detail', capaId],
    queryFn: () => api.get<any>(`/quality/capa/${capaId}`),
    staleTime: 15_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['quality', 'capa-detail', capaId] });
    qc.invalidateQueries({ queryKey: ['quality', 'capa'] });
  };
  const err = (e: any) => toast({ variant: 'destructive', title: 'Error', description: e?.response?.data?.message ?? 'Failed' });

  const addActionMut = useMutation({
    mutationFn: (description: string) => api.post(`/quality/capa/${capaId}/actions`, { description }),
    onSuccess: () => { setNewAction(''); invalidate(); toast({ title: 'Action added' }); },
    onError: err,
  });
  const completeActionMut = useMutation({
    mutationFn: (actionId: string) => api.patch(`/quality/capa/${capaId}/actions/${actionId}/complete`, {}),
    onSuccess: () => { invalidate(); toast({ title: 'Action completed' }); },
    onError: err,
  });
  const verifyMut = useMutation({
    mutationFn: (eff: string) => api.patch(`/quality/capa/${capaId}/verify`, { effectiveness: eff }),
    onSuccess: () => { setEffectiveness(''); invalidate(); toast({ title: 'CAPA verified' }); },
    onError: err,
  });
  const closeMut = useMutation({
    mutationFn: () => api.patch(`/quality/capa/${capaId}/close`, {}),
    onSuccess: () => { invalidate(); toast({ title: 'CAPA closed' }); },
    onError: err,
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading CAPA…</div>;
  if (isError || !data) {
    return (
      <div className="p-6 space-y-4">
        <Link href="/quality/capa"><Button variant="outline" size="sm"><ArrowLeft size={14} className="mr-1.5" /> Back</Button></Link>
        <div className="text-sm text-red-400">CAPA not found or failed to load.</div>
      </div>
    );
  }

  const c = data;
  const cfg = STATUS_CFG[c.status] ?? STATUS_CFG.OPEN;
  const actions: any[] = c.actions ?? [];
  const allDone = actions.length > 0 && actions.every((a) => a.status === 'COMPLETED');
  const canVerify = c.status === 'IN_PROGRESS' && allDone;
  const canClose = c.status === 'VERIFIED';

  const exportPdf = () => exportRecordToPDF(`CAPA ${c.capaNumber}`, c.title ?? '', [
    { heading: 'Summary', fields: [
      { label: 'CAPA #', value: c.capaNumber }, { label: 'Title', value: c.title },
      { label: 'Type', value: c.type }, { label: 'Priority', value: c.priority }, { label: 'Status', value: STATUS_CFG[c.status]?.label ?? c.status },
      { label: 'Related NCR', value: c.ncr?.ncrNumber ?? '—' }, { label: 'Description', value: c.description },
    ]},
    { heading: 'Ownership', fields: [
      { label: 'Owner', value: c.assignedTo?.name ?? '—' }, { label: 'Due Date', value: fmt(c.dueDate) },
      { label: 'Verified At', value: fmt(c.verifiedAt) }, { label: 'Effectiveness', value: c.effectiveness ?? '—' },
    ]},
    { heading: 'Action Plan', fields: actions.length
      ? actions.map((a, i) => ({ label: `Action ${i + 1}`, value: `[${a.status}] ${a.description}` }))
      : [{ label: 'Actions', value: 'None' }] },
  ]);

  return (
    <div className="p-6 space-y-5 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <Link href="/quality/capa" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft size={13} className="mr-1" /> Back to CAPA Register
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2 font-mono">
            <ShieldCheck size={20} className="text-primary" /> {c.capaNumber}
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">{c.type}</Badge>
            <Badge variant="outline">{c.priority}</Badge>
            <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border', cfg.cls)}>{cfg.label}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={exportPdf}><Download size={13} /> PDF</Button>
          {canClose && <Button size="sm" className="h-8 text-xs" disabled={closeMut.isPending} onClick={() => closeMut.mutate()}>Close CAPA</Button>}
        </div>
      </div>

      <div><div className="text-lg font-semibold">{c.title}</div>
        {c.description && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{c.description}</p>}</div>

      <div className="rounded-xl border border-border/60 p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <F icon={AlertTriangle} label={t('qd.relatedNcr')} node={c.ncr ? <Link className="text-primary hover:underline" href="/quality/ncr">{c.ncr.ncrNumber}</Link> : '—'} />
        <F icon={User} label={t('qd.owner')} value={c.assignedTo?.name} />
        <F icon={CalendarClock} label={t('qd.dueDate')} value={fmt(c.dueDate)} />
        <F icon={Gauge} label={t('qd.effectiveness')} value={c.effectiveness} />
      </div>

      {/* Action plan */}
      <div className="rounded-xl border border-border/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-1.5"><ClipboardList size={14} className="text-primary" /> Action Plan ({actions.length})</h2>
          <span className="text-xs text-muted-foreground">{actions.filter(a => a.status === 'COMPLETED').length}/{actions.length} completed</span>
        </div>

        <div className="space-y-2">
          {actions.length === 0 && <p className="text-sm text-muted-foreground">{t('qd.noActions')}</p>}
          {actions.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2">
              {a.status === 'COMPLETED'
                ? <CheckCircle2 size={15} className="text-green-400 shrink-0" />
                : <Circle size={15} className="text-muted-foreground shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm">{a.description}</div>
                <div className="text-[10px] text-muted-foreground">{a.status === 'COMPLETED' ? `Completed ${fmt(a.completedAt)}` : 'Open'}</div>
              </div>
              {a.status !== 'COMPLETED' && c.status !== 'CLOSED' && (
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={completeActionMut.isPending} onClick={() => completeActionMut.mutate(a.id)}>
                  Mark done
                </Button>
              )}
            </div>
          ))}
        </div>

        {c.status !== 'CLOSED' && c.status !== 'VERIFIED' && (
          <div className="flex items-end gap-2 mt-3">
            <div className="flex-1">
              <Label className="text-xs">New Action</Label>
              <Input value={newAction} onChange={(e) => setNewAction(e.target.value)} placeholder={t('qd.actionPlaceholder')} className="mt-1 h-8 text-xs" />
            </div>
            <Button size="sm" className="h-8 text-xs gap-1" disabled={newAction.trim().length < 5 || addActionMut.isPending} onClick={() => addActionMut.mutate(newAction.trim())}>
              <Plus size={13} /> Add
            </Button>
          </div>
        )}
      </div>

      {/* Verification */}
      {(canVerify || c.status === 'VERIFIED' || c.status === 'CLOSED') && (
        <div className="rounded-xl border border-border/60 p-4">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><ShieldCheck size={14} className="text-primary" /> Effectiveness Verification</h2>
          {c.effectiveness ? (
            <div className="text-sm"><span className="text-muted-foreground">Verified {fmt(c.verifiedAt)}: </span>{c.effectiveness}</div>
          ) : canVerify ? (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-xs">Effectiveness note (min 10 chars)</Label>
                <Input value={effectiveness} onChange={(e) => setEffectiveness(e.target.value)} placeholder="e.g. No recurrence in 30 days; root cause eliminated" className="mt-1 h-8 text-xs" />
              </div>
              <Button size="sm" className="h-8 text-xs" disabled={effectiveness.trim().length < 10 || verifyMut.isPending} onClick={() => verifyMut.mutate(effectiveness.trim())}>
                Verify
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function F({ icon: Icon, label, value, node }: { icon: any; label: string; value?: string | null; node?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Icon size={11} /> {label}</div>
      <div className="font-medium mt-0.5">{node ?? value ?? '—'}</div>
    </div>
  );
}
