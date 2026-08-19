'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Grip,
  LayoutGrid,
  Factory,
  ShieldCheck,
  Wrench,
  BarChart3,
  Radio,
  GitBranch,
  Bell,
  AlarmClock,
  RadioTower,
  Router,
  Settings,
  Users,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Bot,
  Package,
  ClipboardList,
  TrendingUp,
  Gauge,
  AlertTriangle,
  Calendar,
  Clock,
  CalendarClock,
  CalendarRange,
  Boxes,
  Network,
  FileText,
  Cpu,
  Activity,
  Map,
  LogOut,
  Layers3,
  Layers,
  Target,
  BoxesIcon,
  Zap,
  ClipboardCheck,
  PackageSearch,
  LineChart,
  Sparkles,
  GitCommit,
  FlaskConical,
  Truck,
  MapPin,
  Workflow,
  GitMerge,
  Monitor,
  Cog,
  BookOpen,
  History,
  Archive,
  ArrowLeftRight,
  SlidersHorizontal,
  GitPullRequest,
  TabletSmartphone,
  PauseCircle,
  ExternalLink,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useSidebarStore } from '@/store/ui-store';
import { useAuthStore } from '@/store/auth-store';
import { useFactoryStore } from '@/store/factory-store';
import { useNotificationStore } from '@/store/notification-store';
import { filterNavByPermission } from '@/lib/nav-permissions';
import { api } from '@/services/api.client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface NavItem {
  label: string;
  href?: string;
  icon?: React.ElementType;
  badge?: string | number;
  badgeVariant?: 'default' | 'destructive' | 'secondary' | 'outline';
  badgeDynamic?: boolean;
  dynamicKey?: string;
  children?: NavItem[];
  permission?: string;
  openNewTab?: boolean;
  /** App landing route — renders an "open in new window" icon on the group header. */
  appHref?: string;
  /** When set, this entry renders as a section divider/label (not a link). */
  section?: string;
}

