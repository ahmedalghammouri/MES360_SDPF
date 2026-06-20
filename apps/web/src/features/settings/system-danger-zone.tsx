'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios, { type AxiosInstance } from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldAlert, Database, Activity, Trash2, Lock, AlertTriangle, Loader2, RefreshCw, KeyRound,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';

interface SystemStatus {
  production: Record<string, number>;
  productionTotal: number;
  preserved: { inspections: number; maintenanceOrders: number; downtimeEvents: number; spcMeasurements: number };
  timeseries: { enabled: boolean; bucket: string; points: number | null; paused: boolean };
}
type ResetTarget = { scope: 'production' | 'timeseries'; title: string; danger: string } | null;

const PROD_LABELS: Record<string, string> = {
  productionOrders: 'Production Orders',
  workOrders: 'Work Orders',
  jobOrders: 'Job Orders',
  productionEvents: 'Production Events',
  batchRecords: 'Batch Records',
  materialConsumptions: 'Material Consumptions',
  jobOrderMaterials: 'Job-Order Materials',
  scrapLogs: 'Scrap Logs',
  rescheduleRequests: 'Reschedule Requests',
  genealogyLinks: 'Genealogy Links',
  energyWoSummaries: 'Energy WO Summaries',
};

/** Same-origin API base (behind nginx) with an SSR fallback. */
function apiBase() {
  return typeof window !== 'undefined' ? `${window.location.origin}/api/v1` : '/api/v1';
}

/** Dedicated axios instance carrying the elevated owner token (NOT the global session). */
function makeElevatedClient(token: string): AxiosInstance {
  const inst = axios.create({
    baseURL: apiBase(),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 120_000,
  });
  inst.interceptors.response.use((r) => {
    if (r.data && typeof r.data === 'object' && 'success' in r.data && 'data' in r.data) r.data = r.data.data;
    return r;
  });
  return inst;
}

/**
 * Entry point shown in Settings for EVERY user. It always renders, but locks the
 * destructive controls behind an admin step-up challenge: enter the owner's
 * credentials → verified server-side → unlocked. Wrong / non-owner → access denied.
 */
export function SystemDangerZone() {
  const [token, setToken] = useState<string | null>(null);

  if (!token) return <AccessGate onUnlock={setToken} />;
  return <DangerZonePanel token={token} onLock={() => setToken(null)} />;
}

