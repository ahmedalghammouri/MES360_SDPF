# Client Request — 30-07-2026 · Checklist & Task Plan

Response to the client's email following the meeting, covering the 28-07-2026 production data, the energy KPI, the dashboard locations, and the machine rate test.
**Review meeting: Sunday.**

---

## A. Checklist — what was asked, what was done

| # | Client's request | Status | Deliverable |
|---|---|---|---|
| **1** | Create a WO with the attached production, stoppage and waste data | ✅ Built | `apps/api/prisma/seed-wo-2026-0007.ts` |
| **2** | Evaluate system functionality and users' ability to capture the data | ✅ Assessed | [Gap report](./01-MANUAL-VS-SYSTEM-GAP-REPORT.md) — 12 findings |
| **3** | Compare against WO-2026-0006 for consistency | ⚠️ Blocked | Tooling ready, but **WO-2026-0006 is not in this database** — see note below |
| **4** | Energy KPI — energy ratio linked to machine **and** work order | ✅ Built & tested | `EnergyWOMachineKpi` + 4 endpoints + UI panel · arithmetic 17/17 |
| **5** | Dashboard locations — 5 facility coordinates | ✅ Applied live | `seed-factory-coordinates.ts` + both seed files · 5/5 pins updated |
| **6** | Production rate per machine (new SKU testing) | ✅ Loaded | `seed-bb-cycle-times.ts` |
| **7** | Manual KPI calculation in Excel | ✅ Built | [`WO-2026-0007-Manual-KPI-Calculation.xlsx`](./WO-2026-0007-Manual-KPI-Calculation.xlsx) — 9 sheets |
| **8** | DB seeder to insert the data | ✅ Built | see #1 |
| **9** | Compare manual vs system KPIs, write the gap | ✅ Built | see #2 + workbook sheet 7 |

✅ **Executed against the live system on 31-07-2026.** WO-2026-0007 is loaded, the 5 pins are updated, the measured cycle times are in, and the comparison is done: **10 KPIs match exactly, 8 gaps, and all 8 trace to a single root cause (G-01).** Details in section D.

⚠️ **`WO-2026-0006` does not exist in this database** — it holds only `WO-2026-0001` and the new `WO-2026-0007`. The client is likely on a different environment; see gap report §3.

---

## B. What was built

### 1 · Manual KPI workbook — `WO-2026-0007-Manual-KPI-Calculation.xlsx`

Nine sheets. Only the yellow cells are typed; every KPI is a live Excel formula, so the client can audit the arithmetic and re-run it for any future day.

| Sheet | Contents |
|---|---|
| 0 · Cover | Sources, scope, how to read it |
| 1 · Inputs-Production | Quantities and waste as logged, plus the product master |
| 2 · Inputs-Stoppages | All 14 stoppages; duration **recomputed** from start/end, not transcribed |
| 3 · Inputs-Rates | The 5-run rate test → ideal cycle times |
| 4 · Manual KPI | Time model, counts, 16 supporting KPIs, six-big-losses waterfall |
| 4b · OEE Scenarios | Six A×P×Q scenarios — ISO 22400 vs as-built, and the effect of each ideal-rate choice |
| 5 · Per-Machine KPI | The same calculation resolved to M1/M3/M4/M5 |
| 6 · Downtime Pareto | Loss ranking with the improvement shortlist |
| 7 · Manual vs System | Gap table — **filled with values measured from the live system** |
| 8 · Data Issues | Eight contradictions inside the client's own data, with the question to ask |

**Verified:** all 141 formula cells were evaluated and matched against an independent calculation.

**Headline result (ISO 22400):** Availability 47.7 % × Performance 55.3 % × Quality 98.3 % = **OEE 25.9 %**.

### 2 · Work order seeder — `seed-wo-2026-0007.ts`

Loads the 28-07 data as `WO-2026-0007` (+ `PO-SDPF-2026-0007`, a shift instance, 14 downtime events, 4 material-consumption rows).

**Design decision worth knowing:** the WO is created **without job orders**. The client logged one stoppage stream for the whole line, which is right for a packing line with no buffers. `kpi.service.woChild()` has two paths — with job orders it filters downtime per machine, which would put all 251 minutes on M1 and leave M3/M4/M5 at zero downtime, reporting **87.7 %** availability instead of the true **50.8 %**. Without job orders it uses the WO window and sums all the order's downtime, reproducing the client's manual line calculation exactly. Per-machine output is preserved in the notes and the consumption rows.

