# MES360° — Grafana Dashboard Library

**65 production-ready dashboards** across **10 folders**, all factory-context aware and
auto-provisioned. Every dashboard carries the standard MES360° template variables
(`Factory, Area, ProductionLine, Machine, Shift, Product, Batch` + native time range).

Datasources used: **MES360° PostgreSQL** (`mes_postgres`, system of record),
**MES360° InfluxDB** (`mes_influxdb`, telemetry), **MES360° Prometheus**
(`mes_prometheus`, infra/broker metrics).

> UID convention: each dashboard's UID is its filename (e.g. `mes-prod-overview`). Use
> it as the `grafanaUid` when registering the dashboard in the Dashboard Center catalog.

---

## Production (`Production` folder — 19 dashboards)

Includes Production, OEE and Downtime suites (OEE/Downtime have no separate folder).

| Dashboard | Key panels / KPIs |
|---|---|
| **Production Overview** (`mes-prod-overview`) | Planned/Actual/Good qty, Scrap %, OEE/Availability/Performance/Quality gauges, output trend, output-by-machine |
| **Production Orders** (`mes-prod-orders`) | Total/In-progress/Completed/On-hold WOs, status mix, priority, completions trend, active WO table |
| **Shift Performance** (`mes-prod-shift`) | Shift output vs target, avg OEE, downtime, per-shift detail table |
| **Production Scheduling** (`mes-prod-scheduling`) | Scheduled (7d), late start, behind schedule, upcoming schedule table |
| **Scrap Analysis** (`mes-prod-scrap`) | Total scrap, events, scrap by reason (Pareto), scrap trend |
| **Batch Performance** (`mes-prod-batch`) | Batches, good/scrap qty, avg yield %, recent batches |
| **Throughput Monitoring** (`mes-prod-throughput`) | Avg rate u/h, runtime, throughput trend, rate by machine |
| **Production KPI Dashboard** (`mes-prod-kpi`) | Achievement %, Yield %, Scrap %, Downtime %, OEE/Availability gauges, components trend |
| **OEE Executive / by Factory / by Line / by Machine** (`mes-oee-*`) | Availability, Performance, Quality, OEE; OEE breakdown bar + trend |
| **OEE Trend Analysis** (`mes-oee-trend`) | OEE & components trend, Planned/Runtime/Stop time, micro stops |
| **Downtime Overview** (`mes-dt-overview`) | Total downtime, events, planned/unplanned, category split, trend |
| **Downtime Pareto** (`mes-dt-pareto`) | Downtime by reason (Pareto bar + detail table) |
| **Downtime Heatmap** (`mes-dt-heatmap`) | Hourly downtime heatmap + by hour-of-day |
| **Root Cause Analysis** (`mes-dt-rca`) | Category/reason/cause splits, event table |
| **MTBF / MTTR Analytics** (`mes-mtbf`, `mes-mttr`) | MTTR(h), failures, reliability trends |

**KPIs covered:** Planned Qty, Actual Qty, Achievement %, Production Rate, Cycle Time,
Scrap %, Yield %, Downtime %, Availability, Performance, Quality, OEE, Planned/Runtime/Stop
time, Micro Stops, MTBF, MTTR.

## Manufacturing (`Manufacturing` — 6)

| Dashboard | KPIs |
|---|---|
| **Manufacturing Overview** (`mes-mfg-overview`) | WIP, WOs in progress, completed today, avg OEE, JO status, output trend |
| **Work Order Status** (`mes-mfg-wo-status`) | Completion %, open, overdue, status breakdown, WO table |
| **Dispatch List Monitoring** (`mes-mfg-dispatch`) | Ready/Executing/Paused JOs, ISA-95 dispatch list |
| **Shopfloor Live** (`mes-mfg-shopfloor`) | Running/Idle/Stopped machines, live state table (10s refresh) |
| **Recipe Execution** (`mes-mfg-recipe`) | Active recipes, WOs by recipe |
| **Process Performance** (`mes-mfg-process-perf`) | Avg cycle time, utilization, cycle by operation |

**KPIs:** WO Completion, WIP, Schedule Adherence, Cycle Time, Utilization.

## Maintenance (`Maintenance` — 8)

Maintenance Overview, Preventive Maintenance, Work Orders, Asset Health, Spare Parts
Analytics, MTBF, MTTR, Maintenance KPI Dashboard.

**KPIs:** Open Work Orders, Overdue PM, PM Compliance %, Equipment Availability, MTTR,
Maintenance Cost, Asset Utilization, Spare stock value / below-min.

## Quality (`Quality` — 6)

Quality Overview, Inspection Results, Non-Conformance, CAPA Tracking, **SPC Dashboard**,
Defect Analytics.

**SPC Dashboard** includes: X-Bar chart with UCL/Center/LCL control lines, Cp, Cpk,
out-of-control count, and a rule-violation table (Western-Electric `controlViolation`).

**KPIs:** FPY, Defect Rate, Reject Rate, CAPA Closure Rate, Inspection Pass Rate, Cp, Cpk.

## Inventory (`Inventory` — 6)

Inventory Overview, Raw Materials, Material Lots, Spare Parts, Inventory Turnover, Stock
Movement.

**KPIs:** Stock Level, Safety Stock breaches, Consumption Rate, Reorder Alerts, Stock Value,
Lot Expiry.

## Energy (`Energy` — 5)

Energy Overview, Electricity Monitoring, Water Monitoring, Compressed Air, Utility Cost
Analysis.

**KPIs:** kWh, Cost, Consumption, Peak Demand, Avg Power, Energy Per Unit.

## Traceability (`Traceability` — 4)

Batch Genealogy, Product Traceability, Material Traceability, Recall Analysis (tables +
relationship/flow views over `trace_events`, `genealogy_links`, `material_consumptions`).

## IIoT (`IIoT` — 4)

Device Health, Gateway Status, MQTT Monitoring (Prometheus/mosquitto exporter), Sensor
Analytics (InfluxDB telemetry + `tag_current_values`).

**KPIs:** Connected/Disconnected Devices, Signal/Status, Telemetry Rate, MQTT throughput.

## Executive (`Executive` — 4)

Executive Manufacturing Cockpit, Factory Comparison, Multi-Plant Performance, Corporate KPI
Dashboard — **all factories on one screen**: OEE, Production, Quality, Maintenance, Energy,
Inventory rollups.

## Templates (`Templates` — 3)

`TEMPLATE — Line Performance`, `TEMPLATE — Machine Detail`, `TEMPLATE — Blank
Factory-Aware`. Clone-to-create starting points with the full variable set pre-wired.

---

### Panel data-source notes

- The vast majority of KPIs come from **PostgreSQL** (the MES system of record) so they work
  immediately against seeded/live data.
- **IIoT Sensor Analytics** uses an InfluxDB Flux query against bucket `mes_timeseries`;
  **MQTT Monitoring** uses Prometheus `mosquitto_*` metrics — these populate once the
  telemetry pipeline / mosquitto-exporter are emitting.
- Energy panels read `energy_readings`/`energy_meters`; if a plant streams power to InfluxDB
  instead, swap the panel datasource to `mes_influxdb` (documented in
  [GRAFANA_FACTORY_CONTEXT](GRAFANA_FACTORY_CONTEXT.md)).
