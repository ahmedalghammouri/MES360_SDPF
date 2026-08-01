// ============================================================
// MES360° — MEASURED MACHINE CYCLE TIMES (BETTI line)
// ------------------------------------------------------------
// Loads the machine rates the client measured on the shop floor into
// MachineCycleTime, replacing the estimates that were seeded from the original
// prerequisites sheet.
//
//   Source: docs/recived from client/Betti Production Line  Production Rate.xlsx
//           (5 timed runs per machine, tested 28-07-2026)
//
// WHY THIS MATTERS
// ----------------
// OEE Performance = (idealCycleTime × totalCount) / runTime. The seeded estimates
// are far slower than the machines actually run:
//
//     M1 Big Betti   seeded  31 s/inner   measured  1.20 s/inner   (25.8× out)
//     M3 Cartomac    seeded  25 s/carton  measured  6.67 s/carton  ( 3.7× out)
//     M4 Euro-Pack   seeded 290 s/pallet  measured   214 s/pallet  ( 1.4× out)
//     M5 Uni-tech    seeded 145 s/pallet  measured   107 s/pallet  ( 1.4× out)
//
// With a denominator that slow, Performance saturates at the 100% clamp in
// oee.service.calculateDetailed() and OEE silently collapses to A × Q — the
// speed loss becomes invisible. This is the single largest source of gap between
// the platform's numbers and the client's manual calculation.
//
// ISO 22400 defines the Performance denominator as the THEORETICAL BEST cycle
// time, so the best of the five runs is used, not the average. Both are printed.
//
// SCOPE: only the SKU that was actually rate-tested (10310064, Alwatani Violet
// HF 6×2 Kg). Pass --all-2kg to apply the same rates to every 2 Kg SKU on the
// line, which is defensible because the rate is set by pack format, not fragrance.
//
// Idempotent: upserts on the (machineId, skuId, unitType) unique key.
//
// Run:  docker exec mes-api npx ts-node prisma/seed-bb-cycle-times.ts
//       docker exec mes-api npx ts-node prisma/seed-bb-cycle-times.ts --all-2kg
// ============================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const FACTORY_CODE = 'SDPF';
const RATE_TESTED_SKU = '10310064'; // Alwatani Powder Detergent — Violet HF — 6 × 2 Kg C
const APPLY_TO_ALL_2KG = process.argv.includes('--all-2kg');

/** The five timed runs, exactly as recorded in the client's file. */
const RUNS = {
  /** Big Betti filling — packs per minute (higher is faster). */
  bettiPacksPerMin: [50, 50, 50, 50, 50],
  /** Cartomac — outer cartons per minute (higher is faster). */
  cartomacCartonsPerMin: [7, 9, 9, 9, 9],
  /** Euro-Pack palletising robot — minutes per pallet (lower is faster). */
  robotMinPerPallet: [3 + 34 / 60, 3 + 58 / 60, 3 + 36 / 60, 3 + 44 / 60, 3 + 49 / 60],
  /** Uni-tech wrapper — minutes per pallet (lower is faster). */
  wrapMinPerPallet: [2 + 6 / 60, 1 + 56 / 60, 1 + 47 / 60, 1 + 50 / 60, 2 + 1 / 60],
};

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round2 = (n: number) => Math.round(n * 100) / 100;

// Best demonstrated → the ISO 22400 ideal cycle time, in seconds per unit.
const BEST = {
  M1: 60 / Math.max(...RUNS.bettiPacksPerMin), //          1.20 s / inner pack
  M3: 60 / Math.max(...RUNS.cartomacCartonsPerMin), //     6.67 s / outer carton
  M4: Math.min(...RUNS.robotMinPerPallet) * 60, //       214.00 s / pallet
  M5: Math.min(...RUNS.wrapMinPerPallet) * 60, //        107.00 s / pallet
};
const AVERAGE = {
  M1: 60 / avg(RUNS.bettiPacksPerMin),
  M3: 60 / avg(RUNS.cartomacCartonsPerMin),
  M4: avg(RUNS.robotMinPerPallet) * 60,
  M5: avg(RUNS.wrapMinPerPallet) * 60,
};

/**
 * M2 (Checkweigher) is inline with the filler and has no independent rate test,
 * so it inherits the Big Betti cycle — the same assumption the original master
 * seed makes.
 */
