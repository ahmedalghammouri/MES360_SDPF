# 02 — Databases, Prisma Architecture & Data Models

Source of truth: [apps/api/prisma/schema.prisma](../../apps/api/prisma/schema.prisma) and
[apps/edgegateway/prisma/schema.prisma](../../apps/edgegateway/prisma/schema.prisma).

---

## 1. Database providers & configuration

| Store | Provider | Used by | Config |
|-------|----------|---------|--------|
| Relational (system of record) | **PostgreSQL** | API + Edge Gateway | `DATABASE_URL` |
| Time-series (historian) | **InfluxDB** | API (historian), Edge Gateway | `INFLUX_URL`, `INFLUX_TOKEN`, `INFLUX_ORG`, `INFLUX_BUCKET` (`mes_timeseries`) |
| Messaging | **MQTT** | API + Edge Gateway | `MQTT_BROKER_URL` |

**Prisma generator:** `prisma-client-js` with the `fullTextSearch` preview feature.
**Binary targets:** native + Windows + Linux (`musl-openssl-3.0.x`) — so the same client runs
on dev machines, the edge gateway `.exe`, and Linux containers.

---

## 2. PrismaService architecture

File: [apps/api/src/database/prisma.service.ts](../../apps/api/src/database/prisma.service.ts),
registered globally by [database.module.ts](../../apps/api/src/database/database.module.ts).

- Extends `PrismaClient` and implements `OnModuleInit` / `OnModuleDestroy` (connect on boot,
  disconnect on shutdown).
- **Logging:** subscribes to query/error/warning events; logs slow queries (>500 ms) in dev.
- **Health probe:** raw `SELECT 1` used by the health endpoint.
- **Soft-delete helper:** generic `softDelete<T>()` that stamps `deletedAt` rather than
  hard-deleting (used by models that carry `deletedAt`).
- Exposed via a **global `DatabaseModule`**, so any feature module injects `PrismaService`
  directly.

The edge gateway has its own minimal `PrismaService`
([apps/edgegateway/src/prisma/prisma.service.ts](../../apps/edgegateway/src/prisma/prisma.service.ts))
that connects to the same PostgreSQL with the shared (subset) schema.

---

## 3. Data model overview

~108 models, organised below by domain. For each: purpose + the fields that matter for
relationships, time windows, and KPI math. (Field lists are representative, not exhaustive —
read the schema for every column.)

### 3.1 Hierarchy & master data (ISA-95)
| Model | Purpose | Key fields / relations |
|-------|---------|------------------------|
| `Enterprise` | Root org / multi-factory parent | `code` (unique), timezone, currency → `factories[]`, `users[]` |
| `Factory` | ISA-95 L3 site (tenant boundary) | `code` (unique), `enterpriseId`, lat/lng, timezone → 40+ downstream relations |
| `Area` | Zone (MAKING/PACKING/FILLING/UTILITY/WAREHOUSE/LAB/OFFICE) | `(factoryId, code)` unique → lines, machines, meters, devices, tags |
| `ProductionLine` | Line (PACKING/FILLING/MAKING/BLOW_*/AEROSOL…) | `(factoryId, code)` unique → machines, workOrders, shiftInstances |
| `Machine` | ISA-95 L2 equipment | `(factoryId, code)` unique, `machineType`, `criticality`, `downtimeThreshold` (60s) → status, cycleTimes, downtime, oeeRecords, devices, tags |
| `MachineModule` | ISA-95 L1 sub-component (DRIVE/SENSOR/VALVE…) | `(machineId, code)` unique, cascade delete |
| `MachineCurrentStatus` | **Live** machine snapshot | `machineId` unique; state, OEE/A/P/Q, speeds, counts, downtime/runtime minutes |
| `WorkCenter` | Logical routing cell (PLANT/AREA/LINE/CELL) | `(factoryId, code)` unique, self-join `parentId` → routingSteps, downtimeEvents, energyReadings, jobOrders |

### 3.2 Product & SKU master data
| Model | Purpose |
|-------|---------|
| `ProductFamily`, `ProductCategory`, `ProductBrand`, `PackagingType`, `BaseUnit`, `BaseWeight` | Lookup/classification tables, all scoped `(factoryId, …)` unique |
| `UnitOfMeasure` | Canonical units + conversion factors (single source of truth for UoM); `category` (WEIGHT/VOLUME/COUNT/PACKAGING/…) |
| `SKU` | Finished-product master (SAP `itemNumber`) | packaging hierarchy (`unitsPerInner`, `innersPerCarton`, `cartonsPerPallet`), relational refs to all lookups, `storageLocationId` |
| `BOMComponent` | Legacy simple BOM lines (deprecated → `BOMHeader`/`BOMItem`) |

