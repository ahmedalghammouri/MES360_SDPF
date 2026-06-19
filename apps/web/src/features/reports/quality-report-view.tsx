'use client';
import { useTranslation } from 'react-i18next';

import React from 'react';
import { Download, Calendar, FileText } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { KPICard } from '@/components/widgets/kpi-card';
import { api } from '@/services/api.client';

export function QualityReportView() {
  const { t } = useTranslation('modules');
  const { data: reportData, isLoading } = useQuery({
    queryKey: ['reports', 'quality'],
    queryFn: () => api.get('/reports/quality'),
    staleTime: 60_000,
  });

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
          <KPICard title="First Pass Yield" value={(reportData as any)?.fpy ?? 0} unit="%" colorMode="default" isLoading={isLoading} />
          <KPICard title="Defect Rate" value={(reportData as any)?.defectRate ?? 0} unit="%" colorMode="alarm" isLoading={isLoading} />
          <KPICard title="Inspections" value={(reportData as any)?.inspections ?? 0} isLoading={isLoading} />
          <KPICard title="NCRs" value={(reportData as any)?.ncrs ?? 0} colorMode="alarm" isLoading={isLoading} />
        </div>

        <div className="industrial-card p-4">
          <h3 className="text-sm font-semibold mb-4">Report Summary</h3>
          <div className="text-center py-12 text-muted-foreground">
            <FileText size={48} className="mx-auto mb-4 opacity-50" />
            <p className="text-sm">Quality report visualization coming soon</p>
          </div>
        </div>
      </div>
    </div>
  );
}
