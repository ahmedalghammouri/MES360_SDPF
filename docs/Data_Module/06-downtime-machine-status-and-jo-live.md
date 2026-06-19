# 06 — Downtime, Machine Status & the Job-Order Live Dashboard

How the platform classifies **planned vs unplanned downtime**, how stops are **reflected into
machine status** and the state timeline, and exactly what the **Job-Order live dashboard**
(`GET /production/job-orders/:id/live`) computes.

Primary code:
- [downtime.service.ts](../../apps/api/src/modules/production/downtime.service.ts)
- [production.service.ts](../../apps/api/src/modules/production/production.service.ts) — `getJobOrderLiveDashboard`, `syncMachineStatus`
- Schema: `DowntimeEvent`, `DowntimeCause`, `MachineStateRecord`, `MachineCurrentStatus` (see [02](02-database-and-prisma.md))

---

## 1. Planned vs unplanned downtime — the classification

Three constants in `downtime.service.ts` drive everything (`DOWNTIME_THRESHOLD_SECONDS = 60`):

```ts
OEE_EXCLUDED_REASON_CODES = { PLANNED_MAINTENANCE, EXTERNAL }  // do NOT reduce OEE Availability
PLANNED_STOP_CODES        = { PLANNED_MAINTENANCE, CHANGEOVER } // planned stops (reduce planned time)
```

Every `DowntimeEvent` carries three flags that together decide its effect:

| Field | Meaning | How it's set |
|-------|---------|--------------|
| `reasonCode` | The ISO/TPM loss category (`PLANNED_MAINTENANCE`, `CHANGEOVER`, `UNPLANNED_BREAKDOWN`, `MICRO_STOP`, `STARVED`, `BLOCKED`, `EXTERNAL`) | from DTO, else derived from the chosen `DowntimeCause.isPlanned` |
| `isPlanned` | Is this a planned stop? | `dto.isPlanned ?? cause.isPlanned ?? PLANNED_STOP_CODES.has(reasonCode)` |
| `affectsOEE` | Does it reduce OEE availability? | `!OEE_EXCLUDED_REASON_CODES.has(reasonCode)` |

So the matrix is:

| reasonCode | isPlanned | affectsOEE | Effect |
|------------|-----------|------------|--------|
| `PLANNED_MAINTENANCE` | ✅ | ❌ | Planned stop — excluded from Planned Production Time, **not** an availability loss |
| `CHANGEOVER` | ✅ | ✅ | Planned stop, but still counts as setup/availability loss in detailed views |
| `UNPLANNED_BREAKDOWN` | ❌ | ✅ | **Availability loss** |
| `MICRO_STOP` | ❌ | ✅ | **Performance (speed) loss** |
| `STARVED` / `BLOCKED` | ❌ | ✅ | **Performance (speed) loss** |
| `EXTERNAL` | ❌ | ❌ | Informational — excluded from OEE |

> When an operator picks a specific NCC reason (`DowntimeCause`), the event **inherits** that
> cause's `category` and `isPlanned` flag so it is classified and counted correctly.

This is the same logic the OEE engine relies on (doc 5 §3): downtime where `isPlanned === true`
**or** `affectsOEE === false` is **not** subtracted from run time.

---

## 2. How downtime is created (three paths)

### a) Manual event — `createDowntimeEvent` (`POST /production/downtime/events`)
- Rejects a second open event for the same machine (one open stop at a time).
- Auto-links to the machine's `IN_PROGRESS` work order if none supplied.
- Resolves `category` / `reasonCode` / `isPlanned` / `affectsOEE` as above.
- Sets machine status to `PLANNED_STOP` or `BREAKDOWN` (§3).
- Emits `downtime.event.created` → WebSocket (+ notification when unplanned).

### b) Operator state change — `setMachineState` (`PATCH /production/downtime/machines/:id/state`)
One "smart" shop-floor action that keeps **four things consistent**:
1. **State timeline** — closes the open `MachineStateRecord` (stamping `endTime` + `durationMinutes`) and opens a new one (`source: 'OPERATOR'`).
2. **Live snapshot** — upserts `MachineCurrentStatus.state`.
3. **Downtime event** — if the new state is a *down* state and none is open, creates one; if it's a *running/up* state and one is open, ends it.
4. **Job order** — pauses the linked JO (`EXECUTING → PAUSED`) on a stop, resumes (`PAUSED → EXECUTING`) on `RUNNING`.

