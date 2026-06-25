'use client';
import { useTranslation } from 'react-i18next';

import React, { useState } from 'react';
import { Download, FileText, TrendingUp } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { KPICard } from '@/components/widgets/kpi-card';
import { api } from '@/services/api.client';

const PERIODS = [7, 30, 90] as const;

function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function MaintenanceReportView() {
  const { t } = useTranslation('modules');
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const { data: reportData, isLoading } = useQuery({
    queryKey: ['reports', 'maintenance', from, to],
    queryFn: () => api.get<{
      mtbf: number; mttr: number; totalWO: number; completedWO: number; completionRate: number;
      failures: number; totalCost: number;
      byType: Record<string, number>; byStatus: Record<string, number>;
    }>('/reports/maintenance', { params: { from, to } }),
    staleTime: 60_000,
  });
  const r = reportData as any;
  const handleExport = () => {
    downloadCsv(`maintenance-report-${from}_${to}.csv`, [
      [t('reports.maintenance.title'), `${from} → ${to}`],
      [t('reports.maint.mtbf'), r?.mtbf ?? 0], [t('reports.maint.mttr'), r?.mttr ?? 0],
      [t('reports.maint.workOrders'), r?.totalWO ?? 0], [t('reports.maint.completionRate'), `${r?.completionRate ?? 0}%`],
      [t('reports.maint.failures'), r?.failures ?? 0], [t('reports.maint.totalCost'), r?.totalCost ?? 0],
      [t('reports.maint.completedWos'), `${r?.completedWO ?? 0} / ${r?.totalWO ?? 0}`],
    ]);
  };
  const byType: [string, number][] = Object.entries(r?.byType ?? {});
  const byStatus: [string, number][] = Object.entries(r?.byStatus ?? {});
  const pretty = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('reports.maintenance.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('reports.maintenance.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-border/60 overflow-hidden">
            {PERIODS.map((p) => (
              <button key={p} onClick={() => setDays(p)}
                className={`px-2.5 h-8 text-xs ${days === p ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/50'}`}>
                {p}d
              </button>
            ))}
          </div>
          <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={handleExport} disabled={isLoading}>
            <Download size={13} />
            {t('reports.maint.exportPdf')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title={t('reports.maint.mtbf')} value={(reportData as any)?.mtbf ?? 0} unit={t('reports.maint.hrs')} isLoading={isLoading} />
          <KPICard title={t('reports.maint.mttr')} value={(reportData as any)?.mttr ?? 0} unit={t('reports.maint.hrs')} isLoading={isLoading} />
          <KPICard title={t('reports.maint.workOrders')} value={(reportData as any)?.totalWO ?? 0} isLoading={isLoading} />
          <KPICard title={t('reports.maint.completionRate')} value={(reportData as any)?.completionRate ?? 0} unit="%" colorMode="default" isLoading={isLoading} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* By status */}
          <div className="industrial-card p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><FileText size={14} className="text-brand-400" /> {t('reports.maint.byStatus')}</h3>
            {byStatus.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">{t('reports.maint.noWorkOrders')}</p>
            ) : (
              <div className="space-y-2">
                {byStatus.sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                  <div key={s} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{pretty(s)}</span>
                    <span className="font-semibold tabular-nums text-foreground">{n}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* By type */}
          <div className="industrial-card p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><TrendingUp size={14} className="text-brand-400" /> {t('reports.maint.byType')}</h3>
            {byType.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">{t('reports.maint.noWorkOrders')}</p>
            ) : (
              <div className="space-y-2">
                {byType.sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                  <div key={t} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{pretty(t)}</span>
                    <span className="font-semibold tabular-nums text-foreground">{n}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cost + reliability */}
          <div className="industrial-card p-4">
            <h3 className="text-sm font-semibold mb-3">{t('reports.maint.costReliability')}</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t('reports.maint.totalCost')}</span>
                <span className="font-semibold tabular-nums text-foreground">{t('reports.maint.sarValue', { value: (r?.totalCost ?? 0).toLocaleString() })}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t('reports.maint.failures')}</span>
                <span className="font-semibold tabular-nums text-foreground">{r?.failures ?? 0}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t('reports.maint.completedWos')}</span>
                <span className="font-semibold tabular-nums text-foreground">{r?.completedWO ?? 0} / {r?.totalWO ?? 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