Two downtime causes the client logged had no node in the reason tree ("Machine synchronization", "Open duplex – guide adjustment"); both are added as level-3 causes so the Pareto groups the repeats correctly.

Idempotent — downtime and consumption rows are cleared and rebuilt on each run.

### 3 · Measured cycle times — `seed-bb-cycle-times.ts`

Loads the rate test as `MachineCycleTime` with `source = 'MEASURED'`. Uses the **best** of the five runs, per ISO 22400's theoretical-best definition. Defaults to the rate-tested SKU only; `--all-2kg` applies to every 2 Kg product.

This is the highest-impact fix in the delivery — see **G-02** in the gap report.

### 4 · Energy ratio per machine × work order

New `EnergyWOMachineKpi` table, unique on `(workOrderId, machineId)`, computed from `EnergyReading` — which already carries both foreign keys. The existing `EnergyWOSummary` and its algorithm are untouched.

Metrics: **kWh/unit** (the headline ratio), kWh/kg, kWh/run-hour, a productive-only ratio, idle/downtime waste share, and variance against the best ratio that machine previously achieved on the same product.

```
GET  /energy/work-orders/:workOrderId/machine-kpis
POST /energy/work-orders/:workOrderId/machine-kpis/recompute
GET  /energy/machines/:machineId/energy-ratio-trend
GET  /energy/energy-ratio-leaderboard
```

Recomputes automatically on `production.work-order.completed`. UI: a per-machine panel on the Energy → MES Context tab, EN + AR.

> While wiring this up I found that the **existing** `EnergyWOSummary` listener is bound to `workorder.completed`, an event nothing emits — so it has never fired. See **G-10**; left alone as it is outside this request.

### 5 · Facility coordinates

All five links resolved and applied to `seed-ncc-master.ts`, `seed.ts`, and an idempotent `seed-factory-coordinates.ts` for the live database. **Two facilities change region** — see **G-11**; worth confirming verbally.

### 6 · Schema changes

| Change | Why | Risk |
|---|---|---|
| `MachineCycleTime.cycleTimeSeconds` `Int` → `Float` | Big Betti runs 1.20 s/pack; as an `Int` that stored as `1` — a 20 % error into the OEE denominator | None — widening preserves every value |
| New `energy_wo_machine_kpis` table | The energy ratio request | None — additive |

Migration `20260730000000_energy_wo_machine_kpi`. Nothing is dropped and no existing row is rewritten.

---

## C. Deliberately **not** changed

Because the client asked for no conflict with the current data module or algorithm, and each of these would silently move numbers on existing orders:

| Item | Why left alone |
|---|---|
| **PPT not excluding planned stops** (G-01) | Changes the OEE of every historical work order. Both values are shown side by side in the workbook (scenarios A and E) so it can be a deliberate, announced decision. |
| **`cartonsPerPallet: 50` in `seed-ncc-master.ts`** (G-05) | Correct fix is to run `prisma:seed:bb` after the master seed, which is already the documented order. |
| **Micro-stop classification** (G-08) | Left exactly as the client logged it so the comparison stays honest. Reclassifying is a data change, not a code change. |
| **Known open items #1/#2/#4/#6** (G-12) | Pre-existing, already tracked in `OEE-KPI-EQUATIONS-AND-APIS.md` §4. Listed so nothing looks like a new surprise. |
| **`EnergyWOSummary`** | Left untouched; the new table adds the machine dimension alongside it. |

---

## D. What was run (31-07-2026)

All of the below was executed against the live `*-plocal` stack, after taking a 32 MB `pg_dump` backup.

```bash
docker exec mes-postgres-plocal pg_dump -U mes_user -d mes360 > backup.sql

docker exec -w /app mes-api-plocal npx ts-node --transpile-only prisma/seed-factory-coordinates.ts
docker exec -w /app mes-api-plocal npx ts-node --transpile-only prisma/seed-bb-cycle-times.ts
docker exec -w /app mes-api-plocal npx ts-node --transpile-only prisma/seed-wo-2026-0007.ts
docker exec -w /app mes-api-plocal npx ts-node --transpile-only prisma/verify-wo-2026-0007.ts
```

