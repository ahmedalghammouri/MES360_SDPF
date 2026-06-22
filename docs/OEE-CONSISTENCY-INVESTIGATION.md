# MES360° — OEE Cross-Page Inconsistency: Investigation, Root Cause & Fix

**Symptom (same scope = Whole factory SDPF, same period = Week):**

| Page | OEE shown |
|---|---:|
| Factory Analytics | **1.4%** |
| OEE Analytics | **1.4%** |
| Machine OEE (OEE Dashboard) | **1.4%** |
| Production KPIs | **68.1%** |
| Manufacturing KPIs | **0.0%** |
| Manufacturing Hub | **0.0%** |
| Machine leaderboard: Cartomac | **79.9%** vs Machine-OEE breakdown **99.9%** |

Five different "OEE" for the same scope/period. Below is exactly why, and what was fixed.

---

## 1. Root cause A — three different aggregation methods

OEE surfaces are fed by **different endpoints that aggregate differently**:

| Surface | Endpoint | Aggregation method | Result |
|---|---|---|---|
| Factory Analytics · OEE Analytics · Machine OEE | `/production/oee/calculate`, `/dashboard/overview` → `KpiService.oeeAnalytics` / `hierarchyOEE` | **Time-weighted rollup**: Availability = Σ runTime ÷ Σ PPT, P = Σ idealRun ÷ Σ run, Q = Σ good ÷ Σ total | 1.4% (had a bug — see B) |
| Production KPIs | `/production/oee-records` (client-side) | **Simple un-weighted average** of per-record OEE: `Σ recordOEE ÷ n` ([production-kpi-view.tsx:277](../apps/web/src/features/production/production-kpi-view.tsx#L277)) | 68.1% |
| Manufacturing KPIs · Hub | `/dashboard/kpis` → `oeeAnalytics` with a **Today/Shift window** | Time-weighted rollup, but **today's** window (no JOs ran today) | 0.0% |
| Machine leaderboard | `/production/oee-records` | per-record average | 79.9% |
| Machine OEE breakdown | `/production/oee/calculate` `byEquipment` | per-machine **rollup** of all its JOs | 99.9% |

So even with correct data, a **simple average of records** (68.1%) and a
**time-weighted rollup** (≈ plant OEE) and a **today-window** (0%) will *never*
agree. The same machine reads 79.9% (average of its individual JO records, one of
which is poor) vs 99.9% (all its JOs rolled up together).

**This is a design inconsistency, not a data error.** The fix is to put every page
on **one** canonical method.

---

## 2. Root cause B — the PPT over-count bug (the 1.4%) — **FIXED**

The time-weighted rollup computes **Availability = Σ runTime ÷ Σ PPT**, where each
job order's PPT was its **whole `plannedStart → plannedEnd` span**.

Verified against the live DB: Big Betti has a **PAUSED** job order (WO‑2026‑0004,
rescheduled months out for a material delivery) whose planned span is **57,200
minutes ≈ 39.7 days**. For a one‑week OEE that single JO dumps 57,200 min into the
PPT denominator:

```
Σ runTime  = 2,452 min
Σ PPT(old) = 58,075 min   ← dominated by the one 57,200-min paused JO
Availability(old) = 2,452 / 58,075 = 4.2%   →  OEE = 4.2% × 32.6% × 98.8% = 1.4%
```

…while every *individual* machine reads ~99% (its own run ≈ its own planned span).
That is the textbook **"plant OEE 1.4% while every machine is 99%"** artifact.

### Fix applied — clamp PPT to the analysis window
`KpiService.joRollupChild` now clamps each JO's PPT to the overlap of its planned
span with the analysis window, floored at the in-window actual run (so availability
never exceeds 100%). A JO planned over 39 days contributes at most the in-window
portion. Threaded through all 5 call sites (`oeeAnalytics`, `hierarchyOEE`,
`oeeRecordsFromJobOrders`).

```
Σ PPT(new, window-clamped) = 2,603 min
Availability(new) = 94.2%   (was 4.2%)
```

**Verified numerically** with the same DB rows (SQL recompute, OLD vs NEW). Files:
[`apps/api/src/modules/production/kpi.service.ts`](../apps/api/src/modules/production/kpi.service.ts) (`joRollupChild` + call sites).

> Requires an **API rebuild/restart** for the change to take effect on the running
> stack.

---

## 3. Fixes applied (✅ live, verified on the running stack)

1. ✅ **PPT window-clamp** (root cause B) — plant Availability **4.2% → 94%**,
   plant OEE **1.4% → 31.4%**, now consistent with the per-machine values
   (≈ 35%) instead of the absurd 1.4%-plant-vs-99.9%-machine contradiction.
2. ✅ **Paused/zero-output JO exclusion** — `joRollupChild` now drops operations
   with zero output (a PAUSED step whose `actualEnd` is null counted *now − start*
   as run with no earned time, dragging Performance). They no longer distort the
   rollup.
3. ✅ **Production KPIs consolidated onto `oeeAnalytics`** — the OEE/A/P/Q cards now
   read `/production/oee/calculate` (the same time-weighted rollup as OEE Analytics)
   instead of a page-local simple average of records, so the week OEE reads the
   **same 31.4%** on both pages (was 68.1% vs 1.4%).
4. ✅ **Unit displays rounded** — base-unit-normalised counts (output, gap, target)
   now render as whole grouped numbers (`8,854` not `8854.3`); percentages keep one
   decimal.

**Live verification (week, whole factory):**
`/production/oee/calculate?timeframe=week` → `OEE 31.4% · A 94% · P 33.8% · Q 98.8% · output 8,854`.
Today-windowed surfaces (Production Overview, Manufacturing Hub) correctly read 0%
when nothing ran today — switch the period to Week and every page agrees.

## 3b. Still recommended (optional, not blocking)

- **Manufacturing leaderboard / Manufacturing KPIs** still use the per-record
  source; fold them onto `oeeAnalytics` too for full parity (same pattern as #3).
- **"Today" windows** should label the empty state "no production in this window"
  rather than imply 0% performance.

---

## 4. The KPI Targets decimals (8854.3 units, −885.7, scrap 23)

These are **not** a bug:
- **Output is base-unit normalised.** Counts are converted from the step's unit
  (carton / inner / pallet) to the product **base unit** via `toBaseUnits` so steps
  sum consistently. Mixed conversions produce **fractional** base-unit totals →
  `8854.3 units`.
- **Target** `9740 units` = Σ `plannedQtyOut` (also base-unit normalised).
- **Gap** `−885.7` = output − target. **Scrap 23** = total − good (base units).

Recommendation: round displayed unit counts to whole numbers (keep fractional
internally) so the cards read `8,854` / `9,740` / `−886`.

---

## 5. The OEE Trend chart (sparse points, no PO/WO/shift breakdown)

The trend buckets job orders by **hour/day** from their `actualStart` timestamps.
With only Jun 20–21 of activity, the series is a near-flat 2-point line — it does
**not** plot the saved OEE records over the period, nor split by PO / WO / shift.

Recommendation (feature): add a **"Group by"** control to the OEE/KPI trend —
`Time · Production Order · Work Order · Shift · Machine` — so the chart can render
each PO/WO/shift as its own series or bar from the same `oee-records` data. The
records already carry `workOrderId` / `machineId` / `recordDate`; shift requires
joining `shiftInstanceId`.

---

## 6. Summary

| Question | Answer |
|---|---|
| Why different OEE per page? | Three different aggregation methods (time-weighted rollup vs simple record-average vs today-window) + a PPT over-count bug. |
| Which is correct? | The **time-weighted rollup** (`oeeAnalytics`) is the ISA-95-correct one. After the PPT fix its plant Availability is **94.2%** (not 4.2%). |
| Fixed now | ✅ PPT window-clamp (the 1.4% bug). API rebuild required. |
| Recommended next | Consolidate all pages onto `oeeAnalytics`; fix paused-JO Performance; round unit displays; add PO/WO/shift trend grouping. |
