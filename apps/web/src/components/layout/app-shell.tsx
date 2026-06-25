'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { ScopePanel } from './scope-panel';
import { QuickDock } from './quick-dock';
import { useSidebarStore } from '@/store/ui-store';
import { NavigationProgress } from '@/components/ui/navigation-progress';
import { useLiveKpi } from '@/hooks/use-live-kpi';
import { useNotificationFeed } from '@/hooks/use-websocket';

interface AppShellProps {
  children: React.ReactNode;
}

// Pages where selecting a hierarchy node actually re-scopes the data (backend filter wired).
// Keep this list honest: only show the scope panel where it has a real effect.
const SCOPE_EXACT = new Set([
  '/dashboard', '/command-center', '/production', '/manufacturing',
  '/production/kpi', '/production/oee', '/manufacturing/kpi', '/manufacturing/oee',
  '/production/downtime', '/production/orders', '/production/production-orders',
  '/production/reports', '/quality/reports',
  '/maintenance/reliability', '/quality/intelligence',
  '/downtime', // Downtime Command Center
  '/energy', '/energy/command-center',
  '/ai', // AI Intelligence — all panels re-scope by area/line/machine
]);
const SCOPE_PREFIX = ['/scheduling', '/quality']; // ScheduleView + all Quality module pages

function isScopeRoute(pathname: string): boolean {
  return SCOPE_EXACT.has(pathname) || SCOPE_PREFIX.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function AppShell({ children }: AppShellProps) {
  const { isCollapsed } = useSidebarStore();
  const pathname = usePathname();
  useLiveKpi(); // live JO→WO→PO OEE/status updates
  useNotificationFeed(); // live per-user notification toasts + bell badge

  // The scope tree is shown on every platform page for a consistent shell.
  // On routes wired to a backend filter it actively re-scopes data; elsewhere it
  // is "passive" (selection persists globally and applies once you reach an
  // analytics/dashboard page) — see ScopePanel.
  const scopeActive = isScopeRoute(pathname ?? '');

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <NavigationProgress />
      <Sidebar />
      <div
        className="flex flex-1 overflow-hidden transition-[margin] duration-300 ease-in-out"
        style={{ marginInlineStart: isCollapsed ? '64px' : '260px' }}
      >
        <ScopePanel passive={!scopeActive} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar />
          <main className="relative flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>

      {/* Global macOS-style quick-action dock — available on every page */}
      <QuickDock />
    </div>
  );
}
