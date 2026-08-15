// ============================================================
// MES360° — Quantity-unit backfill
// ------------------------------------------------------------
// Labels and normalises historical quantities that were stored without a unit.
//
// THE PROBLEM THIS REPAIRS
// Routing steps count in different units — the filler in inners, the cartoner in
// cartons, the palletiser in pallets. WorkOrder.scrapQty was a RAW SUM across
// those steps, so a real row read:
//
//     scrapQty 5682  =  401 inners + 430 cartons + 4851 pallets
//
// while goodQty in the same row was the last step's output, in pallets. Two
// adjacent columns meaning different things, with no unit column to tell you.
//
// WHAT IT DOES
//   • WorkOrder      — quantities are DERIVED, so they are recomputed from the job
//                      orders in PIECES (the only unit in which steps can be added)
//                      and plannedQty is converted from the order's unit. The whole
//                      row then genuinely is PIECE.
//   • ScrapLog       — qty is SOURCE data, so it is left untouched and merely
//                      LABELLED with its job order's output unit. Lossless.
//   • InspectionResult — labelled from the job order that ran on the same machine
//                      for the same work order, when that is unambiguous. Rows that
//                      cannot be resolved are reported, never guessed.
//
// CONVERGENT, NOT "RUN ONCE": every value is recomputed from source each time, so
// running it repeatedly is safe and it self-heals. Wired into prod-init.js.
//
// Run standalone:  node node_modules/.bin/ts-node --transpile-only prisma/backfill-quantity-units.ts
// ============================================================

import { PrismaClient } from '@prisma/client';

// The production image ships `dist/`, not `src/` — so the compiled unit engine is
// required at runtime rather than imported from source. Same pattern the
// ProductionSnapshot backfill uses in prod-init.js. Falling back to the source path
// keeps the script runnable from a dev checkout too. Either way there is exactly ONE
// implementation of the packaging ladder; this never re-implements it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const units: typeof import('../src/common/units.util') = (() => {
  try { return require('../dist/common/units.util'); }
  catch { return require('../src/common/units.util'); }
})();
const { toPieces, isConvertibleUnit } = units;

const prisma = new PrismaClient();

type Pkg = {
  unitsPerInner: number; innersPerCarton: number; cartonsPerPallet: number; baseUnit: string;
};
const DEFAULT_PKG: Pkg = { unitsPerInner: 1, innersPerCarton: 1, cartonsPerPallet: 1, baseUnit: 'PIECE' };

