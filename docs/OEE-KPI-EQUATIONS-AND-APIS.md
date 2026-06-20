# MES360° — KPI & OEE Reference (Equations, Sources, APIs, Logic)

This document is the single source of truth for **how every KPI and OEE number on the
platform is calculated**, where the data comes from (PostgreSQL / InfluxDB), which API
serves it, how filters change it, and worked examples. It also lists the **known
cross‑page inconsistencies** and the canonical definition each page should converge on.

> Conventions used below
> - **Source** = the system of record (Prisma/Postgres table, or InfluxDB measurement).
> - **API** = the HTTP route the frontend calls.
> - **Backend** = file + method that computes the value.
> - All percentages are clamped to `[0, 100]` and rounded to **1 decimal**.

---

## 1. Filters — how scope & time change every number

Every dashboard accepts the same two filter dimensions. They are applied **server‑side**.

| Filter | Values | Effect | Passed as |
|---|---|---|---|
| **Scope** | Factory · Area · Line · Machine | Resolves to a **set of machine IDs**; all queries are restricted to job orders / downtime / readings on those machines. Selecting an Area expands to every machine under it. | `areaId` / `lineId` / `machineId` → resolved to `machineIds[]` |
| **Time range** | Today · 7d · 30d · custom `from`/`to` | Bounds the rows by `actualStart`/`recordDate`/`startTime`. Also drives **trend bucketing**: ≤ 2 days → hourly buckets, otherwise daily. | `from`, `to` (ISO) + `bucket` (`hour`/`day`) |
| **Shift** (where present) | shift instance | Further narrows to the shift's window + machines. | `shiftInstanceId` |

**Tenant isolation:** every query is additionally filtered by `factoryId` from the JWT.

**Key rule (ISO 22400):** aggregation is **bottom‑up by minutes/quantities**, never a
naïve average of percentages. To roll Machine→Line→Area→Plant we sum the underlying
run‑time / planned‑time / good / total counts, then recompute A/P/Q from the totals.

---

## 2. OEE — the two variants

OEE = **Availability × Performance × Quality**. The platform exposes **two variants**;
both are returned together so a page can show either.

### 2.1 Schedule‑based OEE (classic, the default)
Respects the **planned** production window.

```
Availability = RunTime / PlannedProductionTime           (PPT excludes planned stops)
Performance  = (IdealCycleTime × TotalCount) / RunTime
Quality      = GoodCount / TotalCount
OEE          = Availability × Performance × Quality
```
- **RunTime** = PPT − unplanned downtime.
- **PPT** = scheduled time − planned stops (breaks, planned maintenance, cleaning).
- **Source:** `JobOrder` (planned/actual times, `actualQtyGood`, `actualQtyRejected`, ideal cycle time via SKU) + `DowntimeEvent` (overlap minutes).
- **Backend:** `apps/api/src/modules/production/oee.service.ts → calculateDetailed()` (ISO‑22400 six‑loss), rolled up by `kpi.service.ts → oeeAnalytics()`.
- **API:** `GET /production/oee/calculate`.

### 2.2 Time‑based OEE (AT‑OEE / TEEP‑style)
Ignores the plan; measures pure uptime.

```
Availability(TB) = Net / Operating                       Operating = Σ(actualEnd − actualStart)
                                                          Net = Operating − unplanned downtime
OEE(TB)          = Availability(TB) × Performance × Quality   (P, Q reused from above)
```
- **Backend:** `kpi.service.ts → timeBasedOee()`.
- **Returned as** `oeeTb`, `availabilityTb` alongside the schedule‑based fields.
- **Use when:** you want machine‑centric utilization independent of the schedule.

> **UI guidance to show on every OEE card:** *"Schedule‑based uses the planned window;
> Time‑based = uptime ÷ (uptime + downtime)."*

### 2.3 Worked example
8h shift = 480 min; 60 min planned maintenance; 30 min unplanned breakdown; ideal cycle
1.0 min/unit; produced 350 units, 340 good.

```
PPT          = 480 − 60                = 420 min
RunTime      = 420 − 30                = 390 min
Availability = 390 / 420               = 92.9 %
Performance  = (1.0 × 350) / 390       = 89.7 %
Quality      = 340 / 350               = 97.1 %
OEE (sched.) = 0.929 × 0.897 × 0.971   = 80.9 %

Operating       = 450 min (07:30 start → 15:00, minus 30 unplanned not counted in spans? see note)
Availability(TB) = (Operating − 30) / Operating
OEE (time)       = Availability(TB) × 0.897 × 0.971
```

---

## 3. Metric catalogue

