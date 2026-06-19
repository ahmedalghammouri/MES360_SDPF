# MES360° — Design: 7 Enhancement Architecture (v1.0, 2026-06-11)

Senior technical design for the 7 requested enhancements. All references are to the
**actual current codebase** (Prisma schema, NestJS modules, Next.js views) — not generic ERP advice.

---

## 1. Intelligent Workcenter Allocation & Routing

### Current state
- `RoutingStep` has a single optional `machineId` + `workCenterId` (schema.prisma:2357).
- `production.service.resolveStepMachine()` (line 585) falls back to **name-matching heuristics**
  between WorkCenter names and Machine names — fragile, no concept of alternatives or availability.

### Data model changes
```prisma
model RoutingStepMachineOption {
  id            String   @id @default(uuid())
  stepId        String
  machineId     String
  priority      Int      @default(1)   // 0 = primary/default, 1+ = alternatives in preference order
  isDefault     Boolean  @default(false)
  cycleTimeSec  Float?               // override: alternative machine may run slower/faster
  setupTimeMins Float?               // changeover penalty when switching to this machine
  isActive      Boolean  @default(true)

  step    RoutingStep @relation(fields: [stepId], references: [id], onDelete: Cascade)
  machine Machine     @relation(fields: [machineId], references: [id])

  @@unique([stepId, machineId])
  @@map("routing_step_machine_options")
}
```
- Keep `RoutingStep.machineId` as the **denormalized primary** (backward compatible — every existing
  step keeps working). On save, the form writes the primary into both `machineId` AND an
  `isDefault: true` option row. A migration backfills option rows from existing `machineId`s.
- `JobOrder` gains `assignedMachineOptionId String?` + `assignmentReason String?`
  (`"DEFAULT_IDLE" | "DEFAULT_BUSY_ALT_SELECTED" | "MANUAL"`) so the decision is auditable.

### Auto-assignment algorithm (in `generateJobOrders` / `autoGenerateWorkOrders`)
```
for each routing step:
  candidates = [default option] + alternatives ordered by priority
  for each candidate machine compute availabilityScore at plannedStart:
    busyUntil  = max(end of RUNNING/QUEUED JobOrders on machine,
                     end of overlapping PLANNED DowntimeEvent,
                     shift-calendar gap)                       // reuse APS busy-window logic
    waitMs     = max(0, busyUntil - plannedStart)
    runMs      = qtyOut × (option.cycleTimeSec ?? step.cycleTimeSec) × 1000
    setupMs    = (option.setupTimeMins ?? 0) × 60_000
    score      = waitMs + setupMs + runMs                      // earliest-finish wins
  if default.waitMs == 0 → assign default (reason DEFAULT_IDLE)
  else → assign min-score candidate (reason DEFAULT_BUSY_ALT_SELECTED, store busyUntil in reason data)
```
- The availability check **reuses the APS busy-window builder** in `aps.service.ts` (it already merges
  job windows + planned downtime + shift calendar) — extract it into a shared
  `MachineAvailabilityService` consumed by both APS and WO generation.
- New endpoints:
  - `GET /production/machines/availability?machineIds=&from=&to=` → busy windows + next-free time.
  - `POST /production/work-orders/:id/recommend-machines` → per-step candidate ranking (lets the UI
    show "M3 busy until 14:20 → recommended: M3-ALT (ready now)") before committing.
- `resolveStepMachine()` name-matching remains only as the **last** fallback when a step has neither
  machine nor options.

### UI
- Process form step card: "Primary workcenter" select (required for new steps) + "Alternative
  workcenters" multi-row list (machine + priority + optional cycle override).
- WO generation result panel shows the assignment reason chip per job order.

---

## 2. Step-Level Raw Material Allocation (close the gaps)

### Current state — already built
`RoutingStepMaterial` (schema.prisma:2396) with per-step editor in
`manufacturing-processes-view.tsx`; consumption written on WO completion.

