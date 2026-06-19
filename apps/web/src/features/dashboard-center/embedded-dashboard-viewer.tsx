'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  ArrowLeft, ExternalLink, RefreshCw, Building2, Clock, Maximize2, AlertTriangle, Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SelectMenu } from '@/components/ui/select-menu';
import { cn } from '@/lib/utils';
import { useFactoryStore } from '@/store/factory-store';
import { useDashboardEmbed, type EmbedContext } from './use-dashboard-center';
import { resolveIcon } from './dashboard-card';

const TIME_RANGES: { value: string; label: string }[] = [
  { value: 'now-1h', label: 'Last 1h' },
  { value: 'now-6h', label: 'Last 6h' },
  { value: 'now-24h', label: 'Last 24h' },
  { value: 'now-7d', label: 'Last 7d' },
  { value: 'now-30d', label: 'Last 30d' },
];

export function EmbeddedDashboardViewer({ dashboardId }: { dashboardId: string }) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const { selectedFactory } = useFactoryStore();

  const [timeRange, setTimeRange] = useState('now-24h');
  const [reloadKey, setReloadKey] = useState(0);

  const ctx: EmbedContext = useMemo(() => ({
    factoryId: selectedFactory?.id ?? null,
    from: timeRange,
    theme: resolvedTheme === 'light' ? 'light' : 'dark',
  }), [selectedFactory?.id, timeRange, resolvedTheme]);

  const { data, isLoading, error } = useDashboardEmbed(dashboardId, ctx);

  const Icon = resolveIcon(data?.dashboard.icon);
  const iframeUrl = data?.url ? `${data.url}${data.url.includes('?') ? '&' : '?'}_r=${reloadKey}` : null;

  return (
    <div className="flex flex-col h-full">
      {/* Viewer toolbar — keeps users inside MES360° chrome */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border/50 shrink-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => router.push('/dashboard-center')}>
            <ArrowLeft size={14} /> Catalog
          </Button>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-2 min-w-0">
            <Icon size={16} className="text-primary shrink-0" />
            <span className="text-sm font-semibold truncate">{data?.dashboard.title ?? 'Loading…'}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {data?.dashboard.isFactoryAware && (
            <Badge variant="outline" className="h-8 gap-1.5 text-xs">
              <Building2 size={13} className="text-cyan-400" />
              {selectedFactory?.code ?? 'All factories'}
            </Badge>
          )}

          {/* Time range — applies as Grafana from/to */}
          <div className="flex items-center gap-1.5">
            <Clock size={13} className="text-muted-foreground" />
            <SelectMenu
              value={timeRange}
              onValueChange={setTimeRange}
              menuLabel="Time range"
              options={TIME_RANGES.map((t) => ({ value: t.value, label: t.label }))}
            />
          </div>

          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setReloadKey((k) => k + 1)} title="Reload">
            <RefreshCw size={13} />
          </Button>
          {iframeUrl && (
            <Button variant="outline" size="icon" className="h-8 w-8" title="Open in new tab"
              onClick={() => window.open(data!.url!, '_blank', 'noopener')}>
              <Maximize2 size={13} />
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 relative bg-background">
        {isLoading ? (
          <div className="absolute inset-0 p-4">
            <div className="shimmer h-full w-full rounded-lg" />
          </div>
        ) : error ? (
          <ViewerMessage
            icon={<AlertTriangle size={22} className="text-danger-400" />}
            title="Unable to load dashboard"
            body="You may not have access, or the dashboard no longer exists."
            action={<Button size="sm" variant="outline" onClick={() => router.push('/dashboard-center')}>Back to catalog</Button>}
          />
        ) : data?.kind === 'native' ? (
          <ViewerMessage
            icon={<ExternalLink size={22} className="text-brand-400" />}
            title="MES360° native dashboard"
            body="This dashboard opens directly inside MES360°."
            action={data.route
              ? <Button size="sm" onClick={() => router.push(data.route!)}>Open dashboard</Button>
              : undefined}
          />
        ) : data?.kind === 'grafana' && !data.embeddable ? (
          <ViewerMessage
            icon={<Settings size={22} className="text-warning-400" />}
            title={data.grafanaConfigured ? 'Grafana dashboard not mapped' : 'Grafana not configured'}
            body={data.grafanaConfigured
              ? 'This catalog entry has no Grafana dashboard UID assigned yet. An admin can map it from the dashboard settings.'
              : 'Grafana integration is not configured on this environment. Set GRAFANA_URL / GRAFANA_PUBLIC_URL to enable embedded dashboards.'}
          />
        ) : iframeUrl ? (
          <iframe
            key={reloadKey}
            src={iframeUrl}
            title={data?.dashboard.title ?? 'Dashboard'}
            className="absolute inset-0 w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="fullscreen"
          />
        ) : (
          <ViewerMessage
            icon={<AlertTriangle size={22} className="text-muted-foreground" />}
            title="Nothing to display"
            body="This dashboard has no embeddable target."
          />
        )}
      </div>
    </div>
  );
}

function ViewerMessage({
  icon, title, body, action,
}: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
      <div className="w-12 h-12 rounded-xl bg-foreground/5 flex items-center justify-center mb-3">{icon}</div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-md">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
