// ============================================================
// MES360° — WO-2026-0007 · BETTI LINE · 28-07-2026
// ------------------------------------------------------------
// Loads the production, stoppage and waste data the client recorded by hand on
// 28-07-2026 and sent for the PoC review, so the platform's KPI output can be
// compared against their manual calculation.
//
//   Source:  docs/recived from client/
//              BETTI Production Line  Stoppages and Waste Log  28072026.xlsx
//   Manual:  docs/WO-2026-0007/WO-2026-0007-Manual-KPI-Calculation.xlsx
//   Gaps:    docs/WO-2026-0007/01-MANUAL-VS-SYSTEM-GAP-REPORT.md
//
// WHY THIS WORK ORDER HAS NO JOB ORDERS
// -------------------------------------
// The client logged ONE stoppage stream for the whole line (every row names
// "Big Betti", the total is labelled "Betti Production Line") — which is correct
// for a packing line with no buffers: a stop anywhere halts filling, cartoning,
// palletising and wrapping together.
//
// `kpi.service.woChild()` takes two paths. With job orders it attributes downtime
// per machine (`joUnplanned` filters on `machineId`), so the 251 unplanned minutes
// would land on M1 alone and M3/M4/M5 would each show zero downtime — the roll-up
// would report 87.7% availability instead of the true 50.8%. Without job orders it
// uses the WO header window and sums ALL of the WO's downtime, which reproduces the
// client's manual line calculation exactly. So the line-level shape is the faithful
// one here. Per-machine output is preserved in `metadata` and in the material
// consumption rows below.
//
// Idempotent: safe to re-run. Everything is keyed off the WO's order number and is
// deleted-then-rebuilt, so no duplicate downtime events accumulate.
//
// Run:  docker exec mes-api npx ts-node prisma/seed-wo-2026-0007.ts
//       (or)  pnpm --filter @mes360/api prisma:seed:wo7
// ============================================================

import { PrismaClient, DowntimeCategory, DowntimeReasonCode } from '@prisma/client';

const prisma = new PrismaClient();

const FACTORY_CODE = 'SDPF';
const LINE_CODE = 'PL-01';
const SKU_ITEM = '10310064'; // Alwatani Powder Detergent — Violet HF — 6 × 2 Kg C
const WO_NUMBER = 'WO-2026-0007';
const PO_NUMBER = 'PO-SDPF-2026-0007';

// Riyadh is UTC+3 with no DST, so a fixed offset is exact.
const RIYADH_OFFSET_H = 3;
/** "HH:MM" on 2026-07-28 Asia/Riyadh → UTC Date. */
const at = (hhmm: string): Date => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 6, 28, h - RIYADH_OFFSET_H, m, 0, 0));
};
const minutesBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;

// ────────────────────────────────────────────────────────────
// The client's data, transcribed verbatim
// ────────────────────────────────────────────────────────────
const PRODUCTION_START = '08:00';
const PRODUCTION_END = '16:30';

/** Quantities produced, per the log's "Quantity produced" block. */
const OUTPUT = {
  innerCarton: 6720, // the 2 Kg consumer pack — recorded at Big Betti Filling
  outerCarton: 1120, // recorded at Cartomac  (6720 ÷ 6 = 1120 ✓)
  fgPallet: 28, //     recorded at Euro-Pack Robot + Uni-tech Wrapping
};

/** Waste block. Powder is a MATERIAL loss, not a unit reject — see below. */
const WASTE = {
  innerCarton: 86, // pieces, at Big Betti
  outerCarton: 19, // pieces, at Cartomac
  powderKg: 300, //   kg, at Big Betti
};

/**
 * The 14 logged stoppages. `clientCategory` is kept verbatim; `category` /
 * `causeCode` map it onto the platform's ISA-95 reason tree.
 *
 * Every row was logged against Big Betti (M1). `isPlanned` is true only for the
 * lunch break, which ISO 22400 removes from planned production time.
 */
