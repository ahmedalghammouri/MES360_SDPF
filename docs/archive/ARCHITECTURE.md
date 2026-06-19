# MES360° — Architecture

System design, module relationships, data flows, and integration patterns.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Network Topology](#2-network-topology)
3. [Frontend Architecture (Next.js)](#3-frontend-architecture-nextjs)
4. [Backend Architecture (NestJS)](#4-backend-architecture-nestjs)
5. [Database Design](#5-database-design)
6. [Authentication & Authorization Flow](#6-authentication--authorization-flow)
7. [Real-Time Architecture (WebSocket)](#7-real-time-architecture-websocket)
8. [IIoT Data Pipeline](#8-iiiot-data-pipeline)
9. [State Management](#9-state-management)
10. [Multi-Tenancy Model](#10-multi-tenancy-model)

---

## 1. System Overview

MES360° is a **multi-tier, real-time enterprise application** composed of:

| Tier | Technology | Responsibility |
|---|---|---|
| Client | Next.js 15 (React 19) | UI rendering, client state, real-time display |
| API | NestJS 10 (Node.js) | Business logic, REST endpoints, WebSocket gateway |
| Relational DB | PostgreSQL 16 | Persistent structured data (users, orders, assets…) |
| Time-Series DB | InfluxDB 2.7 | IoT telemetry, sensor readings, OEE time-series |
| Cache/PubSub | Redis 7 | Session cache, pub/sub broker for WebSocket fan-out |
| Message Broker | Eclipse Mosquitto | MQTT IIoT ingestion from PLCs/sensors |
| Object Storage | MinIO | Reports, images, document attachments |
| Reverse Proxy | Nginx Alpine | TLS termination, routing, rate limiting |
| Metrics | Prometheus + Grafana | Operational monitoring |

---

## 2. Network Topology

```
                          ┌───────────────────────────────────────┐
                          │           Docker Network               │
                          │           mes-network (bridge)         │
  Browser                 │                                        │
     │                    │  ┌────────────┐    /api/*              │
     │─── :8080 ──────────┼─►│   Nginx    │──────────────────────►│── NestJS :3001
     │                    │  │  :80/:443  │    /*                  │   │
     │─── :3000 ──────────┼─►│            │──────────────────────►│── Next.js :4000
     │                    │  └────────────┘                        │   │
     │                    │                                        │   ├── Prisma ──► PostgreSQL :5432
     │                    │                                        │   ├── Redis      :6379
     │                    │                                        │   ├── InfluxDB   :8086
     │                    │                                        │   ├── MQTT ────► Mosquitto  :1883
     │                    │                                        │   └── MinIO      :9000
     │                    │                                        │
     │─── :3003 ──────────┼────────────────────────────────────►  │── Grafana  :3000
     │─── :9090 ──────────┼────────────────────────────────────►  │── Prometheus :9090
     │─── :9001 ──────────┼────────────────────────────────────►  │── MinIO Console :9001
     │                    └───────────────────────────────────────┘
```

**Port Mapping (host → container):**

| Host Port | Container Port | Service |
|---|---|---|
| 3000 | 4000 | Next.js web app |
| 3001 | 3001 | NestJS REST API |
| 3003 | 3000 | Grafana |
| 5433 | 5432 | PostgreSQL (5432 used by local install) |
| 6379 | 6379 | Redis |
| 8080 | 80 | Nginx (HTTP) |
| 8443 | 443 | Nginx (HTTPS) |
| 8086 | 8086 | InfluxDB |
| 9000 | 9000 | MinIO S3 API |
| 9001 | 9001 | MinIO Console |
| 9090 | 9090 | Prometheus |
| 1883 | 1883 | MQTT (TCP) |
| 9002 | 9001 | MQTT (WebSocket) |

---

## 3. Frontend Architecture (Next.js)

### App Router Layout

```
src/app/
├── page.tsx                    # Route: /  — Factory Selector (public)
├── layout.tsx                  # Root layout: ThemeProvider, QueryClient, AuthProvider
│
├── (auth)/                     # Route group — no AppShell
│   ├── login/page.tsx          # Route: /login
│   └── forgot-password/page.tsx
│
└── (platform)/                 # Route group — wrapped in AppShell
    ├── layout.tsx              # AppShell: Sidebar + Topbar
    ├── dashboard/page.tsx
    ├── production/
    │   ├── page.tsx            # /production
    │   ├── orders/page.tsx
    │   ├── batches/page.tsx
    │   ├── oee/page.tsx
    │   ├── scheduling/page.tsx
    │   └── recipes/page.tsx
    ├── quality/...
    ├── maintenance/...
    ├── reports/...
    ├── iot/...
    ├── hierarchy/page.tsx
    ├── ai/page.tsx
    ├── notifications/page.tsx
    ├── users/page.tsx
    └── settings/page.tsx
```

### Component Hierarchy

```
RootLayout
  └── Providers (ThemeProvider, QueryClientProvider)
        └── AuthProvider (global route guard)
              ├── page.tsx  (factory selector — public route)
              ├── (auth)/login/page.tsx  (public route)
              └── (platform)/layout.tsx
                    └── AppShell
                          ├── Sidebar
                          │     ├── NavGroup (collapsible sections)
                          │     ├── NavItem (with badges)
                          │     └── BackToMapButton
                          ├── Topbar
                          │     ├── Breadcrumb
                          │     ├── FactoryChip
                          │     ├── WSStatusIndicator
                          │     ├── ThemeSwitcher
                          │     ├── NotificationBell
                          │     └── UserMenuDropdown
                          └── <Page /> (Framer Motion animated)
```

### Routing & Navigation Guard

The `AuthProvider` component wraps every page and enforces access rules:

```
Request arrives at a route
         │
         ▼
   isPublicRoute(pathname)?
   ─────────────────────────────────────
   YES                          NO
    │                            │
    ├─ isAuthenticated?          ├─ isAuthenticated?
    │   YES → redirect /dashboard│   YES → render page ✓
    │   NO  → render page ✓      │   NO  → try refreshToken()
                                 │         ├─ success → render page ✓
                                 │         └─ fail   → redirect /
```

Public routes: `/`, `/login`, `/forgot-password`, `/reset-password`

### Data Fetching Strategy

| Pattern | Tool | Use Case |
|---|---|---|
| Server state cache | TanStack Query | API data with stale-while-revalidate |
| Client state | Zustand | Auth session, selected factory, UI prefs |
| Real-time updates | Socket.IO | Live KPIs, alarms, dashboard charts |
| Forms | React Hook Form + Zod | All create/edit forms |
| Tables | TanStack Table | Paginated lists (orders, assets, NCRs…) |

---

## 4. Backend Architecture (NestJS)

### Module Structure

```
src/
├── main.ts                     # Bootstrap: Swagger, global pipes, CORS, Helmet
├── app.module.ts               # Root module, global config
│
├── modules/
│   ├── auth/                   # JWT strategy, login, refresh, guard
│   ├── users/                  # User CRUD, role management
│   ├── production/             # Work orders, batches, OEE, scheduling, recipes
│   ├── quality/                # Inspections, NCR, CAPA, SPC
│   ├── maintenance/            # Work orders, assets, PM schedules, spare parts
│   ├── iot/                    # Device registry, tags, drivers, data streams
│   ├── hierarchy/              # ISA-95 plant tree (Enterprise→Work Unit)
│   ├── reports/                # Report builder, PDF/Excel export
│   ├── notifications/          # Notification storage, delivery
│   └── ai/                     # Anomaly detection, recommendations
│
├── gateways/
│   └── mes.gateway.ts          # Socket.IO WebSocket gateway (single namespace)
│
├── common/
│   ├── guards/                 # JwtAuthGuard, RolesGuard, PermissionsGuard
│   ├── decorators/             # @Roles(), @Permissions(), @CurrentUser()
│   ├── interceptors/           # AuditLogInterceptor, ResponseTransformInterceptor
│   ├── filters/                # AllExceptionsFilter
│   └── middleware/             # TenantMiddleware (factory isolation)
│
└── database/
    └── prisma.service.ts       # Prisma client singleton
```

### Request Lifecycle

```
HTTP Request
     │
     ▼
Nginx (rate limit, routing)
     │
     ▼
NestJS main.ts (Helmet headers, global validation pipe)
     │
     ▼
TenantMiddleware  ── extracts factoryId from JWT / header
     │
     ▼
JwtAuthGuard  ── verifies Bearer token, attaches user to request
     │
     ▼
RolesGuard / PermissionsGuard  ── checks @Roles() / @Permissions()
     │
     ▼
Controller  ── validates DTOs (class-validator)
     │
     ▼
Service  ── business logic
     │
     ▼
Prisma  ── scoped query (always includes factoryId filter)
     │
     ▼
AuditLogInterceptor  ── logs mutation to audit_logs table
     │
     ▼
ResponseTransformInterceptor  ── wraps in { data, meta, timestamp }
     │
     ▼
HTTP Response
```

### API Conventions

- Base path: `/api/v1`
- Swagger UI: `/api/docs`
- All responses: `{ data: T, meta?: PaginationMeta, timestamp: string }`
- Pagination params: `?page=1&limit=20&sortBy=createdAt&order=DESC`
- Date filtering: `?from=2026-01-01&to=2026-01-31` (ISO 8601)

---

## 5. Database Design

### PostgreSQL (Prisma ORM)

**Core entities and relationships:**

```
Factory (1)──(n) User
Factory (1)──(n) WorkOrder
Factory (1)──(n) Batch
Factory (1)──(n) Asset
Factory (1)──(n) Inspection
Factory (1)──(n) NonConformanceReport
Factory (1)──(n) MaintenanceWorkOrder
Factory (1)──(n) Device
Factory (1)──(n) HierarchyNode

User (1)──(n) AuditLog
User (m)──(n) Role ──(m)──(n) Permission

WorkOrder (1)──(n) Batch
Batch (1)──(n) Inspection
Asset (1)──(n) MaintenanceWorkOrder
Asset (1)──(n) PreventiveMaintenance
NonConformanceReport (1)──(n) CAPA
Device (1)──(n) Tag
HierarchyNode (1)──(n) HierarchyNode  (self-referential tree)
HierarchyNode (1)──(n) Tag
```

**Key tables:**

| Table | Purpose |
|---|---|
| `factories` | Factory registry (code, name, city, coordinates, color) |
| `users` | User accounts with role and factory assignment |
| `roles` | RBAC roles (SUPER_ADMIN, ADMIN, OPERATOR…) |
| `permissions` | Granular permission strings |
| `work_orders` | Production work orders (planned/active/closed) |
| `batches` | Production batch records with genealogy |
| `assets` | Equipment asset register |
| `inspections` | QC inspection records |
| `ncrs` | Non-conformance reports |
| `capas` | Corrective/preventive actions |
| `maintenance_work_orders` | Corrective & PM work orders |
| `spare_parts` | Spare parts inventory |
| `devices` | IIoT device registry |
| `tags` | Device data tags with metadata |
| `hierarchy_nodes` | ISA-95 plant tree nodes |
| `notifications` | Notification records |
| `audit_logs` | Immutable activity log |

### InfluxDB (Time-Series)

Used exclusively for high-frequency IoT sensor data.

**Measurement schema:**

```
Measurement: sensor_readings
Tags:
  factory_id   = "SDPF"
  device_id    = "PLC-001"
  tag_name     = "motor_temp"
Fields:
  value        = 87.4   (float)
  quality      = 192    (int, OPC-UA quality code)
Timestamp: nanosecond precision
```

**Retention policies:**
- Raw data: 30 days
- 1-minute downsampled: 1 year
- 1-hour downsampled: 5 years

---

## 6. Authentication & Authorization Flow

### Login Sequence

```
Client                     NestJS API               PostgreSQL
  │                             │                        │
  │── POST /auth/login ─────────►                        │
  │   { email, password }       │── find user by email ──►
  │                             │◄── user record ─────────
  │                             │
  │                             │── bcrypt.compare(password, hash)
  │                             │
  │                             │── sign accessToken (15min)
  │                             │── sign refreshToken (7d)
  │                             │── store refreshToken hash in DB
  │                             │
  │◄── 200 { accessToken,  ─────
  │          refreshToken, user }
  │
  │── store tokens in Zustand (localStorage)
  │── start refresh timer (fires at expiry - 60s)
```

### Token Refresh Sequence

```
Client (Axios interceptor)         NestJS API
  │                                    │
  │── any request ──────────────────►  │
  │◄── 401 Unauthorized ────────────── │
  │
  │── POST /auth/refresh ────────────► │
  │   Authorization: Bearer <refresh>  │── verify refresh token
  │                                    │── validate hash in DB
  │◄── 200 { accessToken,  ──────────  │── rotate refresh token
  │          refreshToken }            │
  │
  │── update Zustand store
  │── retry original request with new accessToken
```

### RBAC Model

```
User ──has──► Role ──has──► Permission[]

Roles (ordered by privilege):
  SUPER_ADMIN   → all permissions, all factories
  ADMIN         → all permissions, own factory
  PRODUCTION_MANAGER → production.* + reports.*
  QUALITY_ENGINEER   → quality.* + reports.*
  MAINTENANCE_TECH   → maintenance.*
  OPERATOR           → production.read + production.execute
  VIEWER             → *.read on own factory

Permission format: <module>.<action>
  Examples: production.create, quality.ncr.approve, maintenance.asset.delete
```

---

## 7. Real-Time Architecture (WebSocket)

### Architecture

```
NestJS MesGateway (Socket.IO)
       │
       ├── authenticates connection via JWT query param
       ├── joins client to room: factory:<factoryId>
       │
       └── emits events:
             production.update   → dashboard production KPIs
             oee.update          → live OEE metrics
             alarm.new           → new alarm raised
             alarm.acknowledged  → alarm cleared
             machine.status      → machine state change
             notification.new    → push notification to user
```

### Client Integration

```typescript
// Socket connects on platform entry, disconnects on leaving
const socket = io(API_URL, {
  auth: { token: accessToken },
  transports: ['websocket'],
});

socket.emit('join:factory', factoryId);

socket.on('production.update', (data) => {
  queryClient.setQueryData(['production', 'live'], data);
});
```

### Redis PubSub (Fan-out)

When multiple API instances run (horizontal scaling), Redis pub/sub ensures events emitted on any instance reach all connected clients:

```
IoT Ingest Service
       │── publish event ──► Redis channel: factory:SDPF:events
                                     │
                                     ▼
                         All NestJS instances subscribed
                                     │
                                     ▼
                         Socket.IO emit to room: factory:SDPF
```

---

## 8. IIoT Data Pipeline

### Ingestion Flow

```
Physical Device (PLC / Sensor)
       │
       │── MQTT publish ──► Mosquitto broker :1883
       │                         │
       │                         ▼
       │                    MES MQTT Driver
       │                    (NestJS IoT module)
       │                         │
       │                         ├── normalize to internal schema
       │                         ├── validate tag exists in registry
       │                         │
       │                         ├── write to InfluxDB (time-series storage)
       │                         │
       │                         └── publish to Redis → WebSocket fan-out
       │                                                      │
       │                                                      ▼
       │                                             Browser dashboard
       │                                             (live chart update)
       │
       │── OPC-UA read ──► NestJS OPC-UA Driver (polling / subscription)
       │── Modbus TCP ───► NestJS Modbus Driver (polling)
```

### Supported Protocols

| Protocol | Mechanism | Typical Source |
|---|---|---|
| MQTT | Pub/sub, push-based | IoT sensors, edge gateways |
| OPC-UA | Client-server, subscription | SCADA systems, modern PLCs |
| Modbus TCP | Polling | Legacy PLCs, VFDs |

---

## 9. State Management

### Zustand Stores

```typescript
// auth-store — user session
{
  user: User | null,
  accessToken: string | null,
  refreshToken: string | null,
  isAuthenticated: boolean,
  setAuth(user, access, refresh): void,
  logout(): void,          // clears state only; callers handle navigation
  hasPermission(p): boolean,
  hasRole(r): boolean,
}

// factory-store — selected factory context
{
  selectedFactory: Factory | null,
  setFactory(factory): void,
  clearFactory(): void,
}

// ui-store — layout preferences
{
  sidebarCollapsed: boolean,
  theme: 'light' | 'dark' | 'system',
  toggleSidebar(): void,
  setTheme(theme): void,
}

// notification-store — in-memory (not persisted)
{
  notifications: Notification[],
  unreadCount: number,
  addNotification(n): void,
  markAllRead(): void,
}
```

**Persistence:** `auth-store`, `factory-store`, `ui-store` are persisted to `localStorage` via Zustand's `persist` middleware. `notification-store` is in-memory only.

### TanStack Query

All server state (API data) flows through TanStack Query:

- Automatic background refetching
- Stale-while-revalidate caching
- Optimistic updates on mutations
- Query key structure: `[module, resource, id?, filters?]`

---

## 10. Multi-Tenancy Model

MES360° uses **factory-level isolation** (tenant = factory).

### Isolation Mechanism

1. **Authentication**: JWT payload includes `factoryId` (or `SUPER_ADMIN` flag)
2. **Middleware**: `TenantMiddleware` extracts `factoryId` from token and attaches it to the request context
3. **Service layer**: Every Prisma query includes `where: { factoryId: context.factoryId }` — enforced by convention and code review
4. **SUPER_ADMIN bypass**: Super admins can query across all factories by passing an explicit `?factoryId=` parameter

### Factory Selector Flow

```
User visits /
    │
    ▼
Factory Selector page (public, no auth needed)
    │── shows all 5 NCC factories on real map
    │── user selects a factory
    │
    ▼
Navigate to /login?factory=SDPF
    │── factory-store.setFactory(selectedFactory)
    │── login form shows factory context badge
    │
    ▼
Login succeeds
    │── JWT includes factoryId: "SDPF"
    │── all subsequent API calls are scoped to SDPF
    │── topbar shows SDPF chip
    │
    ▼
Sidebar "Back to Map" button
    │── logout() + clearFactory() + navigate('/')
    │── user can select a different factory
```

---

*© 2026 MES360° — Architecture Reference*
