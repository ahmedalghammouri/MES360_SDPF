# NCC PoC — Requirements Audit, Implementation Status & Verification Plan

Audit of the 29 items in `NCC_PoC_Enhancement_Action_Checklist_EN.xlsx` and the seven themes in
`NCC_PoC_Client_Requirements_Summary_AR.docx`, checked against the actual codebase.

**Date:** 6 August 2026 · **Branch:** `UPD_POC_SDPF`

> **Evaluation lens.** NCC will judge this PoC on one thing: *are the numbers right?* — counting
> accuracy, calculation accuracy, KPI realism, OEE correctness. Every item below is therefore
> classified by whether the **number it produces is trustworthy today**, not by whether a screen
> exists.

---

## 1. Status summary

| Status | Count | Items |
|---|---|---|
| ✅ Completed (verified in code + tests) | 21 | 2, 6–9, 12, 14–28 |
| 🟡 In progress | 1 | 29 |
| ⏳ Awaiting NCC input | 7 | 1, 3, 4, 5, 10, 11, 13 |

Client's original file recorded **3 of 29 complete (10.3%)**. Verified position after this pass:
**21 of 29 complete (72.4%)**.

Everything still outstanding traces to **one missing input: the stack-light signal
specification** (items 3, 4, 5, 10, 11, 13 — six of the eight Critical items), plus the 3D
line model (item 1). Everything *downstream* of that signal is already built and tested —
the state model, the external-loss handling, the OEE effect. Only the detection is missing.

---

## 2. Per-item audit

### Plant Live Views (items 1–2)

| # | Item | Verdict | Evidence / action |
|---|---|---|---|
| 1 | 3D line model matches actual layout | ⛔ **Blocked** | No 3D engine in the web app — `apps/web/package.json` has no `three` / `@react-three` / `babylon` dependency. The "line model" today is the schematic in `apps/web/src/features/plant-dashboard/plant-live-view.tsx`. **Needs from NCC:** approved site layout drawing + machine sequence/orientation + photos. |
| 2 | Site coordinates updated | ✅ **Done** | `apps/api/prisma/seed-factory-coordinates.ts` contains the five client-supplied Google Maps coordinates. Confirmed correct and deployed (IPIC, 6 Aug 2026); the RNTIC/NDPF ordering flagged in the script header is the intended one. |

### Downtime Command Center — automation (items 3–6)

| # | Item | Verdict | Evidence / action |
|---|---|---|---|
| 3 | Integrate stack-light signals | ⛔ **Blocked** | Zero occurrences of `stackLight` anywhere in the codebase. The acquisition layer that would carry it **does exist** (`apps/edgegateway/src/acquisition/` — Modbus poller, rising-edge counter, debounce, buffer), so this is a tag-mapping + state-machine task, not new infrastructure. **Needs from NCC:** which machine, which signal colours are wired, the electrical interface (dry contact → Remote I/O input vs PLC output), and the meaning of each colour/combination. |
| 4 | Auto-detect and timestamp stops | ⛔ **Blocked by #3** | Design ready (see §4). Debounce logic already exists at the edge for counters and is reusable. |
| 5 | Operator limited to classifying reason | ⛔ **Blocked by #3** | The manual path exists today (`log-downtime-dialog.tsx`). Converting it to "classify only" is small once events arrive automatically. |
| 6 | Review planned/unplanned classification | ✅ **Done** | One rule set now governs every module: `apps/api/src/modules/reliability/reliability.service.ts` exports `PLANNED_DOWNTIME_CATEGORIES`, `FAILURE_*` and `NON_FAILURE_*` constants, consumed by the Downtime cockpit, Maintenance KPIs and Analytics reports. This also fixed a latent bug where category `CLEANING` was referenced but the schema value is `PLANNED_CLEANING`, so cleaning stops were being treated as unplanned. |

### OEE (items 7–13)