### 3.3 Production execution
| Model | Purpose | KPI-relevant fields |
|-------|---------|---------------------|
| `ProductionOrder` | ERP/SAP-level order (L4) | status, `targetQty`/`completedQty`, planned/actual start-end, rolled-up `oee/availability/performance/quality`, soft-delete |
| `WorkOrder` | Shop-floor execution (per machine) | `plannedCycleTime`, planned/actual qty, `goodQty/scrapQty/reworkQty`, `downtimeMinutes`, `recipeId`, rolled-up OEE fields, soft-delete |
| `JobOrder` | **One routing step per WO — OEE source of truth** | status, `predecessorId` + `predecessorType` (FS/SS/SF/FF) + `lagMins`, planned/actual start-end, `plannedQtyIn/Out`, `actualQtyGood/Rejected`, `handoverQty`, `idealCycleTimeSec` (stamped at creation), `outputUnit/inputUnit`, `operatorId` |
| `ProductionEvent` | Event stream (WO_STARTED, COUNT_UPDATE, DOWNTIME_*, SKU_CHANGE…) | indexed `(factoryId,timestamp)`, `(machineId,timestamp)` |
| `RescheduleRequest` | APS governance when WO overruns PO due date | source AUTO_GENERATE / APS_RECALC, status, `details` JSON |
| `ScrapLog` | Per-step scrap entries (one per reject increment) | `category` (QUALITY/SETUP/DAMAGE/…), `jobOrderId`, qty, reason |
| `JobOrderMaterial` | Per-step material IN/OUT/REJECT | `materialLotId`, planned/actual qty |

### 3.4 Routing, recipes & BOM (PLM)
| Model | Purpose |
|-------|---------|
| `ManufacturingProcess` | Routing blueprint, reusable by scope (PRODUCT/CATEGORY/BASE_WEIGHT/PRODUCT_LIST) |
| `ManufacturingProcessSku` | Join table for PRODUCT_LIST scope |
| `RoutingStep` | Operation in a process; `cycleTimeSec` (primary), `setupTimeMins`, in/out units, `workCenterId`/`machineId` |
| `RoutingStepMachineOption` | Primary + alternative machines per step (priority, per-machine cycle/setup) |
| `RoutingStepMaterial` | Inputs consumed per output unit (feeds `MaterialConsumption` on completion) |
| `StepDependency` | Temporal constraints between steps (FS/SS/SF/FF + lag) |
| `Recipe` | Master formula, versioned + approval-gated (DRAFT→REVIEW→APPROVED→OBSOLETE) |
| `RecipeIngredient` | Ingredient line (phase, qty per batch, scrapFactor) |
| `BOMHeader` | BOM version container, `source` (MANUAL/DERIVED_FROM_PROCESS/DRAFT_FOR_PROCESS), `isStale` |
| `BOMItem` | Material line (qty per finished unit, scrapFactor, `routingStepId`) |
| `ChangeRequest` | ECR governance (BOM/RECIPE/PROCESS/DESIGN change) |

### 3.5 Shifts & OEE engine
| Model | Purpose | KPI-relevant fields |
|-------|---------|---------------------|
| `ShiftTemplate` | Master shift definition | `startTime/endTime`, `crossesMidnight`, `plannedProductionHours`, `breakMinutes`, `cleaningMinutes`, `days` JSON, `targetQtyPerShift` |
| `ShiftInstance` | Scheduled shift occurrence | `shiftDate`, target/actual/good/scrap qty, OEE fields, `downtimeMinutes`, `plannedDowntime` |
| `MachineStateRecord` | Atomic state transitions (RUNNING/IDLE/BREAKDOWN/SETUP/CHANGEOVER/STARVED/BLOCKED/OFFLINE/MAINTENANCE) | `startTime/endTime`, `durationMinutes`, `isPlannedStop`, `downtimeCauseId`, `source` |
| `DowntimeCause` | Hierarchical 3-level reason codes | `level` (1/2/3), `parentId`, `isPlanned`, `category` |
| `DowntimeEvent` | Logged downtime incident | `reasonCode`, `category`, `startTime/endTime`, `durationMinutes`, **`affectsOEE`**, `isPlanned`, `maintenanceWOId`, `schedulingImpactMins` |
| `OEERecord` | Stored OEE scorecard (per shift/batch completion) | planned/actual/uptime/downtime minutes, total/good/scrap output, `idealCycleTime`, A/P/Q/OEE |
| `MachineRuntimeHours` | Daily cumulative hours (PM basis) | `(machineId, recordDate)` unique |
| `MachineCycleTime` | Per-SKU per-machine cycle time | `cycleTimeSeconds`, `unitType`, `maxSpeed`, `(machineId, skuId, unitType)` unique |

