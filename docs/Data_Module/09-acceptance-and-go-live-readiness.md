# 09 — Acceptance & Go-Live Readiness Validation Package

Scope: the analytics ecosystem remediated in Waves 1, 2a and 2b (dashboards, KPIs, OEE/AT-OEE,
trends, filters, historian). Wave 2c (backend cleanups) is **on hold** by decision; its items
appear below as open/technical-debt for the readiness call.

> Validation status convention: **CODE-VERIFIED** = proven by `tsc` + unit tests + `next build`.
> **UAT-PENDING** = needs a human to confirm visually against live data. Nothing in this package
> has been click-tested against a running instance with seeded production data yet — that is the
> purpose of this phase.

---

## Part 1 — Go-Live Readiness Assessment

### 1.1 Completed items (CODE-VERIFIED)
| Item | Class | Notes |
|------|-------|-------|
| InfluxDB historian enabled (env `INFLUX_*` fix) | Critical | RC-1 — was the root cause of empty trends |
| OEE engine single source of truth (`OEEService.rollup`, quantity-weighted) | Critical | No inline math on KPI/dashboard endpoints |
| Time-Based OEE (AT-OEE) computed in the engine + historian | High | `KpiService.timeBasedOee`, `computeSample` |
| Schedule + Time-Based OEE/Availability exposed on all OEE surfaces | High | Wave 2b — see doc 08 consistency table |
| Relational trend fallback (OEERecord) when Influx empty | Critical | RC-2 — trends never blank when data exists |
| Filter propagation (Area/Line/Machine + Date) across dashboards | High | Wave 2a — quality/maintenance/energy/job-orders scoped |
| Production/Quality trend payloads corrected (output/target/efficiency, FPY/scrap) | High | This wave — Home charts now have real data |
| Hardcoded/placeholder KPIs removed (oee 82.5, target 400, cpk 1.45, scrap 0, downtime 0) | High | Real values or `null` |
| Dark/Light theme color fixes (manufacturing-overview `text-white`, OEE marker) | Medium | |
| Shift-summary null-safety | Medium | Fixed `Infinity%` regression |
| TB in record-based trends (OEE History, OEE Trend, Leaderboard) | Medium | This wave |
| Build/test gates green (API tsc, 39/39 jest, web tsc, next build 84 routes) | High | CI-ready |

### 1.2 Open items
| Item | Class | Why open |
|------|-------|----------|
| **Business UAT visual sign-off** | **Critical** | Engineering is verified by build/tests, not by live click-through. This is the gate. |
| Live data smoke test (create PO→WO→JO, run, observe) | Critical | DB was wiped clean; needs a fresh run to confirm end-to-end population |
| Detail-table Area/Line scoping (NCR/inspection/SPC/WO lists) | Medium | KPI cards fully scoped; some list tables filter at machine level only |
| OEE Gauge & Radar geometry show schedule-only (TB in adjacent strip) | Low | Both visible on screen, not inside the gauge/radar shapes |

### 1.3 Technical debt (Wave 2c — deferred)
| Item | Class | Ref |
|------|-------|-----|
| Unify `calcJobOrderOEE` onto `OEEService` (remove inline JO/WO-list formula + Quality-as-OEE fallback) | High | RC-3 |
| Maintenance MTBF assumes 100% machine utilization (inflates availability) | Medium | RC-9 |
| `getOEERecords` pagination is cosmetic (`total=data.length`, `totalPages=1`) | Medium | RC-8 |
| Date-window edge bugs (`setDate`/month-boundary; UTC vs local) | Low | RC-10 |
| Historian samples only EXECUTING/PAUSED JOs → sparse history for completed/idle periods | Medium | RC-11 |
| Two MTTR/MTBF definitions (maintenance KPIs vs JO-live reliability) not reconciled | Medium | see Part 3 |
| Product/Batch/Shift are page-local, not in the global scope model | Low | scope-store enhancement |
| Grafana/Dashboard-Center external panels not updated for AT-OEE | Low | Grafana-side queries (fields exist in Influx) |

### 1.4 Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| UAT reveals visual/UX issues not caught by build | Medium | Medium | Run the Part 2 checklist on staging before Go-Live |
| Fresh/empty environment shows blank trends → mistaken as "broken" | High | Low | Run Part 4 Scenario 0 to seed activity first |
| MTBF/availability numbers questioned by reliability engineers (RC-9) | Medium | Medium | Flag as known; schedule RC-9 in Wave 2c if UAT blocks |
| Inline `calcJobOrderOEE` shows ±0.1–2% vs engine on JO/WO list rows (RC-3) | Low | Low | Cosmetic; unify in 2c |
| InfluxDB env not set in a given deploy → trends rely on relational fallback only | Low | Low | Fallback covers it; verify `INFLUX_*` per environment |