| # | Item | Verdict | Evidence / action |
|---|---|---|---|
| 7 | Verify current line-OEE method | ✅ **Done — documented below** | The current method is **not** an average of machine OEEs. `OEEService.rollup()` sums PPT / run-time / earned-minutes / counts across children and re-derives A×P×Q from the totals (`apps/api/src/modules/production/oee.service.ts`). That is a correct quantity-weighted roll-up — but it is still **not bottleneck-based**, which is what NCC asked for. |
| 8 | Bottleneck-based Line OEE | ✅ **Done** | `OEEService.lineOee()` + `KpiService.lineOeeAnalytics()` + `GET /production/oee/line`. The constraint is nominated per line (`ProductionLine.bottleneckMachineId`) and is **editable in Plant Hierarchy → Edit Production Line**. Unset falls back to the machine with the **slowest routing cycle time** — derived from the same process-routing master data as job orders — and reports `basis.bottleneckResolvedBy`, so the figure is never unexplained. Per-machine values are still returned, explicitly labelled as diagnostics rather than the line KPI. |
| 9 | Final Outfeed Quality | ✅ **Done** | Q comes from the nominated outfeed machine only, via `finalStepCounts()` — good = the final step's output, scrap = rejects at every stage — so a unit lost at the checkweigher, cartoner, palletizer or wrapper is counted exactly once and never double-counted. `outfeedMachineId` is editable in the same dialog; unset falls back to the last machine in line order. |
| 10 | Auto-detect Starved | ⛔ **Blocked by #3** for detection · ✅ **handled once detected** | `MachineState.STARVED` already exists in the schema. The consumption side is now correct (see #12). |
| 11 | Auto-detect Blocked | ⛔ **Blocked by #3** for detection · ✅ **handled once detected** | Same as above with `MachineState.BLOCKED`. |
| 12 | Exclude Starved/Blocked from A and P | ✅ **Done** | **This was the root cause NCC diagnosed, and their diagnosis was exactly right.** Before this change `availabilityFromSegments()` put STARVED/BLOCKED into unplanned downtime, and the JO path counted the whole span as run-time — so a palletizer waiting on Big Betti lost both Availability *and* Performance. Now `EXTERNAL_LOSS_STATES = {STARVED, BLOCKED}` is carved out of PPT before A and P are derived, and surfaced separately as `losses.externalLossMin` — excluded, never hidden. 4 new tests. |
| 13 | Demonstrate on Palletizer/Wrapper | ⛔ **Blocked by #3** | Everything downstream of the signal is ready. |

**Worked example of the #12 fix** (from the test suite): 480 planned min, 120 min starved waiting on
the bottleneck, 360 min running.

| | Before | After |
|---|---|---|
| PPT | 480 | 360 (accountable minutes) |
| Availability | 75.0% | **100%** |
| Performance | 75.0% | **100%** |
| External loss | hidden in downtime | **120 min, reported** |

### Analytics & Reports — Production KPIs (items 14–17)

| # | Item | Verdict | Evidence / action |
|---|---|---|---|
| 14 | Add MSA KPI | ✅ **Done** | `ScheduleKpiService.masterScheduleAttainment()` + `GET /production/kpi/master-schedule-attainment`. Returns the percentage **plus the per-order lines** (scheduled, actual, credited, attainment) so the number can be reconciled against source rows without re-deriving it. 6 tests. |
| 15 | Define MSA formula | ✅ **Done** | NCC supplied it; implemented verbatim: `MSA = Σ min(Actual Qty, Scheduled Qty) ÷ Total Scheduled Qty × 100`. The `min()` is the substance of the formula — each order is credited at most its scheduled quantity, so over-producing one order cannot mask a shortfall on another. Worked example in the tests: 800/1000 + 1500/1000 gives **90%**, not the 115% a naive total would report. Scope: orders whose *planned* window overlaps the period; cancelled orders excluded from both sides. |
| 16 | Add Volume-Based Capacity Utilization | ✅ **Done** | `ScheduleKpiService.volumeCapacityUtilization()` + `GET /production/kpi/capacity-utilization`, with a per-machine breakdown. 6 tests. |
| 17 | Define capacity basis | ✅ **Done** | NCC supplied it; implemented verbatim: `Actual Units Produced ÷ Maximum Designed Unit Capacity × 100`. **The rate is derived from the process routing step, not from a separate capacity field** — `3600 ÷ RoutingStep.cycleTimeSec`, converted to the SKU base unit, × calendar hours in the window. This is the same master data that generates job orders and drives scheduling, so capacity analytics cannot drift from the plan. A machine-specific cycle time on the step overrides the step default; where several routings cover one machine the **slowest** rate is used, so the figure is never flattered by the machine's easiest product. Machines not assigned to any active routing step are listed in `machinesMissingCapacity` with the reason, rather than silently shrinking the denominator. Each machine's rate carries a `ratedFrom` block naming the process, step and cycle time it came from. |