const STOPPAGES: Array<{
  seq: number;
  start: string;
  end: string;
  clientCategory: string;
  description: string;
  category: DowntimeCategory;
  causeCode: string | null;
  isPlanned: boolean;
}> = [
  { seq: 1,  start: '08:00', end: '09:45', clientCategory: 'Mechanical',                  description: 'Machine Synchronization',                      category: DowntimeCategory.MECHANICAL,    causeCode: 'BB-19',    isPlanned: false },
  { seq: 2,  start: '09:50', end: '10:40', clientCategory: 'Startup',                     description: 'Machine Adjustments',                          category: DowntimeCategory.CHANGEOVER,    causeCode: 'SETUP-02', isPlanned: false },
  { seq: 3,  start: '11:20', end: '11:37', clientCategory: 'Mechanical',                  description: 'Glue Leakage',                                 category: DowntimeCategory.MECHANICAL,    causeCode: 'BB-04',    isPlanned: false },
  { seq: 4,  start: '11:40', end: '11:42', clientCategory: 'Mechanical',                  description: 'Glue Removal',                                 category: DowntimeCategory.MECHANICAL,    causeCode: 'BB-03',    isPlanned: false },
  { seq: 5,  start: '12:00', end: '12:30', clientCategory: 'Break',                       description: 'Lunch Break',                                  category: DowntimeCategory.PLANNED_BREAK, causeCode: 'PLN-01',   isPlanned: true  },
  { seq: 6,  start: '12:38', end: '12:42', clientCategory: 'Mechanical',                  description: 'Rollers Conveyor Cleaning',                    category: DowntimeCategory.MECHANICAL,    causeCode: 'BB-12',    isPlanned: false },
  { seq: 7,  start: '12:52', end: '12:57', clientCategory: 'Packaging Material Shortage', description: 'Packaging defected - Dulpex (Inner Carton)',   category: DowntimeCategory.MATERIAL,      causeCode: 'BB-18',    isPlanned: false },
  { seq: 8,  start: '13:00', end: '13:04', clientCategory: 'Powder Shortage',             description: 'No powder',                                    category: DowntimeCategory.MATERIAL,      causeCode: 'BB-16',    isPlanned: false },
  { seq: 9,  start: '13:18', end: '13:26', clientCategory: 'Mechanical',                  description: 'Open Dulpex - Guide Adjustment',               category: DowntimeCategory.MECHANICAL,    causeCode: 'BB-20',    isPlanned: false },
  { seq: 10, start: '13:38', end: '13:39', clientCategory: 'Packaging Material Shortage', description: 'No Pallet at Euro-Pack Robot',                 category: DowntimeCategory.MATERIAL,      causeCode: 'BB-18',    isPlanned: false },
  { seq: 11, start: '13:40', end: '13:45', clientCategory: 'Mechanical',                  description: 'Rollers Conveyor Cleaning',                    category: DowntimeCategory.MECHANICAL,    causeCode: 'BB-12',    isPlanned: false },
  { seq: 12, start: '14:10', end: '14:52', clientCategory: 'Mechanical',                  description: 'Open Dulpex - Guide Adjustment',               category: DowntimeCategory.MECHANICAL,    causeCode: 'BB-20',    isPlanned: false },
  { seq: 13, start: '14:58', end: '15:02', clientCategory: 'Powder Shortage',             description: 'No powder',                                    category: DowntimeCategory.MATERIAL,      causeCode: 'BB-16',    isPlanned: false },
  { seq: 14, start: '15:24', end: '15:28', clientCategory: 'Mechanical',                  description: 'Open Dulpex - Guide Adjustment',               category: DowntimeCategory.MECHANICAL,    causeCode: 'BB-20',    isPlanned: false },
];

/**
 * Two reasons the client logged have no node in the seeded tree. They are added
 * as level-3 causes under "Mechanical Faults" rather than being flattened into
 * free text, so the downtime Pareto groups the repeats correctly — "Open Dulpex –
 * Guide Adjustment" alone recurs three times for 54 minutes.
 */
