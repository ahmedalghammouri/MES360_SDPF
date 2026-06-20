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
  '/dashboard', '/production', '/manufacturing',
  '/production/kpi', '/production/oee', '/manufacturing/kpi', '/manufacturing/oee',
  '/production/downtime', '/production/orders', '/production/production-orders',
  '/production/reports', '/quality/reports',
  '/energy',
  '/ai', // AI Intelligence — all panels re-scope by area/line/machine
]);
const SCOPE_PREFIX = ['/scheduling']; // ScheduleView Gantt/Calendar pages

function isScopeRoute(pathname: string): boolean {
  return SCOPE_EXACT.has(pathname) || SCOPE_PREFIX.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function AppShell({ children }: AppShellProps) {
  const { isCollapsed } = useSidebarStore();
  const pathname = usePathname();
  useLiveKpi(); // live JO→WO→PO OEE/status updates
  useNotificationFeed(); // live per-user notification toasts + bell badge

  const showScope = isScopeRoute(pathname ?? '');

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <NavigationProgress />
      <Sidebar />
      <div
        className="flex flex-1 overflow-hidden transition-[margin] duration-300 ease-in-out"
        style={{ marginInlineStart: isCollapsed ? '64px' : '260px' }}
      >
        {showScope && <ScopePanel />}
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