### Analytics & Reports — Quality KPIs (items 18–19)

| # | Item | Verdict | Evidence / action |
|---|---|---|---|
| 18 | Correct FPY in Quality Reports | ✅ **Done** | Root cause was a payload mismatch, not a calculation error: the page bound to `fpy`/`defectRate` but `GET /reports/quality` returned neither. Both are now returned explicitly and computed identically to the Quality cockpit (`Σ pass qty ÷ Σ total qty × 100`). A second fault was fixed too — the Quality Reports hub labelled the **OEE quality factor** as "First Pass Yield", and carried a hard-coded "Inspection Completion" tile (98.2/91.4/77.6) with no data behind it. |
| 19 | Correct Defect Rate | ✅ **Done** | `defectRate` and `defectPpm` now returned by both `/quality/kpis` and `/reports/quality`. `FPY + Defect Rate = 100` by construction. **Open question for NCC:** defect unit — currently *inspected units*; confirm they do not want cartons/batches/opportunities. |

### Analytics & Reports — Maintenance (items 20–23)

| # | Item | Verdict | Evidence / action |
|---|---|---|---|
| 20 | Document MTBF methodology | ✅ **Done** | `docs/KPI-METHODOLOGY-QUALITY-AND-MAINTENANCE.md` §2.2. |
| 21 | Document MTTR methodology | ✅ **Done** | Same document, including the repair-hours fallback rule. |
| 22 | Classification matrix | ✅ **Done** | Same document §2.3–2.4 — full inclusion/exclusion tables by reason code, category and WO type. |
| 23 | Resolve Maintenance vs Downtime CC difference | 🟡 **Root cause fixed; needs on-data validation** | Three real defects found and fixed: (a) the Downtime cockpit counted **every** unplanned stop as a failure — micro-stops, starved, blocked, material, operator — inflating failure count and collapsing MTBF; (b) the Maintenance report used a different formula from every other surface (MTTR averaged *all* completed WOs including preventive; MTBF used bare calendar hours); (c) cockpit capacity used only machines that happened to have an event. All MTBF/MTTR now come from one engine with both lenses shown side by side and the variance explained. **Remaining:** re-validate against live NCC data once deployed. |

### Energy (items 24–28)

| # | Item | Verdict | Evidence / action |
|---|---|---|---|
| 24 | Energy Ratio by machine | 🟢 **Delivered** | `energy-wo-machine.service.ts` — `kwhPerUnit`, `kwhPerKg`, `kwhPerRunHour` per machine, plus baseline and deviation vs best demonstrated. |
| 25 | Energy Ratio by Work Order | 🟢 **Delivered** | Same service, resolved to WO × machine, with `recomputeForWorkOrder`. |
| 26 | Scope 2 carbon KPI | 🔴 **Not started — fully specified, no blockers** | Zero occurrences of `carbon`/`CO2e`/`emissionFactor`. Formula given by client: `kWh × 0.568 kg CO₂e/kWh`. |
| 27 | Configurable grid emission factor | 🔴 **Not started** | Must be a stored, editable setting with unit + effective date + source — explicitly *not* a constant in code. |
| 28 | Filters for energy/carbon KPIs | 🟢 **Delivered** | `GET /energy/analytics/filter-options` + machine/line/WO/period filters. Carbon inherits these once #26 lands. |

