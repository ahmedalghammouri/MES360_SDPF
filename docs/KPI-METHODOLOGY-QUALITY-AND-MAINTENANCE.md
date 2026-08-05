# KPI Methodology — Quality (FPY / Defect Rate) and Maintenance (MTBF / MTTR)

Response to the client review notes on the Analytics & Reports module.
Covers: (1) FPY and Defect Rate in Quality Reports, (2) the MTBF/MTTR calculation
methodology, and (3) why the Maintenance Reports and the Downtime Command Center
previously showed different reliability figures.

---

## 1. Quality KPIs — First Pass Yield and Defect Rate

### 1.1 What was wrong

The values were being calculated correctly on the server, but they were not reaching the
report screen. Two separate wiring faults:

| # | Surface | Fault |
|---|---------|-------|
| 1 | Analytics → Quality Reports (`/reports/quality`) | The page bound its KPI cards to `fpy` and `defectRate`, but `GET /reports/quality` returned neither field — it returned `summary.passRate` only. Both cards therefore fell back to their default and rendered **0%**. |
| 2 | Quality → Reports hub (`/quality/reports`) | The "First Pass Yield" tile was reading the **OEE quality factor** from `/dashboard/kpis`, not FPY. These are different measures (OEE quality is good ÷ total produced; FPY is inspection pass ÷ inspection total), so the tile could disagree with the Quality cockpit. A third tile, "Inspection Completion", was a hard-coded placeholder (98.2 / 91.4 / 77.6) with no data behind it. |

### 1.2 Definitions now in force

Both are inspection-based and share one denominator, so they always sum to 100%.

```
First Pass Yield (FPY) = Σ inspection pass qty  ÷ Σ inspection total qty × 100
Defect Rate            = Σ inspection fail qty  ÷ Σ inspection total qty × 100
Defect PPM             = Σ inspection fail qty  ÷ Σ inspection total qty × 1,000,000

FPY + Defect Rate = 100
```

- **Source**: `InspectionResult` records whose `inspectedAt` falls inside the selected window.
- **First pass** means accepted at the *first* inspection, before any rework — this is why
  FPY is measured on inspection quantities and not on final production output.
- **NCR counts are informational.** They are shown for context and do **not** feed FPY or
  Defect Rate; an NCR can cover units already counted as failed at inspection, so adding
  them would double-count.
- **Scrap Rate is a separate measure** (rejected ÷ produced, from job orders) and is
  reported separately in the Quality module. It is not the same as Defect Rate.

### 1.3 Consistency guarantee

The Quality cockpit (`GET /quality/kpis`), the Analytics quality report
(`GET /reports/quality`) and the Quality Reports hub now all read the same two fields,
computed from the same formula. `defectRate` and `defectPpm` are now returned explicitly by
the API rather than re-derived per screen, so no surface can drift.

Values will still legitimately differ between screens **when the periods differ** — the
Quality cockpit KPI cards are a *current-day* view, while the Analytics report uses the
7/30/90-day selector on the page.

### 1.4 What the Quality Report page now shows

- FPY, Defect Rate, Inspections, NCRs
- Units Inspected / Passed / Failed, Defect PPM
- A daily FPY & Defect Rate trend line
- A defect Pareto (NCRs by category, weighted by affected quantity)
- An on-page "How these are calculated" panel carrying the formulas above
- CSV export including the full daily trend

---

## 2. Maintenance KPIs — MTBF and MTTR

### 2.1 Why two figures existed

The platform measures reliability from two different record sets, because the plant
genuinely produces two different records for the same physical event:

- a **DowntimeEvent** — the machine stopped, logged on the floor;
- a **MaintenanceWO** — a corrective or emergency work order raised for the asset.

They are not in one-to-one correspondence. An operator-cleared jam produces a stop with no
work order. A work order raised on a standby asset produces no production stop. So both
views are valid, and the platform keeps both — but they are now labelled, computed by one
engine, and reconciled on screen rather than left to be compared blindly.