| Metric | Equation | Source (Postgres/Influx) | API | Backend method | Consumers (frontend) |
|---|---|---|---|---|---|
| **OEE (schedule)** | A×P×Q | `JobOrder` + `DowntimeEvent` | `GET /production/oee/calculate` | `kpi.oeeAnalytics → oee.calculateDetailed → oee.rollup` | production‑oee‑view, manufacturing‑oee‑view, dashboard home |
| **OEE (time‑based)** | A(TB)×P×Q | `JobOrder` + `DowntimeEvent` | same (`oeeTb`) | `kpi.timeBasedOee` | production‑oee‑view overlay, dashboard |
| **Availability** | RunTime/PPT | `JobOrder`+`DowntimeEvent` | `/production/oee/calculate` | `oee.calculateDetailed` | OEE/KPI cards, loss waterfall |
| **Performance** | (Ideal×Count)/RunTime | `JobOrder` (+SKU cycle) | `/production/oee/calculate` | `oee.calculateDetailed` | OEE/KPI cards |
| **Quality** | Good/Total | `JobOrder` | `/production/oee/calculate` | `oee.calculateDetailed` | OEE/KPI cards |
| **FPY (First‑Pass Yield)** | ΣGood / Σ(Good+Rejected) | `JobOrder` | `GET /dashboard/overview` (quality trend) | `dashboard.getQualityTrend` | dashboard quality trend |
| **Scrap rate** | ΣRejected / ΣTotal | `JobOrder.actualQtyRejected` | `/dashboard/overview` | `dashboard.getQualityTrend` | quality trend, KPI view |
| **Throughput** | Output / OperatingHours | `MachineCurrentStatus.actualSpeed` (snapshot) ⚠ | `/dashboard/overview` | `dashboard.getMachineStatus` | machine grid |
| **MTTR** | Σ(repair hours) / #completed unplanned WOs | `MaintenanceWO` (CORRECTIVE+EMERGENCY, in window, scoped) | `GET /maintenance/kpis` | `maintenance.getKPIs` | maintenance overview/KPIs |
| **MTBF** | ActualOperatingHours / #failures | `MachineStateRecord` (RUNNING mins) + `MaintenanceWO` failures, scoped | `GET /maintenance/kpis` | `maintenance.getKPIs` | maintenance overview/KPIs |
| **Maint. Availability** | MTBF / (MTBF + MTTR) | derived | `/maintenance/kpis` | `maintenance.getKPIs` | maintenance overview |
| **PM Compliance** | #completed PM / #PM due this month | `MaintenanceWO` (PREVENTIVE/INSPECTION/LUBRICATION) | `/maintenance/kpis` | `maintenance.getKPIs` | maintenance overview |
| **Reliability trend** | monthly MTTR/MTBF (scoped) | `MaintenanceWO` history + `MachineStateRecord` | `GET /maintenance/reliability-trend?areaId/lineId/machineId` | `maintenance.getReliabilityTrend` | mttr‑mtbf chart |
| **Energy consumption (MTD/today)** | last(reading) − first(reading) per meter, summed | `EnergyReading` / `EnergySummary` (Influx‑fed) | `GET /energy/overview` | `energy.getOverview` | energy overview |
| **Energy cost** | consumption × tariff (machine→line→area→factory) | `EnergyReading`/`EnergySummary` + `EnergyTariff` | `/energy/overview` | `energy.getOverview` | energy overview |
| **Live power** | latest `powerKw` per meter | `EnergyReading.powerKw` (Influx) | `GET /energy/live-power` | `energy.getLivePower` | energy live |
| **Dashboard KPI strip + trends** | metric(now) − metric(prev window) | `oeeAnalytics` + `OEERecord` | `GET /dashboard/kpis` | `dashboard.getKPIs` | home KPI cards |
| **Per‑Job‑Order OEE (`joOEE`)** | A×P×Q (per JO) | `JobOrder` (single) | `GET /production/work-orders/:id` | `production.calcJobOrderOEE` ⚠ | WO detail, shop‑floor live |

Maintenance KPI equations in full (card `GET /maintenance/kpis` **and** trend
`GET /maintenance/reliability-trend` now use the **same** definitions and both honour the
area/line/machine **scope**):
```
MTTR            = Σ actualHours(completed CORRECTIVE+EMERGENCY in window) / count
MTBF            = ActualOperatingHours / #failures(CORR+EMG raised in window)
                  ActualOperatingHours = Σ RUNNING durationMinutes / 60  (MachineStateRecord)
                  ↳ falls back to (#activeMachines × calendarHours) only if no state segments exist
Availability    = MTBF / (MTBF + MTTR) × 100
PM Compliance   = completedPM / totalPMdue × 100
```
> Previously MTTR on the **card** counted *all* completed WO types, and MTBF used calendar
> machine-hours (not uptime), and the **trend ignored scope**. All three are now fixed and
> consistent between the card and the chart.

---

## 4. Known inconsistencies (to converge) & status

These were found comparing the same metric across pages. **#3 (yield) is fixed**; the
rest are documented with the canonical target.

