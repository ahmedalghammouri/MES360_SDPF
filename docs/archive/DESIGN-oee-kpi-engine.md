# OEE / KPI Engine — Standards-based, JO-sourced, hierarchical roll-up

Status: **Phase 1 implemented** (pure engine). Phases 2–3 planned.
Owner: platform. Source of truth for how OEE/KPIs are computed and propagated.

---

## 1. Goal

Make the **Job Order (JO)** the single source of truth for OEE, computed from everything
that actually happened on the shop floor, then **roll it up** two independent ways:

```
OEE roll-up (production):     JO  →  WO  →  PO
OEE roll-up (asset hierarchy): Machine → Line → Area → Factory(Plant)
```

Every input must be considered:
- Manufacturing-process **routing steps** (each JO = one step; `idealCycleTimeSec` per step/machine).
- **Scheduling** (planned window per JO from shift/APS) as the availability denominator.
- **Downtime — planned and unplanned** (`DowntimeEvent`, `MachineStateRecord`): planned excluded
  from availability loss; unplanned breakdown = availability loss; micro-stops = performance loss.
- **Machine status** (`MachineCurrentStatus`, `MachineStateRecord`, `MachineState`).
- **Shift status** (`ShiftInstance` planned production minutes = OEE availability base).
- **WO / JO / PO statuses** — kept consistent and propagated in real time.

And: **PO/WO/JO statuses reflect to each other in real time**, OEE recomputes live, and the
asset-hierarchy roll-up powers intelligent visualization/analysis.

---

## 2. Standards model (ISO 22400 / six big losses)

```
Plant Operating Time
  └─ Planned Production Time (PPT)        = shift duration − planned stops (break, cleaning, PM)
       └─ Run Time                        = PPT − Availability Loss (unplanned breakdown, setup>threshold, starved/blocked)
            └─ Net Run Time               = Run Time − Performance Loss (micro-stops, speed loss)
                 └─ Fully Productive Time  = Net Run Time − Quality Loss (scrap, rework)

Availability = Run Time / PPT
Performance  = (Ideal Cycle Time × Total Count) / Run Time
Quality      = Good Count / Total Count
OEE          = A × P × Q
```

Mapping to our `DowntimeEvent.reasonCode` (already in schema):
| reasonCode | Loss bucket |
|---|---|
| PLANNED_MAINTENANCE, PLANNED_CLEANING/BREAK (`isPlanned`/`affectsOEE=false`) | excluded from PPT (not a loss) |
| UNPLANNED_BREAKDOWN, CHANGEOVER, STARVED, BLOCKED, EXTERNAL (`affectsOEE`) | **Availability loss** |
| MICRO_STOP | **Performance loss** (speed) |
| scrap / rework (`actualQtyRejected`, `ScrapLog`) | **Quality loss** |

`MachineState` enum already encodes these states (RUNNING/IDLE/PLANNED_STOP/BREAKDOWN/SETUP/
CHANGEOVER/STARVED/BLOCKED/OFFLINE/MAINTENANCE) → time-segmented availability.

---

## 3. Current state (as of this study)

