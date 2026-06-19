# 03 — REST API Reference

Complete catalog of the MES360° REST API (NestJS). Controllers live under
[apps/api/src/modules](../../apps/api/src/modules); global wiring is in
[apps/api/src/main.ts](../../apps/api/src/main.ts).

---

## 1. Global configuration

- **Base path:** `/api/v1` (set by `API_PREFIX`; `/health` and `/metrics` are excluded from the prefix).
- **Swagger / OpenAPI:** `{prefix}/docs`, JWT bearer auth configured.
- **Auth:** `JwtAuthGuard` applied globally → every route needs a Bearer token unless decorated `@Public`.
- **Authorization:** RBAC via `@Roles(...)` and fine-grained permission strings via
  `@RequirePermissions('module:action')`. `@CurrentUser()` injects `{ userId, factoryId, roles, permissions }`.
- **Validation:** global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` + `transform`.
- **Security/infra:** Helmet (CSP), CORS (localhost + LAN ranges + mes360.com/sa), gzip
  compression, trust-proxy, Winston logging.
- **Global filters/interceptors:** `HttpExceptionFilter`, `TransformInterceptor` (standard
  response envelope), `AuditInterceptor` (writes `AuditLog`). `@AuditLog()` marks audited writes.
- **Pagination:** `?page`/`?limit`; exposed headers `X-Total-Count`, `X-Page`, `X-Per-Page`.

> All paths below are relative to `/api/v1`. ~25 modules, 400+ endpoints.

---

## 2. Auth (`/auth`)
| Method | Path | Description | Access |
|--------|------|-------------|--------|
| GET | `/auth/factories` | Factory selector list | Public |
| GET | `/auth/factories/overview` | Factories + live KPIs (landing) | Public |
| POST | `/auth/login` | Factory-scoped login → JWT + refresh | Public, throttled 10/min |
| POST | `/auth/refresh` | Refresh access token | Public |
| POST | `/auth/logout` | Revoke all sessions | Bearer |
| GET | `/auth/me` | Current user profile | Bearer |
| PATCH | `/auth/change-password` | Change password (needs current) | Bearer |
| POST | `/auth/forgot-password` | Request reset email | Public, throttled 3/min |
| POST | `/auth/reset-password` | Reset via token | Public, throttled 5/min |

## 3. Users (`/users`)
| Method | Path | Description | Access |
|--------|------|-------------|--------|
| GET | `/users` | List (search/role/pagination) | SUPER_ADMIN, FACTORY_ADMIN, PLANT_MANAGER |
| GET | `/users/:id` | Get one | Bearer |
| POST | `/users` | Create | SUPER_ADMIN, FACTORY_ADMIN |
| PATCH | `/users/:id` | Update | Bearer |
| DELETE | `/users/:id` | Deactivate | SUPER_ADMIN, FACTORY_ADMIN |

## 4. Health (`/health`)
| Method | Path | Description | Access |
|--------|------|-------------|--------|
| GET | `/health` | DB + API health (outside global prefix) | Public |

## 5. Hierarchy (`/hierarchy`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/hierarchy/tree` | Full ISA-95 tree |
| GET | `/hierarchy/factories` | Accessible factories |
| GET | `/hierarchy/areas` | Areas in factory |
| GET | `/hierarchy/lines` | Lines (`?areaId`) |
| GET | `/hierarchy/machines` | Machines (`?areaId,?lineId,?type`) |
| POST | `/hierarchy` | Create node (AREA/PRODUCTION_LINE/MACHINE) |
| PATCH | `/hierarchy/:id` | Update node |
| DELETE | `/hierarchy/:id` | Soft-delete node (`body:{type}`) |
| GET | `/hierarchy/workcenters/tree` | WorkCenter tree (PLANT>AREA>LINE>CELL) |
| GET | `/hierarchy/workcenters` | Flat list (`?level`) |
| GET | `/hierarchy/workcenters/:id/path` | Breadcrumb path |
| POST/PATCH/DELETE | `/hierarchy/workcenters[/:id]` | CRUD work centers |