const navItems: NavItem[] = [
  { label: 'Apps', href: '/apps', icon: Grip },
  { label: 'Plant Live Views', href: '/plant-live-view', icon: Monitor, permission: 'plant_dashboard:view' },

  // ═══════════════ NOW ═══════════════
  // What the plant is doing at this instant. These pages take NO time filter —
  // their window is the shift that is running, decided by the server. They were
  // split out because the same screen used to carry a live card beside a
  // historical chart, and a reader could not tell which number was which.
  { section: 'Now', label: 'Now' },
  {
    label: 'Operations Now',
    icon: RadioTower,
    appHref: '/live/production',
    children: [
      { label: 'Live Production', href: '/live/production', icon: Factory,  badge: 'Live', badgeVariant: 'default' },
      { label: 'Live Machines',   href: '/live/machines',   icon: Activity, badge: 'Live', badgeVariant: 'default' },
      { label: 'Shop Floor',      href: '/shop-floor',      icon: Monitor },
      { label: 'Downtime Center', href: '/downtime',        icon: PauseCircle },
      { label: 'Alarms',          href: '/alarms',          icon: AlarmClock, dynamicKey: 'activeAlarms', badgeVariant: 'destructive' },
    ],
  },

  // ═══════════════ INSIGHTS ═══════════════
  // Decision-support apps: dashboards, OEE, analytics & reports, AI & benchmarks.
  { section: 'Insights', label: 'Insights' },
  {
    label: 'Dashboards',
    icon: Gauge,
    appHref: '/command-center',
    children: [
      {
        label: 'Command Centers',
        icon: Gauge,
        children: [
          { label: 'Command Center',          href: '/command-center',        icon: Gauge,       badge: 'New', badgeVariant: 'default' },
          { label: 'Downtime Command Center', href: '/downtime',              icon: PauseCircle, badge: 'New', badgeVariant: 'default' },
          { label: 'Energy Command Center',   href: '/energy/command-center', icon: Zap,         badge: 'New', badgeVariant: 'default' },
          { label: 'Executive Multi-Plant',   href: '/executive',             icon: Factory,     badge: 'New', badgeVariant: 'default' },
        ],
      },
      { label: 'Dashboard Center', href: '/dashboard-center', icon: LayoutGrid },
    ],
  },
  {
    // Analytics only. Everything here reads history and takes the full filter set;
    // the live counterparts live under "Now" so the two can never be confused for
    // one another on the same screen.
    label: 'OEE Analytics',
    icon: Gauge,
    appHref: '/production/oee',
    children: [
      { label: 'OEE Analytics', href: '/production/oee',    icon: LineChart },
      { label: 'Machine OEE',   href: '/manufacturing/oee', icon: Activity  },
      { label: 'Machine Status',  href: '/manufacturing/machine-status', icon: Activity },
      { label: 'Availability Analytics', href: '/production/availability-analytics', icon: Clock },
      { label: 'Performance Analytics',  href: '/production/performance-analytics',  icon: Gauge },
      { label: 'Quality Analytics',      href: '/production/quality-analytics',      icon: ShieldCheck },
      { label: 'Loss Tree & TEEP',       href: '/production/loss-tree',              icon: Layers, badge: 'New', badgeVariant: 'default' },
      { label: 'Schedule & Capacity',    href: '/production/schedule-capacity',      icon: Target, badge: 'New', badgeVariant: 'default' },
    ],
  },
  {
    label: 'Analytics & Reports',
    icon: BarChart3,
    appHref: '/analytics',
    children: [
      {
        label: 'Analysis',
        icon: LayoutGrid,
        children: [
          { label: 'Factory Analytics', href: '/analytics',          icon: LayoutGrid },
          { label: 'Insights Studio',   href: '/analytics/insights', icon: TrendingUp },
        ],
      },
      {
        label: 'KPIs',
        icon: Gauge,
        children: [
          { label: 'Production KPIs', href: '/production/kpi',    icon: Gauge },
          { label: 'Machine KPIs',    href: '/manufacturing/kpi', icon: Cpu   },
        ],
      },
      {
        label: 'Reports',
        icon: FileText,
        children: [
          // { label: 'Reports Overview',      href: '/reports',               icon: Gauge       },
          { label: 'Report Builder',        href: '/reports/builder',       icon: FileText    },
          { label: 'Production Reports',    href: '/reports/production',     icon: Factory     },
          // { label: 'Shift & Line Reports',  href: '/production/reports',     icon: Clock       },
          // { label: 'Manufacturing Reports', href: '/manufacturing/reports', icon: Cog         },
          { label: 'Quality Reports',       href: '/reports/quality',       icon: ShieldCheck },
          { label: 'Maintenance Reports',   href: '/reports/maintenance',   icon: Wrench      },
        ],
      },
    ],
  },
  {
    label: 'AI & Benchmarks',
    icon: Sparkles,
    appHref: '/ai',
    children: [
      { label: 'AI Intelligence', href: '/ai', icon: Sparkles, badge: 'New', badgeVariant: 'default' },
    ],
  },

  // ═══════════════ OPERATIONS ═══════════════
  // Plan → produce → manufacture → downtime → energy → shop-floor execution.
  { section: 'Operations', label: 'Operations' },
  {
    label: 'Planning',
    icon: CalendarRange,
    appHref: '/scheduling',
    children: [
      {
        label: 'Scheduling',
        icon: CalendarRange,
        children: [
          { label: 'General Schedule',    href: '/scheduling',            icon: CalendarRange, badge: 'Gantt', badgeVariant: 'default' },
          { label: 'Production Schedule', href: '/scheduling/production', icon: Factory,       badge: 'APS',   badgeVariant: 'outline' },
          { label: 'Order Scheduling',    href: '/production/scheduling', icon: Calendar       },
        ],
      },
      {
        label: 'Adjustments',
        icon: CalendarClock,
        children: [
          { label: 'Reschedule Requests', href: '/scheduling/reschedule-requests', icon: CalendarClock, dynamicKey: 'pendingReschedules', badgeVariant: 'destructive' },
          { label: 'Planned Downtime',    href: '/scheduling/planned-downtime',    icon: CalendarClock  },
          { label: 'Unplanned Downtime',  href: '/scheduling/unplanned-downtime',  icon: AlertTriangle  },
        ],
      },
      { label: 'Shift Configuration', href: '/production/shifts', icon: Clock, badge: 'NCC', badgeVariant: 'outline' },
      { label: 'Planned Stops',   href: '/production/planned-stops', icon: CalendarClock },
    ],
  },
  {
    label: 'Production',
    icon: Factory,
    appHref: '/production',
    children: [
      { label: 'Overview', href: '/production', icon: Gauge },
      {
        label: 'Orders',
        icon: ClipboardList,
        children: [
          { label: 'Production Orders (PO)', href: '/production/production-orders', icon: GitCommit      },
          { label: 'Work Orders (WO)',       href: '/production/orders',            icon: ClipboardList, dynamicKey: 'workOrders', badgeVariant: 'secondary' },
          { label: 'Job Orders',     href: '/production/job-orders',        icon: Layers         },
        ],
      },
      {
        label: 'Execution & Output',
        icon: Boxes,
        children: [
          { label: 'Batches & Lots',  href: '/production/batches',   icon: Boxes          },
          { label: 'Scrap Log Audit', href: '/production/scrap-log', icon: AlertTriangle, badge: 'Audit', badgeVariant: 'outline' },
        ],
      },
    ],
  },
  {
    label: 'Manufacturing',
    icon: Cog,
    appHref: '/manufacturing',
    children: [
      { label: 'Manufacturing Hub', href: '/manufacturing',         icon: Cog             },
      { label: 'Control Panel',     href: '/manufacturing/control', icon: SlidersHorizontal, badge: 'Live', badgeVariant: 'secondary' },
      {
        label: 'Engineering',
        icon: Workflow,
        children: [
          { label: 'Mfg. Processes', href: '/production/processes', icon: Workflow     },
          { label: 'Recipes',        href: '/production/recipes',   icon: FlaskConical },
        ],
      },
    ],
  },
  {
    label: 'Downtime',
    icon: PauseCircle,
    appHref: '/downtime',
    children: [
      { label: 'Downtime Command Center', href: '/downtime',            icon: PauseCircle,   badge: 'New', badgeVariant: 'default' },
      { label: 'Downtime Management',     href: '/production/downtime', icon: AlertTriangle, dynamicKey: 'openDowntime', badgeVariant: 'destructive' },
    ],
  },
  {
    label: 'Energy',
    icon: Zap,
    appHref: '/energy',
    children: [
      { label: 'Energy Dashboard',      href: '/energy',                icon: Zap   },
      { label: 'Energy Command Center', href: '/energy/command-center', icon: Gauge, badge: 'New', badgeVariant: 'default' },
      { label: 'Energy Analytics',      href: '/energy/analytics',      icon: BarChart3, badge: 'New', badgeVariant: 'default' },
      {
        label: 'Monitoring',
        icon: Activity,
        children: [
          { label: 'Consumption Reports', href: '/energy/reports', icon: BarChart3 },
          { label: 'Energy Meters',    href: '/energy/meters',  icon: Zap       },
          { label: 'Energy Live',      href: '/energy/live',    icon: Activity  },
        ],
      },
    ],
  },
  {
    label: 'Operation Hub',
    icon: TabletSmartphone,
    appHref: '/shop-floor',
    children: [
      { label: 'Shop Floor',        href: '/shop-floor',            icon: Monitor,           badge: 'Live', badgeVariant: 'secondary', openNewTab: true },
      { label: 'Control Panel',     href: '/manufacturing/control', icon: SlidersHorizontal, badge: 'Live', badgeVariant: 'secondary' },
      { label: 'Maintenance Floor', href: '/maintenance-floor',     icon: Wrench,            badge: 'Tablet', badgeVariant: 'outline' },
      { label: 'Quality Floor',     href: '/quality-floor',         icon: ClipboardCheck,    badge: 'Tablet', badgeVariant: 'outline' },
    ],
  },

  // ═══════════════ ASSET, QUALITY & MATERIALS ═══════════════
  { section: 'Asset, Quality & Materials', label: 'Asset, Quality & Materials' },
  {
    label: 'Maintenance',
    icon: Wrench,
    appHref: '/maintenance',
    children: [
      { label: 'Overview',           href: '/maintenance',             icon: Gauge    },
      { label: 'Reliability Center', href: '/maintenance/reliability', icon: Activity },
      {
        label: 'Work Management',
        icon: ClipboardList,
        children: [
          { label: 'Maintenance Orders', href: '/maintenance/work-orders', icon: ClipboardList, dynamicKey: 'openMaintenance', badgeVariant: 'secondary' },
          { label: 'Preventive Maint.',  href: '/maintenance/preventive',  icon: Calendar      },
          { label: 'Maint. Scheduling',  href: '/maintenance/scheduling',  icon: CalendarClock },
          { label: 'Maintenance Log',    href: '/maintenance/log',         icon: History       },
        ],
      },
      {
        label: 'Assets & Spares',
        icon: Cpu,
        children: [
          { label: 'Assets & Equipment', href: '/maintenance/assets',      icon: Cpu           },
          { label: 'Spare Parts',        href: '/maintenance/spare-parts', icon: PackageSearch },
        ],
      },
      { label: 'Reports & Analytics', href: '/maintenance/reports', icon: BarChart3 },
    ],
  },
  {
    label: 'Quality',
    icon: ShieldCheck,
    appHref: '/quality',
    children: [
      { label: 'Overview',             href: '/quality',              icon: Activity   },
      { label: 'Quality Intelligence', href: '/quality/intelligence', icon: TrendingUp },
      {
        label: 'Control & Inspection',
        icon: ClipboardCheck,
        children: [
          { label: 'Quality Plans', href: '/quality/plans',       icon: ClipboardList  },
          { label: 'Inspections',   href: '/quality/inspections', icon: ClipboardCheck, dynamicKey: 'pendingInspections', badgeVariant: 'secondary' },
          { label: 'SPC Charts',    href: '/quality/spc',         icon: LineChart      },
        ],
      },
      {
        label: 'Records & CAPA',
        icon: ShieldCheck,
        children: [
          { label: 'Quality Records', href: '/quality/records', icon: ClipboardCheck },
          { label: 'Non-Conformance', href: '/quality/ncr',     icon: AlertTriangle, dynamicKey: 'openNcr', badgeVariant: 'destructive' },
          { label: 'CAPA',            href: '/quality/capa',    icon: ShieldCheck,   dynamicKey: 'openCapa', badgeVariant: 'secondary' },
        ],
      },
      { label: 'Reports & Analytics', href: '/quality/reports', icon: BarChart3 },
    ],
  },
  {
    label: 'Inventory & Materials',
    icon: Package,
    appHref: '/inventory',
    children: [
      { label: 'Overview',            href: '/inventory',                    icon: Boxes          },
      { label: 'Storage Locations',   href: '/inventory/storage-locations',  icon: MapPin         },
      { label: 'Products (SKUs)',     href: '/inventory/products',           icon: BoxesIcon      },
      {
        label: 'Materials',
        icon: FlaskConical,
        children: [
          { label: 'Raw Materials',     href: '/inventory/raw-materials',     icon: FlaskConical  },
          { label: 'Material Lots',     href: '/inventory/materials',         icon: Layers3       },
          { label: 'Spare Parts',       href: '/inventory/spare-parts',       icon: PackageSearch },
          { label: 'Spare Part Req.',   href: '/inventory/spare-requests',    icon: Truck         },
          { label: 'Material Requests', href: '/inventory/material-requests', icon: ClipboardList },
        ],
      },
      {
        label: 'Movements',
        icon: ArrowLeftRight,
        children: [
          { label: 'Stock Movements',    href: '/inventory/stock-movements',    icon: ArrowLeftRight },
          { label: 'Location Transfers', href: '/inventory/location-movements', icon: ArrowLeftRight },
        ],
      },
      { label: 'Bill of Materials',   href: '/inventory/bom',     icon: GitMerge   },
      { label: 'Reports & Analytics', href: '/inventory/reports', icon: BarChart3  },
    ],
  },
  {
    label: 'Traceability',
    icon: GitCommit,
    appHref: '/traceability',
    children: [
      { label: 'Trace Log',            href: '/traceability',             icon: Activity  },
      { label: 'Genealogy',            href: '/traceability/genealogy',   icon: GitBranch },
      { label: 'Material Consumption', href: '/traceability/consumption', icon: Boxes     },
    ],
  },

  // ═══════════════ ENGINEERING, PLANT & INTEGRATION ═══════════════
  { section: 'Engineering, Plant & Integration', label: 'Engineering, Plant & Integration' },
  {
    label: 'PLM & Engineering',
    icon: BookOpen,
    appHref: '/plm',
    children: [
      { label: 'Overview', href: '/plm', icon: Gauge },
      {
        label: 'Lifecycle',
        icon: GitPullRequest,
        children: [
          { label: 'Change Requests', href: '/plm/change-requests', icon: GitPullRequest, dynamicKey: 'openChangeRequests', badgeVariant: 'secondary' },
          { label: 'Design Studio',   href: '/plm/design',          icon: Sparkles       },
        ],
      },
      {
        label: 'Definitions',
        icon: Workflow,
        children: [
          { label: 'Mfg. Processes',    href: '/production/processes', icon: Workflow     },
          { label: 'Bill of Materials', href: '/inventory/bom',        icon: GitMerge     },
          { label: 'Recipes',           href: '/production/recipes',   icon: FlaskConical },
        ],
      },
      { label: 'Reports & Analytics', href: '/plm/reports', icon: BarChart3 },
    ],
  },
  {
    label: 'Integration & IIoT',
    icon: Radio,
    appHref: '/iot/gateways',
    children: [
      {
        label: 'Connectivity',
        icon: Router,
        children: [
          { label: 'Edge Gateways', href: '/iot/gateways',    icon: Router },
          { label: 'Drivers',       href: '/iot/drivers',     icon: Radio  },
          { label: 'MQTT Client',   href: '/iot/mqtt-client', icon: Radio, badge: 'Live', badgeVariant: 'secondary' },
        ],
      },
      {
        label: 'Data & Tags',
        icon: Network,
        children: [
          { label: 'Devices',          href: '/iot/devices',   icon: Cpu      },
          { label: 'Tag Browser',      href: '/iot/tags',      icon: Network  },
          { label: 'Signal Rules',     href: '/iot/signal-rules', icon: SlidersHorizontal },
          { label: 'Data Streams',     href: '/iot/streams',   icon: Activity },
          { label: 'Historian Trends', href: '/iot/historian', icon: LineChart, badge: 'Live', badgeVariant: 'secondary' },
        ],
      },
    ],
  },
  {
    label: 'Plant & Monitoring',
    icon: GitBranch,
    appHref: '/hierarchy',
    children: [
      { label: 'Plant Hierarchy', href: '/hierarchy',     icon: GitBranch },
      { label: 'Alarms',          href: '/alarms',        icon: AlarmClock, dynamicKey: 'activeAlarms', badgeVariant: 'destructive' },
      { label: 'Notifications',   href: '/notifications', icon: Bell,       badgeDynamic: true, badgeVariant: 'destructive' },
    ],
  },
];

