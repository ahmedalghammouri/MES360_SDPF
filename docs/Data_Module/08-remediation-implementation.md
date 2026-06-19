# 08 — Remediation Implementation & Validation Log

Companion to [07-dashboard-kpi-oee-validation-and-remediation.md](07-dashboard-kpi-oee-validation-and-remediation.md).
Covers Deliverable 3 (implementation) and Deliverable 4 (validation) for **Wave 1 — Backend
single source of truth**, plus the staged Wave 2 (frontend) plan.

---

## Deliverable 3 — Implementation report (Wave 1)

All changes are backend-only and verified by `tsc --noEmit`, the Jest suite, and `nest build`.

| # | Root cause | Change | File(s) |
|---|-----------|--------|---------|
| RC-1 | Influx disabled by env var typo | `INFLUXDB_*` → `INFLUX_*` (names the code actually reads) | [apps/api/.env](../../apps/api/.env) |
| RC-4 / RC-3 | AT-OEE only on JO-live; divergent availability | **`oeeAnalytics` now computes time-based availability + OEE** (`availabilityTb`, `oeeTb`) downtime-aware, reusing `joUnplanned`/`spanMin` and the same P & Q — added a `timeBasedOee()` helper. Returned on `current`, `byEquipment`, `trend`, plus aggregate `downtimeMin`. | [kpi.service.ts](../../apps/api/src/modules/production/kpi.service.ts) |
| RC-4 | KPIs expose one variant | `/dashboard/overview` & `/dashboard/kpis` now return `oeeTb`, `availabilityTb`, `oeeTbTrend`, `availabilityTbTrend` | [dashboard.service.ts](../../apps/api/src/modules/dashboard/dashboard.service.ts) |
| RC-4 / RC-7 | Production endpoints one variant + `downtime:0` | `/production/kpis` & `/production/oee/calculate` now return `oeeTb`/`availabilityTb` (+ per-equipment & trend `oeeTb`); `downtime` now the **real** aggregated unplanned minutes | [production.service.ts](../../apps/api/src/modules/production/production.service.ts) |
| RC-7 | Misleading shift placeholders | `shiftSummary` no longer fakes `oee 82.5` / `target 400` — returns real value or `null` (UI renders "—") | [dashboard.service.ts](../../apps/api/src/modules/dashboard/dashboard.service.ts) |
| RC-7 | Fake quality KPIs | `scrapRate` now from real production rejects; `cpk` computed from SPC measurements with spec limits (or `null`), no longer `1.45` | [quality.service.ts](../../apps/api/src/modules/quality/quality.service.ts) |
| RC-2 | Empty trends when Influx off | Historian `getOeeTrend`/`getProductionTrend` **fall back to `OEERecord`** when Influx is empty/disabled — and the OEE fallback reconstructs `availabilityTb`/`oeeTb` from stored `uptimeMin`/`downtimeMin` | [historian.service.ts](../../apps/api/src/modules/historian/historian.service.ts) |
| — | Stale unit tests (pre-existing, blocked the suite) | Repaired DI/mocks: production (`KpiService`/`ApsService`/`HistorianService`, `jobOrder` mock, KPI assertion → engine + AT-OEE), maintenance (`TraceabilityService`, `maintWOSparePart` methods), auth (`prisma.user.findFirst` + `passwordHash`) | `*.spec.ts` |

### Time-Based OEE (AT-OEE) definition now used everywhere
```
availabilityTb = runMin / (runMin + downMin)         runMin = operating − unplanned downtime
oeeTb          = availabilityTb × performance × quality   (same P & Q as schedule-based)
```
Computed once in `KpiService.timeBasedOee()` and reconstructed in the historian fallback from
`OEERecord.uptimeMin/downtimeMin`, so the figure is identical across KPIs, trends and the JO-live
dashboard.

---

## Deliverable 4 — Validation report (Wave 1)

| Check | Command | Result |
|-------|---------|--------|
| Type safety | `npx tsc --noEmit` (apps/api) | ✅ exit 0 |
| OEE engine unit tests | `jest src/modules/production/oee.service.spec` | ✅ pass (weighted rollup intact) |
| Production service tests | `jest src/modules/production` | ✅ 22/22 |
| Full API suite | `jest` | ✅ **39/39, 5 suites** |
| Production build | `npm run build` (nest build) | ✅ exit 0 |

Behavioural validation:
- **Schedule OEE** unchanged (engine + rollup tests green) → no regression to existing numbers.
- **Time-Based OEE** now returned by `/dashboard/*`, `/production/kpis`, `/production/oee/calculate`, the JO-live dashboard, and both historian trends (live Influx and relational fallback).
- **Trends populate without Influx**: with the env fix the historian is enabled; even disabled, `OEERecord` fallback returns non-empty OEE/production series (incl. both availability methods).
- **No fabricated KPIs**: shift OEE/target, quality `cpk`/`scrapRate` are real or `null`; `/production/oee/calculate` downtime is real.