| # | Issue | Where | Canonical target | Status |
|---|---|---|---|---|
| 1 | **Two availability denominators.** KPI engine uses `RunTime/PPT` (PPT excludes planned stops); per‑JO `calcJobOrderOEE` uses `operating/plannedDuration` (does **not** exclude planned stops) → same WO shows different OEE on the KPI page vs the WO‑detail/shop‑floor page. | `oee.service.ts:~114` vs `production.service.ts:calcJobOrderOEE` | Per‑JO OEE should exclude planned stops from the denominator (use PPT), matching `calculateDetailed`. | **Open** (recommended next) |
| 2 | **`joOEE` falls back to Quality‑only** when planned dates / ideal cycle are missing → inflated "OEE" that is really just FPY. | `production.service.ts:calcJobOrderOEE` | Return `null` (show "—") when A or P can't be computed, rather than substituting Quality. | **Open** |
| 3 | **Batch yield could exceed 100%** and showed 0% because good/scrap weren't summed from WOs. | `production.service.ts:findBatches` | AUTO batches roll up `quantity/good/scrap` live from linked WOs; yield clamped `[0,100]`. | **✅ Fixed** |
| 4 | **FPY averaged per‑WO on the client** instead of global ΣGood/ΣTotal → wrong when WO sizes differ. | `production-kpi-view.tsx:~313` | Compute server‑side as `ΣGood/Σ(Good+Rejected)` (as `dashboard.getQualityTrend` already does). | **Open** |
| 5 | **Three rounding implementations** (`Math.round(n*10)/10`, `toFixed(1)`, local `r1`). | oee/production/dashboard services | One shared `round1()` helper. | **Open** |
| 6 | **Throughput is a stale snapshot** (`MachineCurrentStatus.actualSpeed`) not recomputed with the KPI window. | `dashboard.getMachineStatus` | Derive `output / operatingHours` from job orders in the window. | **Open** |
| 7 | **Scrap aggregated differently** (dashboard sums all JO steps; KPI view sums `wo.scrapQty`). | dashboard vs production‑kpi‑view | Use Σ over job‑order `actualQtyRejected` everywhere. | **Open** |
| 8 | **Energy cost source ambiguous** (stored `EnergySummary.cost` vs live tariff recompute). | `energy.getOverview` | Return `{ cost, costSource: 'SUMMARY'|'ESTIMATED' }`. | **Open** |
| 9 | **PM compliance denominator** counts all WOs *due* this month incl. not‑yet‑due/in‑progress. | `maintenance.getKPIs` | Count PM scheduled to complete in the window. | **Open** |
| 10 | **MTTR card counted all WO types** (planned + unplanned), while the trend counted only CORRECTIVE+EMERGENCY → card ≠ chart. | `maintenance.getKPIs` | Both use CORRECTIVE+EMERGENCY only. | **✅ Fixed** |
| 11 | **MTBF used calendar machine‑hours** (machineCount × clock time), inflating uptime. | `maintenance.getKPIs` + `getReliabilityTrend` | Use actual RUNNING hours from `MachineStateRecord`; calendar only as fallback. | **✅ Fixed** |
| 12 | **Reliability trend ignored scope** (always whole factory) unlike the KPI cards. | `getReliabilityTrend` | Accept & apply area/line/machine scope. | **✅ Fixed** |

---

## 5. Data sources & flow (architecture)

```
InfluxDB (high‑frequency)         PostgreSQL (system of record)
  · machine state samples           · JobOrder / WorkOrder / ProductionOrder
  · energy readings (powerKw)       · DowntimeEvent / DowntimeCause
        │  (edge → ingest)          · MaintenanceWO / PMPlan
        ▼                           · EnergyReading / EnergySummary / EnergyTariff
  EnergyReading / MachineState ───► · OEERecord (persisted snapshots)
                                    · BatchRecord, MaterialLot, TraceEvent
                                            │
                          KpiService / OeeService / DashboardService
                                            │  (compute on read, scope+time filtered)
                                            ▼
                          REST  /dashboard/* /production/oee/* /maintenance/* /energy/*
                                            │
                          React Query + WebSocket (dashboard:kpis, machines:status)
                                            ▼
                                    Dashboards / cards / trends
```

- **Real‑time:** the home dashboard subscribes to WebSocket channels `dashboard:kpis`
  and `machines:status`; KPI recompute is also triggered on WO/JO completion
  (`production.kpi.updated`).
- **Empty ≠ mock:** when a window has no rows the APIs return real **zeros / empty
  arrays** and the UI shows skeletons or "no data" — there is **no hardcoded demo data**
  in the dashboards/overviews (verified across production, manufacturing, quality,
  energy, maintenance, dashboard‑center). If a maintenance/overview number looks
  "static", it means the underlying `MaintenanceWO`/`PMPlan` rows are sparse for the
  selected scope+window, not that the value is faked.

---

## 6. How to verify a number by hand
1. Note the **scope** (which machines) and the **from/to** window shown in the UI.
2. Pull the rows the metric is built from (e.g. `JobOrder` for OEE, `MaintenanceWO` for MTTR) filtered by those machine IDs + window.
3. Apply the equation from §3. Aggregate **by summing the base quantities/minutes**, then compute the ratio (don't average percentages).
4. Compare to the API response (`GET /production/oee/calculate?...`). They should match to 1 decimal.