### 1.5 Recommendations
1. Execute Part 2 + Part 3 checklists on a **staging instance with seeded data** (Part 4 Scenario 0) and capture screenshots — this converts CODE-VERIFIED → UAT-VERIFIED.
2. Decide RC-9 (MTBF) and RC-3 (OEE unification) **before** Go-Live only if UAT flags them; otherwise defer to a post-Go-Live enhancement release.
3. Confirm `INFLUX_*` env vars are correct in the target deployment (not just prod-local).
4. Keep the historian backfill (`POST /historian/backfill`) out of production; it's synthetic demo data.

### 1.6 Go-Live readiness
**~85% ready.**
- Analytics remediation scope: **complete and code-verified.**
- Remaining 15% is **UAT execution + sign-off** (the Critical open item) plus deferred medium/low
  technical debt that is not a functional blocker. No Critical *engineering* item is open.

---

## Part 2 — Functional Verification Checklist (UAT + technical)

Legend: ☐ to verify · scope filters = the global Factory→Area→Line→Machine selector + Date Range.

### Home Dashboard (`/dashboard`)
- ☐ OEE / Availability / Performance / Quality cards render real values (not 0/—) when data exists
- ☐ **Time-Based strip** shows OEE (AT-OEE) + Availability (Time-Based)
- ☐ Production Output chart shows actual vs target **with efficiency line** (not flat target=1)
- ☐ Quality Trend chart shows FPY/scrap (not empty)
- ☐ Downtime Pareto shows unplanned causes, cumulative %
- ☐ Machine Status grid shows live states + OEE bars
- ☐ Current Shift shows operator/output/target or "—"/"no target set" when unset (no `Infinity%`)
- ☐ Changing Area/Line/Machine changes the KPI cards
- ☐ Changing Date Range changes the trends

### Manufacturing Dashboard (`/manufacturing`)
- ☐ KPI pills (OEE/Availability/Units/Alarms) + **TB strip** (OEE-TB, Availability-TB)
- ☐ Machine Status Grid + Active Operations panel **respect scope** (not factory-wide)
- ☐ Production Trend renders; headings legible in **both light and dark** themes
- ☐ Active Operations (executing JOs) filter by selected machine/line/area

### Production Dashboard (`/production`)
- ☐ OEE card + **TB strip** (OEE-TB, schedule & time-based availability)
- ☐ Work-order list respects scope + date range
- ☐ KPI counts (total/in-progress/completed) match scope

### OEE Views (`/manufacturing/oee`, `/production/oee`)
- ☐ OEE/Availability/Performance/Quality cards + **TB sub-strip**
- ☐ Production-OEE trend overlays dashed **OEE (Time-Based)** line
- ☐ OEE History (Last 50) overlays dashed Time-Based series
- ☐ OEE Component Comparison + benchmark pointer legible (light/dark)
- ☐ Scope + timeframe change the numbers and trend

### KPI Views (`/manufacturing/kpi`, `/production/kpi`)
- ☐ KPI cards + **TB strip**
- ☐ OEE Trend — Last 30 Records overlays dashed **OEE (Time-Based)**
- ☐ Machine OEE Leaderboard shows **OEE-TB%** column
- ☐ Timeframe selector actually changes results (RC-6 fixed)
- ☐ Radar / Production Volume / Quality Trend render

### Maintenance (`/maintenance`)
- ☐ MTTR / MTBF / availability / PM compliance render
- ☐ KPIs **respect Area/Line/Machine scope** (Wave 2a)
- ☐ Reliability trend chart renders

### Quality (`/quality`)
- ☐ FPY / Scrap Rate / Cpk / NCR / CAPA KPIs render (scrap & cpk are real, not 0/1.45)
- ☐ KPIs **respect scope** (Wave 2a)
- ☐ SPC chart renders for first tracked parameter

### Energy (`/energy`, `/energy/live`)
- ☐ Overview KPIs + Consumption Trend (30d) respect scope
- ☐ Live power + standby detection updates (5s + WS)

### Reports (`/reports/production`, hubs)
- ☐ Production report summary shows Avg OEE **and Avg OEE (Time-Based)**
- ☐ Report hub pills show OEE + OEE (Time-Based)