## 6. Dashboard — live ops (`/dashboard`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard/overview` | Real-time ops payload (`?areaId,?lineId,?machineId,?timeframe,?dateFrom,?dateTo`) |
| GET | `/dashboard/kpis` | Current shift KPIs (`?areaId,?lineId,?machineId`) |

## 7. Dashboards — catalog / Dashboard Center (`/dashboards`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboards` | List/search catalog (visibility-filtered) |
| GET | `/dashboards/categories` | Categories + counts |
| POST | `/dashboards/categories` | Create category |
| GET | `/dashboards/grafana/health` | Grafana integration health |
| GET | `/dashboards/grafana/available` | Browse importable Grafana dashboards |
| GET | `/dashboards/:id` | Get one |
| GET | `/dashboards/:id/embed` | Resolve embed/open with factory context |
| POST | `/dashboards` | Create catalog entry |
| POST | `/dashboards/:id/clone` | Clone template → private dashboard |
| PATCH/DELETE | `/dashboards/:id` | Update / soft-delete |
| POST | `/dashboards/:id/favorite` | Toggle favorite |
| GET/POST | `/dashboards/:id/permissions` | List / grant permission |
| DELETE | `/dashboards/:id/permissions/:permissionId` | Revoke permission |

## 8. Production (`/production`)
**OEE & KPIs**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/production/kpis` | Day KPIs (`?areaId,?lineId,?machineId`) |
| GET | `/production/oee/calculate` | OEE summary + trend + per-equipment (`?timeframe,?dateFrom,?dateTo,?areaId,?lineId,?machineId`) |
| POST | `/production/oee/calculate` | Calculate OEE from manual inputs |
| GET | `/production/oee/hierarchy` | Weighted OEE Factory→Area→Line→Machine + six-loss + Pareto |
| GET | `/production/oee-records` | Stored OEE records (paginated) |

**Work orders**
| Method | Path | Description | Perm |
|--------|------|-------------|------|
| GET | `/production/work-orders` | List (filters) | Bearer |
| GET | `/production/work-orders/:id` | Detail | Bearer |
| POST | `/production/work-orders` | Create | production:write |
| PATCH | `/production/work-orders/:id` | Update metadata | production:write |
| DELETE | `/production/work-orders/:id` | Soft-delete (not if IN_PROGRESS) | production:write |
| PATCH | `/production/work-orders/:id/start` | → IN_PROGRESS | production:execute |
| PATCH | `/production/work-orders/:id/hold` | → ON_HOLD | production:execute |
| PATCH | `/production/work-orders/:id/release` | → IN_PROGRESS | production:execute |
| PATCH | `/production/work-orders/:id/cancel` | Cancel | production:write |
| PATCH | `/production/work-orders/:id/complete` | Complete (triggers OEE calc) | production:execute |
| POST | `/production/work-orders/:id/count` | Record count update | production:execute |

**Production orders (L4)**
| Method | Path | Description | Perm |
|--------|------|-------------|------|
| GET/POST | `/production/production-orders` | List / create | manage (create) |
| GET/PATCH/DELETE | `/production/production-orders/:id` | Detail / update / soft-delete | manage |
| PATCH | `/production/production-orders/:id/release` | → RELEASED | manage |
| POST | `/production/production-orders/:id/work-orders` | PO→WO | manage |
| PATCH | `…/:id/cancel · /hold · /resume · /complete` | Lifecycle | manage |
| GET | `…/:id/auto-generate-preview` | Preview WOs + smart finish (`?from`) | Bearer |
| POST | `…/:id/auto-generate-work-orders` | Generate WOs from recipe routing | manage |

**Reschedule requests**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/production/reschedule-requests` | List (`?status,?productionOrderId`) |
| POST | `/production/production-orders/:id/reschedule-requests` | Raise request |
| PATCH | `/production/reschedule-requests/:id/review` | Approve/reject (manage) |

