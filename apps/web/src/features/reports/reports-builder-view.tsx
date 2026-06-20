'use client';
import { useTranslation } from 'react-i18next';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  FileText,
  Download,
  RefreshCw,
  Factory,
  ShieldCheck,
  Wrench,
  Gauge,
  Package,
  Zap,
  Trash2,
  Clock,
  BarChart3,
  CheckCircle2,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { api } from '@/services/api.client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReportTypeConfig {
  id: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  descKey: string;
  endpoint: string | null;
  color: string;
  comingSoon?: boolean;
}

interface RecentReport {
  type: string;
  label: string;
  generatedAt: string;
  rowCount: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPORT_TYPES: ReportTypeConfig[] = [
  {
    id: 'production',
    labelKey: 'reports.builder.type.production.label',
    icon: Factory,
    descKey: 'reports.builder.type.production.desc',
    endpoint: '/reports/production',
    color: 'blue',
  },
  {
    id: 'quality',
    labelKey: 'reports.builder.type.quality.label',
    icon: ShieldCheck,
    descKey: 'reports.builder.type.quality.desc',
    endpoint: '/reports/quality',
    color: 'green',
  },
  {
    id: 'maintenance',
    labelKey: 'reports.builder.type.maintenance.label',
    icon: Wrench,
    descKey: 'reports.builder.type.maintenance.desc',
    endpoint: '/reports/maintenance',
    color: 'orange',
  },
  {
    id: 'oee',
    labelKey: 'reports.builder.type.oee.label',
    icon: Gauge,
    descKey: 'reports.builder.type.oee.desc',
    endpoint: '/production/oee-records?limit=200',
    color: 'purple',
  },
  {
    id: 'scrap',
    labelKey: 'reports.builder.type.scrap.label',
    icon: Trash2,
    descKey: 'reports.builder.type.scrap.desc',
    endpoint: '/production/scrap-logs?limit=200',
    color: 'red',
  },
  {
    id: 'inventory',
    labelKey: 'reports.builder.type.inventory.label',
    icon: Package,
    descKey: 'reports.builder.type.inventory.desc',
    endpoint: '/inventory/overview',
    color: 'teal',
  },
  {
    id: 'energy',
    labelKey: 'reports.builder.type.energy.label',
    icon: Zap,
    descKey: 'reports.builder.type.energy.desc',
    endpoint: null,
    color: 'yellow',
    comingSoon: true,
  },
];

const STORAGE_KEY = 'mes_recent_reports';

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const colorBorder: Record<string, string> = {
  blue: 'border-blue-500',
  green: 'border-green-500',
  orange: 'border-orange-500',
  purple: 'border-purple-500',
  red: 'border-red-500',
  teal: 'border-teal-500',
  yellow: 'border-yellow-500',
};

const colorText: Record<string, string> = {
  blue: 'text-blue-400',
  green: 'text-green-400',
  orange: 'text-orange-400',
  purple: 'text-purple-400',
  red: 'text-red-400',
  teal: 'text-teal-400',
  yellow: 'text-yellow-400',
};

const colorBadgeBg: Record<string, string> = {
  blue: 'bg-blue-500/10 text-blue-400',
  green: 'bg-green-500/10 text-green-400',
  orange: 'bg-orange-500/10 text-orange-400',
  purple: 'bg-purple-500/10 text-purple-400',
  red: 'bg-red-500/10 text-red-400',
  teal: 'bg-teal-500/10 text-teal-400',
  yellow: 'bg-yellow-500/10 text-yellow-400',
};

// ---------------------------------------------------------------------------
// CSV export helper
// ---------------------------------------------------------------------------

function exportCSV(rows: Record<string, unknown>[], filename: string): void {
  if (!rows || rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h];
          const str = val == null ? '' : String(val);
          return str.includes(',') || str.includes('"') || str.includes('\n')
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        })
        .join(',')
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Build endpoint URL with date params
// ---------------------------------------------------------------------------

function buildUrl(endpoint: string, from: string, to: string): string {
  const separator = endpoint.includes('?') ? '&' : '?';
  const params: string[] = [];
  if (from) params.push(`from=${encodeURIComponent(from)}`);
  if (to) params.push(`to=${encodeURIComponent(to)}`);
  return params.length > 0 ? `${endpoint}${separator}${params.join('&')}` : endpoint;
}

