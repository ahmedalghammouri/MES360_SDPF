'use client';
import { useTranslation } from 'react-i18next';

import { useState, useMemo } from 'react';
import { Archive, Search, RotateCcw, Inbox } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';

interface EntityDef { slug: string; label: string }
interface ArchivedRow { id: string; primary: string; secondary: string | null; archivedAt: string }

export function ArchiveView() {
  const { t } = useTranslation('modules');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [entity, setEntity] = useState<string>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: entities } = useQuery({
    queryKey: ['archive', 'entities'],
    queryFn: () => api.get<EntityDef[]>('/archive/entities'),
    staleTime: 300_000,
  });
  const { data: counts } = useQuery({
    queryKey: ['archive', 'counts'],
    queryFn: () => api.get<Record<string, number>>('/archive/counts'),
    staleTime: 30_000,
  });

  const entityList = (entities as EntityDef[]) ?? [];
  const activeEntity = entity || entityList[0]?.slug || '';

  const { data, isLoading } = useQuery({
    queryKey: ['archive', 'rows', activeEntity, { search, page }],
    queryFn: () => api.get<any>(`/archive/${activeEntity}`, { params: { search: search || undefined, page, limit: 20 } }),
    enabled: !!activeEntity,
    staleTime: 10_000,
  });

  const rows: ArchivedRow[] = (data as any)?.data ?? [];
  const total: number = (data as any)?.total ?? 0;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['archive'] });
    setSelected(new Set());
  };
  const err = (e: any) => toast({ variant: 'destructive', title: 'Error', description: e?.response?.data?.message ?? 'Failed' });

  const restoreOne = useMutation({
    mutationFn: (id: string) => api.patch(`/archive/${activeEntity}/${id}/restore`, {}),
    onSuccess: () => { invalidate(); toast({ title: 'Restored' }); },
    onError: err,
  });
  const bulkRestore = useMutation({
    mutationFn: (ids: string[]) => api.post(`/archive/${activeEntity}/bulk-restore`, { ids }),
    onSuccess: (r: any) => { invalidate(); toast({ title: `Restored ${r?.count ?? ''} record(s)` }); },
    onError: err,
  });

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)));
  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const totalArchived = useMemo(() => Object.values((counts as any) ?? {}).reduce((s: number, n: any) => s + (n || 0), 0), [counts]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><Archive size={18} className="text-primary" /> {t('archive.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('archive.subtitle')}</p>
        </div>
        <Badge variant="outline" className="text-xs">{totalArchived} archived</Badge>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Entity selector */}
        <div className="flex flex-wrap gap-2">
          {entityList.map((e) => {
            const c = (counts as any)?.[e.slug] ?? 0;
            return (
              <button
                key={e.slug}
                onClick={() => { setEntity(e.slug); setPage(1); setSelected(new Set()); }}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs border transition-colors flex items-center gap-1.5',
                  e.slug === activeEntity ? 'bg-primary/15 border-primary/40 text-primary' : 'border-border/50 text-muted-foreground hover:bg-muted/30',
                )}
              >
                {e.label}
                {c > 0 && <span className="text-[10px] px-1 rounded bg-foreground/10">{c}</span>}
              </button>
            );
          })}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search archived…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="h-8 pl-7 w-60 text-xs" />
          </div>
          {selected.size > 0 && (
            <Button size="sm" className="h-8 text-xs gap-1.5" disabled={bulkRestore.isPending} onClick={() => bulkRestore.mutate([...selected])}>
              <RotateCcw size={13} /> Restore {selected.size} selected
            </Button>
          )}
        </div>

        {/* Table */}
        <div className="rounded-lg border border-border/30 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border/30">
                <TableHead className="w-10"><Checkbox checked={allChecked} onCheckedChange={toggleAll} aria-label="Select all" /></TableHead>
                <TableHead className="text-[11px] font-semibold">Record</TableHead>
                <TableHead className="text-[11px] font-semibold">Detail</TableHead>
                <TableHead className="text-[11px] font-semibold">Archived</TableHead>
                <TableHead className="text-[11px] font-semibold text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i} className="border-border/20">{Array.from({ length: 5 }).map((_, j) => <TableCell key={j}><div className="shimmer h-3.5 rounded w-16" /></TableCell>)}</TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground text-sm">
                  <Inbox size={20} className="mx-auto mb-2 opacity-50" /> No archived records in this entity
                </TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id} className="border-border/20 hover:bg-muted/20" data-state={selected.has(r.id) ? 'selected' : undefined}>
                  <TableCell><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label="Select row" /></TableCell>
                  <TableCell className="font-mono text-xs font-semibold text-primary">{r.primary}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">{r.secondary ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.archivedAt ? new Date(r.archivedAt).toLocaleString() : '—'}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={restoreOne.isPending} onClick={() => restoreOne.mutate(r.id)}>
                      <RotateCcw size={12} /> Restore
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <TablePagination page={page} total={total} limit={20} onPageChange={setPage} isLoading={isLoading} />
      </div>
    </div>
  );
}