| Step | Result |
|---|---|
| Schema (new table + `Float` widening) | ✅ Live — structure matches the migration SQL exactly |
| Coordinates | ✅ 5/5 updated · RNTIC and NDPF each moved ~1 220 km · no NULL pins |
| Cycle times | ✅ 5 written as `MEASURED` · decimals survive (`1.2`, `6.67`, not `1`/`7`) |
| WO-2026-0007 | ✅ Loaded · 14 downtime events (281 min) · 4 consumption rows · 2 new causes |
| Stored vs recomputed OEE | ✅ All 5 columns agree |
| 4 energy endpoints | ✅ All HTTP 200, correct shapes |
| Energy ratio arithmetic | ✅ 17/17 on a self-cleaning integration test |
| Manual vs system | **10 match · 8 gaps · all 8 from G-01** |

All idempotent and safe to re-run. Only the coordinates script writes to pre-existing rows, and only `lat`/`lng`/`city`/`address`.

> This stack was built with `prisma db push`, so `_prisma_migrations` is empty and `migrate deploy` returns **P3005**. The schema changes were already live because the image had been rebuilt from the updated `schema.prisma`. On a migration-managed environment `migrate deploy` applies the migration normally.

**Then check by eye:** the network map pins (5 sites), Production → WO-2026-0007 (OEE card + downtime tab), Energy → MES Context (per-machine ratio panel — expected empty until meters stream), and Downtime Center (14 events, 281 min).

---

## E. Agenda for Sunday

**1 · Walk the manual workbook** — the arithmetic is auditable and independent of the platform, so it is the right thing to agree on first.

**2 · Seven decisions needed** (full detail in gap report §4):

| | Question | Moves |
|---|---|---|
| 1 | Pallet pattern — 32 or 40 cartons? | pallet output, M4/M5 |
| 2 | Adopt measured cycle times for Performance? | **OEE 43 % → 26 %** |
| 3 | Exclude planned stops from PPT per ISO 22400? | Availability +3.1 pp on all history |
| 4 | Is the 300 kg total powder loss or spillage on top? | material yield |
| 5 | Is start-up synchronisation production time or set-up? | Availability |
| 6 | Log stoppages per machine or per line? | maintenance analytics |
| 7 | Confirm RNTIC = Dammam, NDPF = Jeddah | front-page map |

**3 · What the line data says** — availability is the entire problem (251 min lost), two start-up stoppages are 62 % of it, and one fault recurs three times. Quality is not an issue at 98.3 %.

**4 · Agree the follow-ups** — G-01 as an announced change, material-yield KPI on the production dashboard, per-machine stoppage logging, and streaming the line meters so the energy ratio populates.

---

## F. Files

**New**
```
docs/WO-2026-0007/
  00-CLIENT-REQUEST-CHECKLIST-AND-PLAN.md      this file
  01-MANUAL-VS-SYSTEM-GAP-REPORT.md            11 findings + questions
  WO-2026-0007-Manual-KPI-Calculation.xlsx     9 sheets, 141 verified formulas

apps/api/prisma/
  seed-wo-2026-0007.ts                         the work order
  seed-bb-cycle-times.ts                       measured rates
  seed-factory-coordinates.ts                  the 5 locations
  verify-wo-2026-0007.ts                       manual vs system gap table
  migrations/20260730000000_energy_wo_machine_kpi/migration.sql

apps/api/src/modules/energy/
  energy-wo-machine.service.ts                 the energy ratio KPI
```

**Modified**
```
apps/api/prisma/schema.prisma                  + EnergyWOMachineKpi, cycleTimeSeconds → Float
apps/api/prisma/seed-ncc-master.ts             coordinates
apps/api/prisma/seed.ts                        coordinates
apps/api/package.json                          4 new scripts
apps/api/src/modules/energy/energy.controller.ts   4 endpoints
apps/api/src/modules/energy/energy.module.ts       wiring
apps/web/src/features/energy/energy-overview.tsx   per-machine ratio panel
apps/web/src/locales/{en,ar}/modules.json          7 keys each
```

**Verified:** API + web typecheck clean · Prisma schema valid · all 141 workbook formulas evaluated · full pipeline executed against the live database · energy KPI arithmetic 17/17 · 4 endpoints returning 200.
**Open:** `WO-2026-0006` is absent from this environment, so the client-requested comparison against it could not be run here.
