'use client';
import { useTranslation } from 'react-i18next';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Download, Filter, Search, ShieldCheck, AlertTriangle,
  CheckCircle2, XCircle, MoreHorizontal, TrendingUp, FileText,
  ChevronDown, Eye, ClipboardList, ChevronRight,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { KPICard } from '@/components/widgets/kpi-card';
import { SPCChart } from '@/components/charts/spc-chart';
import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { cn, formatDate, timeAgo } from '@/lib/utils';

interface NCR {
  id: string;
  ncrNumber: string;
  title: string;
  severity: 'MINOR' | 'MAJOR' | 'CRITICAL';
  status: 'OPEN' | 'IN_REVIEW' | 'CAPA_PENDING' | 'RESOLVED' | 'CLOSED';
  product: string;
  batchNumber: string;
  detectedBy: string;
  detectedAt: string;
  dueDate: string;
  defectCategory: string;
  qty: number;
}

interface Inspection {
  id: string;
  inspectionNumber: string;
  type: 'INCOMING' | 'IN_PROCESS' | 'FINAL' | 'PATROL';
  product: string;
  batchNumber: string;
  result: 'PASS' | 'FAIL' | 'CONDITIONAL';
  inspector: string;
  date: string;
  passQty: number;
  failQty: number;
  totalQty: number;
}

interface SPCParameter {
  parameterName: string;
  unit: string | null;
  machineId: string | null;
  mean: number | null;
  ucl: number | null;
  lcl: number | null;
  sampleCount: number;
}

interface SPCMeasurement {
  id: string;
  parameterName: string;
  parameterUnit: string | null;
  value: number;
  machineId: string | null;
  ucl: number | null;
  lcl: number | null;
  cl: number | null;
  isOutOfControl: boolean;
  measuredAt: string;
  sampleSize: number | null;
  subgroupNumber: number | null;
}

const NCR_SEVERITY = {
  MINOR: { label: 'Minor', color: 'text-brand-400', bg: 'bg-brand-500/10' },
  MAJOR: { label: 'Major', color: 'text-warning-400', bg: 'bg-warning-500/10' },
  CRITICAL: { label: 'Critical', color: 'text-danger-400', bg: 'bg-danger-500/10' },
};

const NCR_STATUS = {
  OPEN: 'destructive',
  IN_REVIEW: 'secondary',
  CAPA_PENDING: 'outline',
  RESOLVED: 'default',
  CLOSED: 'secondary',
} as const;

const INSPECTION_RESULT = {
  PASS: { label: 'Pass', color: 'text-success-400' },
  FAIL: { label: 'Fail', color: 'text-danger-400' },
  CONDITIONAL: { label: 'Conditional', color: 'text-warning-400' },
};

