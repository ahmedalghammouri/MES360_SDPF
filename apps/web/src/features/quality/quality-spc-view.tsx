'use client';
import { useTranslation } from 'react-i18next';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, AlertTriangle, CheckCircle2, Activity } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { cn } from '@/lib/utils';
import { api } from '@/services/api.client';

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
  value: number;
  ucl: number | null;
  lcl: number | null;
  cl: number | null;
  isOutOfControl: boolean;
  measuredAt: string;
  subgroupNumber: number | null;
}

type Status = 'IN_CONTROL' | 'WARNING' | 'OUT_OF_CONTROL';

function computeStatus(measurements: SPCMeasurement[], cpk: number): Status {
  if (measurements.some(m => m.isOutOfControl)) return 'OUT_OF_CONTROL';
  if (cpk < 1.0) return 'OUT_OF_CONTROL';
  if (cpk < 1.33) return 'WARNING';
  return 'IN_CONTROL';
}

function computeCpk(values: number[], ucl: number, lcl: number, mean: number): number {
  if (values.length < 2) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / (values.length - 1);
  const sigma = Math.sqrt(variance);
  if (sigma === 0) return 0;
  const cpu = (ucl - avg) / (3 * sigma);
  const cpl = (avg - lcl) / (3 * sigma);
  return parseFloat(Math.min(cpu, cpl).toFixed(2));
}

const STATUS_CFG: Record<Status, { label: string; color: string; icon: any }> = {
  IN_CONTROL:     { label: 'In Control',    color: 'text-green-400', icon: CheckCircle2  },
  WARNING:        { label: 'Warning',       color: 'text-amber-400', icon: AlertTriangle },
  OUT_OF_CONTROL: { label: 'Out of Control',color: 'text-red-400',   icon: AlertTriangle },
};