### Enhancements
1. **BOM-coverage validation**: when a process is approved, compare the union of all step materials
   against the SKU's active `BOMHeader.items`. Warn (not block) on: BOM item not allocated to any
   step / step material not in BOM / total qty mismatch beyond tolerance.
   `GET /inventory/processes/:id/bom-coverage` → `{ covered[], missing[], extra[], qtyDeltas[] }`.
2. **One-click allocation tool**: `POST /inventory/processes/:id/allocate-from-bom` — distributes BOM
   items to steps by material category heuristic (RAW→first step, PACKAGING film→filling,
   CARTON→cartoning, PALLET/STRETCH→palletizing/wrapping), user adjusts after.
3. Make `rawMaterialId` strongly preferred: the step-material row keeps free-text only as escape
   hatch; rows with `rawMaterialId == null` get an "unlinked" warning chip (they cannot FIFO-link lots).

---

## 3. Unified Unit of Measure (UoM) Module

### Current state
Unit handling is **scattered strings**: `RawMaterial.unit` (default "KG"), `BOMItem.unit`,
`RoutingStepMaterial.unit`, `MaterialLot.unit`, plus the packaging master `BaseUnit`
(PCS/INNER/CARTON/PALLET) used by routing-step in/out units. No conversion table, no validation.

### Design — new canonical model (keep `BaseUnit` for packaging labels)
```prisma
enum UomCategory { WEIGHT VOLUME COUNT PACKAGING LENGTH AREA TIME }

model UnitOfMeasure {
  id               String      @id @default(uuid())
  factoryId        String
  code             String      // KG, G, TON, L, ML, PCS, INNER, CARTON, PALLET, ROLL, M
  name             String
  nameAr           String?
  category         UomCategory
  baseUnitCode     String?     // canonical unit of the category (KG for WEIGHT, L for VOLUME, PCS for COUNT)
  conversionFactor Float       @default(1)  // 1 of this unit = factor × baseUnitCode (G = 0.001 KG)
  decimals         Int         @default(3)
  isActive         Boolean     @default(true)

  @@unique([factoryId, code])
  @@map("units_of_measure")
}
```
- **Conversion service** `UomService.convert(qty, fromCode, toCode)`:
  - same category → `qty × from.factor / to.factor`;
  - `PACKAGING` category → delegates to the existing SKU ladder (`convertUnits`, requires SKU ctx);
  - cross-category → error (caught at form level).
- **Adoption pattern** (same as the product master-data FKs): add nullable `unitId` FKs to
  `RawMaterial`, `BOMItem`, `RoutingStepMaterial`, `MaterialLot` while keeping legacy string columns;
  `syncLegacyUnitTexts()` keeps strings mirrored; seed backfills FKs by matching codes.
- Managed via the existing **MasterDataSelect / MasterDataManager** component (`master-data-select.tsx`)
  — add `unit` as a 6th managed master type in `getProductMasterData`-style endpoints
  (`GET/POST/PATCH/DELETE /inventory/master-data/units`).
- Seed: KG, G, TON (WEIGHT) · L, ML (VOLUME) · PCS, EA (COUNT) · INNER, CARTON, PALLET (PACKAGING)
  · ROLL, M (LENGTH) — matching the NCC Prerequisites file usage.

---

## 4. Material & Lot Traceability Logic (rebuild)

### Current state + weaknesses
`recordTraceability()` FIFO-picks the **single oldest ACTIVE lot by materialCode** per consumption.
Gaps: ① lot `remainingQty` is **never decremented**; ② no multi-lot split when the oldest lot is
insufficient; ③ no expiry awareness; ④ no reservation at release; ⑤ `MaterialLot.rawMaterialId`
optional → joins rely on string codes; ⑥ no `GenealogyLink` row written lot→batch.