// ---------------------------------------------------------------------------
// Normalize API response to a flat row array
// ---------------------------------------------------------------------------

function normalizeRows(data: unknown): Record<string, unknown>[] {
  if (!data) return [];
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (typeof data === 'object' && data !== null) {
    // Try common envelope keys
    const obj = data as Record<string, unknown>;
    for (const key of ['data', 'items', 'records', 'results', 'rows']) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-8 bg-foreground/5 rounded w-1/3" />
      <div className="h-4 bg-foreground/5 rounded w-full" />
      <div className="h-4 bg-foreground/5 rounded w-full" />
      <div className="h-4 bg-foreground/5 rounded w-5/6" />
      <div className="h-4 bg-foreground/5 rounded w-full" />
      <div className="h-4 bg-foreground/5 rounded w-4/5" />
      <div className="h-4 bg-foreground/5 rounded w-full" />
      <div className="h-4 bg-foreground/5 rounded w-3/4" />
    </div>
  );
}

interface DataTableProps {
  rows: Record<string, unknown>[];
  totalCount: number;
}

function DataTable({ rows, totalCount }: DataTableProps) {
  const { t } = useTranslation('modules');
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
        <BarChart3 className="h-8 w-8 opacity-40" />
        <p className="text-sm">{t('reports.builder.noData')}</p>
      </div>
    );
  }

  const columns = Object.keys(rows[0]);
  const preview = rows.slice(0, 20);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {t('reports.builder.showingRows', { shown: preview.length, total: totalCount })}
        </span>
        {totalCount > 20 && (
          <span className="text-xs opacity-60">{t('reports.builder.exportToViewAll')}</span>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-foreground/10">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-foreground/5 border-b border-foreground/10">
              {columns.map((col) => (
                <th
                  key={col}
                  className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap"
                >
                  {col
                    .replace(/([A-Z])/g, ' $1')
                    .replace(/_/g, ' ')
                    .trim()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, i) => (
              <tr
                key={i}
                className={cn(
                  'border-b border-foreground/5 transition-colors hover:bg-foreground/5',
                  i % 2 === 0 ? 'bg-transparent' : 'bg-foreground/[0.02]'
                )}
              >
                {columns.map((col) => {
                  const val = row[col];
                  const display =
                    val == null
                      ? '—'
                      : typeof val === 'object'
                      ? JSON.stringify(val)
                      : String(val);
                  return (
                    <td
                      key={col}
                      className="px-3 py-1.5 text-foreground/80 max-w-[200px] truncate"
                      title={display}
                    >
                      {display}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ReportsBuilderView() {
  const { t } = useTranslation('modules');
  const [selectedType, setSelectedType] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [isGenerated, setIsGenerated] = useState<boolean>(false);
  const [reportData, setReportData] = useState<unknown>(null);
  const [scheduleMsg, setScheduleMsg] = useState<boolean>(false);
  const [recentReports, setRecentReports] = useState<RecentReport[]>([]);

  // Load recent reports from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setRecentReports(JSON.parse(stored) as RecentReport[]);
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  const selectedConfig = REPORT_TYPES.find((r) => r.id === selectedType) ?? null;

  // Build query URL
  const queryUrl =
    selectedConfig && selectedConfig.endpoint && isGenerated
      ? buildUrl(selectedConfig.endpoint, dateFrom, dateTo)
      : null;

  const {
    data: fetchedData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['report-builder', selectedType, dateFrom, dateTo, isGenerated],
    queryFn: async () => {
      if (!queryUrl) return null;
      const res = await api.get(queryUrl);
      return res;
    },
    enabled: isGenerated && !!selectedType && !!queryUrl,
  });

  // Sync fetched data into state and save recent
  useEffect(() => {
    if (fetchedData !== undefined && fetchedData !== null && isGenerated && selectedConfig) {
      setReportData(fetchedData);
      const rows = normalizeRows(fetchedData);
      const entry: RecentReport = {
        type: selectedConfig.id,
        label: t(selectedConfig.labelKey),
        generatedAt: new Date().toISOString(),
        rowCount: rows.length,
      };
      setRecentReports((prev) => {
        const updated = [entry, ...prev.filter((r) => r.type !== entry.type || r.generatedAt !== entry.generatedAt)].slice(0, 5);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        } catch {
          // ignore
        }
        return updated;
      });
    }
  }, [fetchedData, isGenerated, selectedConfig]);

  const rows = normalizeRows(reportData);

  function handleGenerate() {
    if (!selectedType) return;
    setReportData(null);
    setIsGenerated(true);
  }

  function handleExportCSV() {
    if (!rows.length || !selectedConfig) return;
    const filename = `${selectedConfig.id}-report-${new Date().toISOString().slice(0, 10)}.csv`;
    exportCSV(rows, filename);
  }

  function handleSchedule() {
    setScheduleMsg(true);
    setTimeout(() => setScheduleMsg(false), 4000);
  }

  function handleRerun(recent: RecentReport) {
    setSelectedType(recent.type);
    setIsGenerated(false);
    setReportData(null);
    // Small delay so state settles before re-triggering
    setTimeout(() => {
      setIsGenerated(true);
    }, 100);
  }

  const canExport = rows.length > 0 && !isLoading;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-start gap-3"
      >
        <div className="p-2 rounded-lg bg-brand-500/10">
          <FileText className="h-6 w-6 text-brand-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('reports.builder.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('reports.builder.subtitle')}
          </p>
        </div>
      </motion.div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT — Configuration */}
        <motion.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="lg:col-span-1 space-y-5"
        >
          <div className="rounded-xl border border-foreground/10 bg-card/60 backdrop-blur-sm p-4 space-y-5">
            {/* Select Report Type */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {t('reports.builder.selectType')}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {REPORT_TYPES.map((rt) => {
                  const Icon = rt.icon;
                  const isSelected = selectedType === rt.id;
                  const isDisabled = !!rt.comingSoon;
                  return (
                    <button
                      key={rt.id}
                      disabled={isDisabled}
                      onClick={() => {
                        if (isDisabled) return;
                        setSelectedType(rt.id);
                        setIsGenerated(false);
                        setReportData(null);
                      }}
                      className={cn(
                        'relative text-left rounded-lg border p-2.5 transition-all duration-150',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                        isDisabled && 'opacity-40 cursor-not-allowed',
                        isSelected
                          ? cn('border-2', colorBorder[rt.color] ?? 'border-brand-500', 'bg-foreground/5')
                          : 'border-foreground/10 hover:border-foreground/20 hover:bg-foreground/5 cursor-pointer'
                      )}
                    >
                      {rt.comingSoon && (
                        <span className="absolute top-1.5 right-1.5 text-[9px] font-bold bg-yellow-500/20 text-yellow-400 rounded px-1">
                          {t('reports.builder.soon')}
                        </span>
                      )}
                      <Icon
                        className={cn(
                          'h-4 w-4 mb-1.5',
                          isSelected ? colorText[rt.color] ?? 'text-brand-400' : 'text-muted-foreground'
                        )}
                      />
                      <p
                        className={cn(
                          'text-[11px] font-semibold leading-tight',
                          isSelected ? 'text-foreground' : 'text-foreground/70'
                        )}
                      >
                        {t(rt.labelKey)}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight line-clamp-2">
                        {t(rt.descKey)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date Range */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {t('reports.builder.dateRange')}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground font-medium">{t('reports.builder.from')}</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => {
                      setDateFrom(e.target.value);
                      setIsGenerated(false);
                    }}
                    className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground font-medium">{t('reports.builder.to')}</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => {
                      setDateTo(e.target.value);
                      setIsGenerated(false);
                    }}
                    className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={handleGenerate}
                disabled={!selectedType}
              >
                <BarChart3 className="h-4 w-4 mr-2" />
                {t('reports.builder.generateReport')}
              </Button>

              <Button
                variant="secondary"
                className="w-full"
                onClick={handleExportCSV}
                disabled={!canExport}
              >
                <Download className="h-4 w-4 mr-2" />
                {t('reports.builder.exportCsv')}
              </Button>

              <Button
                variant="outline"
                className="w-full"
                onClick={handleSchedule}
              >
                <Clock className="h-4 w-4 mr-2" />
                {t('reports.builder.scheduleReport')}
              </Button>

              {scheduleMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                  {t('reports.builder.schedulingSoon')}
                </motion.div>
              )}
            </div>
          </div>
        </motion.div>

        {/* RIGHT — Preview */}
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="lg:col-span-2"
        >
          <div className="rounded-xl border border-foreground/10 bg-card/60 backdrop-blur-sm p-4 min-h-[400px]">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t('reports.builder.preview')}
              </p>
              {isGenerated && selectedConfig && !isLoading && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => refetch()}
                  className="h-7 text-xs gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t('reports.builder.refresh')}
                </Button>
              )}
            </div>

            {/* Empty state */}
            {!selectedType && (
              <div className="flex flex-col items-center justify-center h-72 text-muted-foreground gap-3">
                <FileText className="h-12 w-12 opacity-20" />
                <p className="text-sm font-medium">{t('reports.builder.emptyTitle')}</p>
                <p className="text-xs opacity-60">
                  {t('reports.builder.emptyDesc')}
                </p>
              </div>
            )}

            {/* Energy coming soon */}
            {selectedType === 'energy' && (
              <div className="flex flex-col items-center justify-center h-72 text-muted-foreground gap-3">
                <Zap className="h-12 w-12 text-yellow-400 opacity-40" />
                <p className="text-sm font-medium">{t('reports.builder.energySoon')}</p>
                <p className="text-xs opacity-60">
                  {t('reports.builder.energySoonDesc')}
                </p>
              </div>
            )}

            {/* Not yet generated */}
            {selectedType && selectedType !== 'energy' && !isGenerated && (
              <div className="flex flex-col items-center justify-center h-72 text-muted-foreground gap-3">
                {selectedConfig && (
                  <>
                    <selectedConfig.icon
                      className={cn('h-12 w-12 opacity-20', colorText[selectedConfig.color])}
                    />
                    <p className="text-sm font-medium">{t(selectedConfig.labelKey)}</p>
                    <p className="text-xs opacity-60">
                      {t('reports.builder.configureHint')}
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Loading */}
            {isGenerated && isLoading && selectedType !== 'energy' && (
              <div className="mt-2">
                <LoadingSkeleton />
              </div>
            )}

            {/* Error */}
            {isGenerated && isError && !isLoading && (
              <div className="flex flex-col items-center justify-center h-60 text-muted-foreground gap-3">
                <p className="text-sm text-red-400 font-medium">{t('reports.builder.loadFailed')}</p>
                <p className="text-xs opacity-60">
                  {error instanceof Error ? error.message : t('reports.builder.unknownError')}
                </p>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  {t('reports.builder.retry')}
                </Button>
              </div>
            )}

            {/* Data table */}
            {isGenerated && !isLoading && !isError && reportData != null && selectedType !== 'energy' && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                {selectedConfig && (
                  <div className="flex items-center gap-2 mb-3">
                    <selectedConfig.icon
                      className={cn('h-4 w-4', colorText[selectedConfig.color])}
                    />
                    <span className="text-sm font-semibold text-foreground">
                      {t(selectedConfig.labelKey)}
                    </span>
                    <span
                      className={cn(
                        'text-xs rounded-full px-2 py-0.5 font-medium',
                        colorBadgeBg[selectedConfig.color]
                      )}
                    >
                      {t('reports.builder.rowsCount', { count: rows.length })}
                    </span>
                  </div>
                )}
                <DataTable rows={rows} totalCount={rows.length} />
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Recent Reports */}
      {recentReports.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="rounded-xl border border-foreground/10 bg-card/60 backdrop-blur-sm p-4"
        >
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t('reports.builder.recentReports')}
            </p>
          </div>
          <div className="space-y-2">
            {recentReports.slice(0, 5).map((report, i) => {
              const config = REPORT_TYPES.find((r) => r.id === report.type);
              const Icon = config?.icon ?? FileText;
              const color = config?.color ?? 'blue';
              const generatedDate = new Date(report.generatedAt);
              const displayDate = isNaN(generatedDate.getTime())
                ? '—'
                : generatedDate.toLocaleString();
              return (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-foreground/5 bg-foreground/[0.02] px-3 py-2 hover:bg-foreground/5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'p-1.5 rounded-md',
                        colorBadgeBg[color]
                      )}
                    >
                      <Icon className={cn('h-3.5 w-3.5', colorText[color])} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{report.label}</p>
                      <p className="text-xs text-muted-foreground">{displayDate}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        'text-xs rounded-full px-2 py-0.5 font-medium',
                        colorBadgeBg[color]
                      )}
                    >
                      {t('reports.builder.rowsCount', { count: report.rowCount })}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRerun(report)}
                      className="h-7 text-xs gap-1.5"
                    >
                      <RefreshCw className="h-3 w-3" />
                      {t('reports.builder.rerun')}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </div>
  );
}
