# WO-2026-0007 — Manual vs System KPI Gap Report

**Data:** BETTI Production Line · SDPF · 28-07-2026 · Alwatani Violet HF 6 × 2 Kg (SKU 10310064)
**Sources:** the client's two workbooks in `docs/recived from client/`
**Manual baseline:** [`WO-2026-0007-Manual-KPI-Calculation.xlsx`](./WO-2026-0007-Manual-KPI-Calculation.xlsx) — every KPI cell is a live formula; all 141 were evaluated and cross-checked against an independent calculation.
**Status:** run against the live system on 31-07-2026 — **10 KPIs match, 8 gaps, all 8 from a single root cause.** See section 3.

---

## 1. The manual baseline

The client's log gives one stoppage stream for the whole line (every row names "Big Betti", the total is labelled "Betti Production Line"). That is correct for a packing line with no buffers — a stop anywhere halts filling, cartoning, palletising and wrapping together — so the KPIs are calculated at line level, in outer cartons (the SKU base unit).

| | |
|---|---|
| Production window 08:00 → 16:30 | **510 min** |
| Planned stop (lunch break) | **30 min** |
| Planned Production Time (ISO 22400) | **480 min** |
| Unplanned downtime (13 events) | **251 min** |
| Run time | **229 min** |
| Good / scrap | **1 120 / 19 cartons** |

