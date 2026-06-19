# 05 — OEE & AT-OEE Calculation

How the platform computes OEE — **live**, **periodic**, and **analytical** — and how numbers
roll up Machine → Line → Area → Factory and feed every dashboard.

Primary code:
- [oee.service.ts](../../apps/api/src/modules/production/oee.service.ts) — pure formulas (+ [spec](../../apps/api/src/modules/production/oee.service.spec.ts))
- [kpi.service.ts](../../apps/api/src/modules/production/kpi.service.ts) — orchestration & roll-up
- [downtime.service.ts](../../apps/api/src/modules/production/downtime.service.ts) — loss buckets
- [historian.service.ts](../../apps/api/src/modules/historian/historian.service.ts) + [historian.scheduler.ts](../../apps/api/src/modules/historian/historian.scheduler.ts) + [influx.service.ts](../../apps/api/src/modules/historian/influx.service.ts) — live samples & trends
- [shift.service.ts](../../apps/api/src/modules/shift/shift.service.ts) — planned production time
- [dashboard.service.ts](../../apps/api/src/modules/dashboard/dashboard.service.ts) — dashboard assembly
- Design note: [docs/DESIGN-oee-kpi-engine.md](../DESIGN-oee-kpi-engine.md)

---

## 1. The formula (ISO 22400 style)

```
Availability = Run Time / Planned Production Time
Performance  = (Ideal Cycle Time × Total Count) / Run Time
Quality      = Good Count / Total Count
OEE          = Availability × Performance × Quality
```
where `Run Time = Planned Production Time − Unplanned Downtime`. All factors are computed as
decimals and reported as percentages, **clamped to [0, 100]** and rounded to 1 decimal.

`OEEService.calculateDetailed()` (the six-loss form) also returns the **minute/count
primitives** needed for correct roll-up:
```
ppt          = max(0, plannedProductionTime)
runTime      = max(0, ppt − unplannedDowntime)
idealRunTime = idealCycleTime × totalCount     (earned minutes)
losses: { availabilityLossMin = ppt − runTime,
          performanceLossMin  = max(0, runTime − idealRunTime),
          qualityLossMin      = idealCycleTime × (totalCount − goodCount) }
```

`OEEService.calculate()` is the simpler entry used by `POST /production/oee/calculate`.

### Classification (`getClassification`)
`≥85% world-class · ≥65% good · ≥45% acceptable · <45% poor`.

---

## 2. "AT-OEE" — what it means here

There is **no separate AT-OEE *formula*** in the codebase; OEE is always `A × P × Q`.
What differs is **which availability** is used — two flavors are computed and stored
side-by-side (`HistorianService.computeSample`):

| Flavor | Field | Denominator | Meaning |
|--------|-------|-------------|---------|
| **Schedule-based** (classic) | `availability`, `oee` | Planned window (`plannedStart→plannedEnd`) | "Did we run for as long as we were scheduled to?" |
| **Time-based** ("AT-OEE") | `availabilityTb`, `oeeTb` | Actual uptime + downtime | `runMin / (runMin + downMin)` — "of the time the asset was *active*, how much was productive?" |

```
availabilityTimeBased = (runMin + downMin) > 0 ? runMin / (runMin + downMin) × 100 : null
oeeTimeBased          = (availabilityTb/100) × (performance/100) × (quality/100) × 100
```
So **AT-OEE = time-based OEE**: the same `P` and `Q`, but availability measured against the
asset's *active* time rather than its *scheduled* time. Both are persisted to InfluxDB and both
are returned by `GET /historian/oee-trend`, letting dashboards show classic vs time-based.

---

## 3. Inputs & their sources

### Job Order = the source of truth
Per `JobOrder`: `plannedStart/plannedEnd` (→ PPT window), `actualStart/actualEnd`
(operating span), `actualQtyGood`/`actualQtyRejected` (counts), `idealCycleTimeSec` (stamped
from `MachineCycleTime` at creation), `machineId` (to attribute downtime).

### Downtime attribution (`KpiService.joUnplanned`)
For each `DowntimeEvent` overlapping a JO's active window, minutes are added to *unplanned*
**unless** `isPlanned === true` **or** `affectsOEE === false`, and only when the event's machine
matches the JO's machine. The overlap (intersection) of intervals is what counts.

`OEE_EXCLUDED_REASON_CODES = { PLANNED_MAINTENANCE, EXTERNAL }` drive the default `affectsOEE`.

### Shift planned production time (`ShiftService.plannedProductionMinutes`)
```
PPT = shiftDurationHours × 60 − breakMinutes − cleaningMinutes
```
This is the availability denominator for **shift-level** OEE (`POST /shifts/instances/:id/complete`).