Down states & their default reason/category:
```
BREAKDOWN    → UNPLANNED_BREAKDOWN / MECHANICAL          (unplanned)
STARVED      → STARVED / MATERIAL                         (unplanned)
BLOCKED      → BLOCKED / PROCESS                          (unplanned)
PLANNED_STOP → PLANNED_MAINTENANCE / PLANNED_BREAK        (planned)
MAINTENANCE  → PLANNED_MAINTENANCE / PLANNED_MAINTENANCE  (planned)
SETUP        → CHANGEOVER / CHANGEOVER                    (planned)
CHANGEOVER   → CHANGEOVER / CHANGEOVER                    (planned)
```
`DOWN_STATES = {PLANNED_STOP, BREAKDOWN, SETUP, CHANGEOVER, STARVED, BLOCKED, MAINTENANCE}` —
the dialog can override the reason/category. Emits `machine.state.changed`.

### c) Auto-detection — `detectAndCreateAutoDowntime`
For machines `IDLE` with a current WO and `lastEventAt` older than **60 s**
(`DOWNTIME_THRESHOLD_SECONDS`), opens a `MICRO_STOP` event (unplanned, `affectsOEE: true`) and
emits `downtime.auto.created`. This realises the NCC "stop > 60 s" requirement.

### Ending an event — `endDowntimeEvent`
Stamps `endTime` + `durationMinutes` (server-clock-safe against skew), restores machine status to
`RUNNING` (if an `IN_PROGRESS` WO exists) or `IDLE`, **increments `WorkOrder.downtimeMinutes`**,
computes `schedulingImpactMins` on dependent steps (except micro-stops), emits `downtime.event.ended`.

---

## 3. How downtime is reflected into machine status

Two records are kept in lock-step:

| Record | Role |
|--------|------|
| `MachineCurrentStatus` | **Live snapshot** — single row per machine (`state`, `lastEventAt`, `currentWOId`, OEE/speeds/counts). Read by live dashboards & telemetry pushes. |
| `MachineStateRecord` | **Timeline** — append-only segments (`state`, `startTime`, `endTime`, `durationMinutes`, `isPlannedStop`, `downtimeCauseId`, `source`). The basis for the state-distribution strip and segment-based availability. |

State transitions:
```
                 createDowntime / setMachineState(down)
   RUNNING / IDLE ───────────────────────────────► BREAKDOWN | PLANNED_STOP | SETUP | …
        ▲                                                  │
        └────────────── endDowntime / setMachineState(RUNNING) ◄┘
   (RUNNING if an IN_PROGRESS WO exists, else IDLE)
```

- `updateMachineStateForDowntime` sets `PLANNED_STOP` (planned) or `BREAKDOWN` (unplanned) on open.
- `setMachineState` additionally writes the timeline segment and reconciles the open
  `DowntimeEvent` and the linked `JobOrder`.
- `MachineState` enum: `RUNNING, IDLE, PLANNED_STOP, BREAKDOWN, SETUP, CHANGEOVER, STARVED,
  BLOCKED, OFFLINE, MAINTENANCE`.

Telemetry/IoT and `production.service.syncMachineStatus` also keep `MachineCurrentStatus` aligned
with the running JO — but **operator-declared downtime is owned by `setMachineState`** and is not
overridden by telemetry sync.

State changes propagate to the UI as `machine:state-changed` / `machine:telemetry` WebSocket
events (a transition to `BREAKDOWN` also raises a notification) — see [04](04-mqtt-and-websocket.md).

---

## 4. How downtime reflects in OEE & summaries

- **`getOEELossBreakdown`** (date range, optional machine) buckets minutes by `reasonCode`:
  `plannedStopMins` (PLANNED_MAINTENANCE + CHANGEOVER), `availabilityLossMins` (UNPLANNED_BREAKDOWN),
  `speedLossMins` (MICRO_STOP + STARVED + BLOCKED), `externalLossMins` (EXTERNAL), plus
  `byReasonCode` and `totalDowntimeMins`.
- **`getDowntimeSummary`** (`GET /production/downtime/summary`, scoped by area/line/machine)
  totals minutes and counts an **`oeeImpactMinutes`** that includes only events with
  `affectsOEE !== false`.
- The OEE engine (doc 5) consumes the same `isPlanned`/`affectsOEE` flags when computing
  availability at JO/WO/PO and hierarchy level.

---

## 5. The Job-Order Live Dashboard

`GET /production/job-orders/:id/live` → `getJobOrderLiveDashboard`. A single payload that drives
the per-operation live screen. It is **machine-scoped to this JO's machine** (a WO spans several
machines, one per routing step), falling back to the WO when no machine is set.