### 3.6 Quality
`QualityPlan`, `QualityParameter` (nominal/UCL/LCL/USL/LSL, `isKPI`), `InspectionResult`
(INCOMING/IN_PROCESS/FINAL/PATROL/AUDIT; PASS/FAIL/CONDITIONAL), `NCR` (status workflow,
severity, disposition), `CAPA` + `CAPAAction` (corrective/preventive), `SPCMeasurement`
(control limits, `isOutOfControl`, `controlViolation`).

### 3.7 Maintenance (CMMS)
`FailureMode` (FMEA, `rpn`), `PMPlan` (TIME/RUNTIME/CONDITION/CALENDAR based) + `PMPlanSparePart`,
`PMTask` (scheduled execution), `MaintenanceWO` (PREVENTIVE/CORRECTIVE/EMERGENCY/PREDICTIVE…,
`triggeredByDowntimeId`, `productionWOId`, costs, `runtimeHoursAtService`), `SparePart`,
`MaintWOSparePart` (request/issue lifecycle).

### 3.8 Energy
| Model | Purpose |
|-------|---------|
| `EnergyMeter` | Meter (ELECTRICAL/GAS/AIR/WATER/STEAM/CHILLED). Scope = exactly one of machine/line/area; `deviceId`, `templateKey` (register map) |
| `EnergyReading` | Timestamped reading; cumulative `value` + instantaneous `powerKw`; enriched with `workOrderId`, `workCenterId`, `machineState`; indexed `(meterId,timestamp)` |
| `EnergyWOSummary` | Per-WO rollup: total/running/idle/downtime kWh, `kwhPerUnit`, peak/avg power, `anomalyCount` |
| `EnergySummary` | Per-meter per-period (HOURLY/SHIFT/DAILY/WEEKLY/MONTHLY) totals + cost + `specificEnergy` |

### 3.9 IoT / connectivity
| Model | Purpose |
|-------|---------|
| `Device` | Physical endpoint; `protocol` (OPCUA/MODBUS/MODBUS_RTU/MQTT/S7/FINS/HTTP), IP/port/`unitId`, serial params, `pollIntervalMs`, `gatewayId` |
| `TagDefinition` | Logical tag/register; `dataType`, `type` (STATUS/COUNTER/MEASUREMENT/ENERGY…), Modbus binding (address, registerType, wordCount/Order, scaleFactor, offset), `counterRole`, `edgeType`, energy `meterId`+`energyRole`, historization settings |
| `TagCurrentValue` | Live snapshot (upserted) of a tag — `value`, `quality`, `timestamp` |
| `Gateway` | Edge gateway instance; status, `lastHeartbeatAt` |
| `GatewayCounterState` | Restart-safe counter accumulation per tag (`lastRawValue`, `accumulated`, `jobOrderId`) |
| `AlarmDefinition` | Rule (condition GT/LT/EQ…, threshold, deadband, delay) |
| `AlarmEvent` | Triggered alarm instance (trigger/ack/resolve timestamps, duration) |

### 3.10 Inventory & traceability
`RawMaterial`, `MaterialLot` (supplier traceability), `StorageLocation` (zones),
`StockMovement` (universal ledger: RECEIPT/ISSUE/RETURN/ADJUSTMENT/RESERVATION/RELEASE/CONSUMPTION),
`MaterialConsumption` (batch/WO ↔ raw material, genealogy bridge), `BatchRecord` + `GenealogyLink`
(batch parent/child), `TraceEvent` (entity lifecycle audit), `TraceabilityLink`
(CONSUMED_BY / PRODUCED_FROM / GOVERNED_BY).

### 3.11 Users, security & system
`User` (12 roles, `factoryId` tenant key, MFA, lockout, soft-delete), `UserSession`
(refresh-token sessions with revocation), `Notification` + `NotificationRule`, `AuditLog`
(CRUD trail with old/new JSON values).

### 3.12 Dashboards (Dashboard Center)
`DashboardCategory` (global or factory-scoped), `Dashboard` (source MES360_NATIVE/GRAFANA/
REPORT/EXTERNAL/TEMPLATE; type, visibility, `supportedScopes`, Grafana linkage, `route`/`externalUrl`),
`DashboardFavorite`, `DashboardPermission` (VIEW/EDIT/MANAGE by role or user).