const NEW_CAUSES = [
  { code: 'BB-19', name: 'Machine synchronization',      nameAr: 'مزامنة الماكينة' },
  { code: 'BB-20', name: 'Open duplex — guide adjustment', nameAr: 'ضبط موجه الدوبلكس المفتوح' },
];

// ────────────────────────────────────────────────────────────
// OEE — a faithful transcription of oee.service.calculateDetailed()
// so the seeded WO carries the same numbers the API will compute.
// verify-wo-2026-0007.ts re-runs the REAL service and cross-checks.
// ────────────────────────────────────────────────────────────
const round1 = (n: number) => Math.round(n * 10) / 10;
const clampPct = (n: number) => Math.min(100, Math.max(0, n));

function calculateDetailed(input: {
  plannedProductionTime: number;
  unplannedDowntime: number;
  idealCycleTime: number; // minutes per unit
  totalCount: number;
  goodCount: number;
}) {
  const ppt = Math.max(0, input.plannedProductionTime);
  const runTime = Math.max(0, ppt - Math.max(0, input.unplannedDowntime));
  const idealRunTime = Math.max(0, input.idealCycleTime * input.totalCount);
  const availability = ppt > 0 ? clampPct((runTime / ppt) * 100) : 0;
  const performance = runTime > 0 ? clampPct((idealRunTime / runTime) * 100) : 0;
  const quality = input.totalCount > 0 ? clampPct((input.goodCount / input.totalCount) * 100) : 0;
  return {
    oee: round1((availability / 100) * (performance / 100) * (quality / 100) * 100),
    availability: round1(availability),
    performance: round1(performance),
    quality: round1(quality),
    ppt,
    runTime,
    idealRunTime,
  };
}

