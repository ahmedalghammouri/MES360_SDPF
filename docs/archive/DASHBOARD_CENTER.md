# MES360° — Dashboard Center

A unified **dashboard catalog & launcher**. It is the single place where users
discover, search, organize, launch and manage dashboards — without replacing any
existing module dashboard.

MES360° remains the **system of record, authentication, authorization, factory
context and ISA-95 context provider**. **Grafana** is the dashboard / visualization /
designer engine. Grafana features are *integrated*, not re-implemented in Next.js.

---

## 1. Capabilities

| Capability | Status |
|---|---|
| Dashboard catalog (search / filter / categorize) | ✅ |
| Favorites (per user) | ✅ |
| Categories (system + custom) | ✅ |
| Launch dashboards (native, report, Grafana, external) | ✅ |
| Embedded dashboard viewer (preserves MES360° chrome) | ✅ |
| Factory-aware dashboards (Factory / Area / Line / Machine / Shift / Product / Batch) | ✅ |
| Dashboard templates (clone-to-create) | ✅ |
| Dashboard permissions (role + user grants) | ✅ |
| Grafana integration (embed + discovery + health) | ✅ |
| Graceful degradation when Grafana is absent | ✅ |

Existing modules, routes and functionality are **unchanged**. Everything here is additive.

---

## 2. Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  MES360° (Next.js)                                                 │
│  AppShell = Sidebar + Topbar + Factory selector  ← chrome preserved │
│                                                                     │
│  /dashboard-center            → Catalog (DashboardCenterView)       │
│  /dashboard-center/[id]       → Embedded viewer (iframe + toolbar)  │
└──────────────┬─────────────────────────────────────────────────────┘
               │ Bearer JWT (MES360° auth)
               ▼
