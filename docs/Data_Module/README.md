# MES360° Platform — Data Module Documentation

This folder documents the **entire data layer** of the MES360° platform: how data is
modeled, stored, exchanged, calculated and surfaced — from the shop-floor edge gateway all
the way up to the executive dashboards.

It is written against the source code (NestJS API + Edge Gateway + Prisma + InfluxDB +
MQTT/WebSocket) and is intended for engineers extending the platform, integrators consuming
the APIs, and analysts who need to understand exactly how OEE numbers are produced.

---

## Document Index

| # | Document | Covers |
|---|----------|--------|
| 1 | [01-architecture-overview.md](01-architecture-overview.md) | The data module as a whole: components, datastores, ISA-95 hierarchy, multi-tenancy, end-to-end data flow. |
| 2 | [02-database-and-prisma.md](02-database-and-prisma.md) | All databases, `PrismaService` architecture, every Prisma model grouped by domain, all enums, the edge-gateway local schema, and migrations/seeds. |
| 3 | [03-rest-api.md](03-rest-api.md) | Every REST endpoint across all 25 modules, global config (prefix, auth, validation, Swagger), guards/roles/permissions. |
| 4 | [04-mqtt-and-websocket.md](04-mqtt-and-websocket.md) | The MQTT topic hierarchy (edge → API), every WebSocket event, room/subscription model, and the full real-time data flow. |
| 5 | [05-oee-and-at-oee.md](05-oee-and-at-oee.md) | OEE / AT-OEE formulas, live vs periodic vs analytical calculation, hierarchy roll-up (machine → line → area → factory), and where each dashboard reads its numbers. |
| 6 | [06-downtime-machine-status-and-jo-live.md](06-downtime-machine-status-and-jo-live.md) | Planned vs unplanned downtime classification & how it's created/reflected, machine status & state timeline, and the full Job-Order live dashboard calculations. |
| 7 | [07-dashboard-kpi-oee-validation-and-remediation.md](07-dashboard-kpi-oee-validation-and-remediation.md) | Assessment of why dashboards show empty/wrong/inconsistent values: 12 root causes, data-source matrix, recommendations (Deliverables 1 & 2). |
| 8 | [08-remediation-implementation.md](08-remediation-implementation.md) | What was implemented & verified (Wave 1 backend single-source-of-truth, AT-OEE everywhere, trend fallback) + staged Wave 2 frontend plan (Deliverables 3 & 4). |
| 9 | [09-acceptance-and-go-live-readiness.md](09-acceptance-and-go-live-readiness.md) | Acceptance package: Go-Live readiness assessment, functional UAT checklist, per-KPI data validation checklist, and demonstration scenarios. |

---

## The data module at a glance

```
┌───────────────────────────────────────────────────────────────────────────┐
│                            MES360° DATA MODULE                              │
│                                                                             │
│  Shop floor          Edge                Cloud / On-prem server             │
│  ──────────          ────                ─────────────────────              │
│  PLC / Meter ──Modbus──► Edge Gateway ──MQTT──► API (NestJS)                 │
│  (registers)            (apps/edgegateway)      (apps/api)                   │
│                          │   │   │               │   │   │                   │
│                          │   │   └─ PostgreSQL ◄──┘   │   └─► WebSocket ──►   │
│                          │   └──── InfluxDB ◄─────────┘        (browsers)    │
│                          └──── disk buffer (store-and-forward)               │
└───────────────────────────────────────────────────────────────────────────┘
```

- **PostgreSQL** — the system of record (Prisma ORM, ~108 models). Master data, transactions,
  current values, calculated KPIs.
- **InfluxDB** — the historian (time-series): per-minute OEE samples, tag history,
  production/energy trends.
- **MQTT** — the telemetry bus between edge gateways and the API.
- **WebSocket (Socket.io)** — the push channel from the API to browser dashboards.

## Key facts (verify against code when extending)

- API global prefix: **`/api/v1`** (configurable via `API_PREFIX`; `/health` and `/metrics` excluded). Swagger UI at `{prefix}/docs`.
- Auth: **JWT Bearer**, factory-scoped, with refresh-token sessions. RBAC via `@Roles` + permission strings via `@RequirePermissions`.
- Multi-tenancy: every transactional model carries `factoryId`; `SUPER_ADMIN` has `factoryId = null` for global access.
- OEE is **ISO 22400 style** (`OEE = Availability × Performance × Quality`). Roll-up is **quantity-weighted**, never an average of percentages. Two availability flavors are tracked: schedule-based (`availability`) and time-based (`availabilityTb`, the "AT-OEE" interpretation). See doc 5.

> Source paths referenced throughout are relative to the repository root, e.g.
> [apps/api/src/modules/production/oee.service.ts](../../apps/api/src/modules/production/oee.service.ts).
