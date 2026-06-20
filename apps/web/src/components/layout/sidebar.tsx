'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Grip,
  LayoutDashboard,
  LayoutGrid,
  Factory,
  ShieldCheck,
  Wrench,
  BarChart3,
  Radio,
  GitBranch,
  Bell,
  AlarmClock,
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
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useSidebarStore } from '@/store/ui-store';
import { useAuthStore } from '@/store/auth-store';
import { useFactoryStore } from '@/store/factory-store';
import { useNotificationStore } from '@/store/notification-store';
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
  /** When set, this entry renders as a section divider/label (not a link). */
  section?: string;
}

const navItems: NavItem[] = [
  // ═══════════════ OVERVIEW ═══════════════
  { section: 'Overview', label: 'Overview' },
  { label: 'Apps', href: '/apps', icon: Grip },
  { label: 'Home', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Dashboard Center', href: '/dashboard-center', icon: LayoutGrid, badge: 'New', badgeVariant: 'default' },

  // ═══════════════ PLANNING & EXECUTION ═══════════════
  // One home per page: planning → orders pipeline → execution → trace → KPIs.
  { section: 'Planning & Execution', label: 'Planning & Execution' },
  {
    label: 'Planning & Scheduling',
    icon: CalendarRange,
    children: [
      { label: 'General Schedule',        href: '/scheduling',                   icon: CalendarRange, badge: 'Gantt', badgeVariant: 'default' },
      { label: 'Production Schedule',     href: '/scheduling/production',        icon: Factory,       badge: 'APS',   badgeVariant: 'outline' },
      { label: 'Order Scheduling',        href: '/production/scheduling',        icon: Calendar       },
      { label: 'Reschedule Requests',     href: '/scheduling/reschedule-requests', icon: CalendarClock, dynamicKey: 'pendingReschedules', badgeVariant: 'destructive' },
      { label: 'Planned Downtime',        href: '/scheduling/planned-downtime',  icon: CalendarClock  },
      { label: 'Unplanned Downtime',      href: '/scheduling/unplanned-downtime', icon: AlertTriangle },
      { label: 'Shift Configuration',     href: '/production/shifts',            icon: Clock,         badge: 'NCC', badgeVariant: 'outline' },
    ],
  },
  {
    label: 'Production',
    icon: Factory,
    children: [
      { label: 'Overview',                href: '/production',                   icon: Gauge          },
      { label: 'Control Panel',           href: '/manufacturing/control',        icon: SlidersHorizontal, badge: 'Live', badgeVariant: 'secondary' },
      { label: 'Production Orders (PO)',  href: '/production/production-orders', icon: GitCommit      },
      { label: 'Work Orders (WO)',        href: '/production/orders',            icon: ClipboardList, dynamicKey: 'workOrders', badgeVariant: 'secondary' },
      { label: 'Dispatch List (JO)',      href: '/production/job-orders',        icon: Layers         },
      { label: 'Shopfloor Live',          href: '/shop-floor',                   icon: Monitor,       badge: 'Live', badgeVariant: 'secondary', openNewTab: true },
      { label: 'Downtime',                href: '/production/downtime',          icon: AlertTriangle, dynamicKey: 'openDowntime', badgeVariant: 'destructive' },
      { label: 'Batches & Lots',          href: '/production/batches',           icon: Boxes          },
      { label: 'Scrap Log Audit',         href: '/production/scrap-log',         icon: AlertTriangle, badge: 'Audit', badgeVariant: 'outline' },
    ],
  },
  {
    label: 'Traceability',
    icon: GitCommit,
    children: [
      { label: 'Trace Log',            href: '/traceability',              icon: Activity  },
      { label: 'Genealogy',            href: '/traceability/genealogy',    icon: GitBranch },
      { label: 'Material Consumption', href: '/traceability/consumption',  icon: Boxes     },
    ],
  },
  {
    label: 'Performance & KPIs',
    icon: TrendingUp,
    children: [
      { label: 'Factory Analytics',       href: '/analytics',                    icon: LayoutGrid },
      { label: 'Production KPIs',         href: '/production/kpi',               icon: Gauge      },
      { label: 'OEE Analytics',           href: '/production/oee',               icon: LineChart  },
      { label: 'Machine KPIs',            href: '/manufacturing/kpi',            icon: Cpu        },
      { label: 'Machine OEE',             href: '/manufacturing/oee',            icon: Activity   },
      { label: 'Energy Dashboard',        href: '/energy',                       icon: Zap        },
      { label: 'Energy Analytics',        href: '/energy/reports',               icon: BarChart3  },
      { label: 'Manufacturing Hub',       href: '/manufacturing',                icon: Cog        },
    ],
  },

  // ═══════════════ ASSET & QUALITY ═══════════════
  { section: 'Asset & Quality', label: 'Asset & Quality' },
  {
    label: 'Maintenance',
    icon: Wrench,
    children: [
      { label: 'Overview',               href: '/maintenance',                     icon: Gauge         },
      { label: 'Maintenance Floor',      href: '/maintenance-floor',               icon: Monitor,       badge: 'Tablet', badgeVariant: 'secondary' },
      { label: 'Maint. Scheduling',      href: '/maintenance/scheduling',          icon: Calendar      },
      { label: 'Maintenance Orders',     href: '/maintenance/work-orders',         icon: ClipboardList, dynamicKey: 'openMaintenance', badgeVariant: 'secondary' },
      { label: 'Preventive Maint.',      href: '/maintenance/preventive',          icon: Calendar      },
      { label: 'Maintenance Log',        href: '/maintenance/log',                 icon: History       },
      { label: 'Spare Parts',            href: '/maintenance/spare-parts',         icon: PackageSearch },
      { label: 'Assets & Equipment',     href: '/maintenance/assets',              icon: Cpu           },
      { label: 'Reports & Analytics',    href: '/maintenance/reports',             icon: BarChart3     },
    ],
  },
  {
    label: 'Quality',
    icon: ShieldCheck,
    children: [
      { label: 'Overview',               href: '/quality',                         icon: Activity      },
      { label: 'Quality Plans',          href: '/quality/plans',                   icon: ClipboardList },
      { label: 'Quality Records',        href: '/quality/records',                 icon: ClipboardCheck },
      { label: 'Inspections',            href: '/quality/inspections',             icon: ClipboardCheck },
      { label: 'Non-Conformance',        href: '/quality/ncr',                     icon: AlertTriangle, dynamicKey: 'openNcr', badgeVariant: 'destructive' },
      { label: 'CAPA',                   href: '/quality/capa',                    icon: ShieldCheck   },
      { label: 'SPC Charts',             href: '/quality/spc',                     icon: LineChart     },
      { label: 'Reports & Analytics',    href: '/quality/reports',                 icon: BarChart3     },
    ],
  },

  // ═══════════════ MATERIALS & PRODUCTS ═══════════════
  { section: 'Materials & Products', label: 'Materials & Products' },
  {
    label: 'Inventory',
    icon: Package,
    children: [
      { label: 'Overview',               href: '/inventory',                       icon: Boxes         },
      { label: 'Storage Locations',      href: '/inventory/storage-locations',     icon: MapPin        },
      { label: 'Products (SKUs)',        href: '/inventory/products',              icon: BoxesIcon     },
      {
        label: 'Materials',
        icon: FlaskConical,
        children: [
          { label: 'Raw Materials',      href: '/inventory/raw-materials',         icon: FlaskConical  },
          { label: 'Material Lots',      href: '/inventory/materials',             icon: Layers3       },
          { label: 'Spare Parts',        href: '/inventory/spare-parts',           icon: PackageSearch },
          { label: 'Spare Part Req.',    href: '/inventory/spare-requests',        icon: Truck         },
        ],
      },
      { label: 'Stock Movements',        href: '/inventory/stock-movements',       icon: ArrowLeftRight },
      { label: 'Reports & Analytics',    href: '/inventory/reports',               icon: BarChart3     },
    ],
  },
  {
    label: 'PLM & Engineering',
    icon: BookOpen,
    children: [
      { label: 'Overview',               href: '/plm',                             icon: Gauge          },
      { label: 'Change Requests',        href: '/plm/change-requests',             icon: GitPullRequest },
      { label: 'Mfg. Processes',         href: '/production/processes',            icon: Workflow       },
      { label: 'Bill of Materials',      href: '/inventory/bom',                   icon: GitMerge       },
      { label: 'Recipes',                href: '/production/recipes',              icon: FlaskConical   },
      { label: 'Design Studio',          href: '/plm/design',                      icon: Sparkles       },
      { label: 'Reports & Analytics',    href: '/plm/reports',                     icon: BarChart3      },
    ],
  },

  // ═══════════════ PLANT & CONNECTIVITY ═══════════════
  { section: 'Plant & Connectivity', label: 'Plant & Connectivity' },
  { label: 'Alarms', href: '/alarms', icon: AlarmClock, dynamicKey: 'activeAlarms', badgeVariant: 'destructive' },
  { label: 'Energy Meters', href: '/energy/meters', icon: Zap },
  { label: 'Energy Live', href: '/energy/live', icon: Activity },
  {
    label: 'IIoT & Connectivity',
    icon: Radio,
    children: [
      { label: 'Edge Gateways', href: '/iot/gateways', icon: Router   },
      { label: 'Devices',      href: '/iot/devices',  icon: Cpu      },
      { label: 'Tag Browser',  href: '/iot/tags',     icon: Network  },
      { label: 'Historian Trends', href: '/iot/historian', icon: LineChart, badge: 'Live', badgeVariant: 'secondary' },
      { label: 'MQTT Client',  href: '/iot/mqtt-client', icon: Radio, badge: 'Live', badgeVariant: 'secondary' },
      { label: 'Drivers',      href: '/iot/drivers',  icon: Radio    },
      { label: 'Data Streams', href: '/iot/streams',  icon: Activity },
    ],
  },
  { label: 'Plant Hierarchy', href: '/hierarchy', icon: GitBranch },

  // ═══════════════ INSIGHTS ═══════════════
  { section: 'Insights', label: 'Insights' },
  {
    label: 'Reports & Analytics',
    icon: BarChart3,
    children: [
      { label: 'Overview',               href: '/reports',                         icon: Gauge         },
      { label: 'Report Builder',         href: '/reports/builder',                 icon: FileText      },
      { label: 'Production Reports',     href: '/reports/production',              icon: Factory       },
      { label: 'Shift & Line Reports',   href: '/production/reports',              icon: Clock         },
      { label: 'Manufacturing Reports',  href: '/manufacturing/reports',           icon: Cog           },
      { label: 'Quality Reports',        href: '/reports/quality',                 icon: ShieldCheck   },
      { label: 'Maintenance Reports',    href: '/reports/maintenance',             icon: Wrench        },
    ],
  },
  { label: 'AI Intelligence', href: '/ai', icon: Sparkles, badge: 'New', badgeVariant: 'default' },
  { label: 'Notifications', href: '/notifications', icon: Bell, badgeDynamic: true, badgeVariant: 'destructive' },
];

const bottomNavItems: NavItem[] = [
  { label: 'Users & Roles', href: '/users',    icon: Users    },
  { label: 'Archive',       href: '/archive',  icon: Archive  },
  { label: 'Settings',      href: '/settings', icon: Settings },
];

// ── Live counts — single query, 4 parallel fetches, 1 cache entry ────────────

function useSidebarCounts(): Record<string, number> {
  const { data } = useQuery({
    queryKey: ['sidebar-counts'],
    queryFn: async () => {
      const [downtime, workOrders, ncr, maintenance, reschedules, alarms] = await Promise.all([
        api.get('/production/downtime/events?isOpen=true&limit=1').catch(() => null),
        api.get('/production/work-orders?status=IN_PROGRESS&limit=1').catch(() => null),
        api.get('/quality/ncr?status=OPEN&limit=1').catch(() => null),
        api.get('/maintenance/work-orders?status=OPEN&limit=1').catch(() => null),
        api.get('/production/reschedule-requests?status=PENDING').catch(() => null),
        api.get('/alarms/kpis').catch(() => null),
      ]);
      return {
        openDowntime:    (downtime    as any)?.total ?? 0,
        workOrders:      (workOrders  as any)?.total ?? 0,
        openNcr:         (ncr         as any)?.total ?? 0,
        openMaintenance: (maintenance as any)?.total ?? 0,
        // List endpoint returns a plain array → use its length
        pendingReschedules: Array.isArray(reschedules) ? reschedules.length : 0,
        activeAlarms:    (alarms       as any)?.active ?? 0,
      };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return data ?? { openDowntime: 0, workOrders: 0, openNcr: 0, openMaintenance: 0, pendingReschedules: 0, activeAlarms: 0 };
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

  // For parent groups: show a dot if any child has a nonzero count
  const childHasAlert = item.children?.some(c => {
    if (!c.dynamicKey || !countsMap) return false;
    return (countsMap[c.dynamicKey] ?? 0) > 0;
  });

  if (item.children) {
    return (
      <div>
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
              <ChevronDown
                size={14}
                className={cn('shrink-0 transition-transform duration-200', isOpen && 'rotate-180')}
              />
            </>
          )}
        </button>

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
  const { user } = useAuthStore();
  const { unreadCount } = useNotificationStore();
  const countsMap = useSidebarCounts();
  const { t, i18n } = useTranslation('nav');
  const { t: ts } = useTranslation('shell');
  const isRtl = i18n.dir() === 'rtl';
  const tn = (label: string) => t(label, { keySeparator: false, nsSeparator: false, defaultValue: label });

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
            className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center font-black text-[11px] tracking-tight text-white"
            style={{ background: 'linear-gradient(135deg, #818cf8, #a78bfa)' }}
            aria-label="MES360°"
          >
            360°
          </div>
          {!isCollapsed && (
            <div className="overflow-hidden">
              <div className="whitespace-nowrap leading-none">
                <span
                  className="font-black text-[15px] tracking-tight"
                  style={{ background: 'linear-gradient(90deg, #818cf8, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
                >
                  MES
                </span>
                <span className="font-bold text-[15px] tracking-tight text-sidebar-foreground/75">360°</span>
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
        {navItems.map((item) =>
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
        {bottomNavItems.map((item) => (
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