const bottomNavItems: NavItem[] = [
  { label: 'Users & Roles',  href: '/users',                icon: Users     },
  { label: 'Access Control', href: '/users/access-control', icon: ShieldCheck, permission: 'rbac:manage' },
  { label: 'Archive',        href: '/archive',              icon: Archive   },
  { label: 'Settings',       href: '/settings',             icon: Settings  },
];

// ── Live counts — single query, 4 parallel fetches, 1 cache entry ────────────

function useSidebarCounts(): Record<string, number> {
  const { data } = useQuery({
    queryKey: ['sidebar-counts'],
    queryFn: async () => {
      const [downtime, workOrders, ncr, maintenance, reschedules, alarms, changeReq, capa, inspections] = await Promise.all([
        api.get('/production/downtime/events?isOpen=true&limit=1').catch(() => null),
        api.get('/production/work-orders?status=IN_PROGRESS&limit=1').catch(() => null),
        api.get('/quality/ncr?status=OPEN&limit=1').catch(() => null),
        api.get('/maintenance/work-orders?status=OPEN&limit=1').catch(() => null),
        api.get('/production/reschedule-requests?status=PENDING').catch(() => null),
        api.get('/alarms/kpis').catch(() => null),
        api.get('/plm/change-requests?status=UNDER_REVIEW&limit=1').catch(() => null),
        api.get('/quality/capa?status=OPEN&limit=1').catch(() => null),
        api.get('/quality/inspections?result=PENDING&limit=1').catch(() => null),
      ]);
      const total = (r: any) => (typeof r?.total === 'number' ? r.total : Array.isArray(r) ? r.length : Array.isArray(r?.data) ? r.data.length : 0);
      return {
        openDowntime:       total(downtime),
        workOrders:         total(workOrders),
        openNcr:            total(ncr),
        openMaintenance:    total(maintenance),
        pendingReschedules: total(reschedules),
        activeAlarms:       (alarms as any)?.active ?? 0,
        openChangeRequests: total(changeReq),
        openCapa:           total(capa),
        pendingInspections: total(inspections),
      };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return data ?? { openDowntime: 0, workOrders: 0, openNcr: 0, openMaintenance: 0, pendingReschedules: 0, activeAlarms: 0, openChangeRequests: 0, openCapa: 0, pendingInspections: 0 };
}

// ── SidebarItem ─────────────────────────────────────────────────

interface SidebarItemProps {
  item: NavItem;
  isCollapsed: boolean;
  depth?: number;
  dynamicBadge?: number;
  countsMap?: Record<string, number>;
}

/** Every href that appears anywhere in the nav (incl. nested + bottom items). */
function collectHrefs(items: NavItem[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.href) out.push(it.href);
    if (it.children) out.push(...collectHrefs(it.children));
  }
  return out;
}
const ALL_NAV_HREFS = collectHrefs([...navItems, ...bottomNavItems]);

/**
 * The single best-matching nav href for a path. The longest prefix that matches
 * on a path boundary wins, so a parent index route (e.g. `/maintenance`) is
 * never left highlighted on a child page (`/maintenance/scheduling`) while a
 * detail page (`/maintenance/work-orders/123`) still lights its list item.
 */
function resolveActiveHref(pathname: string): string | null {
  let best: string | null = null;
  for (const href of ALL_NAV_HREFS) {
    // `/dashboard` (Home) is an index-only route — never matched as a prefix.
    const matches = href === '/dashboard'
      ? pathname === href
      : pathname === href || pathname.startsWith(href + '/');
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

/** True when this item (or, for a group, any descendant) is the active href. */
function subtreeContainsHref(item: NavItem, activeHref: string | null): boolean {
  if (!activeHref) return false;
  if (item.href) return item.href === activeHref;
  return item.children?.some(c => subtreeContainsHref(c, activeHref)) ?? false;
}

/** Sum of every dynamic-count alert under an item — recurses through sub-groups so
 *  an app/sub-group surfaces the badge of any descendant page (Change Requests,
 *  Reschedules, open WOs/NCRs, downtime, etc.) no matter how deeply nested. */
function subtreeAlertCount(item: NavItem, countsMap?: Record<string, number>): number {
  let n = item.dynamicKey && countsMap ? (countsMap[item.dynamicKey] ?? 0) : 0;
  if (item.children) for (const c of item.children) n += subtreeAlertCount(c, countsMap);
  return n;
}

function SidebarItem({ item, isCollapsed, depth = 0, dynamicBadge, countsMap }: SidebarItemProps) {
  const pathname = usePathname();
  const activeHref = resolveActiveHref(pathname);
  const { t, i18n } = useTranslation('nav');
  // nav keys are the literal English labels → disable key/ns separators, fall back to English.
  const label = t(item.label, { keySeparator: false, nsSeparator: false, defaultValue: item.label });
  const isRtl = i18n.dir() === 'rtl';
  const [isOpen, setIsOpen] = useState(() => {
    if (!item.children) return false;
    return subtreeContainsHref(item, resolveActiveHref(pathname));
  });

  const isActive = item.href
    ? item.href === activeHref
    : subtreeContainsHref(item, activeHref);

  const Icon = item.icon;

  // Resolve badge: static > dynamic-notification > dynamic-count
  const resolvedBadge = (() => {
    if (item.badge !== undefined) return item.badge;
    if (item.badgeDynamic && dynamicBadge && dynamicBadge > 0) return dynamicBadge;
    if (item.dynamicKey && countsMap) {
      const n = countsMap[item.dynamicKey] ?? 0;
      return n > 0 ? n : undefined;
    }
    return undefined;
  })();

  // Parent groups bubble up the combined count of every alerting descendant page.
  const childAlertCount = item.children ? subtreeAlertCount(item, countsMap) : 0;
  const childHasAlert = childAlertCount > 0;

  if (item.children) {
    return (
      <div className="relative group/app">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group',
            isActive
              ? 'bg-sidebar-accent text-sidebar-primary'
              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
            isCollapsed && 'justify-center px-2',
          )}
        >
          <span className="relative shrink-0">
            {Icon && <Icon className={cn(isActive && 'text-sidebar-primary')} size={18} />}
            {childHasAlert && (
              <span className="absolute -top-0.5 -end-0.5 w-2 h-2 rounded-full bg-destructive ring-2 ring-sidebar" />
            )}
          </span>
          {!isCollapsed && (
            <>
              <span className="flex-1 text-start overflow-hidden whitespace-nowrap">
                {label}
              </span>
              {/* Bubbled alert count from descendant pages (hidden while expanded
                  so it doesn't duplicate the per-page badges shown below). */}
              {childHasAlert && !isOpen && (
                <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive/90 text-destructive-foreground text-[10px] font-semibold inline-flex items-center justify-center tabular-nums">
                  {childAlertCount > 99 ? '99+' : childAlertCount}
                </span>
              )}
              <ChevronDown
                size={14}
                className={cn('shrink-0 transition-transform duration-200', isOpen && 'rotate-180')}
              />
            </>
          )}
        </button>

        {/* Open this app in a separate window (multi-app multitasking) */}
        {item.appHref && !isCollapsed && (
          <button
            onClick={(e) => { e.stopPropagation(); window.open(item.appHref!, '_blank', 'noopener'); }}
            title={`${label} — open in new window`}
            className="absolute end-8 top-2.5 p-1 rounded text-sidebar-foreground/40 hover:text-sidebar-primary opacity-0 group-hover/app:opacity-100 transition-opacity"
          >
            <ExternalLink size={13} />
          </button>
        )}

        {isOpen && !isCollapsed && (
          <div className="overflow-hidden ms-3 mt-0.5 ps-4 border-s border-sidebar-border/50">
            {item.children.map((child) => (
              <SidebarItem
                key={child.href || child.label}
                item={child}
                isCollapsed={false}
                depth={depth + 1}
                countsMap={countsMap}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const content = (
    <Link
      href={item.href!}
      target={item.openNewTab ? '_blank' : undefined}
      rel={item.openNewTab ? 'noopener noreferrer' : undefined}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group',
        isActive
          ? 'bg-sidebar-primary/15 text-sidebar-primary shadow-sm'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
        isCollapsed && 'justify-center px-2',
        depth > 0 && 'py-2 text-xs',
      )}
    >
      {Icon && (
        <Icon
          size={depth > 0 ? 15 : 18}
          className={cn('shrink-0', isActive && 'text-sidebar-primary')}
        />
      )}
      {!isCollapsed && (
        <>
          <span className="flex-1 overflow-hidden whitespace-nowrap">
            {label}
          </span>
          {resolvedBadge !== undefined && (
            <Badge
              variant={item.badgeVariant || 'secondary'}
              className="ms-auto text-[10px] h-4 min-w-4 px-1"
            >
              {typeof resolvedBadge === 'number' && resolvedBadge > 99 ? '99+' : resolvedBadge}
            </Badge>
          )}
        </>
      )}
    </Link>
  );

  if (isCollapsed) {
    return (
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>{content}</TooltipTrigger>
          <TooltipContent side={isRtl ? 'left' : 'right'} className="font-medium">
            {label}
            {resolvedBadge !== undefined && (
              <Badge variant={item.badgeVariant || 'secondary'} className="ms-2 text-[10px]">
                {resolvedBadge}
              </Badge>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return content;
}

// ── BackToMapButton ──────────────────────────────────────────────

function BackToMapButton({ isCollapsed }: { isCollapsed: boolean }) {
  const router = useRouter();
  const { t, i18n } = useTranslation('shell');
  const isRtl = i18n.dir() === 'rtl';
  const { selectedFactory, clearFactory } = useFactoryStore();
  const { logout } = useAuthStore();

  function handleBackToMap() {
    logout();
    clearFactory();
    router.push('/');
  }

  const btn = (
    <button
      onClick={handleBackToMap}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all duration-200 group relative overflow-hidden',
        'border border-cyan-500/30 hover:border-cyan-500/60 dark:border-cyan-500/20 dark:hover:border-cyan-500/50',
        'bg-gradient-to-r from-cyan-500/10 to-blue-500/10 hover:from-cyan-500/20 hover:to-blue-500/15 dark:from-cyan-500/5 dark:to-blue-500/5 dark:hover:from-cyan-500/15 dark:hover:to-blue-500/10',
        'text-cyan-700 hover:text-cyan-800 dark:text-cyan-400/70 dark:hover:text-cyan-300',
        isCollapsed && 'justify-center px-2',
      )}
    >
      <span className="absolute start-0 top-0 h-full w-0.5 bg-cyan-500/60 group-hover:bg-cyan-600 dark:bg-cyan-400/50 dark:group-hover:bg-cyan-400 transition-colors" />
      <Map size={15} className="shrink-0 text-cyan-600 group-hover:text-cyan-700 dark:text-cyan-400 dark:group-hover:text-cyan-300 transition-colors" />
      {!isCollapsed && (
        <>
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="whitespace-nowrap leading-tight">
              {selectedFactory ? (
                <>
                  <span className="text-[10px] text-cyan-700/60 dark:text-cyan-400/50 block font-mono tracking-wider uppercase">
                    {selectedFactory.code}
                  </span>
                  <span className="text-[11px] truncate block">{t('switchFactory')}</span>
                </>
              ) : (
                <span className="text-[11px]">{t('backToMap')}</span>
              )}
            </div>
          </div>
          <LogOut size={12} className="shrink-0 opacity-40 group-hover:opacity-80 transition-opacity" />
        </>
      )}
    </button>
  );

  if (isCollapsed) {
    return (
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>{btn}</TooltipTrigger>
          <TooltipContent side={isRtl ? 'left' : 'right'} className="font-medium text-xs">
            {selectedFactory ? `${t('switchFactory')} (${selectedFactory.code})` : t('backToMap')}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return btn;
}

// ── Sidebar ──────────────────────────────────────────────────────

export function Sidebar() {
  const { isCollapsed, toggle } = useSidebarStore();
  const { user, hasPermission } = useAuthStore();
  const { unreadCount } = useNotificationStore();
  const countsMap = useSidebarCounts();
  const { t, i18n } = useTranslation('nav');
  const { t: ts } = useTranslation('shell');
  const isRtl = i18n.dir() === 'rtl';
  const tn = (label: string) => t(label, { keySeparator: false, nsSeparator: false, defaultValue: label });

  // Show only what the user's permissions allow. Recomputed when the permission
  // set changes (login / role edit). SUPER_ADMIN sees everything (hasPermission).
  const visibleNav = useMemo(
    () => filterNavByPermission(navItems, hasPermission),
    [hasPermission, user?.permissions],
  );
  const visibleBottomNav = useMemo(
    () => filterNavByPermission(bottomNavItems, hasPermission),
    [hasPermission, user?.permissions],
  );

  return (
    <motion.aside
      animate={{ width: isCollapsed ? 64 : 260 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      className="fixed start-0 top-0 h-full z-50 flex flex-col bg-sidebar border-e border-sidebar-border overflow-hidden"
    >
      {/* Logo */}
      <div className="flex items-center h-16 px-3 border-b border-sidebar-border shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Brand mark — 360° */}
          <div
            className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center font-black text-[11px] tracking-tight text-[#003933]"
            style={{ background: 'linear-gradient(135deg, #E4D09F, #D9BB75)' }}
            aria-label="MES360°"
          >
            360°
          </div>
          {!isCollapsed && (
            <div className="overflow-hidden">
              <div className="whitespace-nowrap leading-none">
                <span
                  className="font-black text-[15px] tracking-tight"
                  style={{ background: 'linear-gradient(90deg, #003933, #4c7571)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
                >
                  MES
                </span>
                <span className="font-bold text-[15px] tracking-tight" style={{ color: '#B08E42' }}>360°</span>
              </div>
              <div className="text-sidebar-foreground/35 text-[9px] font-semibold tracking-[0.12em] uppercase whitespace-nowrap mt-0.5">
                {ts('tagline')}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={toggle}
          className={cn(
            'ms-auto p-1.5 rounded-md text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors',
            isCollapsed && 'mx-auto',
          )}
        >
          {(isCollapsed ? !isRtl : isRtl) ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 space-y-0.5 no-scrollbar">
        {visibleNav.map((item) =>
          item.section ? (
            isCollapsed ? (
              <div key={`sec:${item.section}`} className="my-2 mx-2 border-t border-sidebar-border/60" />
            ) : (
              <div
                key={`sec:${item.section}`}
                className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/35 select-none"
              >
                {tn(item.section!)}
              </div>
            )
          ) : (
            <SidebarItem
              key={item.href || item.label}
              item={item}
              isCollapsed={isCollapsed}
              dynamicBadge={item.badgeDynamic ? unreadCount : undefined}
              countsMap={countsMap}
            />
          ),
        )}
      </nav>

      {/* Back to Map */}
      <div className="px-2 py-2 border-t border-sidebar-border">
        <BackToMapButton isCollapsed={isCollapsed} />
      </div>

      {/* Bottom nav */}
      <div className="px-2 py-2 border-t border-sidebar-border space-y-0.5">
        {visibleBottomNav.map((item) => (
          <SidebarItem key={item.href} item={item} isCollapsed={isCollapsed} />
        ))}
      </div>

      {/* User profile */}
      <div className={cn(
        'flex items-center gap-3 p-3 border-t border-sidebar-border bg-sidebar-accent/30',
        isCollapsed && 'justify-center',
      )}>
        <Avatar className="w-8 h-8 shrink-0">
          <AvatarImage src={user?.avatarUrl} />
          <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">
            {user?.name?.substring(0, 2).toUpperCase() || 'US'}
          </AvatarFallback>
        </Avatar>
        {!isCollapsed && (
          <div className="flex-1 min-w-0">
            <div className="text-sidebar-foreground text-xs font-semibold truncate">
              {user?.name || 'User'}
            </div>
            <div className="text-sidebar-foreground/40 text-[10px] truncate">
              {user?.role || 'Operator'}
            </div>
          </div>
        )}
      </div>
    </motion.aside>
  );
}