### 5.1 Analysis window
```
windowStart = actualStart ?? plannedStart ?? createdAt
windowEnd   = actualEnd ?? now            (isLive = !actualEnd)
windowMins  = windowEnd − windowStart
```
All minute math below is **clamped to this window** (`clampMins`).

### 5.2 Data gathered (parallel)
Downtime overlapping the window (this machine), scrap logs, `COUNT_UPDATE` events (real series),
the machine **state timeline**, alarms (machine + JO-tagged), maintenance WOs (open + 30-day),
30-day unplanned downtime history (for reliability), and 14-day `OEERecord` history.

### 5.3 ISO 22400 time model (within the window)
```
totalProduced     = actualQtyGood + actualQtyRejected
operationalMins   = windowMins − plannedStopMins
netProductionMins = operationalMins − unplannedStopMins        (= uptime)
idealProductionMins = idealCycleTimeSec × totalProduced / 60
performanceLossMins = max(0, netProductionMins − idealProductionMins)
qualityLossMins     = idealCycleTimeSec × actualQtyRejected / 60
```

### 5.4 OEE block — two availability methods side by side
- **Classic (schedule-based):** `oee` / `joAvailability` / `joPerformance` / `joQuality` from
  `calcJobOrderOEE` (uses the planned window).
- **Time-based ("AT-OEE"):**
  ```
  availabilityTimeBased = uptime / (uptime + unplannedStopMins) × 100    (uptime = netProductionMins)
  oeeTimeBased          = availabilityTimeBased × performance × quality
  ```
- **Utilization & TEEP:**
  ```
  utilizationPct = operationalMins / windowMins × 100
  teepPct        = oee × utilization / 100
  teepTimeBasedPct = oeeTimeBased × utilization / 100
  ```
- **Benchmark class:** `≥85 WORLD_CLASS · ≥70 GOOD · ≥60 FAIR · <60 POOR` applied to each metric.
- **Trend:** prefers the InfluxDB historian (`getOeeTrend`, 14-day daily, both availability
  flavors); falls back to relational `OEERecord` rows (classic only).

### 5.5 Six Big Losses (`sixLosses`) — all from recorded data
```
Availability  equipmentFailure  = unplannedStopMins − microStopMins   (breakdowns)
              setupAdjustments  = changeoverMins + plannedStopMins
Performance   idlingMinorStops  = microStopMins
              reducedSpeed      = performanceLossMins
Quality       processDefects    = (rejected − setupScrap) → minutes via ICT
              startupRejects     = setupScrap → minutes via ICT
```

### 5.6 Downtime block
`totalMins`, `plannedMins`, `unplannedMins`, occurrences, median/avg event length, the **open**
event, the full event list, a **Pareto by cause**, a separate **micro-stop Pareto**, plus
reliability: **MTTR** (mean closed duration), **MTBF** (mean gap between failures), **MTTA**
(failure→ack), **repair time** (ack→resume) over a **30-day** window.

### 5.7 State distribution
From the `MachineStateRecord` timeline within the window: total/median/avg segment minutes and a
`byState` split (Run / Idle / Down …) — the time-model strip.

### 5.8 Production, scrap, machine, alarms, maintenance
- **production:** planned/good/rejected/total, `progressPct`, `rejectRatePct`, **pace**
  (`paceGoodPerHr`), **ETA** (`etaMins` from remaining qty ÷ pace), `idealRatePerHr`, and the
  recorded `COUNT_UPDATE` trend.
- **scrap:** total, logs, highest-reject moment, top reasons, by-category split.
- **machine:** id/name/code, line, area, `designCapacity`, `criticality`, the live
  `currentStatus`, and the `stateTimeline`.
- **alarms:** events, active/unacknowledged counts, by-severity.
- **maintenance:** open + recent WOs and the open count.

### 5.9 Response shape (top-level keys)
```
{ generatedAt, jobOrder, window, oee, production, timeModel, sixLosses,
  stateDistribution, downtime, scrap, machine, alarms, maintenance }
```

---

## 6. Cross-references
- OEE formulas, roll-up, and the schedule-vs-time-based availability discussion: [05-oee-and-at-oee.md](05-oee-and-at-oee.md).
- WebSocket events for downtime/state/telemetry: [04-mqtt-and-websocket.md](04-mqtt-and-websocket.md).
- `DowntimeEvent` / `MachineStateRecord` / `MachineCurrentStatus` schema: [02-database-and-prisma.md](02-database-and-prisma.md).
- Endpoints: `/production/downtime/*`, `/production/job-orders/:id/live` in [03-rest-api.md](03-rest-api.md).