### Job Order Live Dashboard (`/shop-floor/live/[id]`)
- ☐ Schedule + Time-Based OEE/Availability, Six Big Losses, time model
- ☐ Downtime Pareto, state distribution, MTTR/MTBF/MTTA, scrap, alarms, maintenance
- ☐ Updates on 5s poll

### Historian Trends
- ☐ `/historian/oee-trend?machineId=` returns both `oee`/`oeeTb` (Influx) **or** falls back to OEERecord when Influx off
- ☐ `/historian/production-trend?machineId=` returns good/scrap deltas

### Filter Propagation
- ☐ Selecting a Machine narrows every scoped widget (no factory-wide leakage on KPI cards)
- ☐ Date Range changes trend windows
- ☐ React Query refetches on filter change (no stale cache)

### OEE / Time-Based OEE Validation
- ☐ Schedule OEE = A×P×Q with schedule availability
- ☐ Time-Based OEE = (uptime/(uptime+downtime)) × P × Q
- ☐ Both appear together on every OEE surface

### Downtime Validation
- ☐ Planned (PLANNED_MAINTENANCE/CHANGEOVER/SETUP) excluded from availability per rules
- ☐ Unplanned (BREAKDOWN/STARVED/BLOCKED/MICRO_STOP) reduce availability/performance
- ☐ EXTERNAL excluded from OEE
- ☐ `isPlanned` / `affectsOEE` honoured in Pareto + loss buckets

---

## Part 3 — Data Validation Checklist (per KPI)

For each KPI: where the number comes from, how it's computed, how to verify, and the expected result.

| KPI | Data source | Calculation source | Validation method | Expected result |
|-----|-------------|--------------------|-------------------|-----------------|
| **OEE (Schedule)** | PostgreSQL `job_orders` (+ `downtime_events`) | `OEEService.rollup` via `KpiService.oeeAnalytics`; A=runTime/ppt, P=ideal/run, Q=good/total | Compare `/production/oee/calculate` to `/production/oee/hierarchy` plant value for same scope/window | Identical (both use the engine) |
| **Availability (Schedule)** | `job_orders` planned vs operating | `runTime/ppt` (schedule) | JO-live `joAvailability` vs hierarchy availability for one machine | Match within rounding |
| **Availability TB** | `job_orders` + unplanned `downtime_events` | `KpiService.timeBasedOee` = runMin/(runMin+downMin) | JO-live `availabilityTimeBased` vs `/dashboard/kpis.availabilityTb` (same scope) | Match within rounding |
| **Performance** | `job_orders` (idealCycleTimeSec, counts) | `idealRunTime/runTime`, capped 100 | Manual: ideal×count/60 ÷ runMin | ≤100, matches card |
| **Quality** | `job_orders` good/total | `good/total` | Manual: good ÷ (good+rejected) | Matches card |
| **TEEP** | OEE × utilization | JO-live: `oee × (operational/window)` | JO-live `teepPct` ≤ OEE | TEEP ≤ OEE |
| **OEE TB** | as Availability TB + P + Q | `availabilityTb × performance × quality` | Compare card/trend `oeeTb` to JO-live `oeeTb` | Match within rounding |
| **MTTR** | `maintenance_wo` (completed, month) | maintenance.getKPIs: avg `actualHours` | Manual avg of completed WO hours this month | Matches maintenance card |
| **MTTR (JO-live)** | `downtime_events` (30d, closed) | mean closed downtime duration | JO-live `downtime.mttrMins` | May differ from maintenance MTTR — **two definitions (RC, Part 1.3)** |
| **MTBF** | `maintenance_wo` + machine count | operatingHours/failureCount (**assumes 100% util — RC-9**) | Cross-check vs JO-live MTBF (mean gap between failures, 30d) | Maintenance MTBF likely higher (inflated) — flag |
| **Scrap Rate** | `job_orders` rejected/total (today) | `quality.getKPIs`: rejected ÷ (good+rejected) | Manual sum of today's JO rejected ÷ total | Matches Quality card (no longer 0) |
| **Production Counts** | `job_orders` actualQtyGood/Rejected | rolled JO→WO→PO (`KpiService`) | Sum JO good/scrap vs WO.actualQty/goodQty/scrapQty | WO totals = sum of its JOs |
| **Cpk** | `spc_measurements` (today, w/ spec limits) | `quality.computeCpk` = min((USL−µ),(µ−LSL))/3σ, else null | Provide ≥2 SPC samples; verify Cpk; remove → expect `null`/"—" | Real Cpk or "—" (never 1.45) |

