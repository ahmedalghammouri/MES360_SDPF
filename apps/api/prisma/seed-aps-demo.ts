/**
 * APS demo data — a handful of OPEN production work orders for SIDCO so the
 * Advanced Planning & Scheduling engine has something to plan. Additive and
 * idempotent: every work order is keyed by an "APS-" orderNumber prefix and
 * skipped if it already exists. Existing/real data is never touched.
 *
 *   - sets a sensible designCapacity on active machines that lack one
 *   - creates 6 RELEASED work orders (mixed priority + due dates, some tight)
 *   - each with a 3-step routing (Filling → Cartoning → Check-weigh) chained
 *     across distinct machines as SCHEDULED job orders
 *
 * Run:  npx ts-node prisma/seed-aps-demo.ts
 */
import { PrismaClient, Priority, WorkOrderStatus, JobOrderStatus, DependencyType, ProductionOrderStatus } from '@prisma/client';

const prisma = new PrismaClient();

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const ORDERS = [
  { suffix: '0001', qty: 6000, priority: Priority.CRITICAL, dueInDays: 1 },
  { suffix: '0002', qty: 4500, priority: Priority.HIGH, dueInDays: 2 },
  { suffix: '0003', qty: 3000, priority: Priority.HIGH, dueInDays: 3 },
  { suffix: '0004', qty: 5200, priority: Priority.MEDIUM, dueInDays: 4 },
  { suffix: '0005', qty: 2800, priority: Priority.MEDIUM, dueInDays: 5 },
  { suffix: '0006', qty: 4000, priority: Priority.LOW, dueInDays: 7 },
];

const STEPS: { name: string; cycleSec: number; depType: DependencyType; lagMins: number }[] = [
  { name: 'Filling', cycleSec: 1.1, depType: DependencyType.FINISH_TO_START, lagMins: 0 },
  { name: 'Cartoning', cycleSec: 0.9, depType: DependencyType.FINISH_TO_START, lagMins: 0 },
  // Check-weigh runs inline with cartoning: starts 30 min after cartoning starts (SS+30)
  { name: 'Check-weigh', cycleSec: 0.6, depType: DependencyType.START_TO_START, lagMins: 30 },
];

async function main() {
  const factory = await prisma.factory.findFirst({ where: { code: 'SIDCO' }, select: { id: true } });
  if (!factory) throw new Error('SIDCO factory not found');
  const fid = factory.id;

  // 1) Ensure machines have a capacity so durations are realistic.
  const machines = await prisma.machine.findMany({
    // Production machines only (M1..M5) — utilities are never routing steps
    where: { factoryId: fid, isActive: true, machineType: { not: 'PRODUCTION_LINE' }, code: { startsWith: 'M' } },
    select: { id: true, name: true, code: true, designCapacity: true },
    orderBy: { sortOrder: 'asc' },
  });
  if (machines.length < 3) throw new Error(`Need at least 3 active machines, found ${machines.length}`);

  let capFixed = 0;
  for (const m of machines) {
    if (!m.designCapacity || m.designCapacity <= 0) {
      await prisma.machine.update({ where: { id: m.id }, data: { designCapacity: 1200 } });
      capFixed++;
    }
  }

  // Routing machines = first 3 distinct active machines.
  const routeMachines = machines.slice(0, 3);

  // 2) SKUs to produce (reuse existing).
  const skus = await prisma.sKU.findMany({ where: { factoryId: fid }, select: { id: true, code: true }, take: ORDERS.length });
  if (skus.length === 0) throw new Error('No SKUs found for SIDCO');

  const now = Date.now();
  let createdWo = 0, createdJo = 0, skipped = 0;

  // Demo production orders (customer orders) grouping the work orders 3+3.
  const poIds: string[] = [];
  for (const [idx, poNum] of (['APS-PO-0001', 'APS-PO-0002'] as const).entries()) {
    let po = await prisma.productionOrder.findUnique({ where: { orderNumber: poNum }, select: { id: true } });
    if (!po) {
      po = await prisma.productionOrder.create({
        data: {
          factoryId: fid,
          orderNumber: poNum,
          skuId: skus[idx % skus.length].id,
          targetQty: 12000,
          status: ProductionOrderStatus.RELEASED,
          plannedStart: new Date(now),
          plannedEnd: new Date(now + 7 * DAY),
          customer: idx === 0 ? 'Alwatani Trading Co.' : 'Gulf Retail Group',
          notes: 'APS demo production order',
        },
        select: { id: true },
      });
    }
    poIds.push(po.id);
  }

  for (let i = 0; i < ORDERS.length; i++) {
    const o = ORDERS[i];
    const orderNumber = `APS-${o.suffix}`;
    const existing = await prisma.workOrder.findUnique({ where: { orderNumber }, select: { id: true, productionOrderId: true } });
    if (existing) {
      // Back-fill PO link + typed deps on already-seeded data (idempotent upgrade).
      if (!existing.productionOrderId) {
        await prisma.workOrder.update({ where: { id: existing.id }, data: { productionOrderId: poIds[i < 3 ? 0 : 1] } });
      }
      for (const step of STEPS) {
        await prisma.jobOrder.updateMany({
          where: { workOrderId: existing.id, operationName: step.name },
          data: { predecessorType: step.depType, predecessorLagMins: step.lagMins },
        });
      }
      skipped++; continue;
    }

    const sku = skus[i % skus.length];
    const plannedStart = new Date(now);
    const plannedEnd = new Date(now + o.dueInDays * DAY); // due date

    const wo = await prisma.workOrder.create({
      data: {
        factoryId: fid,
        productionOrderId: poIds[i < 3 ? 0 : 1],
        skuId: sku.id,
        orderNumber,
        status: WorkOrderStatus.RELEASED,
        priority: o.priority,
        plannedQty: o.qty,
        plannedStart,
        plannedEnd,
        notes: 'APS demo work order',
      },
      select: { id: true },
    });
    createdWo++;

    // 3) Chained operations across the route machines.
    let prevId: string | null = null;
    for (let s = 0; s < STEPS.length; s++) {
      const step = STEPS[s];
      const machine = routeMachines[s % routeMachines.length];
      const jo: { id: string } = await prisma.jobOrder.create({
        data: {
          factoryId: fid,
          workOrderId: wo.id,
          machineId: machine.id,
          sequenceOrder: s + 1,
          operationName: step.name,
          status: JobOrderStatus.SCHEDULED,
          plannedQtyIn: o.qty,
          plannedQtyOut: o.qty,
          idealCycleTimeSec: step.cycleSec,
          predecessorId: prevId,
          predecessorType: step.depType,
          predecessorLagMins: step.lagMins,
          outputUnit: 'PIECE',
        },
        select: { id: true },
      });
      prevId = jo.id;
      createdJo++;
    }
  }

  console.log(`✅ APS demo seed complete`);
  console.log(`   machines capacity fixed: ${capFixed}`);
  console.log(`   work orders created: ${createdWo} (skipped existing: ${skipped})`);
  console.log(`   job orders created: ${createdJo}`);
  console.log(`   route: ${routeMachines.map((m) => m.code).join(' → ')}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