> Note: the pre-existing maintenance & auth spec failures were confirmed to fail on a clean
> `HEAD` (changes stashed) before being repaired — they were stale-test debt, not regressions
> from this work.

---

## Wave 2a — Filter propagation (IMPLEMENTED & verified)

Goal: no analytics surface shows factory-wide data when a lower scope (area/line/machine) or a
date range is selected. The global filter model is **Factory→Area→Line→Machine** (`useScope`) +
**Date Range** (`useTimeRange`); Product/Batch/Shift are page-local, not global (noted below).

**Backend — scope-enabling (prerequisite, not cleanup):**
| Change | File |
|--------|------|
| `quality.getKPIs(factoryId, scope?)` resolves area/line/machine → machineIds; scopes inspections, NCR, SPC, job-order scrap & Cpk | quality.service.ts + quality.controller.ts |
| `maintenance.getKPIs(factoryId, scope?)` scopes all WO metrics + machine count | maintenance.service.ts + maintenance.controller.ts |
| `listAllJobOrders` accepts area/line/machine (resolved + intersected with `machineIds`) | production.service.ts + production.controller.ts |
| `energy.getConsumption` accepts scope (via existing `scopeMeterWhere` on the summary's meter) | energy.service.ts + energy.controller.ts |

**Frontend — propagation (inject `useScope`/`useTimeRange` + add scope/time to queryKeys so they refetch):**
| Component | Fix |
|-----------|-----|
| quality-overview | scope+date → kpis / ncr / inspections / spc / spc-measurements |
| maintenance-overview | scope → kpis / work-orders |
| manufacturing-overview | scope → executing job-orders panel (was factory-wide) |
| manufacturing-kpi-view | local timeframe now mapped to `dateFrom/dateTo` → `/dashboard/kpis` & oee-records (RC-6) |
| production-overview | added `useTimeRange` → date range on work-orders |
| energy-overview | scope → meters / consumption |

**Scope/behavioural notes (honest limits):**
- Quality/Maintenance **KPI cards** are fully area/line/machine-scoped. Their **detail tables**
  (NCR/inspection/SPC/WO list) filter at machine level where the list endpoint supports it; full
  area/line filtering of those tables is a later backend addition.
- `/production/kpis` is **current-day by design**; production-overview applies the date range to
  the work-order list, not that day-KPI card.
- **Product/Batch/Shift** are not in the global scope store; treating them as global filters is a
  separate feature (extend `scope-store`), out of scope for propagation.

## Wave 2b — Both OEE variants in the UI (IMPLEMENTED on OEE surfaces)

Backend already emits `oeeTb`/`availabilityTb` (Wave 1). UI now consumes them:
- **production-oee-view** & **manufacturing-oee-view:** a "Time-Based OEE (AT-OEE)" +
  "Availability (Time-Based)" sub-strip beside the schedule-based cards; production-oee trend
  overlays a dashed `oeeTb` series with a labelled tooltip.
- **Shared types:** `DashboardKPIs` (home/manufacturing overview) and the OEE response types now
  carry `oeeTb`/`availabilityTb` (+ TB trends), so any consumer can render both.

Remaining 2b polish (data already flows; just add the visible stat): home dashboard KPI strip,
manufacturing-kpi-view & production-kpi-view cards, and the radar/leaderboard. Low-risk, additive.

### Validation (Wave 2a + 2b)
| Check | Result |
|-------|--------|
| API `tsc --noEmit` | ✅ |
| API Jest (incl. quality/maintenance specs) | ✅ 39/39 |
| Web `tsc --noEmit` | ✅ |
| Web `next build` (all 83 routes) | ✅ exit 0 |
| Query-key audit | ✅ every changed query includes scope/time key → refetches on filter change |

---

## Wave 2b — FULL completion (UI Consistency Report)

Both OEE concepts are now surfaced on every OEE-bearing screen. Mechanism: a uniform
"Time-Based OEE (AT-OEE) · Availability (Time-Based)" sub-strip beside the schedule-based cards
(additive, backward-compatible), plus a dashed `oeeTb` overlay on the production-OEE trend.
All values come **only** from the standardized backend fields (`oeeTb`, `availabilityTb`); no
calculation logic was changed.

### Where the second metric was added (implementation notes)
| Dashboard / surface | File | Schedule OEE | Time-Based OEE | Schedule Avail. | Time-Based Avail. |
|---------------------|------|:---:|:---:|:---:|:---:|
| Home Dashboard / Overview | dashboard-view.tsx (KPI row + TB sub-strip) | ✅ | ✅ | ✅ | ✅ |
| Manufacturing Overview | manufacturing-overview.tsx (KPI pills + TB sub-strip) | ✅ | ✅ | ✅ | ✅ |
| Manufacturing OEE | manufacturing-oee-view.tsx (metric boxes + TB sub-strip) | ✅ | ✅ | ✅ | ✅ |
| Manufacturing KPI | manufacturing-kpi-view.tsx (KPI cards + TB sub-strip) | ✅ | ✅ | ✅ | ✅ |
| Production Overview | production-overview.tsx (KPI row + TB sub-strip) | ✅ | ✅ | ✅ | ✅ |
| Production OEE | production-oee-view.tsx (cards + TB sub-strip + trend overlay) | ✅ | ✅ | ✅ | ✅ |
| Production KPI | production-kpi-view.tsx (primary cards + TB sub-strip) | ✅ | ✅ | ✅ | ✅ |
| Job-Order Live (drill-down) | jo-live-dashboard.tsx (already dual, Wave 0) | ✅ | ✅ | ✅ | ✅ |
| Manufacturing Reports (hub) | manufacturing-reports-view.tsx (pills) | ✅ | ✅ | ✅ | ✅ |
| Production Reports (hub) | production-reports-view.tsx (pills) | ✅ | ✅ | ⚠️ n/a | ⚠️ n/a |
| Production Report (detailed) | reports/production-report-view.tsx + reports.service.ts | ✅ | ✅ | ✅(summary) | ✅(summary) |

Legend: ✅ visible · ⚠️ that page's card set doesn't include an availability card (OEE schedule+TB shown).

### Backend touched for Wave 2b (additive only)
- `reports.service.getProductionReport` summary now includes `avgOeeTb` + `availabilityTb`
  (consumed from `oeeAnalytics.current`). No formula changes.

### Validation (Wave 2b full)
| Check | Result |
|-------|--------|
| API `tsc --noEmit` | ✅ |
| API Jest | ✅ 39/39 |
| Web `tsc --noEmit` | ✅ |
| Web `next build` (all 83 routes) | ✅ exit 0 |
| Backward compatibility | ✅ all additions are new fields / new UI rows; no existing field/behavior removed |

### Remaining Gap Analysis (vs "both OEE concepts available throughout")
1. **OEE Gauge & radar charts** still render schedule-based A/P/Q only; the TB values appear in
   the adjacent sub-strip, not inside the gauge/radar geometry. Functionally compliant (both
   visible on the screen) but not *inside* those specific visualizations. Low priority.
2. **Per-machine leaderboards** rank by schedule OEE. `byEquipment` now carries `oeeTb`, so a TB
   column/toggle is a small follow-up; ranking by schedule OEE is acceptable.
3. **Quality/Maintenance/Energy dashboards** intentionally show no OEE (not OEE surfaces) — N/A.
4. **Grafana / Dashboard-Center external dashboards** are out of the app's control; their OEE
   panels would need Grafana-side queries against the historian (both fields exist in InfluxDB).
5. **Detail-table area/line scoping** (carried from Wave 2a) — KPI cards are fully scoped; some
   list tables filter at machine level only. Tracked under Wave 2a notes.

No blocker remains to the requirement that both OEE concepts be *available* on every OEE screen.
Items 1–2 are visual-polish enhancements, not compliance gaps.

## Wave 2c — Staged remainder (backend cleanup — do AFTER 2a/2b sign-off)

Not yet implemented; requires running the app to verify visually. Tracked here with file pointers.

### Frontend (apps/web) — consume the new fields & fix filter wiring
1. **Show both OEE variants** on every analytics card/chart that has `oee` — read the new
   `oeeTb`/`availabilityTb` from `/dashboard/*` and `/production/oee/*`. Files: dashboard
   `use-dashboard-data.ts`, `manufacturing-oee-view.tsx`, `manufacturing-kpi-view.tsx`,
   `production-oee-view.tsx`, `production-kpi-view.tsx`, `manufacturing-overview.tsx`.
2. **Filter propagation (RC-5/RC-6):** inject the active `useScope()` + `useTimeRange()` into
   quality (`/quality/kpis|ncr|inspections|spc`), maintenance (`/maintenance/kpis|work-orders`),
   the manufacturing job-orders panel, and `/energy/consumption`; pass the Manufacturing-KPI
   timeframe to `/dashboard/kpis`.
3. **Energy Reports** page is a stub — wire to `/energy/consumption`.

### Backend — remaining medium/low items
4. **Scope on quality/maintenance KPIs (RC-5):** add `areaId/lineId/machineId` params and push
   into the `where` (mirror `DashboardService.scopeMachineIds`).
5. **Unify `calcJobOrderOEE` (RC-3):** replace the inline formula (with its Quality-as-OEE
   fallback) with `OEEService`, so JO/WO list OEE matches the engine.
6. **Real pagination for `getOEERecords` (RC-8)**, **MTBF from actual runtime (RC-9)**, and a
   **shared UTC/month-safe date-window helper (RC-10)**.
7. **Sample COMPLETED job orders (RC-11)** at completion so historical trends are dense.

### Suggested sequencing
Wave 2a: frontend filter wiring (highest user-visible impact, RC-5/RC-6).
Wave 2b: frontend both-OEE rollout (RC-4 UI).
Wave 2c: backend cleanups (RC-3/RC-8/RC-9/RC-10/RC-11).