function AccessGate({ onUnlock }: { onUnlock: (token: string) => void }) {
  const { t } = useTranslation('settings');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const base = apiBase();
      // Step-up login with the supplied admin credentials (does not change the active session).
      const loginRes = await axios.post(`${base}/auth/login`, { email: email.trim(), password });
      const tok = loginRes.data?.data?.accessToken ?? loginRes.data?.accessToken;
      if (!tok) throw new Error('no token');
      // Confirm those credentials belong to the designated system owner.
      const check = await axios.get(`${base}/system/owner-check`, { headers: { Authorization: `Bearer ${tok}` } });
      const isOwner = check.data?.data?.isOwner ?? check.data?.isOwner;
      if (!isOwner) {
        setError(t('dz.notOwner'));
        return;
      }
      onUnlock(tok);
    } catch {
      setError(t('dz.accessDenied'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <Header />
      <form onSubmit={submit} className="max-w-sm mx-auto rounded-xl border border-border/60 p-6 space-y-4 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
          <Lock className="w-6 h-6 text-red-400" />
        </div>
        <div>
          <div className="font-semibold">{t('dz.adminRequired')}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {t('dz.enterOwner')}
          </p>
        </div>
        <div className="space-y-2 text-left">
          <Label className="text-xs">{t('dz.adminEmail')}</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@mes360.sa" autoComplete="off" required />
        </div>
        <div className="space-y-2 text-left">
          <Label className="text-xs">{t('dz.adminPassword')}</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="off" required />
        </div>
        {error && (
          <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-md p-2" dir="auto">{error}</div>
        )}
        <Button type="submit" className="w-full" disabled={loading || !email || !password}>
          {loading ? <><Loader2 className="w-4 h-4 me-2 animate-spin" /> {t('dz.verifying')}</> : <><KeyRound className="w-4 h-4 me-2" /> {t('dz.unlock')}</>}
        </Button>
      </form>
    </div>
  );
}

function DangerZonePanel({ token, onLock }: { token: string; onLock: () => void }) {
  const { t } = useTranslation('settings');
  const qc = useQueryClient();
  const client = useMemo(() => makeElevatedClient(token), [token]);

  const { data: status, refetch, isFetching } = useQuery<SystemStatus>({
    queryKey: ['system', 'status'],
    queryFn: () => client.get('/system/status').then((r) => r.data),
  });

  const [target, setTarget] = useState<ResetTarget>(null);
  const [wipeTs, setWipeTs] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPhrase, setConfirmPhrase] = useState('');

  const resetMut = useMutation({
    mutationFn: (body: any) => client.post('/system/reset', body).then((r) => r.data),
    onSuccess: (res: any, vars: any) => {
      const deleted = res?.deleted ? Object.values(res.deleted).reduce((a: number, b: any) => a + Number(b || 0), 0) : 0;
      if (res?.scope === 'timeseries') {
        if (res?.timeseriesWiped) {
          toast({ title: t('dz.toast.historianWiped'), description: t('dz.toast.historianWipedDesc') });
        } else {
          toast({ variant: 'destructive', title: t('dz.toast.wipeFailed'), description: t('dz.toast.wipeFailedDesc') });
        }
      } else {
        const tsNote = vars?.wipeTimeseries ? (res?.timeseriesWiped ? t('dz.toast.tsNoteWiped') : t('dz.toast.tsNoteFailed')) : '';
        toast({ title: t('dz.toast.resetCompleted'), description: t('dz.toast.resetCompletedDesc', { count: deleted, tsNote }) });
      }
      closeDialog();
      refetch();
      qc.invalidateQueries();
    },
    onError: (e: any) => {
      toast({ variant: 'destructive', title: t('dz.toast.resetFailed'), description: e?.response?.data?.message ?? t('dz.toast.resetFailedDesc') });
    },
  });

  const pauseMut = useMutation({
    mutationFn: (paused: boolean) => client.post('/system/historian/pause', { paused }).then((r) => r.data),
    onSuccess: (res: any) => {
      toast({ title: res?.paused ? t('dz.toast.historianPaused') : t('dz.toast.historianResumed'), description: res?.paused ? t('dz.toast.historianPausedDesc') : t('dz.toast.historianResumedDesc') });
      refetch();
    },
    onError: () => toast({ variant: 'destructive', title: t('dz.toast.actionFailed') }),
  });

  const closeDialog = () => { setTarget(null); setPassword(''); setConfirmPhrase(''); setWipeTs(false); };

  const submitReset = () => {
    if (!target) return;
    resetMut.mutate({
      scope: target.scope,
      wipeTimeseries: target.scope === 'production' ? wipeTs : undefined,
      password,
      confirmation: confirmPhrase,
    });
  };

  const canSubmit = password.length > 0 && confirmPhrase.trim() === 'RESET' && !resetMut.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <Header unlocked />
        <Button size="sm" variant="outline" onClick={onLock}>
          <Lock className="w-3.5 h-3.5 me-1.5" /> {t('dz.lock')}
        </Button>
      </div>

      {/* Status snapshot */}
      <div className="rounded-xl border border-border/60 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Database className="w-4 h-4 text-brand-400" /> {t('dz.currentData')}</h3>
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 me-1.5 ${isFetching ? 'animate-spin' : ''}`} /> {t('dz.refresh')}
          </Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
          {status && Object.entries(status.production).map(([k, v]) => (
            <Stat key={k} label={t(`dz.prod.${k}`, { defaultValue: PROD_LABELS[k] ?? k })} value={v} highlight={v > 0} />
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-2.5">
          <Stat label={t('dz.historianPoints')} value={status?.timeseries.points ?? '—'} icon={<Activity className="w-3 h-3" />} />
          <Stat label={t('dz.inspectionsKept')} value={status?.preserved.inspections ?? 0} muted />
          <Stat label={t('dz.maintenanceKept')} value={status?.preserved.maintenanceOrders ?? 0} muted />
          <Stat label={t('dz.spcKept')} value={status?.preserved.spcMeasurements ?? 0} muted />
        </div>
      </div>

      {/* Historian ingestion control */}
      <div className="rounded-xl border border-border/60 p-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4 text-brand-400" /> {t('dz.historianIngestion')}
            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${status?.timeseries.paused ? 'border-amber-500/40 bg-amber-500/10 text-amber-400' : 'border-green-500/40 bg-green-500/10 text-green-400'}`}>
              {status?.timeseries.paused ? t('dz.paused') : t('dz.active')}
            </span>
          </h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {t('dz.historianHelp')}
          </p>
        </div>
        <Button
          size="sm"
          variant={status?.timeseries.paused ? 'default' : 'outline'}
          className="shrink-0"
          disabled={!status?.timeseries.enabled || pauseMut.isPending}
          onClick={() => pauseMut.mutate(!status?.timeseries.paused)}
        >
          {pauseMut.isPending
            ? <><Loader2 className="w-3.5 h-3.5 me-1.5 animate-spin" /> …</>
            : status?.timeseries.paused ? t('dz.resumeWrites') : t('dz.pauseWrites')}
        </Button>
      </div>

      {/* Reset production */}
      <ResetCard
        title={t('dz.resetProdTitle')}
        description={t('dz.resetProdDesc')}
        count={status?.productionTotal}
        affectedLabel={t('dz.affectedRecords')}
        resetLabel={t('dz.reset')}
        onClick={() => setTarget({ scope: 'production', title: t('dz.resetProdTitle'), danger: t('dz.resetProdDanger') })}
      />

      {/* Wipe historian */}
      <ResetCard
        title={t('dz.wipeTsTitle')}
        description={t('dz.wipeTsDesc', { bucket: status?.timeseries.bucket ?? 'mes_timeseries' })}
        count={status?.timeseries.points ?? undefined}
        disabled={!status?.timeseries.enabled}
        affectedLabel={t('dz.affectedRecords')}
        resetLabel={t('dz.reset')}
        onClick={() => setTarget({ scope: 'timeseries', title: t('dz.wipeTsTitle'), danger: t('dz.wipeTsDanger') })}
      />

      {/* Confirmation dialog */}
      <Dialog open={!!target} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="w-5 h-5" /> {target?.title}
            </DialogTitle>
            <DialogDescription>
              {t('dz.willDelete', { danger: target?.danger })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {target?.scope === 'production' && status?.timeseries.enabled && (
              <label className="flex items-start gap-2.5 rounded-lg border border-border/60 p-3 cursor-pointer">
                <Checkbox checked={wipeTs} onCheckedChange={(v) => setWipeTs(!!v)} className="mt-0.5" />
                <span className="text-sm">
                  <span className="font-medium">{t('dz.alsoWipeTs')}</span>
                  <span className="block text-xs text-muted-foreground">{t('dz.alsoWipeTsDesc')}</span>
                </span>
              </label>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">{t('dz.confirmPassword')}</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('dz.typeReset')} <span className="font-mono font-bold text-red-400">RESET</span> {t('dz.toConfirm')}</Label>
              <Input value={confirmPhrase} onChange={(e) => setConfirmPhrase(e.target.value)} placeholder="RESET" className="font-mono" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={resetMut.isPending}>{t('dz.cancel')}</Button>
            <Button variant="destructive" onClick={submitReset} disabled={!canSubmit}>
              {resetMut.isPending ? <><Loader2 className="w-4 h-4 me-1.5 animate-spin" /> {t('dz.resetting')}</> : <><Trash2 className="w-4 h-4 me-1.5" /> {t('dz.permanentlyDelete')}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Header({ unlocked }: { unlocked?: boolean }) {
  const { t } = useTranslation('settings');
  return (
    <div>
      <h2 className="text-lg font-semibold flex items-center gap-2 text-red-400"><ShieldAlert className="w-5 h-5" /> {t('dz.headerTitle')}</h2>
      <p className="text-sm text-muted-foreground mt-1">
        {unlocked ? t('dz.headerUnlocked') : t('dz.headerLocked')}
      </p>
    </div>
  );
}

function Stat({ label, value, highlight, muted, icon }: { label: string; value: number | string; highlight?: boolean; muted?: boolean; icon?: React.ReactNode }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${highlight ? 'border-brand-500/40 bg-brand-500/5' : 'border-border/50'} ${muted ? 'opacity-70' : ''}`}>
      <div className="text-[11px] text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className="text-lg font-bold tabular-nums">{typeof value === 'number' ? value.toLocaleString() : value}</div>
    </div>
  );
}

function ResetCard({ title, description, count, disabled, onClick, affectedLabel, resetLabel }: { title: string; description: string; count?: number; disabled?: boolean; onClick: () => void; affectedLabel: string; resetLabel: string }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/[0.03] p-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-red-300">{title}</h3>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
        {count !== undefined && <div className="text-xs mt-2 text-muted-foreground">{affectedLabel} <span className="font-bold text-foreground">{count.toLocaleString()}</span></div>}
      </div>
      <Button variant="destructive" size="sm" className="shrink-0" onClick={onClick} disabled={disabled}>
        <Trash2 className="w-3.5 h-3.5 mr-1.5" /> {resetLabel}
      </Button>
    </div>
  );
}