- **Equipment lens** — what the **Downtime Command Center** shows.
- **Maintenance lens** — what the **Maintenance Reports** and the **Maintenance module KPI cards** show.

### 2.2 Formulas

**Maintenance lens (work-order based) — headline figures on Maintenance Reports**

```
MTTR = Σ repair hours ÷ (CORRECTIVE + EMERGENCY work orders COMPLETED in window)
MTBF = Operating Hours ÷ (CORRECTIVE + EMERGENCY work orders RAISED in window)

Repair hours    = WO actual hours when logged, else (completedAt − startedAt)
Operating Hours = Σ RUNNING machine-state hours in window
                  ↳ falls back to (active machines in scope × window hours)
                    when no machine-state history exists
Availability    = MTBF ÷ (MTBF + MTTR) × 100
```

**Equipment lens (downtime-stop based) — figures on the Downtime Command Center**

```
MTTR = Σ breakdown stop hours ÷ breakdown stop count
MTBF = (Capacity Hours − All Downtime Hours) ÷ breakdown stop count

Capacity Hours = window hours × active machines in scope
```

### 2.3 Downtime classification

Only genuine **asset failures** enter MTBF/MTTR. Everything else is still a real loss and
still hits OEE — it simply is not a reliability event.

| Treatment | Reason codes | Downtime categories |
|-----------|--------------|---------------------|
| **Counted as a failure** | `UNPLANNED_BREAKDOWN` | `MECHANICAL`, `ELECTRICAL`, `UTILITY` |
| **Excluded — planned work** | `PLANNED_MAINTENANCE`, `CHANGEOVER` | `PLANNED_MAINTENANCE`, `PLANNED_CLEANING`, `PLANNED_BREAK`, `CHANGEOVER` |
| **Excluded — flow / speed losses** | `MICRO_STOP`, `STARVED`, `BLOCKED`, `EXTERNAL` | — |
| **Excluded — non-asset causes** | — | `MATERIAL`, `OPERATOR`, `QUALITY`, `PROCESS`, `EXTERNAL`, `OTHER` |

Any event flagged `isPlanned = true` is treated as planned regardless of its category.

A stop is classified in this order: planned → excluded; excluded reason code → excluded;
failure reason code → failure; otherwise, failure category decides.

### 2.4 Work-order inclusion / exclusion

| Treatment | Work-order types |
|-----------|------------------|
| **Counted as a failure** | `CORRECTIVE`, `EMERGENCY` |
| **Excluded** | `PREVENTIVE`, `INSPECTION`, `LUBRICATION` |
| **Excluded regardless of type** | `CANCELLED` work orders; soft-deleted (`deletedAt` set) work orders |

- The **MTBF numerator** counts failures by **`createdAt`** — when the failure occurred.
- The **MTTR sample** counts repairs by **`completedAt`** — when the repair finished.
  A failure raised late in the window and repaired after it therefore contributes to MTBF
  but not to MTTR, which is correct: the repair duration is not yet known.

### 2.5 Event handling rules

- **Open stops** (no `endTime`) are clamped to *now*.
- **Stops overlapping the window edges** are clamped to the window, so a stop is never
  double-counted across two report periods.
- **Zero failures** → MTTR is `0`; MTBF returns the full uptime/operating hours for the
  window (there was no failure to interrupt it).
- **Scope** (area / line / machine) is applied identically to both lenses.

---

## 3. Why the two reports disagreed — root cause

Three concrete defects, all now fixed:

| # | Defect | Effect |
|---|--------|--------|
| 1 | The Downtime Command Center counted **every unplanned stop** as a failure — micro-stops, starved, blocked, material, operator and quality stops included. | The failure count was inflated by a large factor, which collapsed MTBF (MTBF = uptime ÷ failures) and distorted MTTR. This was the dominant source of the discrepancy. |
| 2 | The Maintenance Report used a **different formula from every other reliability surface**: MTTR averaged the hours of *all* completed work orders including preventive/inspection/lubrication (inflating MTTR with planned work), and MTBF used bare **calendar window hours** with no machine count and no uptime basis. | Maintenance Report MTBF was understated relative to the Maintenance module, and MTTR was overstated. |
| 3 | The Downtime Command Center's capacity used **only machines that happened to have a downtime event**, not the active machines in scope. Its planned-stop list also referenced a category `CLEANING` that does not exist in the schema (the real value is `PLANNED_CLEANING`), so cleaning stops were treated as unplanned unless the `isPlanned` flag was set. | Capacity — and therefore MTBF — was understated; cleaning time was misclassified as unplanned loss. |