### Delivery (item 29)

| # | Item | Verdict |
|---|---|---|
| 29 | Consolidated technical approach | 🟡 **This document + the methodology doc are the substance; needs assembling into the client-facing response** |

---

## 3. What NCC must confirm before we can finish

Only one is a genuine blocker; the rest are confirmations that would refine an already-working
number.

**Blocking:**

1. **Stack-light signals** — machine, colours wired, electrical interface, meaning of each colour
   and combination. *Blocks items 3, 4, 5, 10, 11, 13 — six of the eight Critical items.*
2. **3D line layout** — approved drawing, machine sequence and orientation, photos (item 1).

**Confirmations (system works today; the answer may change a definition):**

3. **Bottleneck nomination** — confirm Big Betti is the constraint for all SKUs, or whether it
   varies by product. Set in Plant Hierarchy → Edit Production Line.
4. **Final Outfeed Quality point** — implemented as the last outfeed count only; confirm NCC does
   not instead want the product of per-stage yields.
5. **Defect Rate unit** — inspected units (current) vs cartons / batches / opportunities.
6. **Energy ratio denominator** — kWh per tonne, carton, or unit (all three are computed today).
7. **Emission factor** — 0.568 fixed for the PoC, or should it track a published update.
8. **Routing coverage** — any machine not assigned to an active routing step with a cycle time
   contributes nothing to the capacity-utilization denominator. The API lists them by name with
   the reason; they need adding to the process routing for a complete figure.

### Known remaining duplication

`Machine.designCapacity` still exists and is still read by the **APS scheduler**
(`aps.service.ts` — capable-to-promise and the machine-selection fallback). The KPI layer no
longer uses it, so capacity analytics now have a single source of truth in the routing steps,
but the scheduler does not yet. Migrating APS onto `ratedCapacityByMachine()` and dropping the
column is the clean end state and is not done.

---

## 4. Stack-light design (ready to build once §3.1 is answered)

Proposed, non-intrusive, no PLC change:

```
Stack light lamp commons ──▶ Remote I/O digital inputs ──▶ Edge Gateway
                                                            │
                          debounce (existing) ──────────────┤
                          state machine (new) ──────────────┤
                                                            ▼
                                              MachineStateRecord + DowntimeEvent
```

**Colour → state mapping (to be confirmed with NCC):**

| Signal | Derived machine state | OEE treatment |
|---|---|---|
| Green steady | `RUNNING` | Run time |
| Amber steady | `STARVED` or `BLOCKED` (disambiguated by position in line, or by a second signal) | **External loss — excluded from A and P** |
| Red steady/flashing | `BREAKDOWN` | Unplanned downtime → operator classifies reason |
| All off | `OFFLINE` | Outside PPT |

**Rules to agree:** minimum stop duration before an event is raised (proposal: 60 s, matching the
existing `DOWNTIME_THRESHOLD_SECONDS`); debounce window; behaviour when the signal is lost; and how
an automatically-created event that the operator never classifies is reported.

---

## 5. Number-integrity work plan

This is the plan for the criterion NCC will actually judge. Sequenced by risk to credibility.

### Phase A — Wire the corrected OEE end-to-end *(next)*
- Populate `RollupChild.externalLoss` from `MachineStateRecord` STARVED/BLOCKED segments in
  `kpi.service.ts` (`joRollupChild`, `woChild`), so the engine fix reaches the dashboards.
- Add `bottleneckMachineId` to the Line entity; expose `GET /production/line-oee`.
- Point the Line/Area OEE cards at `lineOee()` and label the method on screen.

### Phase B — Formula register and reconciliation tests
- One register listing **every KPI displayed anywhere**: name, formula, source tables, filters,
  window semantics, owning service, screen(s) it appears on.
- A reconciliation test per KPI asserting the same value across cockpit, module page and report for
  an identical scope and window — the failure mode NCC already caught twice.
