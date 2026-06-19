# MES360° — Features Documentation

All features implemented in the platform as of May 2026.

---

## Table of Contents

1. [Factory Selector Landing Page](#1-factory-selector-landing-page)
2. [Authentication System](#2-authentication-system)
3. [Platform Shell — Navigation & Layout](#3-platform-shell--navigation--layout)
4. [Dashboard](#4-dashboard)
5. [Production Management](#5-production-management)
6. [Quality Management](#6-quality-management)
7. [Maintenance Management](#7-maintenance-management)
8. [IIoT & Connectivity](#8-iiiot--connectivity)
9. [Plant Hierarchy](#9-plant-hierarchy)
10. [Reports](#10-reports)
11. [AI Intelligence](#11-ai-intelligence)
12. [Notifications](#12-notifications)
13. [Users & Roles](#13-users--roles)
14. [Settings](#14-settings)
15. [Infrastructure & DevOps](#15-infrastructure--devops)

---

## 1. Factory Selector Landing Page

**Route:** `/`  
**Files:** `apps/web/src/app/page.tsx`, `apps/web/src/features/factory-selector/`

The entry point of the platform — a full-screen, dark-themed industrial landing page that shows the NCC factory network on a real interactive map before authentication.

### Map (Leaflet + OpenStreetMap)
- **Real-world map** using Leaflet 1.9 with **CartoDB Dark Matter** tiles — 100% free, no API key
- Factories placed at their exact GPS coordinates extracted from company documents
- Custom color-coded markers per factory with:
  - Pulsing glow ring animation
  - Colored dot with glow shadow matching factory brand color
  - Factory code label with dark background
  - Scale-up animation on hover/select
- Map auto-fits to show all factories (Dammam cluster + Jeddah)
- Supports scroll zoom, double-click zoom, pan

### Factory Data Panel
- Live KPI display for the selected or hovered factory:
  - **OEE gauge** (SVG arc gauge with percentage)
  - Availability, Performance, Quality breakdown
  - Active Alarms counter
  - Employees count
  - Shifts today
  - System uptime
- Animated number counter on values
- Factory name in English and Arabic

### Factory List Sidebar
- Scrollable list of all 5 factories
- Each row shows factory code, name, city, and quick KPI preview (OEE + Quality)
- Expands on selection to show full KPI grid
- Color-coded left border per factory

### Global Stats Bar
- Total network OEE average
- Total employees across all factories
- Total active alarms
- Live clock (KSA timezone, Arabic locale)
- "ALL SYSTEMS OPERATIONAL" live status indicator
- Date display

### Navigation Flow
- Clicking a factory pin or list item → navigates to `/login?factory=FACTORY_ID`
- Login page reads the `?factory=` param and shows a factory context badge

---

## 2. Authentication System

**Route:** `/login`, `/forgot-password`  
**Files:** `apps/web/src/app/(auth)/`, `apps/web/src/features/auth/`, `apps/web/src/store/auth-store.ts`

### Login Page
- Factory context badge at top (shows selected factory name, code, city with brand color)
- "Back to Map" / "Change Factory" link to return to factory selector
- Email + Password form with Zod validation
- Password visibility toggle
- "Remember me for 30 days" checkbox
- Animated error message display
- Single Sign-On (SSO) button (placeholder)
- Security note: "All activity is logged and audited"
- Responsive: full-width on mobile, split panel on desktop with industrial background on left

### Auth Provider (Global Guard)
- Wraps entire app in `AuthProvider` component
- Checks every route change against public/protected route list
- **Public routes:** `/`, `/login`, `/forgot-password`, `/reset-password`
- **Unauthenticated + protected route:** attempts token refresh first, then redirects to `/`
- **Authenticated + public route:** redirects to `/dashboard`
- Auto token refresh timer: refreshes 60 seconds before expiry
- On refresh failure: clears auth state → redirects to factory selector

### Token Management
- JWT access token + refresh token pair
- Tokens stored in Zustand (persisted to `localStorage`)
- Axios interceptor automatically injects `Authorization: Bearer` header
- 401 response interceptor: attempts token refresh → retries request → on failure clears session

### State (Zustand `auth-store`)
- `user` — full user object (name, email, role, permissions, avatar, language, timezone)
- `isAuthenticated` — boolean flag
- `accessToken` / `refreshToken` — stored and persisted
- `hasPermission(permission)` — checks user permissions (ADMIN/SUPER_ADMIN bypass)
- `hasRole(role)` — checks user role
- `logout()` — clears all auth state (navigation handled by callers)

---

## 3. Platform Shell — Navigation & Layout

**Files:** `apps/web/src/components/layout/`

### Sidebar
- Fixed left sidebar, always visible inside the platform
- **Collapsible** — toggle button collapses to icon-only mode (64px) or expands to full (260px)
- Smooth Framer Motion width animation
- Logo section: MES360° brand mark + "MES Platform" subtitle
- **Navigation groups** with expand/collapse sub-menus (chevron animation):
  - Dashboard
  - Production (6 sub-items)
  - Quality (5 sub-items)
  - Maintenance (5 sub-items)
  - Reports (4 sub-items)
  - IIoT & Connectivity (4 sub-items)
  - Plant Hierarchy
  - AI Intelligence (New badge)
  - Notifications (badge with unread count)
- **Badge support** on nav items (count badges, "New" badges, destructive variant for alarms)
- Active route highlighting with brand color
- Tooltips on all items when sidebar is collapsed
- **Back to Map button** (always visible above bottom nav):
  - Shows factory code + "Switch Factory" text when a factory is selected
  - Shows "Back to Map" when no factory context
  - Cyan accent border with gradient background
  - Logout + clear factory + navigate to `/` on click
  - Tooltip when collapsed
- Bottom nav: Users & Roles, Settings
- User profile section at bottom (avatar, name, role)

### Topbar
- Sticky header, 56px height, backdrop blur
- **Breadcrumb navigation** — auto-generated from URL path with human-readable labels
- **Factory Chip** — colored pill badge showing current factory code with pulsing dot (matches factory brand color), only shown when a factory is selected
- **WebSocket connection status** — live/offline indicator with pulse animation
- Search button (global search placeholder)
- **Theme switcher** — Light / Dark / System (dropdown)
- **Notifications bell** — badge with unread count
- **User menu dropdown**:
  - User name, email, role badge
  - My Profile, Settings, Activity Log, Help & Support
  - Sign Out → logs out and navigates to factory selector

### AppShell
- Responsive layout: sidebar + main area
- Main area margin adjusts to sidebar width (collapsed vs expanded) via smooth CSS transition
- Framer Motion page transitions (fade + slide on route change)
- Overflow scroll on main content area

---

## 4. Dashboard

**Route:** `/dashboard`  
**Files:** `apps/web/src/app/(platform)/dashboard/`

- Real-time KPI overview for the selected factory
- OEE gauge chart
- Production trend chart (real-time updates via WebSocket)
- Quality rate indicators
- Active alarms list widget
- Machine status grid
- Shift summary card
- Live data via Socket.IO connection

---

## 5. Production Management

**Routes:** `/production/*`

### Overview (`/production`)
- Production status bar across all work centers
- Shift performance summary
- OEE breakdown (Availability × Performance × Quality)

### Work Orders (`/production/orders`)
- Work order list with status, priority, progress
- Create / edit / close work orders
- Material requirements display

### Batches (`/production/batches`)
- Batch tracking list
- Batch genealogy and traceability
- Start / pause / complete batch actions

### OEE Analytics (`/production/oee`)
- OEE trend chart (daily / weekly / monthly)
- Downtime Pareto chart (top causes ranked by impact)
- Availability, Performance, Quality sub-metric trends
- MTTR / MTBF chart
- Industry benchmark comparison

### Scheduling (`/production/scheduling`)
- Production schedule view
- Shift planning

### Recipes (`/production/recipes`)
- Recipe management list
- Recipe parameters and steps

---

## 6. Quality Management

**Routes:** `/quality/*`

### Overview (`/quality`)
- Quality rate KPI card
- Recent inspection results
- NCR trend

### Inspections (`/quality/inspections`)
- Inspection records list (in-process, incoming, final)
- Pass / Fail / Conditional results
- Linked to work orders and batches

### NCR Management (`/quality/ncr`)
- Non-Conformance Report list
- NCR creation, assignment, disposition
- Badge count in sidebar (3 open NCRs shown in demo)

### CAPA (`/quality/capa`)
- Corrective and Preventive Action tracking
- Root cause analysis linkage
- Effectiveness verification status

### SPC Charts (`/quality/spc`)
- Statistical Process Control charts
- X-bar, R-chart, P-chart support
- Control limit lines (UCL, LCL, CL)
- Out-of-control signal detection

---

## 7. Maintenance Management

**Routes:** `/maintenance/*`

### Overview (`/maintenance`)
- Maintenance KPI cards (MTTR, MTBF, maintenance cost)
- Upcoming PM tasks
- Recent work order status

### Work Orders (`/maintenance/work-orders`)
- Corrective and preventive work order list
- Priority, status, assigned technician
- Estimated vs actual labor hours

### Assets (`/maintenance/assets`)
- Equipment asset register
- Asset details: manufacturer, model, serial, install date
- Maintenance history per asset

### Preventive Maintenance (`/maintenance/preventive`)
- PM schedule calendar
- Recurring task templates (daily, weekly, monthly, hours-based)
- Completion tracking and compliance rate

### Spare Parts (`/maintenance/spare-parts`)
- Spare parts inventory
- Minimum stock alerts
- Linked to work orders for consumption tracking

---

## 8. IIoT & Connectivity

**Routes:** `/iot/*`  
**Backend:** `apps/api/src/modules/iot/`

### Devices (`/iot/devices`)
- Connected device registry
- Device status (online / offline / error)
- Last seen timestamp
- Connection protocol indicator

### Tag Browser (`/iot/tags`)
- Browse all data tags from connected devices
- Real-time tag value display
- Tag metadata (unit, data type, source device)

### Drivers (`/iot/drivers`)
- Configured protocol drivers:
  - **MQTT** — Eclipse Mosquitto broker integration
  - **OPC-UA** — Industrial OPC-UA server connectivity
  - **Modbus TCP** — PLC/SCADA Modbus integration
- Driver status and connection health

### Data Streams (`/iot/streams`)
- Live data stream monitor
- Time-series data routed to InfluxDB
- Stream health and throughput metrics

---

## 9. Plant Hierarchy

**Route:** `/hierarchy`  
**Backend:** `apps/api/src/modules/hierarchy/`

- ISA-95 compliant plant model:
  - Enterprise → Site → Area → Work Center → Work Unit
- Interactive tree view of the factory hierarchy
- Add / edit / delete nodes
- Link IoT devices and tags to hierarchy nodes

---

## 10. Reports

**Routes:** `/reports/*`

### Report Builder (`/reports`)
- Drag-and-drop report builder
- Configurable KPI widgets
- Date range selector
- Export to PDF (jsPDF) and Excel (xlsx)

### Production Reports (`/reports/production`)
- Shift production summary
- OEE trend report
- Work order completion rate

### Quality Reports (`/reports/quality`)
- Inspection pass/fail rates
- NCR trend analysis
- First-pass yield

### Maintenance Reports (`/reports/maintenance`)
- PM compliance rate
- Equipment downtime summary
- Work order backlog report

---

## 11. AI Intelligence

**Route:** `/ai`

- Predictive maintenance anomaly detection
- Production optimization recommendations
- Quality defect pattern analysis
- AI assistant interface
- "New" badge on sidebar nav item

---

## 12. Notifications

**Route:** `/notifications`  
**Store:** `apps/web/src/store/notification-store.ts`

- Notification list with unread count (badge: 7 in demo)
- Real-time notifications via Socket.IO
- Alarm acknowledgement
- Notification categories: Production, Quality, Maintenance, System

---

## 13. Users & Roles

**Route:** `/users`  
**Backend:** `apps/api/src/modules/users/`

### Roles
| Role | Access Level |
|---|---|
| SUPER_ADMIN | Full access, all factories |
| ADMIN | Full access, assigned factory |
| PRODUCTION_MANAGER | Production + Reports |
| QUALITY_ENGINEER | Quality + Reports |
| MAINTENANCE_TECH | Maintenance module |
| OPERATOR | Production read + execute |
| VIEWER | Read-only |

### Features
- User list with role, status, last login
- Invite / create user
- Role assignment
- Permission matrix management
- Audit trail of user actions

---

## 14. Settings

**Route:** `/settings`

- Factory profile configuration
- Shift schedule definition
- Alert thresholds configuration
- Email / SMS notification settings
- System preferences (language, timezone, units)
- Integration configuration (LDAP, SSO)

---

## 15. Infrastructure & DevOps

### Docker Stack (10 Services)

| Service | Image | Port | Purpose |
|---|---|---|---|
| `mes-postgres` | postgres:16-alpine | 5433 | Primary database |
| `mes-redis` | redis:7-alpine | 6379 | Cache + pub/sub |
| `mes-influxdb` | influxdb:2.7 | 8086 | Time-series IoT data |
| `mes-mqtt-broker` | eclipse-mosquitto:2 | 1883, 9002 | MQTT broker |
| `mes-minio` | minio/minio | 9000, 9001 | Object storage |
| `mes-api` | mes360-api | 3001 | NestJS backend |
| `mes-web` | mes360-web | 3000→4000 | Next.js frontend |
| `mes-nginx` | nginx:alpine | 8080, 8443 | Reverse proxy |
| `mes-prometheus` | prom/prometheus | 9090 | Metrics collection |
| `mes-grafana` | grafana/grafana | 3003 | Metrics dashboards |

### Security
- Nginx rate limiting: 10 req/s general, 5 req/s auth endpoints
- HTTP security headers (X-Frame-Options, CSP, HSTS)
- JWT tokens with short expiry + refresh rotation
- RBAC guards on all API endpoints
- Tenant isolation middleware
- Audit logging interceptor

### Monitoring
- Prometheus scrapes API, PostgreSQL, Redis, Nginx metrics
- Grafana provisioned dashboards
- Health check endpoints on all services
- Docker container health checks with restart policies

### Development Workflow
- pnpm workspaces monorepo
- Hot Module Replacement in Next.js dev mode
- Volume-mounted source code for instant changes without rebuild
- `docker compose build --no-cache <service>` to rebuild after `package.json` changes
- After adding new npm packages: `docker compose rm -f -v <service>` → `docker compose up -d <service>`

---

## State Management Summary

| Store | Purpose | Persisted |
|---|---|---|
| `auth-store` | User session, tokens, permissions | `localStorage` |
| `factory-store` | Selected factory context | `localStorage` |
| `ui-store` | Sidebar collapsed state, theme | `localStorage` |
| `notification-store` | Unread notifications count | In-memory |

---

## Known Behaviors

- First page load after container restart takes 20–35 seconds (Next.js dev compilation)
- Subsequent navigations are instant (compiled & cached)
- Port 3000 → web container (direct), Port 8080 → through nginx
- PostgreSQL mapped to 5433 (5432 occupied by local install)