**Job orders (dispatch)**
| Method | Path | Description | Perm |
|--------|------|-------------|------|
| GET | `/production/job-orders` | All JOs (`?status,?workOrderId,?productionOrderId,?machineIds`) | Bearer |
| GET | `/production/job-orders/:id/live` | Live JO dashboard (OEE, six-loss, downtime, scrap, trends, alarms) | Bearer |
| GET | `/production/work-orders/:id/job-orders` | Dispatch list for a WO | Bearer |
| GET | `/production/work-orders/:id/machine-recommendations` | Per-step machine candidates by earliest finish | Bearer |
| POST | `/production/work-orders/:id/job-orders/generate` | Generate JOs from routing | manage |
| DELETE | `/production/work-orders/:id/job-orders` | Delete JOs (none EXECUTING) | manage |
| PATCH | `/production/job-orders/:id/output` | Report actual output | execute |
| PATCH | `/production/job-orders/:id/add-count` | Incremental good/scrap add | execute |
| PATCH | `/production/job-orders/:id/operator` | Assign/unassign operator | execute |
| PATCH | `/production/job-orders/:id/status` | Status transition | execute |
| GET | `/production/scrap-logs` | Scrap log entries | Bearer |

**Batches**: `GET/POST/PATCH/DELETE /production/batches[/:id]`.

## 9. Downtime (`/production/downtime`)
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/production/downtime/events` | List / create (execute) |
| PATCH | `/production/downtime/events/:id` | Update cause/category/notes (execute) |
| PATCH | `…/events/:id/end` | End open event (execute) |
| PATCH | `…/events/:id/acknowledge` | Acknowledge (execute) |
| GET/POST | `/production/downtime` | Flat list / create |
| PATCH | `/production/downtime/:id/close` | Close event |
| DELETE | `/production/downtime/:id` | Delete (data correction, execute) |
| GET | `/production/downtime/causes` | Cause codes (`?machineId`) |
| GET | `/production/downtime/summary` | Summary (`?dateFrom,?dateTo,?areaId,?lineId,?machineId`) |
| PATCH | `/production/downtime/machines/:id/state` | Operator state change (syncs timeline + downtime + JO) (execute) |
| GET | `/production/downtime/reasons/tree` | 3-level reason tree |
| POST/PATCH/DELETE | `/production/downtime/reasons[/:id]` | Manage reason nodes |

## 10. Recipes (`/production/recipes`)
CRUD + lifecycle: `GET/POST/PATCH/DELETE /production/recipes[/:id]`,
`POST …/:id/{submit,approve,obsolete,clone}`, and ingredient sub-resource
`POST/PATCH/DELETE /production/recipes/:id/ingredients[/:ingredientId]`.

## 11. Production traceability (`/production/traceability`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/production/traceability/backward/:fgLotId` | FG lot → WO → recipe + material lots |
| GET | `/production/traceability/forward/:materialLotId` | Material lot → WOs → FG lots |
| GET | `/production/traceability/links/:entityType/:entityId` | Raw links |
| GET | `/production/traceability/stats` | Coverage stats |
| POST | `/production/traceability/links` | Record link manually |

## 12. Quality (`/quality`)
KPIs: `GET /quality/kpis`. Permissions: `quality:write`, `quality:approve`.
- **Inspections:** `GET/POST/PATCH/DELETE /quality/inspections[/:id]`; `GET /quality/work-orders/:workOrderId/inspections`.
- **NCR:** `GET/POST/PATCH/DELETE /quality/ncr[/:id]`; `PATCH /quality/ncr/:id/status`.
- **CAPA:** `GET/POST/PATCH/DELETE /quality/capa[/:id]`; `POST …/:id/actions`;
  `PATCH …/:capaId/actions/:actionId/complete`; `PATCH …/:id/verify` (approve);
  `PATCH …/:id/close` (approve).
