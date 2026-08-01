'use client';
import { useTranslation } from 'react-i18next';
import { toFactoryDayKey } from '@/lib/datetime';

import React from 'react';
import { Download, FileText } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
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

export function QualityReportView() {
  const { t } = useTranslation('modules');
  const [days, setDays] = React.useState<(typeof PERIODS)[number]>(7);
  const to = toFactoryDayKey(new Date());
  const from = toFactoryDayKey(Date.now() - days * 86_400_000);
  const { data: reportData, isLoading } = useQuery({
    queryKey: ['reports', 'quality', from, to],
    queryFn: () => api.get('/reports/quality', { params: { from, to } }),
    staleTime: 60_000,
  });

  const handleExport = () => {
    const d = (reportData as any) ?? {};
    downloadCsv(`quality-report-${from}_${to}.csv`, [
      [t('reports.quality.title'), `${from} → ${to}`],
      [t('reports.qual.fpy'), `${d.fpy ?? 0}%`],
      [t('reports.qual.defectRate'), `${d.defectRate ?? 0}%`],
      [t('reports.qual.inspections'), d.inspections ?? 0],
      [t('reports.qual.ncrs'), d.ncrs ?? 0],
    ]);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('reports.quality.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('reports.quality.subtitle')}
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
            {t('reports.qual.exportPdf')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title={t('reports.qual.fpy')} value={(reportData as any)?.fpy ?? 0} unit="%" colorMode="default" isLoading={isLoading} />
          <KPICard title={t('reports.qual.defectRate')} value={(reportData as any)?.defectRate ?? 0} unit="%" colorMode="alarm" isLoading={isLoading} />
          <KPICard title={t('reports.qual.inspections')} value={(reportData as any)?.inspections ?? 0} isLoading={isLoading} />
          <KPICard title={t('reports.qual.ncrs')} value={(reportData as any)?.ncrs ?? 0} colorMode="alarm" isLoading={isLoading} />
        </div>

        <div className="industrial-card p-4">
          <h3 className="text-sm font-semibold mb-4">{t('reports.qual.summary')}</h3>
          <div className="text-center py-12 text-muted-foreground">
            <FileText size={48} className="mx-auto mb-4 opacity-50" />
            <p className="text-sm">{t('reports.qual.vizSoon')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