export function QualityOverview() {
  const { t } = useTranslation(['quality', 'common']);
  const [activeTab, setActiveTab] = useState('ncr');
  const [search, setSearch] = useState('');
  // Respect the global analysis scope (factory/area/line/machine) + date range.
  const { filter: scopeFilter, key: scopeKey } = useScope();
  const { params: timeParams, key: timeKey } = useTimeRange();
  const dateParams = { dateFrom: timeParams.dateFrom, dateTo: timeParams.dateTo };

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['quality', 'kpis', scopeKey],
    queryFn: () => api.get<{
      fpy: number; fpyTrend: number; reworkRate: number; scrapRate: number;
      openNCRs: number; criticalNCRs: number; passRate: number; cpk: number;
    }>('/quality/kpis', { params: { ...scopeFilter } }),
    refetchInterval: 30_000,
  });

  const { data: ncrs, isLoading: ncrsLoading } = useQuery({
    queryKey: ['quality', 'ncr', { search }, scopeKey, timeKey],
    queryFn: () => api.get<{ data: NCR[]; total: number }>('/quality/ncr', {
      params: { search, limit: 20, ...scopeFilter, ...dateParams },
    }),
  });

  const { data: inspections, isLoading: insLoading } = useQuery({
    queryKey: ['quality', 'inspections', { search }, scopeKey, timeKey],
    queryFn: () => api.get<{ data: Inspection[] }>('/quality/inspections', {
      params: { search, limit: 20, ...scopeFilter, ...dateParams },
    }),
  });

  // SPC — pick the first tracked parameter and chart its recent measurements
  const { data: spcParams } = useQuery({
    queryKey: ['quality', 'spc', 'params', scopeKey],
    queryFn: () => api.get<SPCParameter[]>('/quality/spc', { params: { ...scopeFilter } }),
    refetchInterval: 60_000,
  });

  const activeParam = spcParams?.[0];

  const { data: spcMeasurements, isLoading: spcLoading } = useQuery({
    queryKey: ['quality', 'spc', 'measurements', activeParam?.parameterName, scopeKey],
    queryFn: () => api.get<SPCMeasurement[]>('/quality/spc/measurements', {
      params: { parameterId: activeParam!.parameterName, limit: 30, ...scopeFilter },
    }),
    enabled: !!activeParam,
    refetchInterval: 60_000,
  });

  const spcData = React.useMemo(
    () =>
      (spcMeasurements ?? [])
        .slice()
        .reverse()
        .map((m, i) => ({
          sample: i + 1,
          value: m.value,
          time: m.subgroupNumber != null
            ? `#${m.subgroupNumber}`
            : new Date(m.measuredAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit' }),
        })),
    [spcMeasurements],
  );

  const latestSpc = spcMeasurements?.[0];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('headers.overview.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('headers.overview.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
            <Download size={13} />
            Export
          </Button>
          <Button size="sm" className="gap-1.5 h-8 text-xs">
            <Plus size={13} />
            New NCR
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-3">
          <KPICard title="First Pass Yield" value={kpis?.fpy ?? 0} unit="%" trend={kpis?.fpyTrend} target={99} colorMode="oee" isLoading={kpisLoading} icon={<ShieldCheck size={16} />} />
          <KPICard title="Rework Rate" value={kpis?.reworkRate ?? 0} unit="%" isLoading={kpisLoading} />
          <KPICard title="Scrap Rate" value={kpis?.scrapRate ?? 0} unit="%" colorMode="alarm" isLoading={kpisLoading} />
          <KPICard title="Open NCRs" value={kpis?.openNCRs ?? 0} colorMode="alarm" subtitle={`${kpis?.criticalNCRs ?? 0} critical`} isLoading={kpisLoading} icon={<AlertTriangle size={16} />} />
        </div>

        {/* SPC Chart */}
        <SPCChart
          title={activeParam
            ? `SPC — ${activeParam.parameterName}${activeParam.unit ? ` (${activeParam.unit})` : ''}`
            : 'Statistical Process Control (X-Bar Chart)'}
          data={spcData}
          mean={latestSpc?.cl ?? activeParam?.mean ?? undefined}
          ucl={latestSpc?.ucl ?? activeParam?.ucl ?? undefined}
          lcl={latestSpc?.lcl ?? activeParam?.lcl ?? undefined}
          isLoading={spcLoading}
        />

        {/* Tabs for NCR and Inspections */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between mb-3">
            <TabsList>
              <TabsTrigger value="ncr" className="text-xs gap-1.5">
                <AlertTriangle size={12} />
                NCR Management
                {(kpis?.openNCRs ?? 0) > 0 && (
                  <Badge variant="destructive" className="text-[9px] h-4 min-w-4 px-1">
                    {kpis?.openNCRs}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="inspections" className="text-xs gap-1.5">
                <ClipboardList size={12} />
                Inspections
              </TabsTrigger>
              <TabsTrigger value="capa" className="text-xs gap-1.5">
                <ShieldCheck size={12} />
                CAPA
              </TabsTrigger>
            </TabsList>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-7 w-44 text-xs"
              />
            </div>
          </div>

          {/* NCR Table */}
          <TabsContent value="ncr">
            <div className="industrial-card overflow-hidden">
              <div className="rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-border/30">
                      <TableHead className="text-[11px]">NCR #</TableHead>
                      <TableHead className="text-[11px]">Title</TableHead>
                      <TableHead className="text-[11px]">Severity</TableHead>
                      <TableHead className="text-[11px]">Status</TableHead>
                      <TableHead className="text-[11px]">Product</TableHead>
                      <TableHead className="text-[11px]">Batch</TableHead>
                      <TableHead className="text-[11px]">Detected</TableHead>
                      <TableHead className="text-[11px]">Due Date</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ncrsLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i} className="border-border/20">
                          {Array.from({ length: 9 }).map((_, j) => (
                            <TableCell key={j}><div className="shimmer h-3.5 rounded w-20" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : (ncrs?.data ?? []).map((ncr) => {
                      const sev = NCR_SEVERITY[ncr.severity];
                      return (
                        <TableRow key={ncr.id} className="border-border/20 hover:bg-muted/20 cursor-pointer">
                          <TableCell className="font-mono text-xs font-semibold text-primary">{ncr.ncrNumber}</TableCell>
                          <TableCell className="text-xs max-w-[160px]">
                            <span className="truncate block">{ncr.title}</span>
                          </TableCell>
                          <TableCell>
                            <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold', sev.bg, sev.color)}>
                              {sev.label}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant={NCR_STATUS[ncr.status]} className="text-[10px] h-5">
                              {ncr.status.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{ncr.product}</TableCell>
                          <TableCell className="text-xs font-mono">{ncr.batchNumber}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{timeAgo(ncr.detectedAt)}</TableCell>
                          <TableCell className={cn('text-xs', new Date(ncr.dueDate) < new Date() ? 'text-danger-400 font-medium' : 'text-muted-foreground')}>
                            {formatDate(ncr.dueDate)}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <ChevronRight size={13} />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TabsContent>

          {/* Inspections Table */}
          <TabsContent value="inspections">
            <div className="industrial-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border/30">
                    <TableHead className="text-[11px]">Inspection #</TableHead>
                    <TableHead className="text-[11px]">Type</TableHead>
                    <TableHead className="text-[11px]">Product</TableHead>
                    <TableHead className="text-[11px]">Batch</TableHead>
                    <TableHead className="text-[11px]">Result</TableHead>
                    <TableHead className="text-[11px]">Pass/Total</TableHead>
                    <TableHead className="text-[11px]">Inspector</TableHead>
                    <TableHead className="text-[11px]">Date</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {insLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i} className="border-border/20">
                        {Array.from({ length: 9 }).map((_, j) => (
                          <TableCell key={j}><div className="shimmer h-3.5 rounded w-20" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (inspections?.data ?? []).map((ins) => {
                    const res = INSPECTION_RESULT[ins.result];
                    return (
                      <TableRow key={ins.id} className="border-border/20 hover:bg-muted/20 cursor-pointer">
                        <TableCell className="font-mono text-xs font-semibold text-primary">{ins.inspectionNumber}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[10px] h-5">{ins.type}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">{ins.product}</TableCell>
                        <TableCell className="text-xs font-mono">{ins.batchNumber}</TableCell>
                        <TableCell>
                          <span className={cn('text-xs font-semibold', res.color)}>{res.label}</span>
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="text-success-400 font-medium">{ins.passQty}</span>
                          <span className="text-muted-foreground"> / {ins.totalQty}</span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{ins.inspector}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDate(ins.date)}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <ChevronRight size={13} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* CAPA Tab */}
          <TabsContent value="capa">
            <div className="flex items-center justify-center h-40 industrial-card rounded-lg">
              <div className="text-center">
                <ShieldCheck size={32} className="text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">CAPA Management module</p>
                <p className="text-xs text-muted-foreground/60">Corrective and Preventive Actions</p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