**Headline (ISO 22400, ideal cycle = the client's own best demonstrated Cartomac rate of 9 ctn/min):**

```
Availability = 229 / 480                      = 47.7 %
Performance  = (0.1111 × 1139) / 229          = 55.3 %
Quality      = 1120 / 1139                    = 98.3 %
OEE          = 0.477 × 0.553 × 0.983          = 25.9 %
```

Sensitivity to the ideal-cycle assumption is carried in the workbook (scenarios A–F): OEE lands between **25.9 %** and **43.1 %** depending purely on which rate is treated as "ideal". That makes the cycle-time question (**G-02**) the biggest lever on the *absolute* number — which is why it needs an explicit client decision.

The biggest lever on the *gap between manual and system*, however, turned out to be **G-01**. Measurement (section 3) showed it is the root cause of all 8 divergences; everything independent of it matches exactly.

---

## 2. Gaps found

Ranked by impact on the numbers the client will see on Sunday.

### G-01 · Planned stops are not removed from Planned Production Time — **HIGH — CONFIRMED, and it is the only real defect**

`kpi.service.ts` → `woChild()` (and `joPpt()` for routed orders) sets PPT to the raw `actualStart → actualEnd` span. It never subtracts planned stops. The lunch break therefore sits **inside** PPT *and* inside run time — it is counted as productive.

| | Manual (ISO) | System | Gap |
|---|---|---|---|
| PPT | 480 min | 510 min | +30 |
| Run time | 229 min | 259 min | +30 |
| Availability | 47.7 % | 50.8 % | **+3.1 pp** |

This contradicts the platform's own specification — `docs/OEE-KPI-EQUATIONS-AND-APIS.md` §2.1 states *"PPT excludes planned stops"*. The data is recorded correctly (`isPlanned = true`, `affectsOEE = false`); only the consumer ignores it.

**Measured on the live system, this is the root cause of all 8 gaps** — see section 3. Every KPI that does not depend on PPT matches to the last decimal.

**Not fixed here.** It changes the OEE of every historical work order in the database, so it should be a deliberate, announced change rather than a side effect of this delivery. The fix is to subtract planned-stop overlap from `ppt` in `woChild()`/`joPpt()` — and, since AT-OEE reuses the Performance term, it inherits the distortion and should be corrected in the same change. **Recommend deciding this with the client on Sunday** — the workbook shows both numbers side by side (scenarios A and E) so the conversation can be had with the arithmetic visible.

### G-02 · Machine cycle times are wrong by up to 26× — **HIGH — fix shipped**

`MachineCycleTime` was seeded from estimates that bear no relation to how the line actually runs:

| Machine | Seeded | Measured (client, 28-07) | Factor |
|---|---|---|---|
| M1 Big Betti | 31 s / inner | **1.20 s / inner** | 25.8× |
| M3 Cartomac | 25 s / carton | **6.67 s / carton** | 3.75× |
| M4 Euro-Pack | 290 s / pallet | **214 s / pallet** | 1.36× |
| M5 Uni-tech | 145 s / pallet | **107 s / pallet** | 1.36× |

Performance = (ideal × count) / runTime. With a denominator that slow the ratio exceeds 1, hits the `clampPct` ceiling in `oee.service.calculateDetailed()`, and reports **100 %** — so OEE silently collapses to A × Q and the entire speed loss becomes invisible. On this order the real Performance is 55 %; the system would have shown 100 %.

This is almost certainly why the client sent the rate file. **Fixed:** `seed-bb-cycle-times.ts` loads the measured rates with `source = 'MEASURED'`.

**Confirmed worse than expected on the live database:** `machine_cycle_times` held **zero rows** — there was no ideal cycle time for any machine at all, not merely a wrong one. The five measured rates are now loaded and stored with their decimals intact (`1.2`, `6.67`).

**The clamp risk was real.** With the fix in place Performance reported 48.9 % and did not clamp. Had the old 25 s/carton rate been used, the ideal run would have been 474.6 min against 259 run minutes → 183 % → clamped to 100 % → **OEE 49.9 %, nearly double the true 25.9 %.**

> ⚠ Job orders stamp `idealCycleTimeSec` at creation. Orders created *before* that script runs keep the old denominator until their KPIs are recomputed.

### G-03 · Cycle time could not represent sub-second rates — **HIGH — fixed**

`MachineCycleTime.cycleTimeSeconds` was an `Int`. Big Betti's measured 1.20 s/pack would have been stored as `1` — a 20 % error straight into the Performance denominator, defeating the G-02 fix. Widened to `Float` (migration `20260730000000_energy_wo_machine_kpi`). Widening `INTEGER → DOUBLE PRECISION` preserves every existing value; `JobOrder.idealCycleTimeSec` was already `Float`, so this aligns the two.

### G-04 · The pallet count does not reconcile — **HIGH — client answer needed**

1 120 cartons ÷ 32 per pallet = **35 pallets**. The log records **28**. The numbers only reconcile at 40 cartons/pallet, but three independent sources say 32:

- `BB Item (3).xlsx` — "Pallet" column = 32
- the BOM — pallet qty 0.03126154 per carton → 1 ÷ 0.03126154 = **32.0**
- the client's own rate file header — *"32 Cartons per Pallet"*

So 28 is the outlier — most likely 7 pallets were left part-built at shift end. The seeder records both figures in a `MaterialConsumption` row (planned 35.0 vs actual 28.0) so the discrepancy is visible in the data rather than hidden. **Carton- and inner-level KPIs are unaffected;** only pallet output and the M4/M5 machine views are.

### G-05 · Two seeds disagree about cartons per pallet — **HIGH**

`seed-ncc-master.ts` hard-codes `cartonsPerPallet: 50` for every SKU. `seed-bb-master.ts` reads the real value (32) from the client's file. Whichever ran last wins. **Checked on the live database: SKU 10310064 correctly holds 32**, so `seed-bb-master` ran last here and this is currently latent rather than active. **Not changed here** — the correct fix is to run `prisma:seed:bb` after the master seed so the file value wins, which is already the documented order. Flagging it because it silently changes pallet maths.

### G-06 · Powder waste has nowhere to go in OEE — **MEDIUM**

300 kg of powder was lost. OEE Quality is unit-based (good ÷ total units) and correctly does **not** absorb it — folding a material loss into a unit-count ratio would be wrong. But it means a real 2.2 % material loss is invisible on every OEE screen.

**Handled:** the seeder writes it as a `MaterialConsumption` planned-vs-actual variance (13 440 kg planned, 13 740 kg actual), and the workbook derives **material yield = 97.82 %** from it. Promoting that to a first-class KPI on the production dashboard is a small, self-contained follow-up.

The client's three waste figures also cannot all be independent — 19 scrapped cartons carry 228 kg of powder and 86 scrapped inner packs carry 172 kg, which already exceeds 300 kg. **Needs their answer:** is the 300 kg the total powder loss, or spillage on top of the scrapped units?

### G-07 · Every stoppage is attributed to Big Betti — **MEDIUM — client decision**

All 14 rows name M1, yet three descriptions point elsewhere ("No Pallet at Euro-Pack Robot" → M4; "Packaging defected – Dulpex" → the inner-carton feed; the glue events could be M1 or M3).

Line OEE is correct either way. **Per-machine Pareto, MTBF and maintenance attribution are not** — every minute currently lands on M1, which will distort reliability analysis as soon as there is enough history to matter. MES360 supports per-machine logging today; it is a data-entry convention question, not a system limitation.

### G-08 · Micro-stops are booked as availability loss — **LOW**

5 of the 13 unplanned stops are under 5 minutes (19 min total). ISO 22400 classes sub-5-minute interruptions as a **performance** loss, not an availability loss. Reclassifying would move Availability to 50.0 % and lower Performance correspondingly — OEE barely changes, it only shifts which bucket carries the blame.

Left as the client logged them (`UNPLANNED_BREAKDOWN`) so the comparison stays honest. Note that MES360 already has a `MICRO_STOP` reason code, and `production.service.ts` splits it into a separate loss bucket — so switching later is a data change, not a code change.

### G-09 · No energy ratio per machine existed — **built**

The client asked for an energy KPI "linked to both the production machine and the corresponding Work Order". `EnergyWOSummary` is keyed on the work order **alone**, so it could say what an order cost in kWh but never which machine spent it.

**Added** `EnergyWOMachineKpi` (unique on `workOrderId × machineId`), computed from `EnergyReading` — which already carries both foreign keys, stamped at ingestion by `EnergyContextService`. `EnergyWOSummary` and its algorithm are untouched.

Exposed as **kWh/unit** (the headline ratio), plus kWh/kg, kWh/run-hour, a productive-only ratio, the idle/downtime waste share, and variance against the best ratio that machine has previously achieved on the same product.

**Verified on the live system:** all four endpoints return HTTP 200 with the correct payload shape, and the computation was validated by a self-cleaning integration test — **17/17 checks passed**, covering meter-delta integration, per-state attribution, kWh/unit, kWh/kg, kWh/run-hour, waste %, and the line roll-up. The test created a throwaway work order with synthetic readings and deleted everything afterwards; no fabricated energy data was left on the client's order.

> **This reads empty for WO-2026-0007, correctly.** The client's log is manual and carries no meter readings, so no `EnergyReading` rows are tagged to it. The database does hold 11 492 readings, but the 2 492 that carry a `workOrderId` point at an order that no longer exists. The KPI populates as soon as the line meters stream against a live work order.

**State attribution convention:** an interval is attributed to the machine state read at its **start** (zero-order hold) — a state sample describes the machine from that moment until the next sample says otherwise. This matches `EnergyContextService`, keeping the new table consistent with `EnergyWOSummary`.

### G-10 · `EnergyWOSummary` is never computed automatically — **MEDIUM — pre-existing**

Found while wiring the new KPI. `EnergyContextService.computeWOEnergySummary()` listens for the event **`workorder.completed`**, but `production.service.completeWorkOrder()` emits **`production.work-order.completed`**. No emitter uses the shorter name anywhere in the codebase, so the listener has never fired — meaning `EnergyWOSummary` only ever populates if something calls it directly.

That is why the existing "Work Order Energy Analysis" panel tends to show no data even when readings exist.

**Not fixed here** — it is outside this request and changing it will start writing rows on every WO completion, which should be a deliberate change. The new `EnergyWoMachineService` listens for the **correct** event name, so the new KPI does recompute automatically. One-line fix when you want it: change the string in `energy-context.service.ts:129` and read the id from `payload.workOrder.id`.

### G-11 · Two facilities were in the wrong region — **MEDIUM — please confirm**

The client's Google Maps links resolve RNTIC to **Dammam** and NDPF to **Jeddah** — the opposite of the seeded data. The Jeddah pin reads "المصنع الوطني لصابون البودرة" (National Powder Soap Factory), which matches NDPF's name, so the seeded pair looks to have been transposed and these links correct it.

| Site | New coordinate | Moved | City |
|---|---|---|---|
| SDPF | 25.9267784, 49.9469883 | ~42 km | Dammam |
| SIDCO | 26.2539087, 49.9876848 | ~3 km | Dammam |
| SAF | 25.9265816, 49.9448726 | ~36 km | Dammam |
| RNTIC | 26.2524912, 49.9857344 | ~530 km | Jeddah → **Dammam** |
| NDPF | 21.4112773, 39.2425602 | ~530 km | Dammam → **Jeddah** |

**Applied to the live database:** 5/5 updated, no NULL coordinates remain, so every pin renders. RNTIC and NDPF each moved ~1 220 km. Worth a verbal confirmation before the review, since it is a visible change on the front page.

### G-12 · Pre-existing open items that touch this comparison — **INFO**

Already tracked in `docs/OEE-KPI-EQUATIONS-AND-APIS.md` §4; listed so nothing looks like a new surprise on Sunday:

- **#1 / #2** — per-JO `calcJobOrderOEE` uses a different availability denominator than the KPI engine, and falls back to Quality-only when inputs are missing. The same WO can show two different OEEs on two pages.
- **#6** — dashboard throughput reads a stale `MachineCurrentStatus` snapshot instead of recomputing over the window.
- **#4** — FPY averaged per-WO on the client instead of ΣGood/ΣTotal.

---

## 3. Measured results — run against the live system on 31-07-2026

Everything below was **executed**, not predicted. The stack (`*-plocal`) was up, the database backed up first (32 MB dump), and all four scripts run in order.

### The comparison

| KPI | Manual | MES360 | Gap | |
|---|---|---|---|---|
| Scheduled window | 510 min | 510 | 0 | ✅ |
| Planned stop minutes | 30 min | 30 | 0 | ✅ |
| Unplanned downtime | 251 min | 251 | 0 | ✅ |
| **Planned Production Time** | 480 min | **510** | **+30** | ❌ |
| Run time | 229 min | 259 | +30 | ❌ |
| **Availability** | 47.71 % | **50.8** | **+3.09** | ❌ |
| **Performance** | 55.26 % | **48.9** | **−6.36** | ❌ |
| Quality | 98.33 % | 98.3 | −0.03 | ✅ |
| **OEE (schedule)** | 25.93 % | **24.4** | **−1.53** | ❌ |
| OEE (time-based) | 27.6 % | 24.4 | −3.2 | ❌ |
| First-Pass Yield | 98.33 % | 98.33 | 0 | ✅ |
| Scrap rate | 1.67 % | 1.67 | 0 | ✅ |
| Good quantity | 1 120 ctn | 1 120 | 0 | ✅ |
| Scrap quantity | 19 ctn | 19 | 0 | ✅ |
| Throughput while running | 293 ctn/h | 259.46 | −33.5 | ❌ |
| MTBF | 17.6 min | 19.92 | +2.32 | ❌ |
| MTTR | 19.3 min | 19.31 | +0.01 | ✅ |
| Material yield (powder) | 97.82 % | 97.82 | 0 | ✅ |
| Energy ratio | — | — | — | no meter data |

**10 match · 8 gaps.**

### The single most important result

**Every one of the 8 gaps traces to one root cause — G-01.** Nothing else is wrong.

```
PPT 510 instead of 480   (planned break not subtracted)
   → run time    259 instead of 229
   → Availability  50.8 %  instead of 47.71 %   (259/510 vs 229/480)
   → Performance   48.9 %  instead of 55.26 %   (same 126.6 ideal min ÷ a bigger run time)
   → OEE           24.4 %  instead of 25.93 %
   → AT-OEE        24.4 %  instead of 27.60 %   (inherits P)
   → Throughput  259.5     instead of 293       (1120 ÷ 259 vs ÷ 229)
   → MTBF         19.92    instead of 17.62     (259/13 vs 229/13)
```

Everything that does **not** depend on PPT — quantities, quality, FPY, scrap, MTTR, material yield — matches to the last decimal. That is a strong result: the data model, the downtime classification, the material-variance handling and the roll-up are all correct. There is exactly **one** defect, it is a single expression in `woChild()`, and it explains the entire divergence.

Two refinements this measurement revealed that reading the code alone did not:

- **AT-OEE is not plan-independent after all.** Its availability term (50.8 %) is correct by design, but it reuses the Performance term, so it inherits the G-01 distortion. Worth fixing alongside G-01.
- **Performance did not clamp.** G-02 predicted a 100 % clamp; it did not happen, because the seeder stamps the *measured* 6.67 s/carton onto the work order. Had the old rate been in play, the ideal run would have been 474.6 min against 259 run minutes → 183 % → clamped to 100 % → **OEE would have read 49.9 %, nearly double the true 25.9 %.** The fix worked; the clamp risk was real.

### What was confirmed working

| Check | Result |
|---|---|
| Migration (new table + `Float` widening) | ✅ Applied — table structure matches the SQL exactly |
| Sub-second cycle times survive the round trip | ✅ `1.2` and `6.67` stored, not `1` and `7` |
| Coordinates | ✅ 5/5 updated, no NULL pins remain |
| WO-2026-0007 load | ✅ 14 downtime events (281 min), 4 consumption rows, 2 new causes |
| Stored WO columns vs recomputed | ✅ All 5 agree (oee, A, P, Q, downtimeMinutes) |
| Downtime Pareto | ✅ MECHANICAL 187 / CHANGEOVER 50 / MATERIAL 14, planned 30 excluded |
| 4 new energy endpoints | ✅ All HTTP 200 with correct payload shapes |
| Energy ratio arithmetic | ✅ **17/17** on a self-cleaning integration test (deltas, state attribution, kWh/unit, kWh/kg, waste %, run hours, line roll-up) |

### ⚠️ WO-2026-0006 does not exist in this database

The client asked to *"compare the results against WO-2026-0006"*. **That order is not present** — this database contains only `WO-2026-0001` (IN_PROGRESS, 0 qty) and now `WO-2026-0007`.

`machine_cycle_times` was also **completely empty** before this delivery (0 rows), so G-02 was worse than a wrong value — there was no ideal cycle time at all.

This most likely means the client is running a **different environment** from this `-plocal` stack. Before the meeting, either point these scripts at the environment holding WO-2026-0006, or ask the client which system they mean. The comparison tooling is ready either way:

```bash
docker exec mes-api-plocal npx ts-node --transpile-only prisma/verify-wo-2026-0007.ts --wo WO-2026-0006
```

### Reproducing

```bash
docker exec mes-postgres-plocal pg_dump -U mes_user -d mes360 > backup.sql   # first

docker exec -w /app mes-api-plocal npx ts-node --transpile-only prisma/seed-factory-coordinates.ts
docker exec -w /app mes-api-plocal npx ts-node --transpile-only prisma/seed-bb-cycle-times.ts
docker exec -w /app mes-api-plocal npx ts-node --transpile-only prisma/seed-wo-2026-0007.ts
docker exec -w /app mes-api-plocal npx ts-node --transpile-only prisma/verify-wo-2026-0007.ts
```

All idempotent. Only the coordinates script writes to pre-existing rows, and only `lat`/`lng`/`city`/`address`.

> This stack was built with `prisma db push`, not migrations, so `_prisma_migrations` is empty and `migrate deploy` returns **P3005**. The schema changes were already live because the image had been rebuilt from the updated `schema.prisma`. On a migration-managed environment, `npx prisma migrate deploy` applies `20260730000000_energy_wo_machine_kpi` normally.

---

## 4. Questions for the client

Ordered by how much they change the numbers.

1. **Pallets** — is the Violet 6×2 Kg pattern 32 or 40 cartons? If 32, were 7 pallets left part-built at shift end? *(G-04)*
2. **Cycle times** — confirm the measured rates are what should drive OEE Performance. This moves OEE from 43 % to 26 %, so it must be an explicit decision. *(G-02)*
3. **Planned stops** — should the lunch break be excluded from Planned Production Time per ISO 22400? Recommended yes; it changes every historical order. *(G-01)*
4. **Powder waste** — is the 300 kg the total loss, or spillage on top of the scrapped units? *(G-06)*
5. **Start-up** — stop #1 runs 105 min from exactly 08:00, and with stop #2 the line lost 155 of its first 160 minutes. Is synchronisation production time, or planned set-up excluded from PPT like a changeover?
6. **Stoppage attribution** — log against the machine that failed, or against the line? Per-machine is far more useful for maintenance. *(G-07)*
7. **Facility locations** — confirm RNTIC is in Dammam and NDPF in Jeddah. *(G-11)*

---

## 5. What the data says about the line

Independent of any system question, the client's own numbers point somewhere specific:

- **Availability is the whole problem.** 251 unplanned minutes against 480 of planned production. Performance and quality losses together are worth less than half of it.
- **Two stoppages are 62 % of all downtime.** Machine synchronisation (105 min) and machine adjustments (50 min), both in the first 160 minutes of the shift. A start-up checklist is worth more than anything else on this list.
- **One fault recurs three times.** "Open Dulpex – Guide Adjustment" at 8 + 42 + 4 = 54 min. Recurrence, not duration, is what a corrective action should target.
- **Quality is not an issue.** 98.3 % at carton level, 98.7 % at pack level.
- **The line ran at 40 % of its planned rate** — 132 ctn/h delivered against the 325 ctn/h BOM target — and at 55 % of its demonstrated speed even while running.