### Robust consumption engine (replaces the single-lot pick inside `recordTraceability`)
```
consumeFifo(factoryId, rawMaterial, requiredQty, unit, woId, batchId, tx):
  lots = MaterialLot.findMany({
    rawMaterialId,                       // FK first; fallback materialCode for legacy lots
    status: ACTIVE,
    remainingQty > 0,
    OR: [expiryDate: null, expiryDate >= today],   // FEFO-safe: never consume expired
    orderBy: [expiryDate asc nulls last, receivedAt asc],   // FEFO → FIFO tiebreak
  })
  remaining = convert(requiredQty, unit, lot.unit)          // via UomService (#3)
  for lot of lots while remaining > 0:
    take = min(lot.remainingQty, remaining)
    MaterialConsumption.create({ materialLotId: lot.id, quantityActual: take, ... })  // one row PER lot slice
    lot.remainingQty -= take; if 0 → status DEPLETED
    GenealogyLink.create({ parentType: MATERIAL_LOT, parentId: lot.id,
                           childType: BATCH, childId: batchId, linkType: CONSUMED_INTO })
    StockMovement.create({ type: CONSUMPTION, ref: woId, qty: -take })   // ledger entry
    remaining -= take
  if remaining > 0 → create UNLOTTED consumption row (materialLotId null) + SHORTAGE TraceEvent
```
- All inside the completion transaction; still wrapped so completion never fails on trace errors,
  but shortage is surfaced as a `TraceEvent(eventType: 'LOT_SHORTAGE')` for the Trace Log.
- **Reservation at WO release**: `releaseWorkOrder` sums step-material demand
  (`qtyPerOutputUnit × plannedQtyOut` per step) and bumps `RawMaterial.reservedStock` (field exists,
  line 2080); completion/cancellation releases it. CTP/MRP already read this.
- **Backfill migration**: link `MaterialLot.rawMaterialId` by `materialCode` join; flag unmatched.
- Result: backward trace = Batch → consumptions → lot slices → supplier lot/CoA; forward trace =
  Lot → consumptions → batches → (future shipments) — both via existing GenealogyLink explorer.

---

## 5. UI/UX — Routing Steps Dynamic Fields & Auto-Fetch Unit

In `manufacturing-processes-view.tsx` step material rows:
1. **Auto-fetch unit**: selecting a raw material sets `row.unit = material.unit` (post-#3:
   `material.unitId` → UoM code) and renders the Unit cell as a **read-only badge** with a lock icon.
   Free-text material rows keep the editable unit select. Changing the material re-fetches.
2. **Dynamic parameters**: `RoutingStep.parameters Json` (exists, line 2373) gets a key/value chip
   editor ("+ Add parameter" → name, value, unit) rendered per step card; values surface later on the
   operator's JO screen.
3. Searchable comboboxes (type-ahead filter) for machine/material selects — current 200-row plain
   `<select>` does not scale.
4. Same auto-fetch pattern applied to the **BOM dialog** (screenshot: Create Bill of Materials):
   material pick → unit auto-fills read-only.

---

## 6. Manufacturing Process Diagram View

Current view = vertical card list with dashed connectors; dependencies/parallelism are not visually
distinguishable (screenshot shows SS-parallel steps stacked as if serial).

### Design — custom SVG flow diagram (no new dependency; reuse FactoryGantt arrow primitives)
- **Layered DAG layout**: topological layering by StepDependency — steps with an SS relation (or no
  path between them) share a **column**; FS chains advance columns. Parallel steps render side by side.
- **Edges**: elbow connectors color-coded by DependencyType (same palette as FactoryGantt:
  FS blue / SS green / SF amber / FF orange) with the type label on the edge.
