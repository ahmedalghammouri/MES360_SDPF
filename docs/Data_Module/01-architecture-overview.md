# 01 — Data Module Architecture Overview

This document gives the big picture of how data moves and lives across the MES360° platform.
The detailed reference for each layer is in the sibling documents (DB, REST, MQTT/WS, OEE).

---

## 1. Components

| Component | Path | Stack | Role in the data module |
|-----------|------|-------|-------------------------|
| **API** | [apps/api](../../apps/api) | NestJS, Prisma, Socket.io | System of record. Owns PostgreSQL, writes/reads InfluxDB, subscribes to MQTT, pushes WebSocket events, exposes the REST API. |
| **Edge Gateway** | [apps/edgegateway](../../apps/edgegateway) | NestJS, Prisma (shared schema), MQTT, InfluxDB client | On-prem data acquisition. Polls Modbus devices, computes counters/energy, fans data to PostgreSQL + InfluxDB + MQTT, with disk store-and-forward. |
| **Industrial drivers** | [packages/industrial-drivers](../../packages/industrial-drivers) | TypeScript | Modbus TCP client, meter templates, rising-edge counters, scaling helpers used by the gateway. |
| **Shared / Types** | [packages/shared](../../packages/shared), [packages/types](../../packages/types) | TypeScript | Cross-cutting constants and API/MES/user types. |
| **Grafana** | [grafana](../../grafana) | Grafana | Optional analytics dashboards over InfluxDB/Postgres, catalogued in the Dashboards module. |

---

## 2. Datastores

### PostgreSQL — system of record
- Accessed through Prisma (`PrismaService`, see doc 2).
- Holds master data (hierarchy, SKUs, recipes, routings), transactions (orders, batches,
  downtime, inspections, maintenance), **current values** (`TagCurrentValue`,
  `MachineCurrentStatus`) and **calculated KPIs** (`OEERecord`, OEE fields on WO/PO/Shift).
- Both the API and the Edge Gateway connect via `DATABASE_URL`. The gateway uses a *subset*
  of the same schema (see doc 2 §6).

### InfluxDB — the historian (time-series)
- Bucket: `mes_timeseries` (env `INFLUX_BUCKET`). Enabled only when `INFLUX_URL` + `INFLUX_TOKEN` are set; otherwise the API degrades gracefully to relational fallbacks.
- Measurements: `oee` (per-minute OEE samples) and tag/production/energy series.
- Written by the **Edge Gateway** (raw tag values) and by the **API HistorianScheduler**
  (per-minute OEE samples). Read by dashboards and trend endpoints.

### MQTT broker
- `mqtt://localhost:1883` by default (`MQTT_BROKER_URL`). The transport between gateways and API.

### Disk buffers (edge resilience)
- `apps/edgegateway/buffer/*.jsonl` — store-and-forward queues for `pg-tagvalue`, `influx`,
  and `mqtt` sinks. Drained every 20 s on recovery so no data is lost during outages.

---

## 3. ISA-95 hierarchy (the spine of all data)

Almost every model is scoped to a node in this hierarchy:

```
Enterprise              (e.g. National Care Company)
  └─ Factory            (ISA-95 L3 site, e.g. SDPF / SAF)  ← tenant boundary (factoryId)
       └─ Area          (MAKING, PACKING, FILLING, UTILITY, WAREHOUSE …)
            └─ ProductionLine
                 └─ Machine         (ISA-95 L2)
                      └─ MachineModule (ISA-95 L1)
```

A parallel **WorkCenter** tree (`PLANT > AREA > LINE > CELL`) provides a logical routing
view used by job-order dispatch and energy roll-ups (see doc 2).

OEE and KPIs roll **up** this tree; orders and dispatch flow **down** it.

---

## 4. Multi-tenancy

- **Tenant key:** `factoryId` on every transactional model.
- **Super admin:** `User.factoryId = null` → global cross-factory access.
- **Enforcement:** JWT carries `{ sub: userId, factoryId }`; guards/services filter queries by
  `factoryId`. WebSocket clients auto-join a `factory:{factoryId}` room (doc 4).
- **Soft delete:** `deletedAt` on `User`, `WorkOrder`, `ProductionOrder`, `MaintenanceWO`,
  `Dashboard`, etc.

---

## 5. The production data model (Level 4 → Level 2)

The execution chain is the backbone for OEE and traceability:

```
ProductionOrder   (ERP/SAP level — what to make)
   └─ WorkOrder    (machine/line assignment — execution)
        └─ JobOrder (one routing step per WO — the atomic unit & OEE source of truth)
             └─ ScrapLog / JobOrderMaterial / counts
```

- **Recipes** + **ManufacturingProcess/RoutingStep** define *how* to make a SKU.
- **Auto-generation** turns a released PO → WOs → JobOrders from the routing.
- **Counts** flow up: edge counters → JobOrder → WorkOrder → ProductionOrder.
- **OEE** is computed at JobOrder level and rolled up (doc 5).

---

## 6. End-to-end data flow

```
1. ACQUIRE   Edge Gateway polls Modbus registers (per device, ~1 s).
             Tags classified: MEASUREMENT | COUNTER | ENERGY.
             Rising-edge counters persisted (GatewayCounterState, restart-safe).

2. FAN-OUT   Each reading → 3 sinks (with disk buffering on failure):
               • PostgreSQL  → TagCurrentValue.upsert()
               • InfluxDB    → time-series point
               • MQTT        → mes360/{factory}/{machineKey}/{tagCode}
             Counter edges → mes360/{factory}/jo/{jobOrderId}/count
             Energy reads  → mes360/{factory}/energy/{meterId}

3. INGEST    API GatewayIngestService subscribes to MQTT:
               • jo/.../count  → roll up WorkOrder actuals → emit production.count.updated
               • energy/...    → EnergyContextService enriches (WO, WorkCenter, machine
                                  state), detects power anomalies → emit iot.energy.reading

4. CALCULATE KpiService recomputes JO→WO→PO OEE on change.
             HistorianScheduler samples active JOs every minute → InfluxDB (oee measurement).

5. PUSH      MesWebSocketGateway listens to internal NestJS events and broadcasts to
             factory:{factoryId} / machine:{machineId} rooms.

6. CONSUME   Browser dashboards subscribe over WebSocket and/or pull REST endpoints
             (/production/oee/*, /dashboard/overview, /historian/oee-trend …).
```

See doc 4 for exact topics/events and doc 5 for the calculation detail.

---

## 7. Where to read next

- **Models & storage:** [02-database-and-prisma.md](02-database-and-prisma.md)
- **HTTP surface:** [03-rest-api.md](03-rest-api.md)
- **Real-time messaging:** [04-mqtt-and-websocket.md](04-mqtt-and-websocket.md)
- **KPI math:** [05-oee-and-at-oee.md](05-oee-and-at-oee.md)
