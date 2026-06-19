'use client';

/**
 * ScopePanel — a slim secondary panel (beside the main nav) holding the plant
 * hierarchy tree (Factory→Area→Line→Machine). Selecting a node sets the global
 * analysis scope (scope-store) which every dashboard / KPI / OEE / report page
 * reads via useScope to filter its data. Shown only on analysis routes.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronRight, ChevronDown, Factory, LayoutGrid, GitBranch, Cpu, PanelLeftClose, PanelLeftOpen, Filter, Check,
} from 'lucide-react';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { useScopeStore, type ScopeType } from '@/store/scope-store';

interface TreeNode {
  id: string;
  code: string;
  name: string;
  type: 'FACTORY' | 'AREA' | 'PRODUCTION_LINE' | 'MACHINE';
  children?: TreeNode[];
}

const TYPE_ICON: Record<string, React.ElementType> = {
  FACTORY: Factory, AREA: LayoutGrid, PRODUCTION_LINE: GitBranch, MACHINE: Cpu,
};
const TYPE_COLOR: Record<string, string> = {
  FACTORY: 'text-blue-400', AREA: 'text-violet-400', PRODUCTION_LINE: 'text-orange-400', MACHINE: 'text-green-400',
};
const toScopeType = (t: TreeNode['type']): ScopeType =>
  t === 'PRODUCTION_LINE' ? 'LINE' : (t as ScopeType);

function Node({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const { scope, setScope } = useScopeStore();
  const Icon = TYPE_ICON[node.type] ?? Cpu;
  const hasChildren = (node.children?.length ?? 0) > 0;
  const selected = scope?.id === node.id;

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 pr-1.5 py-1 rounded-md text-xs cursor-pointer transition-colors group',
          selected ? 'bg-primary/15 text-primary' : 'hover:bg-muted/50',
        )}
        style={{ paddingLeft: `${4 + depth * 12}px` }}
        onClick={() => setScope({ type: toScopeType(node.type), id: node.id, name: node.name, code: node.code })}
      >
        <button
          onClick={(e) => { e.stopPropagation(); if (hasChildren) setOpen(o => !o); }}
          className={cn('w-3.5 shrink-0 text-muted-foreground', !hasChildren && 'opacity-0 pointer-events-none')}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        <Icon size={12} className={cn('shrink-0', selected ? 'text-primary' : TYPE_COLOR[node.type])} />
        <span className="flex-1 truncate">{node.name}</span>
        {selected && <Check size={11} className="shrink-0" />}
      </div>
      {open && hasChildren && (
        <div>{node.children!.map(c => <Node key={c.id} node={c} depth={depth + 1} />)}</div>
      )}
    </div>
  );
}

export function ScopePanel() {
  const { scope, setScope, collapsed, toggleCollapsed } = useScopeStore();

  const { data } = useQuery({
    queryKey: ['hierarchy-tree'],
    queryFn: () => api.get('/hierarchy/tree'),
    staleTime: 60_000,
  });
  const tree: TreeNode[] = (() => {
    const d = (data as any)?.data ?? data;
    return Array.isArray(d) ? d : d ? [d] : [];
  })();

  if (collapsed) {
    return (
      <div className="shrink-0 border-r border-border/60 bg-card/40 flex flex-col items-center py-3 w-9">
        <button onClick={toggleCollapsed} title="Show scope" className="p-1.5 rounded-md hover:bg-muted/60 text-muted-foreground">
          <PanelLeftOpen size={16} />
        </button>
        <Filter size={14} className="text-muted-foreground mt-2" />
      </div>
    );
  }

  return (
    <div className="shrink-0 w-56 border-r border-border/60 bg-card/40 flex flex-col">
      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border/60">
        <Filter size={13} className="text-primary" />
        <span className="text-xs font-semibold flex-1">Scope</span>
        <button onClick={toggleCollapsed} title="Collapse" className="p-1 rounded-md hover:bg-muted/60 text-muted-foreground">
          <PanelLeftClose size={15} />
        </button>
      </div>

      <button
        onClick={() => setScope(null)}
        className={cn(
          'mx-2 mt-2 mb-1 px-2 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors',
          !scope || scope.type === 'FACTORY' ? 'bg-primary/15 text-primary' : 'hover:bg-muted/50 text-muted-foreground',
        )}
      >
        <Factory size={12} /> Whole factory
        {(!scope || scope.type === 'FACTORY') && <Check size={11} className="ml-auto" />}
      </button>

      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
        {tree.length === 0 ? (
          <div className="text-[11px] text-muted-foreground text-center py-6">No hierarchy</div>
        ) : tree.map(root => <Node key={root.id} node={root} depth={0} />)}
      </div>

      {scope && scope.type !== 'FACTORY' && (
        <div className="px-3 py-2 border-t border-border/60 text-[10px] text-muted-foreground">
          Scoped to <span className="font-semibold text-foreground">{scope.name}</span> <span className="uppercase opacity-70">({scope.type})</span>
        </div>
      )}
    </div>
  );
}