- **Node card**: step number, operation, machine/workcenter (+ "2 alternatives" chip from #1),
  cycle (`31s / INNER`), **unit-flow badge** on each edge (`600 PCS → 100 INNER` computed by
  `convertUnits` for a sample qty selector at top), materials count chip (`🧪 3 inputs`, expandable).
- **Material side-nodes** (toggle): step inputs drawn as small left-attached nodes — turning the
  diagram into a process+BOM genealogy preview.
- Toolbar: sample-qty input (default SKU MOQ), zoom, orientation H/V, export PNG.
- Alternative considered: `@xyflow/react` (MIT) — fine if pan/drag editing is wanted later, but the
  custom SVG keeps bundle small and visual language identical to the APS Gantt. **Recommend custom.**

---

## 7. PLM & BOM Re-architecture (Smart Linking)

### Current state
`BOMHeader`/`BOMItem` (schema.prisma:2107) are a flat SKU→materials list, fully disconnected from
`ManufacturingProcess`/`RoutingStepMaterial` — two sources of truth that drift.

### Target: **process = source of truth, BOM = derived summary**
```prisma
model BOMHeader {
  // ... existing fields ...
  processId    String?               // smart link to the generating/source process
  sourceType   BomSource @default(MANUAL)   // MANUAL | DERIVED_FROM_PROCESS | DRAFT_FOR_PROCESS
  isStale      Boolean   @default(false)    // process materials changed after derivation
  process      ManufacturingProcess? @relation(...)
}
model BOMItem {
  // ... existing fields ...
  routingStepId String?              // which step consumes this line (genealogy of the summary)
}
```
### Flows
1. **Derive BOM from process** — `POST /inventory/bom/generate-from-process`
   `{ skuId, processId? }`: resolve process via the existing scope-priority chain
   (PRODUCT → PRODUCT_LIST → CATEGORY → BASE_WEIGHT); roll up every `RoutingStepMaterial` to
   **per-1-finished-base-unit**: `quantityPer = qtyPerOutputUnit × convertUnits(1 FG-unit → step.outUnit)`
   (e.g. RM-CARTON 1/CARTON → 1/6 per PCS-equivalent… expressed per SKU base unit), group by
   material, keep `routingStepId` on each line. Header gets `sourceType: DERIVED_FROM_PROCESS`.
2. **Guided "Create BOM" wizard** (replaces the flat dialog in the screenshot):
   - Step 1 — pick SKU → system runs scope resolution and shows: *"Found '2 Kg Standard Process'
     (Weight scope) — derive BOM from it?"* → one click = flow 1.
   - Step 2 (no process found) — user enters material rows (with #5 unit auto-fetch), assigns each
     row a step from a **process template** (Filling/Weighing/Cartoning/Palletizing/Wrapping cloned
     from the matching BASE_WEIGHT process), then `POST /inventory/bom/:id/generate-process` creates
     a **DRAFT ManufacturingProcess** with steps + `RoutingStepMaterial`s from the BOM lines and
     back-links it (`sourceType: DRAFT_FOR_PROCESS`).
3. **Staleness sync**: any mutation of `RoutingStepMaterial` (create/update/delete in
   `inventory.service.createProcess/updateProcess`) sets `isStale: true` on linked derived BOMs and
   raises a PLM `ChangeRequest(type: BOM_CHANGE)` (enum already exists, schema.prisma:391) so the
   change flows through the existing ECR workflow (`plm.service` ALLOWED_TRANSITIONS). The BOM view
   shows a "Stale — re-derive" banner with a one-click regenerate.
4. **PLM view**: BOM detail gains a "Process" tab rendering the #6 diagram read-only with the BOM
   lines highlighted on their steps — BOM literally *is* the summary of the process.

---

## Implementation order & risk

| Phase | Items | Why first |
|-------|-------|-----------|
| 1 | #3 UoM module + #5 auto-fetch | Foundation; #4 and #7 conversions depend on it |
| 2 | #4 lot engine + reservation | Highest correctness value; isolated in `recordTraceability` |
| 3 | #1 machine options + auto-assign | Needs shared availability service extracted from APS |
| 4 | #7 BOM↔process smart link + wizard | Depends on #3 (unit rollup) and #2 (coverage) |
| 5 | #2 coverage tools + #6 diagram | UX polish layers on the above |

Migration safety: every schema change is additive (nullable FKs + join tables); legacy string
columns retained and mirrored — same proven pattern as the product master-data rollout. Container
boot runs `db push` + idempotent seed, so all backfills must live in seed/upsert logic, not one-off
SQL (see project_docker_ops gotcha #3).
