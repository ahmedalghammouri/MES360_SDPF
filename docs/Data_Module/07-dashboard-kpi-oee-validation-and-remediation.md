# 07 — Dashboard / KPI / Trend / OEE Validation & Remediation

Principal-architect assessment of why dashboards show empty / wrong / inconsistent values, the
root causes (verified against code), and the remediation plan + what has been implemented.

> Method: full code audit of the frontend (`apps/web`, 15 analytics screens) and the backend
> analytics services (`dashboard`, `production/kpi`, `historian`, `quality`, `maintenance`,
> `energy`, `reports`). Every finding below is grounded in a real `file:line`.

---

## Deliverable 1 — Assessment

### 1.1 Architecture & data-flow (as built)

```
Frontend (Next.js)                Backend (NestJS)                 Stores
──────────────────                ────────────────                 ──────
useScope() + useTimeRange()  ──►  /dashboard/overview      ─┐
   (global filter context)        /dashboard/kpis           ├─► KpiService.oeeAnalytics() ─► PostgreSQL (JobOrder rollup)
React Query hooks            ──►  /production/oee/calculate ─┘                    │
   per dashboard                  /production/oee/hierarchy  ─► OEEService.rollup()│ (weighted, correct)
useWebSocket() overlay       ──►  /historian/oee-trend ───────► HistorianService ─► InfluxDB (oee measurement)
                                  /energy/* ─────────────────► EnergyService ────► PostgreSQL (EnergySummary/Reading)
                                  /quality|maintenance/kpis ─► own services ─────► PostgreSQL
```

The **OEE engine itself is sound** (`OEEService.rollup` is correctly quantity-weighted). The
failures are at the **edges**: data-source wiring, filter propagation, two divergent availability
semantics, and the historian being silently disabled.

### 1.2 Confirmed root causes

| # | Root cause | Evidence | Effect | Sev |
|---|-----------|----------|--------|-----|
| RC-1 | **InfluxDB env var mismatch.** Code reads `INFLUX_URL`/`INFLUX_TOKEN`; local `apps/api/.env` sets `INFLUXDB_URL`/`INFLUXDB_TOKEN`. | [configuration.ts:19](../../apps/api/src/config/configuration.ts), [influx.service.ts:27](../../apps/api/src/modules/historian/influx.service.ts), apps/api/.env:18-21 | Historian disabled in local/dev → **all OEE/production trends empty** | **Critical** |
| RC-2 | **No relational fallback for OEE/production trends.** When Influx is off, `getOeeTrend`/`getProductionTrend` return `[]`. | [historian.service.ts:156-199](../../apps/api/src/modules/historian/historian.service.ts), contrast energy fallback [energy.service.ts:90](../../apps/api/src/modules/energy/energy.service.ts) | Empty trend charts even though `OEERecord`/JobOrder data exists | **Critical** |
| RC-3 | **Two divergent availability semantics.** `joRollupChild` (oeeAnalytics, hierarchy) uses *schedule-based* `runTime = operating span`; `woChild` (WO/PO) uses *time-based* `runTime = ppt − unplanned`; `calcJobOrderOEE` (JO/WO lists) uses schedule-only with a **Quality-as-OEE fallback**. | [kpi.service.ts:234-251](../../apps/api/src/modules/production/kpi.service.ts) vs [kpi.service.ts:100-120](../../apps/api/src/modules/production/kpi.service.ts) vs [production.service.ts:3353-3409](../../apps/api/src/modules/production/production.service.ts) | Same machine shows **different OEE on different screens** | **High** |
| RC-4 | **Time-Based OEE (AT-OEE) only on the JO-live dashboard.** `oeeAnalytics` returns schedule-based only; no `oeeTb`/`availabilityTb`. | [kpi.service.ts:334-341](../../apps/api/src/modules/production/kpi.service.ts), [historian.service.ts:118-152](../../apps/api/src/modules/historian/historian.service.ts) | Mandate "both metrics everywhere" unmet on 14/15 dashboards | **High** |
| RC-5 | **Scope filters silently ignored.** Quality `getKPIs`/NCR/inspections/SPC, Maintenance `getKPIs`/WOs accept no scope; FE calls them with no params. Manufacturing job-orders panel & `/energy/consumption` ignore scope. | [quality.service.ts:37](../../apps/api/src/modules/quality/quality.service.ts), [maintenance.service.ts:38](../../apps/api/src/modules/maintenance/maintenance.service.ts), FE manufacturing-overview.tsx:251 | Filtering to an area/line/machine still shows factory-wide numbers | **High** |
| RC-6 | **Time range not propagated.** Manufacturing-KPI timeframe selector never passed to `/dashboard/kpis`; Production/Manufacturing overviews send no range. | FE manufacturing-kpi-view.tsx:183→187 | KPI cards show wrong window | **High** |
| RC-7 | **Hardcoded / placeholder KPIs.** `shiftSummary.oee ?? 82.5`, `target ?? 400`; quality `cpk: 1.45`, `scrapRate: 0`; `/production/oee/calculate` `downtime: 0`; reports `downtime: 0`. | [dashboard.service.ts:249-250](../../apps/api/src/modules/dashboard/dashboard.service.ts), [quality.service.ts:63,71](../../apps/api/src/modules/quality/quality.service.ts), [production.service.ts](../../apps/api/src/modules/production/production.service.ts) getOEESummary, [reports.service.ts:61](../../apps/api/src/modules/reports/reports.service.ts) | Misleading/fake numbers | **High** |
| RC-8 | **`getOEERecords` pagination is fake** (`total = data.length`, `totalPages = 1`). | production.service.ts getOEERecords | Lists look complete when truncated | Medium |
| RC-9 | **Maintenance MTBF assumes 100 % utilization** (machineCount × full month). | [maintenance.service.ts:117-123](../../apps/api/src/modules/maintenance/maintenance.service.ts) | Inflated availability | Medium |
| RC-10 | **Date-window arithmetic** near month boundaries (`new Date(y, m−i, 1)`), and week/month via `setDate`. | maintenance reliability-trend, getOEESummary | Wrong buckets at edges | Low |
| RC-11 | **Historian samples only EXECUTING/PAUSED JOs.** Completed periods/ idle gaps never sampled; backfill is synthetic. | [historian.service.ts:77-116](../../apps/api/src/modules/historian/historian.service.ts) | Sparse trends even with Influx on | Medium |
| RC-12 | **WebSocket overlay vs polled HTTP** can disagree (machines replaced if WS array non-empty). | FE use-dashboard-data.ts:98 | Flicker / inconsistent machine OEE | Low |