- **Quality plans:** `GET/POST/PATCH/DELETE /quality/plans[/:id]`; `PATCH …/:id/approve` (approve);
  parameter sub-resource `POST/PATCH/DELETE /quality/plans/:planId/parameters[/:paramId]`.
- **SPC:** `GET /quality/spc` (params w/ control limits), `GET /quality/spc/measurements`.

## 13. Maintenance (`/maintenance`)
KPIs/analytics: `GET /maintenance/kpis`, `/maintenance/reliability-trend` (MTTR/MTBF).
Permissions: `maintenance:write`, `maintenance:execute`.
- **Work orders:** `GET/POST/PATCH/DELETE /maintenance/work-orders[/:id]`; lifecycle
  `PATCH …/:id/{assign,start,complete,hold,resume,cancel}`; spare parts
  `GET/POST /maintenance/work-orders/:id/spare-parts`,
  `PATCH …/spare-parts/:requestId/{issue,cancel}`.
- **Inventory feed:** `GET /maintenance/pending-parts`, `GET /maintenance/spare-parts`,
  `GET /maintenance/spare-parts/kpis`.
- **Preventive:** `GET /maintenance/pm-plans`, `GET /maintenance/preventive/kpis`,
  `GET/POST/PATCH/DELETE /maintenance/preventive[/:id]`, `GET /maintenance/pm-tasks`.
- **Assets:** `GET/POST/PATCH/DELETE /maintenance/assets[/:id]`.

## 14. Inventory (`/inventory`)
- **Overview:** `GET /inventory/overview`.
- **Spare parts:** `GET/POST/PATCH/DELETE /inventory/spare-parts[/:id]`; `POST …/:id/adjust`.
- **Products (SKU):** `GET/POST/PATCH/DELETE /inventory/products[/:id]`.
- **Materials / lots:** `GET/POST/DELETE /inventory/materials[/:id]`;
  raw materials `GET/POST/PATCH/DELETE /inventory/raw-materials[/:id]`,
  `GET …/:id/movements`, `POST …/:id/adjust`.
- **Master data:** `GET /inventory/master`; `POST/PATCH/DELETE /inventory/master/:entity[/:id]`
  (categories|brands|packaging-types|base-units|base-weights).
- **UoM:** `GET /inventory/uom/convert?qty&from&to`.
- **Storage:** `GET/POST/PATCH/DELETE /inventory/storage-locations[/:id]`; `GET …/:id/contents`.
- **BOM:** `GET/POST/PATCH/DELETE /inventory/bom[/:id]`; `GET /inventory/bom/resolve-process`;
  `POST /inventory/bom/generate-from-process`; `POST /inventory/bom/:id/generate-process`;
  `POST /inventory/bom/:id/approve`; `POST /inventory/bom/:id/items`;
  `DELETE /inventory/bom/:bomId/items/:itemId`.
- **Manufacturing processes:** `GET/POST/PATCH/DELETE /inventory/manufacturing-processes[/:id]`;
  `POST …/:id/approve`; `POST …/:id/revert-to-draft`; `GET …/:id/products`;
  `GET /inventory/processes/:id/bom-coverage`; `POST /inventory/processes/:id/allocate-from-bom`.
- **Ledger:** `GET /inventory/stock-movements`.

## 15. Alarms (`/alarms`)
`GET /alarms` (filters), `GET /alarms/kpis`, `POST /alarms` (manual raise),
`PATCH /alarms/:id/acknowledge`, `PATCH /alarms/:id/resolve`.

## 16. Notifications (`/notifications`)
`GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`,
`PATCH /notifications/read-all`, `DELETE /notifications/:id`.
Rules (`notifications:manage`): `GET/POST/PATCH/DELETE /notifications/rules[/:id]`.

## 17. IoT (`/iot`)
- **Ingest/live:** `POST /iot/ingest` (telemetry), `GET /iot/machines/states`.
- **Devices:** `GET /iot/devices`, `GET /iot/devices/:id/status`, `POST /iot/devices/:id/connect`,
  `GET /iot/devices/kpis`, `POST/PATCH/DELETE /iot/devices[/:id]`.
