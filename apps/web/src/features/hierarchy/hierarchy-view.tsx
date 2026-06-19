'use client';
import { useTranslation } from 'react-i18next';

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Layers, Cpu, Activity, ChevronRight, ChevronDown, Circle,
  Plus, Pencil, Trash2, MoreVertical, X, Settings, AlertTriangle,
} from 'lucide-react';
import { api } from '@/services/api.client';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EntityPicker } from '@/components/ui/entity-picker';
import { toast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface HierarchyNode {
  id: string;
  name: string;
  type: 'FACTORY' | 'AREA' | 'PRODUCTION_LINE' | 'MACHINE';
  code?: string;
  machineType?: string;
  state?: string;
  oee?: number;
  // Editable attributes (surfaced by /hierarchy/tree for the Edit dialog)
  areaType?: string;
  lineType?: string;
  criticality?: string;
  manufacturer?: string | null;
  designCapacity?: number | null;
  areaId?: string | null;
  lineId?: string | null;
  children?: HierarchyNode[];
}

interface Area { id: string; name: string; code: string; type: string }
interface Line { id: string; name: string; code: string; type: string; areaId: string }

const TYPE_CFG = {
  FACTORY:         { icon: Building2, color: 'text-brand-400',  bg: 'bg-brand-500/20',  label: 'Factory'         },
  AREA:            { icon: Layers,    color: 'text-blue-400',   bg: 'bg-blue-500/20',   label: 'Area'            },
  PRODUCTION_LINE: { icon: Activity,  color: 'text-cyan-400',   bg: 'bg-cyan-500/20',   label: 'Production Line' },
  MACHINE:         { icon: Cpu,       color: 'text-green-400',  bg: 'bg-green-500/20',  label: 'Machine'         },
} as const;

const STATE_COLORS: Record<string, string> = {
  RUNNING: 'text-green-400', IDLE: 'text-amber-400', FAULT: 'text-red-400',
  MAINTENANCE: 'text-blue-400', OFFLINE: 'text-gray-400',
};

const AREA_TYPES = ['MAKING', 'PACKING', 'FILLING', 'UTILITY', 'WAREHOUSE', 'LABORATORY', 'OFFICE'];
const LINE_TYPES = ['PACKING', 'FILLING', 'MAKING', 'BLOW_MOLDING', 'BLOW_FILM', 'AEROSOL', 'CUTTING_SEALING', 'UTILITY'];
const MACHINE_TYPES = [
  'MACHINE', 'FILLING_MACHINE', 'CARTONING_MACHINE', 'CHECKWEIGHER', 'ROBOT', 'WRAPPING_MACHINE',
  'PALLETIZER', 'BLOW_MOLDING', 'CONVEYOR', 'COMPRESSOR', 'BOILER', 'TRANSFORMER',
  'CHILLER', 'PUMP', 'MIXER', 'REACTOR', 'SENSOR', 'GATEWAY', 'HMI',
];
const CRITICALITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

type NodeType = 'AREA' | 'PRODUCTION_LINE' | 'MACHINE';

const EMPTY_FORM = {
  type: 'MACHINE' as NodeType,
  name: '', code: '',
  areaType: 'PACKING', lineType: 'PACKING',
  machineType: 'MACHINE', criticality: 'MEDIUM',
  areaId: '__none__', lineId: '__none__',
  manufacturer: '', designCapacity: '',
};

function TreeNode({
  node, depth = 0, onEdit, onDelete,
}: { node: HierarchyNode; depth?: number; onEdit: (n: HierarchyNode) => void; onDelete: (n: HierarchyNode) => void }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const cfg = TYPE_CFG[node.type] ?? TYPE_CFG.MACHINE;
  const Icon = cfg.icon;
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      <div
        className={cn('flex items-center gap-2 py-2 px-3 rounded-lg group cursor-pointer hover:bg-foreground/5 transition-colors')}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        <span className="text-muted-foreground w-4 shrink-0">
          {hasChildren
            ? expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />
            : null}
        </span>

        <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', cfg.bg)}>
          <Icon className={cn('w-3.5 h-3.5', cfg.color)} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{node.name}</span>
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 shrink-0">{cfg.label}</Badge>
            {node.code && <span className="text-[10px] font-mono text-muted-foreground">{node.code}</span>}
          </div>
          {node.machineType && (
            <div className="text-[11px] text-muted-foreground mt-0.5">{node.machineType.replace(/_/g, ' ')}</div>
          )}
        </div>

        {node.state && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Circle className={cn('w-2 h-2 fill-current', STATE_COLORS[node.state] ?? 'text-gray-400')} />
            {node.oee != null && (
              <span className="text-[10px] text-muted-foreground font-mono">{node.oee.toFixed(1)}%</span>
            )}
          </div>
        )}

        {node.type !== 'FACTORY' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0">
                <MoreVertical className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-xs">
              <DropdownMenuItem onClick={e => { e.stopPropagation(); onEdit(node); }}>
                <Pencil className="w-3 h-3 mr-2" /> Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={e => { e.stopPropagation(); onDelete(node); }} className="text-destructive">
                <Trash2 className="w-3 h-3 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {expanded && hasChildren && (
        <div>
          {node.children!.map(child => (
            <TreeNode key={child.id} node={child} depth={depth + 1} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

export function HierarchyView() {
  const { t } = useTranslation('modules');
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editNode, setEditNode] = useState<HierarchyNode | null>(null);
  const [deleteNode, setDeleteNode] = useState<HierarchyNode | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: tree, isLoading } = useQuery({
    queryKey: ['hierarchy-tree'],
    queryFn: () => api.get('/hierarchy/tree'),
    staleTime: 30_000,
  });

  const { data: areasData } = useQuery({
    queryKey: ['hierarchy', 'areas'],
    queryFn: () => api.get('/hierarchy/areas'),
    staleTime: 60_000,
    enabled: formOpen,
  });

  const { data: linesData } = useQuery({
    queryKey: ['hierarchy', 'lines', form.areaId],
    queryFn: () => api.get('/hierarchy/lines', { params: { areaId: form.areaId || undefined } }),
    staleTime: 60_000,
    enabled: formOpen && form.type === 'MACHINE',
  });

  const areas: Area[] = (areasData as any) ?? [];
  const lines: Line[] = (linesData as any) ?? [];

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/hierarchy', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hierarchy-tree'] });
      qc.invalidateQueries({ queryKey: ['hierarchy', 'areas'] });
      qc.invalidateQueries({ queryKey: ['hierarchy', 'lines'] });
      toast({ title: 'Node created successfully' });
      setFormOpen(false);
      setForm(EMPTY_FORM);
    },
    onError: (e: any) => toast({ title: 'Failed to create node', description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/hierarchy/${id}`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hierarchy-tree'] });
      qc.invalidateQueries({ queryKey: ['hierarchy', 'areas'] });
      toast({ title: 'Node updated successfully' });
      setEditNode(null);
    },
    onError: (e: any) => toast({ title: 'Failed to update node', description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, type }: { id: string; type: string }) =>
      api.delete(`/hierarchy/${id}`, { data: { type } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hierarchy-tree'] });
      toast({ title: 'Node removed from hierarchy' });
      setDeleteNode(null);
    },
    onError: (e: any) => toast({ title: 'Delete failed', description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const openCreate = () => {
    setEditNode(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (node: HierarchyNode) => {
    setEditNode(node);
    setForm({
      ...EMPTY_FORM,
      type: node.type as NodeType,
      name: node.name,
      code: node.code ?? '',
      areaType: node.areaType ?? 'PACKING',
      lineType: node.lineType ?? 'PACKING',
      machineType: node.machineType ?? 'MACHINE',
      criticality: node.criticality ?? 'MEDIUM',
      areaId: node.areaId ?? '__none__',
      lineId: node.lineId ?? '__none__',
      manufacturer: node.manufacturer ?? '',
      designCapacity: node.designCapacity != null ? String(node.designCapacity) : '',
    });
    setFormOpen(true);
  };

  const none = '__none__';
  const val = (v: string) => (v === none || v === '' ? undefined : v);

  const handleSubmit = () => {
    const dto: any = { type: form.type, name: form.name };
    if (!editNode) dto.code = form.code;

    if (form.type === 'AREA') {
      dto.areaType = form.areaType;
    } else if (form.type === 'PRODUCTION_LINE') {
      dto.lineType = form.lineType;
      dto.areaId = val(form.areaId);
    } else if (form.type === 'MACHINE') {
      dto.machineType = form.machineType;
      dto.criticality = form.criticality;
      if (val(form.areaId)) dto.areaId = val(form.areaId);
      if (val(form.lineId)) dto.lineId = val(form.lineId);
      if (form.manufacturer) dto.manufacturer = form.manufacturer;
      if (form.designCapacity) dto.designCapacity = form.designCapacity;
    }

    if (editNode) {
      updateMutation.mutate({ id: editNode.id, dto });
    } else {
      createMutation.mutate(dto);
    }
  };

  const isValid = !!form.name && (editNode ? true : !!form.code) &&
    (form.type !== 'PRODUCTION_LINE' || (!!form.areaId && form.areaId !== none));

  const nodes: HierarchyNode[] = Array.isArray(tree)
    ? tree as HierarchyNode[]
    : tree ? [tree as HierarchyNode] : [];

  const nodeTypeLabel = (t: NodeType) => TYPE_CFG[t]?.label ?? t;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('hierarchy.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('hierarchy.subtitle')}</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="w-4 h-4" /> Add Node
        </Button>
      </div>

      <InlineFormSlot />

      {/* Tree */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Hierarchy Tree</h2>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {(Object.keys(TYPE_CFG) as (keyof typeof TYPE_CFG)[]).map(type => {
              const cfg = TYPE_CFG[type];
              const Icon = cfg.icon;
              return (
                <div key={type} className="flex items-center gap-1.5">
                  <Icon className={cn('w-3 h-3', cfg.color)} />
                  <span>{cfg.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="shimmer h-10 rounded" />)}
          </div>
        ) : nodes.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Building2 className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm">No hierarchy configured yet</p>
          </div>
        ) : (
          <div className="max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
            {nodes.map(node => (
              <TreeNode key={node.id} node={node} depth={0} onEdit={openEdit} onDelete={setDeleteNode} />
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit — inline form */}
      <InlineFormPanel
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditNode(null); }}
        icon={Settings}
        title={editNode ? t('hierarchy.hform.editTitle', { type: t(`hierarchy.hform.nodeType.${editNode.type}`, { defaultValue: nodeTypeLabel(editNode.type as NodeType) }) }) : t('hierarchy.hform.createTitle')}
        description={editNode
          ? t('hierarchy.hform.editDesc', { name: editNode.name })
          : t('hierarchy.hform.createDesc')}
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={() => { setFormOpen(false); setEditNode(null); }}>{t('hierarchy.hform.cancel')}</Button>
            <Button
              size="sm"
              disabled={!isValid || createMutation.isPending || updateMutation.isPending}
              onClick={handleSubmit}
            >
              {createMutation.isPending || updateMutation.isPending
                ? (editNode ? t('hierarchy.hform.saving') : t('hierarchy.hform.creating'))
                : (editNode ? t('hierarchy.hform.saveChanges') : t('hierarchy.hform.createNode'))}
            </Button>
          </>
        )}
      >
          <div className="space-y-4">
            {/* Node Type — only when creating */}
            {!editNode && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{t('hierarchy.hform.nodeTypeField')} <span className="text-destructive">*</span></Label>
                <div className="grid grid-cols-3 gap-2">
                  {(['AREA', 'PRODUCTION_LINE', 'MACHINE'] as NodeType[]).map(nt => {
                    const cfg = TYPE_CFG[nt];
                    const Icon = cfg.icon;
                    return (
                      <button
                        key={nt}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, type: nt }))}
                        className={cn(
                          'flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all',
                          form.type === nt
                            ? 'border-brand-500 bg-brand-500/10 text-brand-400'
                            : 'border-border hover:border-border/70 text-muted-foreground hover:bg-muted/30',
                        )}
                      >
                        <Icon className={cn('w-5 h-5', form.type === nt ? cfg.color : '')} />
                        {t(`hierarchy.hform.nodeType.${nt}`, { defaultValue: cfg.label })}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Common: Name + Code (Code is read-only when editing — it's the immutable node key) */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{t('hierarchy.hform.name')} <span className="text-destructive">*</span></Label>
                <Input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={form.type === 'AREA' ? 'e.g. Packing Area' : form.type === 'PRODUCTION_LINE' ? 'e.g. Packing Line 1' : 'e.g. Big Betti'}
                  className="h-9"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  {t('hierarchy.hform.code')} {!editNode && <span className="text-destructive">*</span>}
                </Label>
                <Input
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder={form.type === 'AREA' ? 'PACKING' : form.type === 'PRODUCTION_LINE' ? 'PL-01' : 'M1-001'}
                  className="h-9 font-mono disabled:opacity-60 disabled:cursor-not-allowed"
                  disabled={!!editNode}
                  title={editNode ? t('hierarchy.hform.codeRO') : undefined}
                />
              </div>
            </div>

            {/* AREA specific */}
            {form.type === 'AREA' && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{t('hierarchy.hform.areaType')}</Label>
                <Select value={form.areaType} onValueChange={v => setForm(f => ({ ...f, areaType: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AREA_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* PRODUCTION_LINE specific */}
            {form.type === 'PRODUCTION_LINE' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">{t('hierarchy.hform.area')} <span className="text-destructive">*</span></Label>
                  <EntityPicker
                    items={areas}
                    value={form.areaId || null}
                    onChange={id => setForm(f => ({ ...f, areaId: id ?? '' }))}
                    getId={a => a.id}
                    getPrimary={a => a.name}
                    placeholder={t('hierarchy.hform.selectArea')}
                    searchPlaceholder={t('hierarchy.hform.searchAreas')}
                    emptyText={t('hierarchy.hform.noAreas')}
                    clearable={false}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">{t('hierarchy.hform.lineType')}</Label>
                  <Select value={form.lineType} onValueChange={v => setForm(f => ({ ...f, lineType: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LINE_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* MACHINE specific */}
            {form.type === 'MACHINE' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">{t('hierarchy.hform.machineType')}</Label>
                    <Select value={form.machineType} onValueChange={v => setForm(f => ({ ...f, machineType: v }))}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent className="max-h-52">
                        {MACHINE_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">{t('hierarchy.hform.criticality')}</Label>
                    <Select value={form.criticality} onValueChange={v => setForm(f => ({ ...f, criticality: v }))}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CRITICALITIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">{t('hierarchy.hform.area')}</Label>
                    <EntityPicker
                      items={areas}
                      value={form.areaId === '__none__' ? null : (form.areaId || null)}
                      onChange={id => setForm(f => ({ ...f, areaId: id ?? '__none__', lineId: '__none__' }))}
                      getId={a => a.id}
                      getPrimary={a => a.name}
                      placeholder={t('hierarchy.hform.selectArea')}
                      searchPlaceholder={t('hierarchy.hform.searchAreas')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">{t('hierarchy.hform.productionLine')}</Label>
                    <EntityPicker
                      items={lines}
                      value={form.lineId === '__none__' ? null : (form.lineId || null)}
                      onChange={id => setForm(f => ({ ...f, lineId: id ?? '__none__' }))}
                      getId={l => l.id}
                      getPrimary={l => l.name}
                      placeholder={form.areaId ? t('hierarchy.hform.selectLine') : t('hierarchy.hform.selectAreaFirst')}
                      searchPlaceholder={t('hierarchy.hform.searchLines')}
                      disabled={!form.areaId}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">{t('hierarchy.hform.manufacturer')}</Label>
                    <Input value={form.manufacturer} onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))} className="h-9" placeholder="e.g. Siemens" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">{t('hierarchy.hform.designCapacity')}</Label>
                    <Input type="number" value={form.designCapacity} onChange={e => setForm(f => ({ ...f, designCapacity: e.target.value }))} className="h-9" placeholder="e.g. 2700" />
                  </div>
                </div>
              </>
            )}
          </div>

      </InlineFormPanel>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteNode} onOpenChange={open => !open && setDeleteNode(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-4 h-4" /> {t('hierarchy.hform.removeTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('hierarchy.hform.removeConfirmPre')} <strong>{deleteNode?.name}</strong> {t('hierarchy.hform.removeConfirmPost')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteNode(null)}>{t('hierarchy.hform.cancel')}</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => deleteNode && deleteMutation.mutate({ id: deleteNode.id, type: deleteNode.type })}
            >
              {deleteMutation.isPending ? t('hierarchy.hform.removing') : t('hierarchy.hform.removeNode')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