> Reconciliation note for UAT: **MTTR/MTBF appear in two places with different definitions**
> (maintenance month-based WO hours vs JO-live 30-day downtime-event reliability). This is
> expected today; unifying them is a Wave 2c candidate. Document which one is "official" for UAT.

---

## Part 4 — Test Data & Demonstration Scenarios

> The DB was cleared (clean slate). Run **Scenario 0** first to generate activity; otherwise all
> trends/leaderboards are legitimately empty.

### Scenario 0 — Seed a production run (prerequisite)
1. Create a Production Order for an existing SKU (`POST /production/production-orders`), release it.
2. Auto-generate Work Orders from routing (`POST …/:id/auto-generate-work-orders`).
3. Generate Job Orders for a WO (`POST /production/work-orders/:id/job-orders/generate`).
4. Start the WO; set the first JO to EXECUTING; report counts (`PATCH …/job-orders/:id/add-count`).
5. Wait ≥1 min so the historian sampler writes an `oee` point (or run `POST /historian/sample`).
**Proves:** the chain populates; dashboards leave the empty state.

### Scenario 1 — Filter propagation
1. Note Home/Production KPI values at **Factory** scope.
2. Select one **Machine** in the scope panel.
3. Confirm KPI cards, Production/Quality trends, Maintenance & Quality KPIs all change to that machine.
**Proves:** Area/Line/Machine scope reaches every scoped widget (no factory-wide leakage).

### Scenario 2 — Trend population
1. After Scenario 0, open `/production/oee` and `/manufacturing/kpi`.
2. Confirm OEE Trend / OEE History render points; widen Date Range and confirm more buckets.
3. Disable InfluxDB (unset `INFLUX_*`) and reload → trends still render from `OEERecord` fallback.
**Proves:** historian + relational fallback (RC-1/RC-2).

### Scenario 3 — Schedule OEE
1. On a JO with planned window 600 min, operating 600, ideal=run, 1000 good / 1000 total → OEE 100%.
2. Compare card vs `/production/oee/hierarchy` machine node.
**Proves:** schedule A×P×Q via the engine, consistent across surfaces.

### Scenario 4 — Time-Based OEE (AT-OEE)
1. On a running JO, record an unplanned BREAKDOWN of e.g. 30 min, then resume.
2. Schedule availability drops (operating/planned); **Time-Based availability = uptime/(uptime+30)**.
3. Confirm OEE-TB strip + dashed trend line + Leaderboard OEE-TB% reflect the downtime.
**Proves:** AT-OEE differs from schedule OEE by the time-based availability, everywhere.

### Scenario 5 — Downtime impact & classification
1. Record a **PLANNED_MAINTENANCE** stop → availability **not** reduced (excluded), appears in planned bucket.
2. Record an **UNPLANNED_BREAKDOWN** → availability loss; **MICRO_STOP** → performance/speed loss.
3. Record **EXTERNAL** → excluded from OEE.
**Proves:** `isPlanned`/`affectsOEE` rules + six-loss/Pareto buckets.

### Scenario 6 — Machine state impact
1. Operator sets machine to BREAKDOWN (`PATCH /production/downtime/machines/:id/state`).
2. Confirm: live `MachineCurrentStatus` → BREAKDOWN, an open `downtime_event` is created, the linked JO pauses, Machine Status grid updates, a WS `machine:state-changed` fires.
3. Set back to RUNNING → downtime event closes, JO resumes.
**Proves:** state ↔ downtime ↔ JO synchronization (doc 06).

### Scenario 7 — Rollup consistency (Machine → Line → Area → Factory)
1. Run JOs on ≥2 machines on the same line with different OEE.
2. Open `/production/oee/hierarchy`; verify each Line node = quantity-weighted rollup of its machines (NOT the average of percentages), Area = rollup of lines, Plant = rollup of all.
3. Spot-check: a 100%-for-10min + 50%-for-90min pair rolls to ~55%, not 75%.
**Proves:** `OEEService.rollup` weighting up the hierarchy (doc 05 §7).

---

## Sign-off
- Engineering (CODE-VERIFIED): ✅ Waves 1/2a/2b + payload/theme/TB fixes; build+tests green.
- Business UAT (Parts 2–4): ☐ pending on staging with seeded data.
- Go/No-Go decision on Wave 2c (RC-3, RC-9 especially): ☐ after UAT findings.