---

## 4. Enums (≈53)

Hierarchy/equipment: `AreaType`, `LineType`, `MachineType`, `Criticality`, `MachineState`,
`WorkCenterLevel`.
Production: `ProductionOrderStatus`, `WorkOrderStatus`, `JobOrderStatus`, `ProductionEventType`,
`RescheduleStatus`, `ScrapCategory`, `DependencyType`.
PLM/recipe/BOM: `ProcessScope`, `RecipeStatus`, `BomSource`, `ChangeRequestType`,
`ChangeRequestStatus`, `Priority`.
Shifts/OEE/downtime: `ShiftStatus`, `DowntimeCategory`, `DowntimeReasonCode`.
Quality: `InspectionType`, `InspectionResult2`, `NCRStatus`, `Severity`, `CAPAType`, `CAPAStatus`.
Maintenance: `PMType`, `PMTaskStatus`, `MaintType`, `MaintStatus`, `SpareIssueStatus`.
Energy/IoT: `EnergyType`, `EnergyPeriod`, `CounterRole`, `TagDataType`, `TagType`, `TagQuality`,
`AlarmSeverity`.
Inventory/trace: `StockEntityType`, `MovementType`, `TraceEntityType`, `TraceLinkType`,
`StorageZone`, `UomCategory`.
Users/system: `UserRole` (SUPER_ADMIN, FACTORY_ADMIN, PLANT_MANAGER, PRODUCTION_MANAGER,
PRODUCTION_SUPERVISOR, QUALITY_MANAGER, QUALITY_ENGINEER, MAINTENANCE_MANAGER,
MAINTENANCE_TECHNICIAN, ENERGY_MANAGER, OPERATOR, VIEWER), `NotificationType`.
Dashboards: `DashboardSource`, `DashboardType`, `DashboardVisibility`, `DashboardPermissionLevel`.

> Note: the inspection-result enum is named `InspectionResult2` in the schema to avoid a clash
> with the `InspectionResult` model.

---

## 5. Multi-tenancy & soft delete (schema-level)

- `factoryId` foreign key on every transactional model; `SUPER_ADMIN` users have `factoryId = null`.
- Cross-factory isolation is enforced in services by always filtering on `factoryId`.
- Soft delete (`deletedAt`) on `User`, `WorkOrder`, `ProductionOrder`, `MaintenanceWO`,
  `Dashboard` (and others) — use `PrismaService.softDelete()` / filter `deletedAt: null`.

---

## 6. Edge Gateway local schema

[apps/edgegateway/prisma/schema.prisma](../../apps/edgegateway/prisma/schema.prisma) is a
**subset of the same PostgreSQL schema** (kept in sync via
[scripts/sync-schema.mjs](../../apps/edgegateway/scripts/sync-schema.mjs)). The gateway reads
its assigned `Device`/`TagDefinition` rows and `Gateway` config, and writes
`TagCurrentValue`, `GatewayCounterState`, `EnergyReading`, and heartbeats — so the gateway and
API share one database rather than syncing two.

---

## 7. Migrations & seeds

**Migrations** ([apps/api/prisma/migrations](../../apps/api/prisma/migrations)):
1. `20260520110103_gemy` — initial schema.
2. `20260609182427_dashboard_center` — Dashboard Center (categories, dashboards, permissions, favorites).

**Seeds** ([apps/api/prisma](../../apps/api/prisma)):
- `seed.ts` — orchestrator: NCC enterprise, super-admin users, factories (SDPF Dammam, SAF).
- `seed-ncc-master.ts` — master data (products, machines, areas, processes, recipes).
- `seed-ncc-downtime.ts` — 3-level downtime reason trees.
- `seed-dashboard-center.ts` / `seeds/dashboard-center.seed.ts` — dashboard catalog.
- `seed-aps-demo.ts` — APS/scheduling demo (orders, routing).
- `seed-sidco-shifts.ts` — shift templates/instances.
- `seed-shopfloor-history.ts` — historical events for analytics.
- `seeds/iot-energy-demo.ts` — IoT/energy demo data.

---

## 8. Cross-references
- KPI fields (`oee/availability/performance/quality`) on `WorkOrder`/`ProductionOrder`/`ShiftInstance`/`OEERecord` are populated by the engine in [05-oee-and-at-oee.md](05-oee-and-at-oee.md).
- `TagDefinition`/`Device`/`Gateway`/`EnergyReading` are driven by the flows in [04-mqtt-and-websocket.md](04-mqtt-and-websocket.md).
- REST access to all models: [03-rest-api.md](03-rest-api.md).