- **Tags:** `GET /iot/tags`, `POST /iot/tags/read` (live read via driver),
  `POST/PATCH/DELETE /iot/tags[/:id]`.
- **Protocols:** `GET /iot/protocols`.
- **Gateways:** `GET /iot/gateways`, `GET /iot/gateways/kpis`, `PATCH/DELETE /iot/gateways/:id`.
- **Energy:** `POST /iot/energy/readings`, `GET /iot/energy/timeseries`,
  `GET /iot/energy/wo/:workOrderId`, `GET /iot/energy/by-workcenter`.

## 18. Energy (`/energy`)
`GET /energy/overview`, `GET /energy/live` (power + standby detection),
`GET/POST/PATCH/DELETE /energy/meters[/:id]`, `GET /energy/meter-templates`,
`GET /energy/meters/:id/tags`, `POST /energy/meters/:id/apply-template`,
`POST /energy/readings`, `GET /energy/consumption`.

## 19. Historian (`/historian`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/historian/health` | InfluxDB availability |
| GET | `/historian/oee-trend` | OEE/availability series for a machine (classic + time-based) |
| GET | `/historian/production-trend` | Good/rejected series for a machine |
| POST | `/historian/backfill` | Synthetic series (demo, `confirm:true`) |
| POST | `/historian/sample` | Force an immediate sample of active JOs |

## 20. APS — Advanced Planning & Scheduling (`/aps`)
`GET /aps/plan` (finite-capacity plan, Gantt + KPIs + late orders), `POST /aps/schedule`
(recalc, dry-run), `POST /aps/save-schedule` (commit), `POST /aps/reschedule-job`
(drag-drop ripple), `POST /aps/ctp` (capable-to-promise), `GET /aps/mrp` (BOM explosion vs stock).

## 21. AI (`/ai`)
`GET /ai/insights` — rule-based insights from live operational data.

## 22. Reports (`/reports`)
`GET /reports` (templates), `GET /reports/production?from&to`, `GET /reports/quality?from&to`.

## 23. Scheduling (`/scheduling`)
`GET /scheduling/unified` — unified schedule (POs, WOs, maintenance, planned downtime, shifts)
for a range (`?dateFrom,?dateTo,?types,?machineId,?areaId,?lineId`).

## 24. Shifts (`/shifts`)
- **Config/templates:** `GET /shifts/config`, `GET/POST/PATCH/DELETE /shifts/templates[/:id]`.
- **Instances:** `POST /shifts/instances/generate`, `GET /shifts/instances`,
  `GET /shifts/instances/current`, `GET /shifts/current-status`, `GET /shifts/analysis`,
  `POST /shifts/instances/:id/start`, `POST /shifts/instances/:id/complete` (computes OEE).
- **Planned downtime:** `GET /shifts/downtime-causes`, `POST /shifts/planned-downtime/generate`,
  `GET/POST/DELETE /shifts/planned-downtime[/:id]`.

## 25. Traceability (`/traceability`)
`GET /traceability/stats`, `GET /traceability/consumption`, `GET /traceability` (event feed),
`GET /traceability/entity/:entityType/:entityId`.

## 26. PLM (`/plm`)
`GET/POST/PATCH/DELETE /plm/change-requests[/:id]`, `POST /plm/change-requests/:id/transition`
(DRAFT→SUBMITTED→UNDER_REVIEW→APPROVED→IMPLEMENTED / REJECTED).

---

## 27. Conventions summary
- **Auth:** JWT bearer everywhere except `@Public` (login/refresh/health/factory selector).
- **RBAC:** `@Roles` (coarse) + `@RequirePermissions('module:action')` (fine).
- **Audited writes:** `@AuditLog()` → `AuditLog` rows.
- **Responses:** wrapped by `TransformInterceptor`; errors by `HttpExceptionFilter`.
- **Pagination:** `?page`/`?limit` + `X-Total-Count`/`X-Page`/`X-Per-Page`.