### Unit normalization (`KpiService.joRollupChild`)
Across a multi-step routing, counts are converted to the SKU's **base unit** (via the packaging
hierarchy) before summing, so `Quality = good/total` stays unit-safe when mixing inners/cartons/pallets.

---

## 4. Live calculation

- **Cadence:** every minute. `HistorianScheduler.tick()` (`@Cron(EVERY_MINUTE)`) calls
  `HistorianService.sampleActiveJobOrders()` (skipped if Influx is disabled).
- **What it samples:** all `JobOrder`s with status `EXECUTING|PAUSED`, a `machineId`, and an
  `actualStart`. For each, `operatingMin = now − actualStart`; overlapping downtime is split into
  `plannedMin` vs `downMin`; `runMin = operatingMin − downMin − plannedMin`.
- **Per-sample math** (`computeSample`): both availability flavors, performance
  (`idealProdMin / runMin`, capped 100), quality, and **both** `oee` and `oeeTb`.
- **Storage:** InfluxDB measurement **`oee`**, tags `factoryId/machineId/jobOrderId/workOrderId`,
  fields `availability, availabilityTb, performance, quality, oee, oeeTb, good, rejected, runMin,
  downMin, utilization`. Bucket `mes_timeseries`.
- **Force a sample:** `POST /historian/sample`.

On **JO/WO/PO state or quantity change**, `KpiService.propagateFromJobOrder()` /
`recomputeWorkOrderAndPO()` immediately recompute OEE up the chain, update the relational KPI
fields, and emit `production.kpi.updated` → WebSocket (live dashboards update without waiting
for the next minute tick).

---

## 5. Periodic calculation & storage

- **On WorkOrder completion** (`completeWorkOrder` → `recomputeWorkOrderAndPO`): WO `oee/A/P/Q`
  updated, PO rolled up, `production.kpi.updated` emitted.
- **On Shift completion** (`/shifts/instances/:id/complete`): OEE computed from the planned shift
  window and stored on `ShiftInstance`.
- **`OEERecord`** rows are the stored scorecards (per shift/batch), exposed via
  `GET /production/oee-records` and built from job orders by `KpiService.oeeRecordsFromJobOrders`.
- **Relational KPI fields** on `WorkOrder`/`ProductionOrder`/`ShiftInstance` hold the latest
  rolled-up values for fast reads.

---

## 6. Analysis / historical

- **Trends from Influx** (`HistorianService.getOeeTrend`, `getProductionTrend`): Flux
  `aggregateWindow(every: 30m|1h|1d, fn: mean|max)` + `pivot`, returning
  `{ time, availability, availabilityTb, performance, quality, oee, oeeTb }`. Surfaced by
  `GET /historian/oee-trend` and `GET /historian/production-trend`.
- **Hierarchy OEE tree** (`KpiService.hierarchyOEE`, default last 7 days): queries all job orders
  in range on in-scope machines, builds `RollupChild` per JO (unit-normalized), buckets by
  machine, then rolls up Machine → Line → Area → Plant, plus a **downtime Pareto** by reason code
  and the six-loss split. Surfaced by `GET /production/oee/hierarchy`.
- **OEE summary** (`getOEESummary` → `oeeAnalytics`): window roll-up + trend + per-equipment
  breakdown, for `GET /production/oee/calculate`.

---

## 7. Roll-up — the core principle

**Never average percentages.** `OEEService.rollup(children)` sums the underlying primitives of
all children (`ppt`, `runTime`, `idealRunTime`, `totalCount`, `goodCount`) and **recomputes**
A/P/Q from the totals. This is quantity/time-weighted and ISO 22400-correct.

```
JobOrder  ──sum──►  WorkOrder  ──sum──►  ProductionOrder
Machine   ──sum──►  Line       ──sum──►  Area  ──sum──►  Factory(Plant)
```

- **JO → WO:** `recomputeWorkOrderAndPO` builds a `RollupChild` from the WO's job orders
  (`woChild`) — summing planned/run/ideal minutes and counts; quality taken from the final step's
  output. Non-routed WOs use their own actuals.
- **WO → PO:** `recomputeProductionOrder` maps each non-cancelled WO to a `RollupChild` and calls
  `oee.rollup(children)`.
- **Machine → Line → Area → Factory:** `hierarchyOEE` groups job-order `RollupChild`s by machine,
  then flattens per line, per area, and across the whole plant — each level re-running `rollup`.

**Why it matters (from the spec):** a 100%-efficient 10-min run plus a 50%-efficient 90-min run
is *not* 75% — correct roll-up yields the time-weighted truth (≈55%).