### Resolution

All MTBF/MTTR calculations were moved into a single engine,
`ReliabilityService` (`apps/api/src/modules/reliability/reliability.service.ts`), which owns
the classification constants, the two lenses and the formulas above. It is now the only
place these numbers are computed. Consumers:

| Surface | Endpoint | Lens |
|---------|----------|------|
| Downtime Command Center | `GET /production/downtime/cockpit` | equipment |
| Maintenance module KPI cards | `GET /maintenance/kpis` | maintenance (month-to-date) |
| Maintenance reliability trend | `GET /maintenance/reliability-trend` | maintenance (per month) |
| Analytics → Maintenance Reports | `GET /reports/maintenance` | maintenance headline + **both lenses returned** |

The Maintenance Reports page now shows a **Reliability Basis & Reconciliation** panel
carrying both lenses side by side — MTBF, MTTR, failure counts, the MTTR sample size, the
MTBF denominator and its source — plus the full methodology text. The figures are also
included in the CSV export.

### Remaining reasons the two can still differ (by design)

1. **Event source** — a stop cleared without a work order appears only in the equipment
   lens; a work order raised without a production stop appears only in the maintenance lens.
   The reconciliation panel exposes both failure counts so the gap is visible and auditable.
2. **What MTTR measures** — equipment MTTR is *production time lost*; maintenance MTTR is
   *technician time logged on the work order*. Maintenance MTTR is normally the smaller of
   the two, because it excludes waiting, escalation and restart time.
3. **MTBF denominator** — equipment MTBF uses capacity minus all downtime; maintenance MTBF
   uses RUNNING machine-state hours, which excludes idle/standby time.
4. **Window** — the Maintenance module KPI cards are month-to-date by design. To compare
   like for like, select the equivalent period on the Maintenance Reports page.

If the client wants the two lenses to converge to a single number, the operational change
is to require a corrective work order for every breakdown stop (link
`DowntimeEvent.maintenanceWOId`). The `unlinkedFailures` figure in the API response is the
size of that gap and can be used to track the discipline.

---

## 4. Verification

`apps/api/src/modules/reliability/reliability.service.spec.ts` locks the definitions with 11
tests covering: failure classification for each reason code and category, planned-work
exclusion (including `PLANNED_CLEANING`), window-edge clamping, the capacity/uptime basis,
the machine-state vs calendar fallback, and the actual-hours vs elapsed-time repair fallback.
Worked example from the suite:

> 240-hour window, 2 active machines → capacity 480 h.
> Stops: two 2-hour breakdowns, one 1-hour material stop, one 1-hour planned changeover.
> Failures = 2 (material and changeover excluded). Total downtime = 6 h → uptime 474 h.
> **MTTR = 4 ÷ 2 = 2.0 h. MTBF = 474 ÷ 2 = 237.0 h.**

Under the previous logic the same data gave failures = 3, MTTR = 1.7 h and MTBF = 158 h —
a 33% error on MTBF driven entirely by the material stop being counted as a breakdown.

---

## 5. Third reliability surface (not changed)

The **Job Order live dashboard** (`jo-live`) shows a per-machine 30-day MTTR/MTBF computed
from the *gaps between consecutive stop events* on that one machine. This is a legitimate,
standard formulation for a single-asset live view and is deliberately scoped to one machine
and a fixed 30-day window, so it is not expected to equal the plant-level figures. Flagged
here for completeness; align it with the shared engine if the client wants a single number
everywhere.
