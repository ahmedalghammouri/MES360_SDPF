# Persistent Production / OEE Fact Store

## Context

Today the platform **never persists** OEE/KPI + production (good/scrap/bad) **classified per shift × job-order × work-order × production-order × product × step × machine over time**. It only keeps a single *mutable* "current" OEE on `WorkOrder`/`ProductionOrder`/`ShiftInstance` rows and **recomputes every analytic live from `JobOrder`'s current counts**. Consequences the user reported:

- No professional reference to aggregate a **period / shift / WO / PO / product / machine** — everything depends on the "last reading".
- Inconsistency between time filters, charts and tables.
- `OEERecord` (the existing per-machine/shift fact table) is **only written on WO completion** and lacks `jobOrderId/workOrderId/productionOrderId/lineId/areaId`, so it can't break down by those.
- The only time-series (InfluxDB `oee`) isn't dimension-classified and isn't what the SQL dashboards aggregate.

**Goal:** an immutable, dimension-classified, time-bucketed **fact store** that every dashboard aggregates from — giving correct totals for any window/scope, consistent across charts & tables. Decisions: **Phase 1 (foundation) + Phase 2 (repoint app reads)** this round; Grafana = later. Atomic granularity = **per-minute**, folded into **hourly/shift/day** rollups.

The correct count model is already implemented live (after the recent fix in `kpi.service`): **good = final routing step's good (base unit); scrap = Σ all steps' rejects (base unit); total = good + scrap**. The fact store encodes the same rule so numbers match exactly.

---

## Phase 1 — Fact store, writer, backfill (write-only, no read changes)

### 1.1 Prisma model `ProductionSnapshot` — atomic fact = one row per `(jobOrderId × granularity × bucketStart)`
`apps/api/prisma/schema.prisma` (+ back-relations on `Factory`, `JobOrder`, `WorkOrder`, `Machine`, `ShiftInstance`).