export function QualitySpcView() {
  const { t } = useTranslation(['quality', 'common']);
  const [selected, setSelected] = useState<string | null>(null);

  const { data: paramsData, isLoading: paramsLoading } = useQuery({
    queryKey: ['quality', 'spc', 'parameters'],
    queryFn: () => api.get('/quality/spc'),
    staleTime: 60_000,
  });

  const parameters: SPCParameter[] = (paramsData as any) ?? [];

  const selectedParam = selected
    ? parameters.find(p => p.parameterName === selected)
    : parameters[0] ?? null;

  if (!selected && parameters.length > 0 && selectedParam) {
    // auto-select first without causing render loop — handled via useMemo key
  }

  const activeParamName = selectedParam?.parameterName ?? null;

  const { data: measurementsData, isLoading: measLoading } = useQuery({
    queryKey: ['quality', 'spc', 'measurements', activeParamName],
    queryFn: () => api.get('/quality/spc/measurements', {
      params: { parameterId: activeParamName, limit: 30 },
    }),
    enabled: !!activeParamName,
    staleTime: 30_000,
  });

  const rawMeasurements: SPCMeasurement[] = (measurementsData as any) ?? [];
  const measurements = [...rawMeasurements].reverse();

  const chartData = measurements.map((m, i) => ({
    sample: m.subgroupNumber ?? i + 1,
    value: m.value,
    isOutOfControl: m.isOutOfControl,
  }));

  const paramValues = measurements.map(m => m.value);
  const ucl = selectedParam?.ucl ?? measurements[0]?.ucl ?? null;
  const lcl = selectedParam?.lcl ?? measurements[0]?.lcl ?? null;
  const cl  = selectedParam?.mean ?? measurements[0]?.cl ?? null;

  const cpk = useMemo(() => {
    if (ucl == null || lcl == null || cl == null || paramValues.length < 2) return 0;
    return computeCpk(paramValues, ucl, lcl, cl);
  }, [paramValues, ucl, lcl, cl]);

  const status: Status = useMemo(() => {
    return computeStatus(rawMeasurements, cpk);
  }, [rawMeasurements, cpk]);

  const unit = selectedParam?.unit ?? '';

  const StatusIcon = selectedParam ? STATUS_CFG[status].icon : Activity;

  if (paramsLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
          <div>
            <h1 className="text-lg font-bold">{t('headers.spc.title')}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{t('headers.spc.subtitle')}</p>
          </div>
        </div>
        <div className="flex-1 p-6 grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="industrial-card rounded-xl p-4">
              <div className="shimmer h-4 rounded w-24 mb-3" />
              <div className="shimmer h-8 rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (parameters.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
          <div>
            <h1 className="text-lg font-bold">SPC Control Charts</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Statistical process control — monitor process stability</p>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No SPC measurements recorded yet</p>
            <p className="text-xs mt-1">Measurements will appear here once IoT devices start recording quality data</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">SPC Control Charts</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Statistical process control — monitor process stability and capability</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* Parameter selector */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {parameters.map((p) => {
            const isSelected = (selected ?? parameters[0]?.parameterName) === p.parameterName;
            return (
              <button
                key={p.parameterName}
                onClick={() => setSelected(p.parameterName)}
                className={cn(
                  'industrial-card rounded-xl p-4 text-left transition-all',
                  isSelected && 'border-brand-500/60 bg-brand-500/5',
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium truncate">{p.parameterName}</span>
                  <Activity size={13} className="text-muted-foreground shrink-0" />
                </div>
                <div className="text-xs text-muted-foreground">Samples</div>
                <div className="text-2xl font-bold text-foreground">{p.sampleCount}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{p.unit ?? 'unit'}</div>
              </button>
            );
          })}
        </div>

        {/* Main chart */}
        {selectedParam && (
          <div className="industrial-card rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold">{selectedParam.parameterName} — X-bar Control Chart</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {ucl != null && <>UCL: {ucl.toFixed(4)} {unit} &nbsp;|&nbsp;</>}
                  {cl  != null && <>Mean: {cl.toFixed(4)} {unit} &nbsp;|&nbsp;</>}
                  {lcl != null && <>LCL: {lcl.toFixed(4)} {unit}</>}
                </p>
              </div>
              <div className={cn('flex items-center gap-1.5 text-xs font-semibold', STATUS_CFG[status].color)}>
                <StatusIcon size={13} />
                {STATUS_CFG[status].label}
              </div>
            </div>

            {measLoading ? (
              <div className="h-[280px] flex items-center justify-center">
                <div className="shimmer h-full w-full rounded-lg" />
              </div>
            ) : chartData.length === 0 ? (
              <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                No measurement data for this parameter
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="sample"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    label={{ value: 'Sample', position: 'insideBottom', offset: -2, fontSize: 11, fill: '#64748b' }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    domain={['auto', 'auto']}
                    unit={unit ? ` ${unit}` : ''}
                  />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                    formatter={(v: number) => [`${v} ${unit}`, 'Value']}
                  />
                  {ucl != null && (
                    <ReferenceLine y={ucl} stroke="#ef4444" strokeDasharray="6 3" label={{ value: 'UCL', fill: '#ef4444', fontSize: 10 }} />
                  )}
                  {cl != null && (
                    <ReferenceLine y={cl} stroke="#6366f1" strokeDasharray="4 4" label={{ value: 'CL', fill: '#6366f1', fontSize: 10 }} />
                  )}
                  {lcl != null && (
                    <ReferenceLine y={lcl} stroke="#ef4444" strokeDasharray="6 3" label={{ value: 'LCL', fill: '#ef4444', fontSize: 10 }} />
                  )}
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={(props: any) => {
                      const d = chartData[props.index];
                      return (
                        <circle
                          key={props.index}
                          cx={props.cx}
                          cy={props.cy}
                          r={4}
                          fill={d?.isOutOfControl ? '#ef4444' : '#22c55e'}
                          stroke={d?.isOutOfControl ? '#ef4444' : '#22c55e'}
                        />
                      );
                    }}
                    activeDot={{ r: 5 }}
                    name="Value"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        {/* Capability summary */}
        {selectedParam && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Cpk',  value: cpk,  isGood: cpk >= 1.33  },
              { label: 'UCL',  value: ucl != null ? `${ucl.toFixed(4)} ${unit}` : '—', isGood: true },
              { label: 'Mean', value: cl  != null ? `${cl.toFixed(4)} ${unit}`  : '—', isGood: true },
              { label: 'LCL',  value: lcl != null ? `${lcl.toFixed(4)} ${unit}` : '—', isGood: true },
            ].map(s => (
              <div key={s.label} className="industrial-card rounded-xl p-3 text-center">
                <div className="text-xs text-muted-foreground">{s.label}</div>
                <div className={cn('text-lg font-bold mt-0.5', !s.isGood ? 'text-red-400' : 'text-foreground')}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