| Area | File / method | Behaviour | Gap |
|---|---|---|---|
| Pure formula | `production/oee.service.ts` `calculate()` | A×P×Q, clamps 0–100 | OK; no six-loss split, no roll-up |
| JO OEE | `production.service.ts` `calcJobOrderOEE()` | A=operatingSpan/plannedSpan, P=ideal×count/span, Q=good/total | operating span = **wall-clock** (doesn't subtract unplanned downtime → A overstated); ignores MachineStateRecord, planned vs unplanned, micro-stops, shift PPT |
| WO OEE | `production.service.ts` `calculateAndStoreOEE()` (on complete) | recompute from WO actual span − unplanned downtime; writes WO + `OEERecord` | independent recompute, **not rolled up from JOs**; only at completion; PPT = actual span not shift window |
| PO OEE | — | none (PO only sums `goodQty` → `completedQty`) | **missing** |
| Plant OEE | `dashboard.service.ts` | flat `_avg` of `OEERecord` | **not hierarchy-weighted** (machine→line→area→plant) |
| Status flow | `production.service.ts` | PO release→WO; WO complete→PO manual; JO chain READY via predecessor | JO→WO→PO not auto-propagated live; no live OEE recompute on status change |
| Real-time | `gateways/mes.gateway.ts` + `eventEmitter` | emits WO completed etc. | no live OEE/status roll-up broadcast |

**Conclusion:** schema is sufficient; the engine + orchestration + propagation layer is what we improve.

---

## 4. Target architecture

### 4.1 Pure engine (`oee.service.ts`) — Phase 1 ✅
No DB. Deterministic, unit-tested. Exposes:
- `calculate(input)` — back-compat simple A×P×Q.
- `calculateDetailed(input)` — six-loss inputs (PPT, plannedDowntime, unplannedDowntime/availability loss, microStopMinutes, idealCycleTime, totalCount, goodCount) → `{availability, performance, quality, oee, runTime, netRunTime, losses{...}}`.
- `availabilityFromSegments(segments)` — time-segmented availability from `MachineStateRecord`-shaped rows (state + durationMinutes + isPlannedStop).
- `rollup(children)` — **weighted aggregate** of child OEE breakdowns. Weight = Run Time (preferred) or Good Output. Produces a parent `{availability, performance, quality, oee}` that is consistent (parent A = Σ runtime / Σ PPT, etc.) rather than a naive average. This is the single primitive reused for **JO→WO→PO** and **Machine→Line→Area→Plant**.

### 4.2 Orchestration (`KpiService`, Phase 2)
DB-aware. Builds engine inputs from real data and persists/roll-ups:
- `computeJobOrderOEE(joId)` — PPT from JO planned window (or shift window ∩ JO), Run Time = PPT − Σ unplanned `DowntimeEvent`/breakdown `MachineStateRecord` overlapping the JO; micro-stops → performance; Q from good/(good+rejected) + `ScrapLog`.
- `computeWorkOrderOEE(woId)` = `rollup(JOs of WO)` weighted by run time. Writes `WorkOrder.oee/availability/performance/quality`.
- `computeProductionOrderOEE(poId)` = `rollup(WOs of PO)`. (Add `oee/availability/performance/quality` columns to `ProductionOrder`.)
- `computeMachineOEE / Line / Area / Factory(range)` = time-bounded `rollup` of children, reading `OEERecord` (machine grain) then weighting up the asset tree (`Machine.lineId → Line.areaId → Area.factoryId`).

### 4.3 Status state machine + propagation (Phase 2)
- JO: SCHEDULED→READY→EXECUTING↔PAUSED→COMPLETE (chain via predecessor handover — already present).
- On **JO status/qty change**: recompute WO live OEE; derive WO status (any JO EXECUTING → WO IN_PROGRESS; all JO COMPLETE → WO COMPLETED; etc.); then derive PO status (any WO IN_PROGRESS → PO IN_PROGRESS; all WO COMPLETED → PO COMPLETED) + PO OEE.
- Centralize in `KpiService.onJobOrderChanged(joId)` invoked from JO mutations + an `@OnEvent('production.job-order.changed')` listener; emit `production.kpi.updated` for the gateway to broadcast live.
- Machine status: derive `MachineCurrentStatus.state` from latest `MachineStateRecord`/active JO; feed live availability.

### 4.4 Real-time (Phase 2)
`mes.gateway` broadcasts `kpi.updated` with the affected JO/WO/PO/machine ids + new OEE/status so the frontend updates without refetch.

### 4.5 Visualization & analysis (Phase 3)
- Hierarchy OEE tree (Factory→Area→Line→Machine) with drill-down, waterfall of the six losses, Pareto by `reasonCode`, trend, and live status badges — driven by `KpiService` endpoints.

---

## 5. Phased plan

- **Phase 1 (this change, additive, safe):** pure engine `calculateDetailed` + `availabilityFromSegments` + `rollup` + tests. No behaviour change to live numbers yet.
- **Phase 2 (backend orchestration):** `KpiService` (JO→WO→PO + machine→line→area→plant), `ProductionOrder` OEE columns (`prisma db push`), status propagation + real-time events, refactor `calcJobOrderOEE`/`calculateAndStoreOEE`/dashboard to call the engine. Migrate dashboard plant OEE to hierarchy-weighted roll-up.
- **Phase 3 (frontend):** hierarchy OEE tree + six-loss waterfall + live status; wire WO/PO detail OEE to rolled-up values; OEE Analytics + Machine KPIs pages.

Each phase is independently shippable. Phase 2 changes live numbers → ship behind verification (the engine is unit-tested; compare old vs new on seed data before switch-over).