const CYCLE_SPEC: Array<{ machineCode: string; unitType: string; seconds: number; label: string }> = [
  { machineCode: 'M1', unitType: 'INNER',  seconds: BEST.M1, label: 'Big Betti — filling' },
  { machineCode: 'M2', unitType: 'INNER',  seconds: BEST.M1, label: 'Checkweigher — inline with filler' },
  { machineCode: 'M3', unitType: 'CARTON', seconds: BEST.M3, label: 'Cartomac — cartoning' },
  { machineCode: 'M4', unitType: 'PALLET', seconds: BEST.M4, label: 'Euro-Pack Robot — palletising' },
  { machineCode: 'M5', unitType: 'PALLET', seconds: BEST.M5, label: 'Uni-tech — wrapping' },
];

async function main() {
  console.log('🌱 Measured machine cycle times — BETTI line (client rate test, 28-07-2026)\n');

  const factory = await prisma.factory.findFirst({ where: { code: FACTORY_CODE } });
  if (!factory) throw new Error(`Factory "${FACTORY_CODE}" not found — run prisma:seed:master first.`);

  const machines = await prisma.machine.findMany({
    where: { factoryId: factory.id, code: { in: CYCLE_SPEC.map((c) => c.machineCode) } },
    select: { id: true, code: true, name: true },
  });
  const machineByCode = new Map(machines.map((m) => [m.code, m]));

  // Which SKUs get these rates.
  const targetSkus = APPLY_TO_ALL_2KG
    ? await prisma.sKU.findMany({
        where: { factoryId: factory.id, weight: 2 },
        select: { id: true, itemNumber: true, name: true, weight: true },
      })
    : await prisma.sKU.findMany({
        where: { factoryId: factory.id, itemNumber: RATE_TESTED_SKU },
        select: { id: true, itemNumber: true, name: true, weight: true },
      });

  if (targetSkus.length === 0) {
    throw new Error(
      APPLY_TO_ALL_2KG
        ? 'No 2 Kg SKUs found — run prisma:seed:bb first.'
        : `SKU "${RATE_TESTED_SKU}" not found — run prisma:seed:bb first.`,
    );
  }

  console.log('   Rate test → ideal cycle time (best of 5 runs, ISO 22400):');
  for (const c of CYCLE_SPEC) {
    const m = machineByCode.get(c.machineCode);
    const avgSec = AVERAGE[c.machineCode as keyof typeof AVERAGE] ?? c.seconds;
    console.log(
      `     ${c.machineCode}  ${(m?.name ?? '—').padEnd(20)} ` +
        `${round2(c.seconds).toString().padStart(7)} s/${c.unitType.padEnd(6)} ` +
        `(5-run avg ${round2(avgSec)} s · max ${Math.round(3600 / c.seconds)}/h)  — ${c.label}`,
    );
  }
  console.log(
    `\n   Applying to ${targetSkus.length} SKU(s): ` +
      (APPLY_TO_ALL_2KG ? 'every 2 Kg product on the line' : targetSkus[0].itemNumber),
  );

  let written = 0;
  let skipped = 0;
  for (const sku of targetSkus) {
    for (const c of CYCLE_SPEC) {
      const machine = machineByCode.get(c.machineCode);
      if (!machine) {
        skipped++;
        continue;
      }
      const data = {
        cycleTimeSeconds: round2(c.seconds),
        maxSpeed: Math.round(3600 / c.seconds),
        source: 'MEASURED',
        isActive: true,
      };
      await prisma.machineCycleTime.upsert({
        where: {
          machineId_skuId_unitType: {
            machineId: machine.id,
            skuId: sku.id,
            unitType: c.unitType,
          },
        },
        update: data,
        create: { machineId: machine.id, skuId: sku.id, unitType: c.unitType, ...data },
      });
      written++;
    }
  }

  console.log(`\n✅ ${written} cycle times written with source=MEASURED${skipped ? ` · ${skipped} skipped (machine missing)` : ''}`);
  console.log('   Existing rows for other SKUs are untouched (source stays NCC_DATA).');
  console.log('');
  console.log('   ⚠  Job orders stamp idealCycleTimeSec at creation time, so work orders');
  console.log('      created BEFORE this ran keep their old denominator. Re-run the KPI');
  console.log('      recompute, or recreate those job orders, to pick the new rates up.');
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
