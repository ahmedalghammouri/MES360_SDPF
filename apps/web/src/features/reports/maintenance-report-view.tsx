'use client';
import { useTranslation } from 'react-i18next';

import React, { useState } from 'react';
import { Download, Calendar, FileText, TrendingUp } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { KPICard } from '@/components/widgets/kpi-card';
import { api } from '@/services/api.client';

export function MaintenanceReportView() {
  const { t } = useTranslation('modules');
  const { data: reportData, isLoading } = useQuery({
    queryKey: ['reports', 'maintenance'],
    queryFn: () => api.get<{
      mtbf: number; mttr: number; totalWO: number; completedWO: number; completionRate: number;
      failures: number; totalCost: number;
      byType: Record<string, number>; byStatus: Record<string, number>;
    }>('/reports/maintenance'),
    staleTime: 60_000,
  });
  const r = reportData as any;
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
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
            <Calendar size={13} />
            Date Range
          </Button>
          <Button size="sm" className="gap-1.5 h-8 text-xs">
            <Download size={13} />
            Export PDF
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title="MTBF" value={(reportData as any)?.mtbf ?? 0} unit="hrs" isLoading={isLoading} />
          <KPICard title="MTTR" value={(reportData as any)?.mttr ?? 0} unit="hrs" isLoading={isLoading} />
          <KPICard title="Work Orders" value={(reportData as any)?.totalWO ?? 0} isLoading={isLoading} />
          <KPICard title="Completion Rate" value={(reportData as any)?.completionRate ?? 0} unit="%" colorMode="default" isLoading={isLoading} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* By status */}
          <div className="industrial-card p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><FileText size={14} className="text-brand-400" /> By Status</h3>
            {byStatus.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">No work orders in this period</p>
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
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><TrendingUp size={14} className="text-brand-400" /> By Type</h3>
            {byType.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">No work orders in this period</p>
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
            <h3 className="text-sm font-semibold mb-3">Cost & Reliability</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Total Maintenance Cost</span>
                <span className="font-semibold tabular-nums text-foreground">{(r?.totalCost ?? 0).toLocaleString()} SAR</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Failures (corrective + emergency)</span>
                <span className="font-semibold tabular-nums text-foreground">{r?.failures ?? 0}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Completed WOs</span>
                <span className="font-semibold tabular-nums text-foreground">{r?.completedWO ?? 0} / {r?.totalWO ?? 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