async function backfillWorkOrders() {
  const wos = await prisma.workOrder.findMany({
    select: {
      id: true, orderNumber: true, plannedQty: true, goodQty: true, scrapQty: true,
      qtyUnit: true,
      sku: { select: { unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true, baseUnit: true } },
      productionOrder: { select: { unit: true, targetQty: true } },
      jobOrders: {
        orderBy: { sequenceOrder: 'asc' },
        select: { actualQtyGood: true, actualQtyRejected: true, outputUnit: true },
      },
    },
  });

  let recomputed = 0;
  let headerOnly = 0;
  let unchanged = 0;

  for (const wo of wos) {
    const pkg: Pkg = wo.sku
      ? {
          unitsPerInner: wo.sku.unitsPerInner ?? 1,
          innersPerCarton: wo.sku.innersPerCarton ?? 1,
          cartonsPerPallet: wo.sku.cartonsPerPallet ?? 1,
          baseUnit: wo.sku.baseUnit ?? 'PIECE',
        }
      : DEFAULT_PKG;

    // The unit the ORDER was raised in — what plannedQty is counted in.
    const orderUnit = wo.productionOrder?.unit ?? pkg.baseUnit ?? 'PIECE';

    if (wo.jobOrders.length === 0) {
      // Non-routed work order: nothing to recompute from. Label it with the unit it
      // was actually raised in rather than asserting a PIECE it is not.
      const unit = isConvertibleUnit(orderUnit) ? orderUnit.toUpperCase() : 'PIECE';
      if (wo.qtyUnit !== unit) {
        await prisma.workOrder.update({ where: { id: wo.id }, data: { qtyUnit: unit } });
        headerOnly += 1;
      } else unchanged += 1;
      continue;
    }

    const last = wo.jobOrders[wo.jobOrders.length - 1];

    // good/scrap are DERIVED from the job orders, so recomputing them is naturally
    // convergent — the same inputs always give the same answer, and live counter
    // updates simply flow through.
    const goodPieces = Math.round(toPieces(last.actualQtyGood ?? 0, last.outputUnit, pkg));
    const scrapPieces = Math.round(
      wo.jobOrders.reduce((sum, j) => sum + toPieces(j.actualQtyRejected ?? 0, j.outputUnit, pkg), 0),
    );

    // plannedQty is SOURCE data, and converting a column in place is NOT idempotent:
    // an earlier version of this script re-converted already-converted values every
    // run (1,000 pallets → 160,000 → 25,600,000). It is therefore derived from the
    // PRODUCTION ORDER, which this script never writes and which still holds the
    // quantity in the unit it was raised in. That makes the result convergent no
    // matter how many times it runs. A work order with no production order keeps its
    // own planned quantity, converted only on the first pass.
    const plannedPieces = wo.productionOrder
      ? Math.round(toPieces(
          wo.productionOrder.targetQty ?? 0,
          isConvertibleUnit(wo.productionOrder.unit) ? wo.productionOrder.unit : 'PIECE',
          pkg,
        ))
      : (wo.qtyUnit === 'PIECE'
          ? wo.plannedQty // already normalised on a previous pass — do not touch
          : Math.round(toPieces(wo.plannedQty ?? 0, isConvertibleUnit(orderUnit) ? orderUnit : 'PIECE', pkg)));

    const already =
      wo.qtyUnit === 'PIECE' &&
      wo.goodQty === goodPieces &&
      wo.scrapQty === scrapPieces &&
      wo.plannedQty === plannedPieces;

    if (already) { unchanged += 1; continue; }

    await prisma.workOrder.update({
      where: { id: wo.id },
      data: {
        plannedQty: plannedPieces,
        goodQty: goodPieces,
        scrapQty: scrapPieces,
        actualQty: goodPieces + scrapPieces,
        qtyUnit: 'PIECE',
      },
    });
    console.log(
      `  ${wo.orderNumber}: good ${wo.goodQty}→${goodPieces}, scrap ${wo.scrapQty}→${scrapPieces}, ` +
        `planned ${wo.plannedQty}→${plannedPieces} (all PIECE)`,
    );
    recomputed += 1;
  }

  console.log(`✅ Work orders — ${recomputed} recomputed, ${headerOnly} header-only labelled, ${unchanged} already correct.`);
}

async function backfillScrapLogs() {
  // qty is source data — only the LABEL is added, from the job order it belongs to.
  const logs = await prisma.scrapLog.findMany({
    select: { id: true, qtyUnit: true, jobOrder: { select: { outputUnit: true } } },
  });

  let labelled = 0;
  let unchanged = 0;
  for (const l of logs) {
    const unit = (l.jobOrder?.outputUnit ?? 'PIECE').toUpperCase();
    if (l.qtyUnit === unit) { unchanged += 1; continue; }
    await prisma.scrapLog.update({ where: { id: l.id }, data: { qtyUnit: unit } });
    labelled += 1;
  }
  console.log(`✅ Scrap logs — ${labelled} labelled from their job order, ${unchanged} already correct.`);
}

async function backfillInspections() {
  const rows = await prisma.inspectionResult.findMany({
    select: { id: true, qtyUnit: true, workOrderId: true, machineId: true },
  });

  let labelled = 0;
  let unchanged = 0;
  let unresolved = 0;

  for (const r of rows) {
    if (!r.workOrderId || !r.machineId) { unresolved += 1; continue; }

    // Only accept an unambiguous match: exactly one step ran on that machine for
    // that work order. Anything else is a guess, and a guess is what caused this.
    const jos = await prisma.jobOrder.findMany({
      where: { workOrderId: r.workOrderId, machineId: r.machineId },
      select: { outputUnit: true },
      take: 2,
    });
    if (jos.length !== 1 || !jos[0].outputUnit) { unresolved += 1; continue; }

    const unit = jos[0].outputUnit.toUpperCase();
    if (r.qtyUnit === unit) { unchanged += 1; continue; }
    await prisma.inspectionResult.update({ where: { id: r.id }, data: { qtyUnit: unit } });
    labelled += 1;
  }

  console.log(
    `✅ Inspections — ${labelled} labelled, ${unchanged} already correct, ${unresolved} left as PIECE ` +
      '(no unambiguous job order to infer from).',
  );
}

async function main() {
  console.log('▶ Backfilling quantity units (convergent — safe to re-run)...');
  await backfillWorkOrders();
  await backfillScrapLogs();
  await backfillInspections();
}

main()
  .catch((e) => {
    console.error('❌ Quantity-unit backfill failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
