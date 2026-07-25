'use client';

/**
 * DowntimeReasonList — recorded downtime events with inline reason / sub-reason
 * attribution. Solves the "assign a reason to a PAST stoppage" requirement: the
 * system auto-records downtime (from machine state) often WITHOUT a reason; here an
 * operator/supervisor picks an event and sets its reason + sub-reason from the
 * predefined cause tree. Reuses the shared CauseTreeSelect and the existing
 * PATCH /production/downtime/events/:id endpoint (production:execute) — no backend
 * change. Tablet-friendly (large targets; the tree picker no longer traps the
 * on-screen keyboard).
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, CheckCircle2, ChevronDown, Loader2, Tag, Square } from 'lucide-react';

import { api } from '@/services/api.client';
import { useToast } from '@/components/ui/use-toast';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  CauseTreeSelect,
  type ReasonNode, type CauseSelection,
} from '@/features/production/production-downtime-view';

type DowntimeEvent = {
  id: string;
  machineId: string;
  machine: { id: string; name: string; code: string } | null;
  workOrder: { id: string; orderNumber: string } | null;
  cause: { id: string; name: string; parent?: { name: string; parent?: { name: string } } } | null;
  category: string;
  reasonCode: string;
  reason: string | null;
  startTime: string;
  endTime: string | null;
  durationMinutes: number | null;
  isOpen: boolean;
  isPlanned: boolean;
};

function fmtWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtDur(mins: number | null, isOpen: boolean) {
  if (isOpen) return 'ongoing';
  if (mins == null) return '—';
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${Math.round(mins % 60)}m`;
}
function causePath(c: DowntimeEvent['cause']): string | null {
  if (!c) return null;
  const parts = [c.parent?.parent?.name, c.parent?.name, c.name].filter(Boolean);
  return parts.join(' › ');
}
// datetime-local value (local time, no seconds) from an ISO string / now.
function toLocalInput(iso?: string) {
  const d = iso ? new Date(iso) : new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Close an open downtime with an operator-adjustable end time (defaults to now,
// floored to the event's start so a negative duration is impossible).
function CloseRow({ start, onClose, pending }: { start: string; onClose: (endTime: string) => void; pending: boolean }) {
  const [end, setEnd] = useState(() => toLocalInput());
  const minEnd = toLocalInput(start);
  return (
    <div className="mt-2 rounded-lg bg-muted/30 p-2.5">
      <div className="text-[11px] font-medium text-red-400 mb-1.5 flex items-center gap-1.5"><Square size={11} /> Close this downtime</div>
      <div className="flex items-center gap-2">
        <input
          type="datetime-local"
          value={end}
          min={minEnd}
          onChange={(ev) => setEnd(ev.target.value)}
          className="flex-1 h-9 text-sm rounded-lg bg-background border border-border px-2 focus:outline-none focus:border-red-400"
        />
        <button
          disabled={pending || !end || end < minEnd}
          onClick={() => onClose(end)}
          className="h-9 px-3 rounded-lg bg-red-500 text-white text-sm font-semibold active:scale-95 disabled:opacity-50"
        >
          {pending ? '…' : 'Close'}
        </button>
      </div>
    </div>
  );
}

export function DowntimeReasonList({
  machineIds,
  workOrderId,
  limit = 40,
  className,
}: {
  /** Restrict to these machines (client-side filter). Omit = whole factory. */
  machineIds?: string[];
  workOrderId?: string;
  limit?: number;
  className?: string;
}) {
  const { t } = useTranslation('production');
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Last 7 days of events, newest first. Factory-scoped; filtered to machineIds below.
  const dateFrom = useMemo(() => new Date(Date.now() - 7 * 86_400_000).toISOString(), []);
  const { data, isLoading } = useQuery({
    queryKey: ['downtime-events', workOrderId ?? 'all', dateFrom, limit],
    queryFn: () => api.get('/production/downtime/events', {
      params: { ...(workOrderId ? { workOrderId } : {}), dateFrom, limit },
    }),
    refetchInterval: 20_000,
  });

  const { data: reasonTree = [] } = useQuery<ReasonNode[]>({
    queryKey: ['downtime-reason-tree'],
    queryFn: () => api.get('/production/downtime/reasons/tree'),
    staleTime: 300_000,
  });

  const events: DowntimeEvent[] = useMemo(() => {
    const all: DowntimeEvent[] = ((data as any)?.data ?? []);
    return machineIds?.length ? all.filter((e) => machineIds.includes(e.machineId)) : all;
  }, [data, machineIds]);

  const setReason = useMutation({
    mutationFn: ({ id, causeId, category }: { id: string; causeId: string; category: string }) =>
      api.patch(`/production/downtime/events/${id}`, { causeId, category }),
    onSuccess: () => {
      toast({ title: t('dlive.toastLogged', { defaultValue: 'Reason saved' }) });
      qc.invalidateQueries({ queryKey: ['downtime-events'] });
      qc.invalidateQueries({ queryKey: ['downtime'] });
      setExpandedId(null);
    },
    onError: (e: any) =>
      toast({ variant: 'destructive', title: 'Failed to save reason', description: e?.response?.data?.message }),
  });

  const closeEvent = useMutation({
    mutationFn: ({ id, endTime }: { id: string; endTime: string }) =>
      api.patch(`/production/downtime/events/${id}/end`, { endTime: new Date(endTime).toISOString() }),
    onSuccess: () => {
      toast({ title: 'Downtime closed' });
      qc.invalidateQueries({ queryKey: ['downtime-events'] });
      qc.invalidateQueries({ queryKey: ['downtime'] });
      qc.invalidateQueries({ queryKey: ['machine-states-3d'] });
      qc.invalidateQueries({ queryKey: ['machine-states'] });
    },
    onError: (e: any) =>
      toast({ variant: 'destructive', title: 'Failed to close downtime', description: e?.response?.data?.message }),
  });

  const onCause = (eventId: string) => (_id: string, sel: CauseSelection | null) => {
    if (sel) setReason.mutate({ id: eventId, causeId: _id, category: sel.category });
  };

  return (
    <div className={cn('flex flex-col', className)}>
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground p-4 text-sm">
          <Loader2 className="animate-spin" size={15} /> Loading downtime events…
        </div>
      ) : events.length === 0 ? (
        <div className="text-center text-muted-foreground/70 py-8 text-sm">
          No downtime events recorded in the last 7 days.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((e) => {
            const hasReason = !!e.cause || !!e.reason;
            const expanded = expandedId === e.id;
            const busy = setReason.isPending && expandedId === e.id;
            return (
              <li key={e.id} className="rounded-xl border border-border/60 bg-card overflow-hidden">
                <button
                  onClick={() => setExpandedId(expanded ? null : e.id)}
                  className="w-full flex items-center gap-3 p-3 text-start active:bg-accent/40 transition"
                >
                  <div className={cn(
                    'flex items-center justify-center w-10 h-10 rounded-xl shrink-0',
                    e.isOpen ? 'bg-red-500/15 text-red-400' : e.isPlanned ? 'bg-blue-500/15 text-blue-400' : 'bg-amber-500/15 text-amber-400',
                  )}>
                    <AlertTriangle size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-foreground truncate">
                        {e.machine?.code ?? e.machine?.name ?? 'Machine'}
                      </span>
                      {e.isOpen && <Badge variant="destructive" className="h-4 text-[10px]">OPEN</Badge>}
                      {e.workOrder && <span className="text-[11px] font-mono text-brand-400/70">{e.workOrder.orderNumber}</span>}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                      <Clock size={11} /> {fmtWhen(e.startTime)} · {fmtDur(e.durationMinutes, e.isOpen)}
                    </div>
                    <div className="mt-1">
                      {hasReason ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400">
                          <CheckCircle2 size={12} /> {causePath(e.cause) ?? e.reason}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-400 font-medium">
                          <Tag size={12} /> No reason set — tap to add
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronDown size={16} className={cn('text-muted-foreground shrink-0 transition-transform', expanded && 'rotate-180')} />
                </button>

                {expanded && (
                  <div className="p-3 pt-0 border-t border-border/50">
                    {/* Close an OPEN downtime with an adjustable end time */}
                    {e.isOpen && (
                      <CloseRow
                        start={e.startTime}
                        pending={closeEvent.isPending}
                        onClose={(endTime) => closeEvent.mutate({ id: e.id, endTime })}
                      />
                    )}

                    <div className="text-[11px] font-medium text-muted-foreground mb-1.5 mt-3">
                      {hasReason ? 'Change reason / sub-reason' : 'Select reason / sub-reason'}
                    </div>
                    {busy ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                        <Loader2 className="animate-spin" size={14} /> Saving…
                      </div>
                    ) : (
                      <CauseTreeSelect
                        reasonTree={reasonTree}
                        value={e.cause?.id ?? ''}
                        machineId={e.machineId || undefined}
                        onChange={onCause(e.id)}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