// ────────────────────────────────────────────────────────────
async function main() {
  console.log('🌱 WO-2026-0007 — BETTI line, 28-07-2026 (client manual data)\n');

  // ── 1. Resolve master data (never created here) ──────────────────────
  const factory = await prisma.factory.findFirst({ where: { code: FACTORY_CODE } });
  if (!factory) throw new Error(`Factory "${FACTORY_CODE}" not found — run prisma:seed:master first.`);

  const line = await prisma.productionLine.findFirst({
    where: { factoryId: factory.id, code: LINE_CODE },
  });
  if (!line) throw new Error(`Production line "${LINE_CODE}" not found in ${FACTORY_CODE}.`);

  const sku = await prisma.sKU.findFirst({
    where: { factoryId: factory.id, itemNumber: SKU_ITEM },
  });
  if (!sku) {
    throw new Error(
      `SKU "${SKU_ITEM}" (Alwatani Violet HF 6×2 Kg) not found — run prisma:seed:bb first.`,
    );
  }

  const machines = await prisma.machine.findMany({
    where: { factoryId: factory.id, code: { in: ['M1', 'M2', 'M3', 'M4', 'M5'] } },
    select: { id: true, code: true, name: true },
  });
  const machineByCode = new Map(machines.map((m) => [m.code, m]));
  const bigBetti = machineByCode.get('M1');
  if (!bigBetti) throw new Error('Machine M1 (Big Betti) not found — run prisma:seed:master first.');

  console.log(`   factory ${factory.code} · line ${line.code} · sku ${sku.itemNumber} "${sku.name}"`);
  console.log(`   machines resolved: ${machines.map((m) => m.code).join(', ')}`);

  // ── 2. Add the two missing downtime causes (idempotent) ──────────────
  const mechParent = await prisma.downtimeCause.findFirst({
    where: { factoryId: factory.id, code: 'L2-MECH' },
    select: { id: true },
  });
  for (const c of NEW_CAUSES) {
    const existing = await prisma.downtimeCause.findFirst({
      where: { factoryId: factory.id, code: c.code },
    });
    if (existing) continue;
    await prisma.downtimeCause.create({
      data: {
        factoryId: factory.id,
        code: c.code,
        name: c.name,
        nameAr: c.nameAr,
        category: DowntimeCategory.MECHANICAL,
        level: 3,
        parentId: mechParent?.id ?? null,
        machineId: bigBetti.id,
        isPlanned: false,
        sortOrder: 30,
        isActive: true,
      },
    });
    console.log(`   + downtime cause ${c.code} — ${c.name}`);
  }

  const causes = await prisma.downtimeCause.findMany({
    where: { factoryId: factory.id },
    select: { id: true, code: true },
  });
  const causeIdByCode = new Map(causes.map((c) => [c.code, c.id]));

  // ── 3. Shift instance (day shift covering the run) ───────────────────
  const dayTemplate = await prisma.shiftTemplate.findFirst({
    where: { factoryId: factory.id, code: 'S1' },
  });
  let shiftInstanceId: string | null = null;
  if (dayTemplate) {
    const shiftDate = new Date(Date.UTC(2026, 6, 27, 21, 0, 0)); // 2026-07-28 00:00 Riyadh
    const existing = await prisma.shiftInstance.findFirst({
      where: { factoryId: factory.id, shiftTemplateId: dayTemplate.id, shiftDate, lineId: line.id },
    });
    const payload = {
      factoryId: factory.id,
      shiftTemplateId: dayTemplate.id,
      lineId: line.id,
      shiftDate,
      startTime: at('07:30'),
      endTime: at('19:30'),
      targetQty: dayTemplate.targetQtyPerShift ?? null,
      status: 'COMPLETED' as const,
      handoverNotes:
        'Manual PoC data entry — BETTI line, Alwatani Violet 6×2 Kg. Production ran 08:00–16:30.',
    };
    const row = existing
      ? await prisma.shiftInstance.update({ where: { id: existing.id }, data: payload })
      : await prisma.shiftInstance.create({ data: payload });
    shiftInstanceId = row.id;
    console.log(`   shift instance ${dayTemplate.code} on 2026-07-28 ready`);
  }

  // ── 4. Derived quantities ────────────────────────────────────────────
  const innersPerCarton = sku.innersPerCarton || 6;
  const cartonsPerPallet = sku.cartonsPerPallet || 32;

  const goodQty = OUTPUT.outerCarton; //  1120 cartons — the SKU base unit
  const scrapQty = WASTE.outerCarton; //    19 cartons
  const actualQty = goodQty + scrapQty; // 1139 cartons

  const windowStart = at(PRODUCTION_START);
  const windowEnd = at(PRODUCTION_END);
  const windowMin = minutesBetween(windowStart, windowEnd); // 510

  const plannedMin = STOPPAGES.filter((s) => s.isPlanned)
    .reduce((sum, s) => sum + minutesBetween(at(s.start), at(s.end)), 0); // 30
  const unplannedMin = STOPPAGES.filter((s) => !s.isPlanned)
    .reduce((sum, s) => sum + minutesBetween(at(s.start), at(s.end)), 0); // 251

  // Ideal cycle time = the client's best demonstrated Cartomac rate (9 ctn/min),
  // per their "Production Rate" test on the same day. Loaded machine-by-machine by
  // seed-bb-cycle-times.ts; stamped here so the WO is self-contained.
  const idealCycleSecPerCarton = 60 / 9; // 6.667 s
  const plannedQty = Math.round((windowMin - plannedMin) * (325 / 60)); // BOM target 325 ctn/h over PPT

  // `woChild()` for a WO with no job orders uses the full actualStart→actualEnd
  // span as PPT — it does NOT subtract planned stops. Mirrored here so the stored
  // fields match what the API recomputes. The ISO-22400 value (480) and the gap
  // this creates are documented in the gap report.
  const breakdown = calculateDetailed({
    plannedProductionTime: windowMin,
    unplannedDowntime: unplannedMin,
    idealCycleTime: idealCycleSecPerCarton / 60,
    totalCount: actualQty,
    goodCount: goodQty,
  });

  console.log(
    `\n   window ${windowMin} min · planned stop ${plannedMin} · unplanned ${unplannedMin} · run ${breakdown.runTime}`,
  );
  console.log(
    `   A ${breakdown.availability}%  P ${breakdown.performance}%  Q ${breakdown.quality}%  OEE ${breakdown.oee}%`,
  );

  // ── 5. Production order ──────────────────────────────────────────────
  const poPayload = {
    factoryId: factory.id,
    skuId: sku.id,
    targetQty: plannedQty,
    completedQty: goodQty,
    unit: 'CARTON',
    status: 'COMPLETED' as const,
    priority: 'HIGH' as const,
    plannedStart: windowStart,
    plannedEnd: windowEnd,
    actualStart: windowStart,
    actualEnd: windowEnd,
    oee: breakdown.oee,
    availability: breakdown.availability,
    performance: breakdown.performance,
    quality: breakdown.quality,
    notes:
      'PoC validation order — manually recorded BETTI line data for 28-07-2026, ' +
      'supplied by the client for comparison against WO-2026-0006.',
  };
  const po = await prisma.productionOrder.upsert({
    where: { orderNumber: PO_NUMBER },
    update: poPayload,
    create: { orderNumber: PO_NUMBER, ...poPayload },
  });

  // ── 6. Work order ────────────────────────────────────────────────────
  const woPayload = {
    factoryId: factory.id,
    productionOrderId: po.id,
    lineId: line.id,
    skuId: sku.id,
    shiftInstanceId,
    status: 'COMPLETED' as const,
    priority: 'HIGH' as const,
    plannedQty,
    actualQty,
    goodQty,
    scrapQty,
    reworkQty: 0,
    plannedStart: windowStart,
    plannedEnd: windowEnd,
    actualStart: windowStart,
    actualEnd: windowEnd,
    oee: breakdown.oee,
    availability: breakdown.availability,
    performance: breakdown.performance,
    quality: breakdown.quality,
    downtimeMinutes: round1(unplannedMin),
    plannedCycleTime: idealCycleSecPerCarton, // seconds per carton
    notes:
      'Manually recorded production data for 28-07-2026 (BETTI line, Alwatani Violet 6×2 Kg), ' +
      'entered for the PoC review. Output by stage: ' +
      `${OUTPUT.innerCarton} inner packs (Big Betti) · ${OUTPUT.outerCarton} outer cartons (Cartomac) · ` +
      `${OUTPUT.fgPallet} pallets (Euro-Pack + Uni-tech). Waste: ${WASTE.innerCarton} inner, ` +
      `${WASTE.outerCarton} outer, ${WASTE.powderKg} kg powder. ` +
      'Stoppages are line-level (see seeder header). ' +
      'NOTE: 1120 cartons ÷ 32 per pallet = 35 pallets, but 28 were logged — pending client confirmation.',
  };

  const existingWo = await prisma.workOrder.findUnique({ where: { orderNumber: WO_NUMBER } });
  const wo = existingWo
    ? await prisma.workOrder.update({ where: { id: existingWo.id }, data: woPayload })
    : await prisma.workOrder.create({ data: { orderNumber: WO_NUMBER, ...woPayload } });
  console.log(`   ${existingWo ? '↻ updated' : '+ created'} ${WO_NUMBER}`);

  // ── 7. Downtime events — rebuilt from scratch so re-runs don't duplicate ──
  const removed = await prisma.downtimeEvent.deleteMany({ where: { workOrderId: wo.id } });
  if (removed.count) console.log(`   − cleared ${removed.count} previous downtime events`);

  for (const s of STOPPAGES) {
    const start = at(s.start);
    const end = at(s.end);
    const duration = minutesBetween(start, end);
    await prisma.downtimeEvent.create({
      data: {
        factoryId: factory.id,
        machineId: bigBetti.id,
        workOrderId: wo.id,
        shiftInstanceId,
        causeId: causeIdByCode.get(s.causeCode ?? '') ?? null,
        reason: s.description,
        category: s.category,
        reasonCode: s.isPlanned
          ? DowntimeReasonCode.PLANNED_MAINTENANCE
          : DowntimeReasonCode.UNPLANNED_BREAKDOWN,
        startTime: start,
        endTime: end,
        durationMinutes: duration,
        // The lunch break is a planned stop: it must not count as an availability loss.
        isPlanned: s.isPlanned,
        affectsOEE: !s.isPlanned,
        acknowledged: true,
        notes:
          `Stop #${s.seq} of 14 · client category "${s.clientCategory}" · ` +
          'logged against the BETTI production line (all machines halt together).',
      },
    });
  }
  console.log(
    `   + ${STOPPAGES.length} downtime events (${plannedMin} planned + ${unplannedMin} unplanned = ${plannedMin + unplannedMin} min)`,
  );

  // ── 8. Material consumption — where the powder waste is recorded ─────
  // OEE Quality is unit-based and deliberately does NOT absorb powder loss.
  // The 300 kg lives here as a planned-vs-actual variance, which is also what
  // makes the 35-vs-28 pallet discrepancy visible in the data itself.
  const bom = await prisma.bOMComponent.findMany({ where: { skuId: sku.id } });
  const bomByCode = new Map(bom.map((b) => [b.componentCode, b]));

  const consumption: Array<{ code: string; planned: number; actual: number; unit: string; note: string }> = [
    { code: '20300009', planned: 12 * goodQty,            actual: 12 * goodQty + WASTE.powderKg, unit: 'KG', note: 'Al Watani HF Violet Powder — 300 kg variance is the logged powder waste' },
    { code: '40330078', planned: innersPerCarton * goodQty, actual: innersPerCarton * goodQty + WASTE.innerCarton, unit: 'PC', note: 'Inner carton (duplex) — 86 pc waste' },
    { code: '40320023', planned: goodQty,                 actual: actualQty,                     unit: 'PC', note: 'Outer case — 19 pc waste' },
    { code: '40250024', planned: goodQty / cartonsPerPallet, actual: OUTPUT.fgPallet,            unit: 'PC', note: `Wooden pallet — planned ${(goodQty / cartonsPerPallet).toFixed(1)} at ${cartonsPerPallet} ctn/pallet vs ${OUTPUT.fgPallet} logged` },
  ];

  const clearedMc = await prisma.materialConsumption.deleteMany({ where: { workOrderId: wo.id } });
  if (clearedMc.count) console.log(`   − cleared ${clearedMc.count} previous consumption rows`);

  for (const c of consumption) {
    const b = bomByCode.get(c.code);
    await prisma.materialConsumption.create({
      data: {
        factoryId: factory.id,
        workOrderId: wo.id,
        materialCode: c.code,
        materialName: b?.componentName ?? c.code,
        quantityPlanned: Math.round(c.planned * 1000) / 1000,
        quantityActual: Math.round(c.actual * 1000) / 1000,
        unit: c.unit,
        consumedAt: windowEnd,
      },
    });
  }
  console.log(`   + ${consumption.length} material consumption rows (powder waste = ${WASTE.powderKg} kg variance)`);

  // ── 9. Summary ───────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(66));
  console.log(`✅ ${WO_NUMBER} loaded — compare against WO-2026-0006`);
  console.log('═'.repeat(66));
  console.log(`   Product          ${sku.itemNumber} · ${sku.name}`);
  console.log(`   Window           2026-07-28  08:00 → 16:30  (${windowMin} min)`);
  console.log(`   Output           ${goodQty} good / ${scrapQty} scrap cartons  (${OUTPUT.innerCarton} inner · ${OUTPUT.fgPallet} pallets)`);
  console.log(`   Downtime         ${unplannedMin} unplanned + ${plannedMin} planned = ${plannedMin + unplannedMin} min`);
  console.log(`   Stored OEE       A ${breakdown.availability}%  P ${breakdown.performance}%  Q ${breakdown.quality}%  →  OEE ${breakdown.oee}%`);
  console.log('');
  console.log('   Next:  npx ts-node prisma/verify-wo-2026-0007.ts   (manual vs system gap table)');
  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