Key columns:
- **Bucket:** `bucketStart`, `bucketEnd`, `granularity` ("MINUTE"|"HOUR"|"SHIFT"|"DAY"|"JO"), `isFinalized` (false = live upsertable, true = immutable).
- **Dimensions (denormalised at write so reads never join):** `factoryId, areaId, lineId, machineId, jobOrderId, workOrderId, productionOrderId, skuId, shiftInstanceId, shiftTemplateId, shiftCode`.
- **Step:** `operationName, sequenceOrder, isFinalStep` (= JO has MAX(sequenceOrder) among its WO's JOs; un-routed JO ⇒ true).
- **Counts raw + base** (`Float`, because base-unit conversion is fractional): `goodRaw/scrapRaw/reworkRaw/totalRaw/plannedQtyOutRaw`, `outputUnit`, `baseUnit`, `goodBase/scrapBase/reworkBase/totalBase/plannedQtyOutBase`.
- **Time (min, window-clamped):** `plannedMin, runMin, downMin, plannedDownMin, microStopMin, idealCycleSec, idealRunMin`.
- **Metrics (%):** `availability, performance, quality, oee, availabilityTb, oeeTb`.
- **Idempotent key:** `@@unique([jobOrderId, granularity, bucketStart])`.
- **Indexes:** `[factoryId,granularity,bucketStart]`, `[machineId,bucketStart]`, `[workOrderId,bucketStart]`, `[productionOrderId,bucketStart]`, `[lineId,bucketStart]`, `[areaId,bucketStart]`, `[shiftInstanceId]`, and `[factoryId,bucketStart,isFinalStep]` (index-only "good where final").

**Double-count rule (load-bearing):** any scope ≥ one step aggregates as
`scrap = SUM(scrapBase)`, `good = SUM(goodBase) FILTER (isFinalStep)`, `total = good + scrap` (derived, never summed); time = `SUM(plannedMin/runMin/downMin/idealRunMin)`; then A=run/ppt, P=earned/run, Q=good/(good+scrap), OEE=A·P·Q — identical maths to `OEEService.rollup` / `kpi.finalStepCounts`.

Apply via the project's existing mechanism: add to `schema.prisma`, `prisma generate`, then `prisma db push` (prod-local/hostinger migrate-seed already runs `db push`) or a migration file.

### 1.2 Writer — new `ProductionSnapshotService` in `HistorianModule`
- Extend the existing per-minute loop (`historian.service.ts sampleActiveJobOrders` + `historian.scheduler.ts @Cron EVERY_MINUTE`) to feed BOTH Influx and a Postgres upsert from one enriched active-JO query (add `JO_SELECT_ANALYTICS` + `machine{lineId,areaId}` + `workOrder{productionOrderId,skuId,shiftInstance{shiftTemplateId,shiftTemplate.code}}`).
- **Live row** = cumulative `actualQtyGood/Rejected` as-of the minute (counters are cumulative), base-normalised via `toBaseUnits` (`apps/api/src/common/units.util.ts`); time via reused `kpi.joRollupChild(jo, {bucketStart,bucketEnd})` clamping + the historian downtime-overlap loop; A/P/Q/OEE+Tb via `oee.calculateDetailed`. `upsert` on the unique key, `isFinalized=false`.
- **Finalize (immutable)** on: bucket rollover (next tick sees a new bucketStart), JO COMPLETE/CANCELLED (hook `kpi.propagateFromJobOrder`), shift close (`ShiftInstance` → COMPLETED). On JO complete also write a terminal `granularity='JO'` row.
- **Rollup writer** (every ~5 min + on finalize): fold finalized MINUTE rows → HOUR/SHIFT/DAY rows (per-bucket deltas from cumulative, summed time), same unique key.
- **shiftInstanceId/shiftCode resolved per-bucket** (so a JO spanning shifts splits correctly). Failures swallowed+logged (same contract as historian — never disrupt run).

### 1.3 Backfill — `ProductionSnapshotBackfill` (deterministic, idempotent)
Reconstruct snapshots for `[from,to]` from existing data: JobOrders (`JO_SELECT_ANALYTICS`) + `ProductionEvent` COUNT_UPDATE deltas (carry jobOrderId/good/rejected/timestamp) for the count curve (fallback: linear apportionment of final counts across `[actualStart,actualEnd]`, like `historian.backfill`) + `DowntimeEvent` via `kpi.joUnplanned` overlap. Walk buckets, upsert finalized rows, then run the rollup writer. Idempotent via unique key. Expose a guarded admin endpoint/CLI (e.g. `prisma/seed-snapshots.ts`) to run it.

**Phase 1 validation:** assert `snapshotAggregate` totals == live `kpi.oeeAnalytics` for the same window/scope.

---

## Phase 2 — Repoint app reads (hybrid: persisted history + live open bucket)

- Add `kpi.snapshotAggregate(scope, from, to, groupBy?)` running the GROUP BY above and feeding results into the SAME `oee.calculateDetailed`/`rollup` primitives (return shapes unchanged).
- **Hybrid read for windows touching `now`:** `SUM(finalized snapshots in window)` **+** live `aggregateJos` for JOs whose open bucket is inside the window. Closed windows read purely from snapshots → consistent & dimension-correct; current period stays identical to today.
- Repoint inside `kpi.service`: `oeeAnalytics`, `oeeGroupedTrend`, `hierarchyOEE`, `oeeRecordsFromJobOrders` — behind a `SNAPSHOTS_READ` flag (fallback = current JobOrder scan). All consumers inherit automatically: `dashboard.service` (Command Center, Executive, cockpit), `/production/oee*` endpoints, and the React cockpits (Command Center, Reliability, Quality Intelligence, Energy, Executive, Factory Analytics, Insights, Production KPI).
- New cockpits gain true **shift / WO / PO / product / step** breakdowns by aggregating `ProductionSnapshot` directly (groupBy dimension) — not possible cheaply from the live scan.
- Repoint the other `OEERecord` readers to snapshots where it improves correctness: `shift.service` (shift OEE), `ai.service` (7d vs prev-7d OEE), `dashboard.service` actualOutput, `production.service` 14-day trend, `historian` relational fallback.

(Grafana SQL + deriving `OEERecord` from snapshots = **Phase 3, later**. `calculateAndStoreOEE` keeps writing `OEERecord` for now so Grafana is untouched.)

---

## Critical files
- `apps/api/prisma/schema.prisma` — `ProductionSnapshot` model + back-relations (+ `prisma generate` / `db push`).
- `apps/api/src/modules/historian/historian.service.ts`, `historian.scheduler.ts`, `historian.module.ts` — share the per-minute loop; host `ProductionSnapshotService` + rollup + finalize hooks.
- `apps/api/src/modules/production/kpi.service.ts` — reuse `joRollupChild`/`finalStepCounts`/`aggregateJos`; add `snapshotAggregate` + hybrid read; repoint `oeeAnalytics`/`oeeGroupedTrend`/`hierarchyOEE`/`oeeRecordsFromJobOrders`.
- `apps/api/src/modules/production/production.service.ts` — finalize JO bucket on COMPLETE (via `propagateFromJobOrder`); leave `calculateAndStoreOEE` (~3199) writing `OEERecord` until Phase 3.
- `apps/api/src/modules/{shift,ai,dashboard}` — repoint `OEERecord` reads to snapshots.
- `apps/api/prisma/seed-snapshots.ts` (new) — backfill runner.

## Edge cases
Multi-WO batches (keyed per JO + workOrderId) · un-routed JOs (`isFinalStep=true`, seq 0) · missing SKU packaging (`toBaseUnits` factor 1 → base==raw) · partial buckets (clamped time, PPT floored at in-window run) · JO spanning shifts (per-bucket shift stamp) · paused/zero-output JOs (zeroed metrics) · idempotent upsert + immutable finalized rows (recompute only via explicit flag).

## Verification
1. `pnpm --filter @mes360/api exec tsc --noEmit` (API compiles).
2. `prisma db push` adds `production_snapshots`; confirm table + indexes (`psql … \d production_snapshots`).
3. Run backfill (`seed-snapshots.ts`) over the existing window; confirm rows populated for SDPF's 5 machines × JOs.
4. **Parity test:** for several windows/scopes (machine, line, WO, shift), assert `snapshotAggregate` good/scrap/OEE == live `kpi.oeeAnalytics` (Phase 1 gate).
5. Let the per-minute writer run; confirm a live row upserts each minute for an EXECUTING JO and finalizes on rollover/complete.
6. In the app (with `SNAPSHOTS_READ=on`): open Factory Analytics / Insights / Command Center for a past period and a shift — totals stable, dimension-correct, and matching the WO detail (good=final step, scrap=Σ steps, base unit).