### Example (spec test)
```
Child 1: ppt=600 run=600 ideal=600 total=1000 good=1000   (perfect)
Child 2: ppt=60  run=30  ideal=15  total=50   good=25     (poor)
Parent : availability=630/660=95.5%  performance=615/630=97.6%  quality=1025/1050=97.6%
```

---

## 8. Six big losses & Pareto

`DowntimeService.getOEELossBreakdown` maps `DowntimeEvent.reasonCode` to buckets:

| Reason code | Bucket |
|-------------|--------|
| PLANNED_MAINTENANCE, CHANGEOVER | Planned stop (excluded from PPT) |
| UNPLANNED_BREAKDOWN | Availability loss |
| MICRO_STOP, STARVED, BLOCKED | Performance (speed) loss |
| EXTERNAL | Excluded (informational) |
| scrap / rework | Quality loss |

The hierarchy endpoint also returns a **Pareto** of downtime minutes by reason code (with
cumulative %), and each tree node carries `losses { availabilityLossMin, performanceLossMin,
qualityLossMin }` for waterfall charts.

---

## 9. OEE by hierarchy level — endpoints & dashboards

| Scope | How to get it | Backing logic |
|-------|---------------|---------------|
| **Factory (plant)** | `GET /production/oee/hierarchy` → `plant`; `GET /dashboard/overview` | `hierarchyOEE` plant roll-up |
| **Area** | `/production/oee/hierarchy` → `tree[type=AREA]`; or `?areaId=` scope on KPI/summary endpoints | area roll-up of its machines |
| **Line** | `/production/oee/hierarchy` → `tree[…][type=LINE]`; `?lineId=` | line roll-up |
| **Machine** | tree leaves `[type=MACHINE]`; `?machineId=`; `GET /historian/oee-trend?machineId=` | per-machine sum of its JOs / Influx series |
| **Shift** | `GET /shifts/analysis`, `GET /shifts/current-status` | shift-window OEE on `ShiftInstance` |
| **Job order (live)** | `GET /production/job-orders/:id/live` | live OEE, six-loss, downtime, scrap, trends |

**Live operations dashboard** (`DashboardService.getOverview`) combines KPIs (oee/A/P/Q),
machine status, running lines & planned-vs-actual output, active alarms, the production trend,
the downtime Pareto, and the current shift summary. `GET /production/kpis` and
`GET /dashboard/kpis` give the header KPI numbers (filterable by area/line/machine).

All of the above accept the scope filters `?areaId`, `?lineId`, `?machineId` and (where relevant)
`?timeframe`/`?dateFrom`/`?dateTo`, so the same engine serves every drill-down level.

---

## 10. Influx vs PostgreSQL in OEE

| Concern | InfluxDB | PostgreSQL |
|---------|----------|------------|
| Per-minute OEE samples (live + trends) | ✅ measurement `oee` | — |
| Trend queries (`aggregateWindow`) | ✅ | — |
| Latest rolled-up WO/PO/Shift OEE | — | ✅ KPI fields |
| Stored scorecards | — | ✅ `OEERecord` |
| Event sourcing (downtime, counts, states) | — | ✅ |
| Degraded mode (Influx down) | n/a | ✅ relational fallback |

InfluxDB is **optional**: if `INFLUX_URL`/`INFLUX_TOKEN` are unset, the historian disables and
the API falls back to relational queries.

---

## 11. Quick reference — functions

| Function | File | Role |
|----------|------|------|
| `OEEService.calculate` | oee.service.ts | Simple A/P/Q/OEE from raw inputs |
| `OEEService.calculateDetailed` | oee.service.ts | Six-loss form + minute/count primitives |
| `OEEService.availabilityFromSegments` | oee.service.ts | Availability from state records |
| `OEEService.rollup` | oee.service.ts | **Weighted** aggregation primitive |
| `KpiService.woChild` / `joRollupChild` | kpi.service.ts | Build `RollupChild` from WO/JO |
| `KpiService.recomputeWorkOrderAndPO` / `recomputeProductionOrder` | kpi.service.ts | JO→WO→PO roll-up + persist |
| `KpiService.hierarchyOEE` | kpi.service.ts | Machine→Line→Area→Factory tree + Pareto |
| `HistorianService.sampleActiveJobOrders` / `computeSample` | historian.service.ts | Live per-minute samples (both OEE flavors) |
| `HistorianService.getOeeTrend` / `getProductionTrend` | historian.service.ts | Influx trend queries |
| `DowntimeService.getOEELossBreakdown` | downtime.service.ts | Six-loss buckets |
| `ShiftService.plannedProductionMinutes` | shift.service.ts | PPT for shift OEE |
