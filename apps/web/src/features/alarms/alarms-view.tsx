'use client';
import { useTranslation } from 'react-i18next';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlarmClock, AlertTriangle, AlertOctagon, Info, Bell,
  CheckCircle2, Check, RefreshCw, Filter, Cpu, Clock, Timer,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { KPICard } from '@/components/widgets/kpi-card';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api.client';
import { cn, timeAgo, formatDateTime } from '@/lib/utils';

// ── Config ──────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<
  string,
  { label: string; icon: typeof Info; color: string; bg: string; badge: string }
> = {
  CRITICAL: { label: 'Critical', icon: AlertOctagon,  color: 'text-danger-400',  bg: 'bg-danger-500/15',  badge: 'bg-danger-500/15 text-danger-400 border-danger-500/30' },
  HIGH:     { label: 'High',     icon: AlertTriangle, color: 'text-orange-400',  bg: 'bg-orange-500/15',  badge: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  MEDIUM:   { label: 'Medium',   icon: AlertTriangle, color: 'text-warning-400', bg: 'bg-warning-500/15', badge: 'bg-warning-500/15 text-warning-400 border-warning-500/30' },
  LOW:      { label: 'Low',      icon: Info,          color: 'text-brand-400',   bg: 'bg-brand-500/15',   badge: 'bg-brand-500/15 text-brand-400 border-brand-500/30' },
  INFO:     { label: 'Info',     icon: Info,          color: 'text-blue-400',    bg: 'bg-blue-500/15',    badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
};

const SEVERITY_FILTERS = [
  { label: 'All',      value: 'all'      },
  { label: 'Critical', value: 'CRITICAL' },
  { label: 'High',     value: 'HIGH'     },
  { label: 'Medium',   value: 'MEDIUM'   },
  { label: 'Low',      value: 'LOW'      },
  { label: 'Info',     value: 'INFO'     },
];

// ── Types ───────────────────────────────────────────────────────

interface AlarmEvent {
  id: string;
  code: string;
  description: string;
  severity: string;
  category: string | null;
  triggeredAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  durationMinutes: number | null;
  notes: string | null;
  machine: { id: string; name: string; code: string } | null;
}

interface AlarmKpis {
  active: number;
  unacknowledged: number;
  critical: number;
  last24h: number;
  avgResolutionMins: number | null;
}

// ── Helpers ─────────────────────────────────────────────────────

function fmtDuration(mins: number | null): string {
  if (mins == null) return '—';
  if (mins < 1) return '<1m';
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function alarmState(a: AlarmEvent): 'active' | 'acknowledged' | 'resolved' {
  if (a.resolvedAt) return 'resolved';
  if (a.acknowledgedAt) return 'acknowledged';
  return 'active';
}

// ── Component ───────────────────────────────────────────────────

export function AlarmsView() {
  const { t } = useTranslation('modules');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ── Data ──────────────────────────────────────────────────────

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['alarms', 'kpis'],
    queryFn: () => api.get<AlarmKpis>('/alarms/kpis'),
    refetchInterval: 30_000,
  });

  const {
    data: alarms,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['alarms', { severityFilter, activeOnly }],
    queryFn: () =>
      api.get<AlarmEvent[]>('/alarms', {
        params: {
          limit: 200,
          ...(severityFilter !== 'all' ? { severity: severityFilter } : {}),
          ...(activeOnly ? { active: true } : {}),
        },
      }),
    refetchInterval: 30_000,
  });

  const list: AlarmEvent[] = Array.isArray(alarms) ? alarms : [];

  // ── Mutations ─────────────────────────────────────────────────

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['alarms'] });
    queryClient.invalidateQueries({ queryKey: ['sidebar-counts'] });
  };

  const ackMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/alarms/${id}/acknowledge`),
    onSuccess: () => {
      invalidate();
      toast({ title: 'Alarm acknowledged', variant: 'success' });
    },
    onError: () => toast({ title: 'Failed to acknowledge alarm', variant: 'destructive' }),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/alarms/${id}/resolve`),
    onSuccess: () => {
      invalidate();
      toast({ title: 'Alarm resolved', variant: 'success' });
    },
    onError: () => toast({ title: 'Failed to resolve alarm', variant: 'destructive' }),
  });

  const pendingId =
    (ackMutation.isPending && ackMutation.variables) ||
    (resolveMutation.isPending && resolveMutation.variables) ||
    null;

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <AlarmClock size={18} className="text-primary" />
            {t('alarms.title')}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Live equipment &amp; process alarms — acknowledge, resolve, and track resolution time
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="gap-1.5 h-8 text-xs"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <KPICard title="Active" value={kpis?.active ?? 0} colorMode="alarm" isLoading={kpisLoading} icon={<Bell size={16} />} />
          <KPICard title="Unacknowledged" value={kpis?.unacknowledged ?? 0} colorMode="alarm" isLoading={kpisLoading} icon={<AlertTriangle size={16} />} />
          <KPICard title="Critical" value={kpis?.critical ?? 0} colorMode="alarm" isLoading={kpisLoading} icon={<AlertOctagon size={16} />} />
          <KPICard title="Last 24h" value={kpis?.last24h ?? 0} isLoading={kpisLoading} icon={<Clock size={16} />} />
          <KPICard title="Avg Resolution" value={kpis?.avgResolutionMins ?? 0} unit="min" isLoading={kpisLoading} icon={<Timer size={16} />} />
        </div>

        {/* Filters */}
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground w-16 shrink-0">Severity</span>
            {SEVERITY_FILTERS.map((f) => (
              <Button
                key={f.value}
                variant={severityFilter === f.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSeverityFilter(f.value)}
                className="h-7 text-xs"
              >
                {f.label}
              </Button>
            ))}
            <Button
              variant={activeOnly ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveOnly((v) => !v)}
              className="h-7 text-xs ml-auto gap-1.5"
            >
              <Filter className="w-3 h-3" />
              Active only
            </Button>
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="glass-card rounded-xl p-12 text-center text-muted-foreground">
            <RefreshCw className="w-8 h-8 mx-auto mb-3 opacity-40 animate-spin" />
            <div className="text-sm">Loading alarms…</div>
          </div>
        ) : list.length === 0 ? (
          <div className="glass-card rounded-xl p-16 text-center">
            <div className="w-16 h-16 rounded-full bg-success-500/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-success-400/60" />
            </div>
            <div className="font-semibold text-foreground/70 text-base">
              {severityFilter !== 'all' || activeOnly ? t('alarms.noMatch') : t('alarms.noAlarms')}
            </div>
            <div className="text-muted-foreground text-sm mt-1.5">
              {severityFilter !== 'all' || activeOnly
                ? 'Try clearing your filters to see the full history.'
                : 'Equipment and process alarms will appear here when triggered.'}
            </div>
            {(severityFilter !== 'all' || activeOnly) && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => { setSeverityFilter('all'); setActiveOnly(false); }}
              >
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <div className="glass-card rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[130px]">{t('alarms.col.severity')}</TableHead>
                  <TableHead>{t('alarms.col.alarm')}</TableHead>
                  <TableHead className="w-[180px]">{t('alarms.col.machine')}</TableHead>
                  <TableHead className="w-[150px]">{t('alarms.col.triggered')}</TableHead>
                  <TableHead className="w-[130px]">{t('alarms.col.status')}</TableHead>
                  <TableHead className="w-[90px]">{t('alarms.col.duration')}</TableHead>
                  <TableHead className="w-[180px] text-end">{t('alarms.col.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <AnimatePresence initial={false}>
                  {list.map((alarm) => {
                    const cfg = SEVERITY_CONFIG[alarm.severity] ?? SEVERITY_CONFIG.INFO;
                    const Icon = cfg.icon;
                    const state = alarmState(alarm);
                    const rowBusy = pendingId === alarm.id;

                    return (
                      <motion.tr
                        key={alarm.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className={cn(
                          'border-b border-border/50 transition-colors hover:bg-foreground/[0.03]',
                          state === 'active' && 'bg-danger-500/[0.04]',
                          state === 'resolved' && 'opacity-60',
                        )}
                      >
                        {/* Severity */}
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', cfg.bg)}>
                              <Icon className={cn('w-3.5 h-3.5', cfg.color)} />
                            </div>
                            <span className={cn('text-xs font-medium', cfg.color)}>{cfg.label}</span>
                          </div>
                        </TableCell>

                        {/* Alarm code + description */}
                        <TableCell>
                          <div className="font-medium text-sm">{alarm.description}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <code className="text-[10px] text-muted-foreground bg-muted/50 px-1 py-0.5 rounded">
                              {alarm.code}
                            </code>
                            {alarm.category && (
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                                {alarm.category}
                              </span>
                            )}
                          </div>
                        </TableCell>

                        {/* Machine */}
                        <TableCell>
                          {alarm.machine ? (
                            <div className="flex items-center gap-1.5 text-xs">
                              <Cpu size={12} className="text-muted-foreground shrink-0" />
                              <span className="truncate">{alarm.machine.name}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        {/* Triggered */}
                        <TableCell>
                          <div className="text-xs" title={formatDateTime(alarm.triggeredAt)}>
                            {timeAgo(alarm.triggeredAt)}
                          </div>
                        </TableCell>

                        {/* Status */}
                        <TableCell>
                          {state === 'active' && (
                            <Badge variant="destructive" className="text-[10px] gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-white/90 animate-pulse" />
                              Active
                            </Badge>
                          )}
                          {state === 'acknowledged' && (
                            <Badge variant="secondary" className="text-[10px]">Acknowledged</Badge>
                          )}
                          {state === 'resolved' && (
                            <Badge variant="outline" className="text-[10px] text-success-400 border-success-500/30">
                              Resolved
                            </Badge>
                          )}
                        </TableCell>

                        {/* Duration */}
                        <TableCell>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {fmtDuration(alarm.durationMinutes)}
                          </span>
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {!alarm.acknowledgedAt && !alarm.resolvedAt && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1"
                                disabled={rowBusy}
                                onClick={() => ackMutation.mutate(alarm.id)}
                              >
                                <Check size={12} />
                                Ack
                              </Button>
                            )}
                            {!alarm.resolvedAt && (
                              <Button
                                size="sm"
                                className="h-7 text-xs gap-1"
                                disabled={rowBusy}
                                onClick={() => resolveMutation.mutate(alarm.id)}
                              >
                                <CheckCircle2 size={12} />
                                Resolve
                              </Button>
                            )}
                            {alarm.resolvedAt && (
                              <span className="text-[11px] text-muted-foreground">
                                {timeAgo(alarm.resolvedAt)}
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </TableBody>
            </Table>
          </div>
        )}

        {/* Footer count */}
        {list.length > 0 && (
          <div className="text-xs text-muted-foreground text-center">
            {list.length} alarm{list.length === 1 ? '' : 's'}
            {activeOnly ? ' · active only' : ''}
            {severityFilter !== 'all' ? ` · ${SEVERITY_CONFIG[severityFilter]?.label ?? severityFilter}` : ''}
          </div>
        )}
      </div>
    </div>
  );
}