┌────────────────────────────────────────────────────────────────────┐
│  MES360° API (NestJS)  — /api/v1/dashboards/*                      │
│  DashboardsService   → catalog / favorites / categories / perms     │
│  GrafanaService      → embed URL builder + Grafana HTTP API client  │
│  Postgres (Prisma)   → Dashboard, DashboardCategory, …              │
└──────────────┬─────────────────────────────────────────────────────┘
               │ server→server (service-account token, never to browser)
               ▼
┌────────────────────────────────────────────────────────────────────┐
│  Grafana   — render engine, designer, datasources                   │
│  Embedded via reverse proxy + auth.proxy (SSO from MES360°)        │
└────────────────────────────────────────────────────────────────────┘
```

### Why the embedded viewer "feels like MES360°"
The viewer route lives under the `(platform)` route group, whose layout is `AppShell`
(sidebar + topbar + factory selector). The Grafana dashboard is rendered in an
`<iframe>` in **kiosk mode** (`&kiosk`), which hides Grafana's own chrome. The
MES360° toolbar on top provides back-to-catalog, factory badge, time range, reload
and open-in-new-tab. Authentication and permissions are enforced by MES360° before
the embed URL is ever produced.

---

## 3. Data model (Prisma)

All models are **isolated/additive** (indexed FK columns, no edits to core models).

- **`Dashboard`** — a catalog entry. `source` ∈ `MES360_NATIVE | GRAFANA | REPORT | EXTERNAL | TEMPLATE`.
  - Native/report → `route` (internal Next.js path).
  - Grafana → `grafanaUid`, `grafanaSlug`, `grafanaOrgId`.
  - External → `externalUrl`.
  - Factory-aware fields: `isFactoryAware`, `supportedScopes[]` (`FACTORY|AREA|LINE|MACHINE|SHIFT|PRODUCT|BATCH`), `defaultTimeRange`, `refreshInterval`.
  - Governance: `visibility` (`PRIVATE|FACTORY|ENTERPRISE|PUBLIC`), `isSystem`, `isPublished`, `isTemplate`, `templateOfId`, `createdById`, `viewCount`.
- **`DashboardCategory`** — `key`, `name`, `icon`, `color`; `factoryId = null` ⇒ global.
- **`DashboardFavorite`** — unique `(dashboardId, userId)`.
- **`DashboardPermission`** — grants `VIEW|EDIT|MANAGE` to a `role` **or** `userId`.

### Migration
A migration is provided at `apps/api/prisma/migrations/<ts>_dashboard_center/migration.sql`
(additive: 4 enums + 4 tables). Apply with either:

```bash
# Dev environments managed by db push (this repo's default):
pnpm --filter @mes360/api exec prisma db push

# Migration-history environments (production):
pnpm --filter @mes360/api exec prisma migrate deploy
```

Seed the built-in catalog (idempotent — runs inside the main seed):

```bash
pnpm --filter @mes360/api run seed
```

This creates **9 system categories** and **19 catalog entries** that point at the
existing MES360° module dashboards/analytics/reports, plus 3 Grafana templates.

---

## 4. Access control

Resolved server-side in `DashboardsService`:

- `SUPER_ADMIN` → sees everything.
- Otherwise a dashboard is visible if **factory scope** matches (`factoryId == user.factoryId` or global `null`) **and** one of:
  - `visibility = PUBLIC | ENTERPRISE | FACTORY`, or
  - `visibility = PRIVATE` and the user is the creator, or
  - an explicit `DashboardPermission` grant for the user's `role` or `userId`.
- **Manage** (edit/delete/permissions) requires: creator, factory admin (`FACTORY_ADMIN`/`PLANT_MANAGER`) of the same factory, super admin, or a `MANAGE` grant.
- `isSystem` dashboards cannot be deleted (and only `SUPER_ADMIN` can edit them).

---

## 5. Factory-aware context

The selected factory in MES360° (`useFactoryStore`) is automatically passed to the
embed resolver. `GET /dashboards/:id/embed` resolves context (factory id + code, and
optional Area/Line/Machine/Shift/Product/Batch + time range/theme) and:

- **Grafana** → builds a kiosk URL injecting Grafana template variables:
  `var-factory=<code>&var-factoryId=<id>&var-area=…&var-line=…&var-machine=…&var-shift=…&var-product=…&var-batch=…`
  plus `from`, `to`, `refresh`, `theme`. Only scopes listed in `supportedScopes` are injected.
- **Native/Report** → returns the internal `route` (opened directly in MES360°).
- **External** → returns `externalUrl` with `?factory=<code>&factoryId=<id>` appended when factory-aware.

The Grafana template variable name is configurable via `GRAFANA_FACTORY_VAR` (default `factory`).

---

## 6. API reference (`/api/v1/dashboards`)

All endpoints require a valid MES360° JWT (global `JwtAuthGuard`).

| Method | Path | Description |
|---|---|---|
| `GET` | `/dashboards` | List/search catalog. Query: `search, source, type, category, favorites, templates, tags` |
| `GET` | `/dashboards/categories` | Categories with dashboard counts |
| `POST` | `/dashboards/categories` | Create category (admin) |
| `GET` | `/dashboards/:id` | Single dashboard (access-checked) |
| `GET` | `/dashboards/:id/embed` | Resolve launch/embed target with factory context |
| `POST` | `/dashboards` | Create a dashboard / catalog entry |
| `POST` | `/dashboards/:id/clone` | Clone a template/dashboard into a private copy |
| `PATCH` | `/dashboards/:id` | Update (manage perm) |
| `DELETE` | `/dashboards/:id` | Soft-delete (manage perm; not `isSystem`) |
| `POST` | `/dashboards/:id/favorite` | Toggle favorite |
| `GET` | `/dashboards/:id/permissions` | List grants (manage perm) |
| `POST` | `/dashboards/:id/permissions` | Grant `{ role? , userId?, level }` |
| `DELETE` | `/dashboards/:id/permissions/:permissionId` | Revoke grant |
| `GET` | `/dashboards/grafana/health` | Grafana integration status |
| `GET` | `/dashboards/grafana/available` | Browse importable Grafana dashboards (admin) |

Full schema is published in Swagger at `/api/docs` under **Dashboard Center**.

---

## 7. Grafana integration & deployment

### 7.1 Environment variables (API)

```env
# Server-side Grafana origin (HTTP API calls, token-authenticated)
GRAFANA_URL=http://grafana:3000
# Browser-facing base for iframe embedding — usually a reverse-proxied path
GRAFANA_PUBLIC_URL=/grafana
# Grafana service-account token (server→Grafana only; never sent to the browser)
GRAFANA_SA_TOKEN=glsa_xxx
GRAFANA_DEFAULT_ORG_ID=1
# Grafana template variable that carries factory context
GRAFANA_FACTORY_VAR=factory
```

If `GRAFANA_URL`/`GRAFANA_PUBLIC_URL` are unset, the catalog still works fully for
native/report/external dashboards; Grafana entries show a "not configured" state.

### 7.2 Recommended SSO embedding (auth.proxy)

MES360° is the identity provider. Put Grafana behind the same origin via a reverse
proxy that performs a MES360° auth check and injects the Grafana auth.proxy header.

**nginx (sketch):**
```nginx
location /grafana/ {
  auth_request /__auth;                 # validates MES360° session/JWT
  auth_request_set $user $upstream_http_x_user_email;
  proxy_set_header X-WEBAUTH-USER $user; # Grafana trusts this header
  proxy_pass http://grafana:3000/;
}
```

**Grafana `grafana.ini`:**
```ini
[auth.proxy]
enabled = true
header_name = X-WEBAUTH-USER
header_property = email
auto_sign_up = true
[security]
allow_embedding = true
[users]
viewers_can_edit = false
```

Embedding only works when `allow_embedding = true` and the proxy serves Grafana from
the **same origin** as MES360° (so the iframe is not blocked by `X-Frame-Options`).

### 7.3 Provisioning factory-aware Grafana dashboards

1. Add a MES360° datasource in Grafana (Postgres/InfluxDB pointing at the MES data).
2. In each dashboard, create template variables named to match the embed contract:
   `factory`, `factoryId`, `area`, `line`, `machine`, `shift`, `product`, `batch`.
3. Use them in panel queries, e.g. `WHERE factory_code = '$factory'`.
4. Register the dashboard in the catalog (admin): `POST /dashboards` with
   `source: GRAFANA`, the `grafanaUid`, and the relevant `supportedScopes`.
   Or browse `GET /dashboards/grafana/available` to import.

---

## 8. Frontend map

| File | Purpose |
|---|---|
| `app/(platform)/dashboard-center/page.tsx` | Catalog route |
| `app/(platform)/dashboard-center/[id]/page.tsx` | Embedded viewer route |
| `features/dashboard-center/dashboard-center-view.tsx` | Catalog UI (search, filters, categories, favorites, tabs) |
| `features/dashboard-center/dashboard-card.tsx` | Dashboard card + dynamic icon resolver |
| `features/dashboard-center/embedded-dashboard-viewer.tsx` | Factory-aware toolbar + Grafana iframe |
| `features/dashboard-center/use-dashboard-center.ts` | React-Query hooks + types |
| `components/layout/sidebar.tsx` | "Dashboard Center" nav entry |

Launch behavior:
- **Native / Report** → navigates to the existing in-app route (no iframe).
- **Grafana / External** → opens the embedded viewer at `/dashboard-center/[id]`.
- **Template** → clones into a private dashboard, then opens it.

---

## 9. Security notes

- The Grafana **service-account token is never exposed to the browser** — only the
  server uses it (search/health). Browser embedding relies on the same-origin reverse
  proxy + auth.proxy, so the user's MES360° session is the source of truth.
- The iframe is sandboxed (`allow-scripts allow-same-origin allow-forms allow-popups
  allow-downloads`) and uses `referrerPolicy=strict-origin-when-cross-origin`.
- All catalog mutations are permission-checked server-side; `isSystem` entries are
  protected from deletion.