### 1.3 Data-source matrix (Phase 8)

| Dashboard component | Correct source | Current source | Status |
|---------------------|----------------|----------------|--------|
| Plant/area/line/machine OEE (A/P/Q) | `KpiService.oeeAnalytics` (JobOrder rollup) | ✅ same | OK (add TB) |
| OEE / production **trend** | InfluxDB via Historian, else `OEERecord` fallback | InfluxDB only → `[]` when off | **Fix RC-1/RC-2** |
| Machine status | `MachineCurrentStatus` | ✅ same | OK |
| State timeline | `MachineStateRecord` | ✅ (JO-live) | OK |
| Downtime Pareto | `DowntimeEvent` (`isPlanned`/`affectsOEE`) | ✅ same | OK |
| Hierarchy rollup | `OEEService.rollup` (weighted) | ✅ same | OK |
| Quality KPIs | `InspectionResult` + production rejects, scoped | factory-wide, `cpk`/`scrap` hardcoded | **Fix RC-5/RC-7** |
| Maintenance KPIs | `MaintenanceWO`/`DowntimeEvent`, scoped | factory-wide, MTBF inflated | **Fix RC-5/RC-9** |
| Energy overview/live | `EnergySummary`/`EnergyReading` (scoped) | ✅ (consumption ignores scope) | Minor fix |
| Live machine metrics | WebSocket + `MachineCurrentStatus` | ✅ same | OK |

### 1.4 Severity roll-up
- **Critical (blocks trends platform-wide):** RC-1, RC-2.
- **High (wrong/inconsistent KPI & OEE, mandate gaps):** RC-3, RC-4, RC-5, RC-6, RC-7.
- **Medium/Low:** RC-8…RC-12.

---

## Deliverable 2 — Recommendations

1. **Make the backend the single source of truth for OEE** — every surface calls
   `OEEService`/`KpiService`; delete inline OEE math (`calcJobOrderOEE` → engine).
2. **Emit both OEE variants from one place.** Extend `oeeAnalytics` to return
   `availabilityTb`/`oeeTb` (downtime-aware) on `current`, `byEquipment`, and `trend`, so all
   KPI/OEE endpoints expose both without per-dashboard math.
3. **Never return empty trends when relational data exists** — Historian falls back to
   `OEERecord`/JobOrder when Influx is disabled or empty.
4. **Filter contract:** every analytics endpoint accepts `areaId/lineId/machineId` + range and
   actually applies them; the FE injects the active scope/range on every analytics query.
5. **No placeholders in production KPIs** — compute or return `null`; the UI renders "—".
6. **Standardize date windows** with a single helper (UTC-safe, month-boundary-safe).
7. **Sample completed JOs** at completion so historical trends are dense (RC-11).

---

## Phase 10 — Implementation status

See [08-remediation-implementation.md](08-remediation-implementation.md) for the running log of
files changed, before/after, and verification. Wave 1 (backend single-source-of-truth) is being
implemented first because it is the leverage point and is verifiable by typecheck/build; the
frontend "both-OEE-everywhere + filter wiring" rollout consumes those fields in Wave 2.
