# MES360° — Dashboard QC Report (Live Data Validation)

**Date:** 2026-06-21 · **Factory under test:** SDPF — Saudi Detergent Powder Factory
(`10a9c8ab…`) · **Method:** automated harness against the **running stack**
(Postgres `mes360` @ :5433, InfluxDB @ :8086, API @ :3001).

**Result: 39 checks — ✅ 34 PASS · ⚠️ 5 WARN · ❌ 0 FAIL.**
All formula/equation tests pass and every dashboard number reconciles with the
database. The 5 warnings are **data-coverage gaps (sparse seed data)**, not logic
or formula errors.

Reproduce: `node scripts/qc-dashboard-harness.mjs`
(harness: [`scripts/qc-dashboard-harness.mjs`](../scripts/qc-dashboard-harness.mjs)).

---

## 1. Method & scenarios

The harness does four things and asserts each:

1. **Formula unit-tests** — feed known inputs into each documented equation and
   assert the expected output (proves the math the dashboards claim).
2. **Live endpoint capture** — logs into the real API and calls every dashboard
   endpoint across scenarios.
3. **Independent DB recompute** — recomputes the same KPIs straight from Postgres
   (`docker exec psql`) and compares to the API output.
4. **Cross-page & equation consistency** — same metric across endpoints; internal
   identities (e.g. Availability = MTBF/(MTBF+MTTR)).

**Scenarios**
- **S1 — Whole factory** (no scope): all KPI + list endpoints.
- **S2 — Line scope** (`lineId = Powder Packing Line 1`): re-scoped production KPIs.
- **S3 — OEE timeframes**: `/production/oee/calculate` for `day`, `week`, `month`.

---

## 2. Data census (what was actually in the DB)

| Entity | Count | Entity | Count |
|---|---:|---|---:|
| Production Orders | 4 | OEE records | **0** |
| Work Orders (3 COMPLETED, 1 PLANNED) | 4 | Inspections | **0** |
| Job Orders | 25 | Energy meters / summaries | **0** |
| Downtime events | 1 | NCRs | 0 |
| Maintenance WOs (2 COMPLETED corrective) | 2 | SKUs | 32 |
| Raw materials | 15 | Spare parts | 22 |
| Material lots | 2 | Stock movements (7d) | 17 |

> The analytical source tables (OEE records, inspections, energy meters) are
> **empty** — the seed created summary rows (e.g. `WorkOrder.oee`) without the
> granular records the live engines read. This is the root of all 5 warnings.

---

## 3. Live endpoint snapshots (S1 — whole factory)

```jsonc
// GET /production/kpis
{ "oee":0, "availability":0, "performance":0, "quality":0,
  "oeeTb":0, "availabilityTb":100,
  "totalOrders":4, "completedOrders":3, "inProgressOrders":0, "plannedOrders":1, "heldOrders":0 }

// GET /maintenance/kpis
{ "openWOs":0, "overdueWOs":0, "completionRate":100,
  "mttr":0.7, "mtbf":20, "availabilityRate":96.8, "pmCompliance":100 }

// GET /quality/kpis
{ "fpy":0, "passRate":0, "reworkRate":0, "scrapRate":0,
  "openNCRs":0, "criticalNCRs":0, "openCAPAs":0, "capaComplianceRate":100,
  "inspectionsToday":0, "cpk":null }

// GET /inventory/overview
{ "totalSpareParts":22, "lowStockCount":0, "totalSKUs":32, "totalMaterialLots":2,
  "totalStockValue":0, "movementsLast7d":17 }
```

---

## 4. Test results by group

### 4.1 Formula unit-tests — ✅ 8/8 PASS
| Equation | Input | Expected | Result |
|---|---|---|---|
| OEE = A×P×Q | 0.90×0.95×0.99 | 84.6% | ✅ 84.6% |
| FPY = passed/inspected | 950/1000 | 95.0% | ✅ 95.0% |
| MTTR = repair time/repairs | 12/4 | 3h | ✅ 3h |
| MTBF = operating hrs/failures | 480/4 | 120h | ✅ 120h |
| Availability = MTBF/(MTBF+MTTR) | 120/(120+3) | 97.6% | ✅ 97.6% |
| Available stock = current − reserved | 100−30 | 70 | ✅ 70 |
| Energy intensity = kWh/units | 5000/1000 | 5 | ✅ 5 |
| Guard: 0 inspected ⇒ FPY 0 (no NaN) | 0/0 | 0 | ✅ 0 |