- Golden-dataset tests using the two NCC files already in `docs/recived from client/`
  (`BETTI Production Line Stoppages and Waste Log`, `Betti Production Line Production Rate`):
  seed them, compute, and assert against hand-calculated expected values.

### Phase C — Counting accuracy
- Edge counter vs manual shift count reconciliation report (the ≤2–3% acceptance target).
- Duplicate-pulse and missed-pulse detection with an alert.
- Buffered-event recovery test: kill the network, produce, restore, assert zero loss.

### Phase D — Info/explainer coverage
- `dashboard-explainers.ts` already carries formula + data-source + benchmark text for several
  dashboards. Extend it to **every** dashboard page and add the on-page methodology panel pattern
  already used on the Quality and Maintenance reports.
- Acceptance: no KPI is displayed anywhere without a reachable explanation of how it was computed.

---

## 6. Changes already made in this pass

| File | Change | Items |
|---|---|---|
| `apps/api/src/modules/production/oee.service.ts` | `EXTERNAL_LOSS_STATES`; external loss carved out of PPT in `calculateDetailed`, `availabilityFromSegments`, `rollup`; new `lineOee()` bottleneck primitive; `externalLoss` on `OEEBreakdown` / `RollupChild`. | 8, 9, 12 |
| `apps/api/src/modules/production/kpi.service.ts` | `joExternalLoss()`, `loadExternalStates()`; external loss threaded through `joRollupChild`, `woChild`, `aggregateJos`, `nodeFromJos`, the Factory→Area→Line→Machine hierarchy, `oeeAnalytics` and WO/PO recompute. New `lineOeeAnalytics()` resolving the constraint and outfeed point with a reported fallback rule. | 8, 9, 12 |
| `apps/api/src/modules/production/production.controller.ts` | `GET /production/oee/line`. | 8, 9 |
| `apps/api/prisma/migrations/20260806000000_line_bottleneck_oee` | `ProductionLine.bottleneckMachineId` + `outfeedMachineId` (additive, nullable). | 8, 9 |
| `apps/api/src/modules/hierarchy/hierarchy.service.ts`, `apps/web/.../hierarchy-view.tsx` | Bottleneck + final-outfeed machine are now configurable in the Edit Production Line dialog, with the formula and the automatic-fallback rule shown inline. | 8, 9 |
| `apps/api/src/modules/production/schedule-kpi.service.ts` (+ spec) | MSA and volume capacity utilization, using NCC's supplied formulas verbatim. 12 tests. | 14–17 |
| `apps/api/src/modules/energy/carbon.service.ts` (+ spec) | Scope 2 engine: `resolveFactor`, `scope2`, `scope2ByWorkOrder`, versioned factor CRUD. 10 tests. | 26, 27 |
| `apps/api/src/modules/energy/energy.service.ts` | `electricalKwh()` — the single public kWh read, so carbon and energy cannot diverge. | 26 |
| `apps/api/src/modules/energy/energy.controller.ts` | `GET /energy/carbon/scope2`, `/carbon/work-orders/:id`, `/carbon/emission-factor(s)`, `POST /carbon/emission-factors`. | 26, 27 |
| `apps/api/prisma/migrations/20260806010000_grid_emission_factor` | `GridEmissionFactor` table, versioned by effective date, seeded at 0.568 for every factory. | 27 |
| `apps/api/src/modules/reliability/*` | Canonical MTBF/MTTR engine. | 6, 20–23 |
| `apps/api/src/modules/reports/reports.service.ts`, `.../quality/quality.service.ts` | FPY / Defect Rate / PPM exposure. | 18, 19 |
| `docs/KPI-METHODOLOGY-QUALITY-AND-MAINTENANCE.md` | Methodology deliverable. | 20–23 |

**Test position:** 9 suites, 87 tests, all passing. 29 of those tests were added in this work
(4 external-loss, 3 line-OEE, 10 carbon, 12 MSA/capacity) and 1 pre-existing test was updated
because it encoded the old STARVED-as-downtime behaviour NCC asked us to change.