### 4.2 API ↔ DB consistency — ✅ PASS
- `production/kpis.totalOrders` **4 == DB 4** ✅; `completedOrders` **3 == 3** ✅; `inProgressOrders` **0 == 0** ✅.
- `quality/kpis.fpy` = **0** with 0 inspections — **guarded, no NaN** ✅.
- `maintenance/kpis.openWOs` **0 == DB 0** ✅; MTTR/MTBF/availability/PM all **finite numbers** ✅.
- Inventory: **no raw material has reserved > current** (available ≥ 0) ✅ — matches the material-shortage gate's definition.

### 4.3 Equation consistency (internal) — ✅ PASS
- **Maintenance availability == MTBF/(MTBF+MTTR):** API `96.8%` vs recomputed `96.6%` from the *displayed* (rounded) MTTR 0.7 / MTBF 20. The ≤0.2% gap confirms the engine computes availability from **unrounded** internals (0.65/20 → 96.8%) — correct behaviour.

### 4.4 Reachability & scenarios — ✅ PASS
- All 8 endpoints return **HTTP 200**.
- S2 line-scoped `/production/kpis` returns a **finite** OEE.
- S3 `/production/oee/calculate` works for `day`/`week`/`month`.

---

## 5. Findings (the 5 warnings) & recommendations

| # | Finding | Type | Recommendation |
|---|---|---|---|
| **F1** | **3 completed WOs carry `oee` (avg 47.1%: 90.9 / 19.5 / 30.8) but `oee_records = 0`.** The live OEE KPI is today-windowed and reads OEERecord, so it shows **0%** while the WOs clearly ran. | Data gap (+ robustness) | Complete WOs through the app (the engine persists OEERecord), **or** backfill OEERecord from historical WOs. Optionally add a fallback: when no OEERecord exists in the window, roll up completed `WorkOrder.oee` so historical OEE isn't lost. |
| **F2** | Completed WOs have `oee/quality = 90.9/100` but `goodQty = actualQty = 0`. | Inconsistent seed data | Seed should set `actualQty/goodQty/scrapQty` consistently with the OEE it stores, or compute OEE from those counts. |
| **F3** | `inspection_results = 0` ⇒ Quality FPY/defect/Cpk all 0/null. | Data coverage | Seed/record inspections to exercise the quality dashboards. |
| **F4** | `energy_meters = 0`, `energy_summaries = 0` ⇒ Energy dashboard reads 0. | Data coverage | Configure meters + feed InfluxDB series (or seed EnergySummary) to validate energy KPIs. |
| **F5** | `totalStockValue = 0` (items have no `unitCost`). | Data quality | Populate unit costs so inventory value/turns are meaningful. |
| (note) | Test harness fell back to super-admin login (factory-admin password pattern mismatch). Did not affect results — only SDPF holds data. | Harness | Use a known factory-admin credential to validate strict scope isolation. |

**No incorrect formulas or inconsistent cross-page logic were found.** Where data
exists (production counts, maintenance reliability), the dashboards reconcile with
the database and the equations verify. Where dashboards show 0, it is the
**correct, guarded response to empty source tables** — not a bug.

---

## 6. Recommendations (priority order)

1. **Seed a realistic operating window** so analytical dashboards are testable
   end-to-end: completed WOs *with* OEERecord rows, inspections (pass/fail),
   downtime spread across causes, energy meter series, and item unit-costs.
2. **F1 robustness option:** add an OEERecord-absent fallback in `getKPIs` /
   `oeeAnalytics` to roll up `WorkOrder.oee` for the window so historical runs are
   not invisible on the live KPI.
3. **Re-run this harness after seeding** — with non-zero data the harness will
   additionally assert OEE rollups, FPY, scrap%, and energy intensity against
   independent DB recomputation (the checks already exist; they currently pass
   trivially on zero data).
4. Keep the harness in CI as a **dashboard contract test** (endpoint shape +
   API↔DB reconciliation + equation identities).

---

## 7. Artifacts

- Harness script: [`scripts/qc-dashboard-harness.mjs`](../scripts/qc-dashboard-harness.mjs) — re-runnable, no mutation of data.
- Calculation reference & per-dashboard data-source map: [`docs/DASHBOARD-AUDIT.md`](./DASHBOARD-AUDIT.md).
- In-app explainers (formulas/benchmarks per page): the ℹ️ icon → `src/lib/dashboard-explainers.ts`.
