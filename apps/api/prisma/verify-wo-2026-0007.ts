// ============================================================
// MES360° — WO-2026-0007 · MANUAL vs SYSTEM KPI COMPARISON
// ------------------------------------------------------------
// Reads WO-2026-0007 back out of the database, recomputes every KPI through the
// SAME code path the API uses (a faithful transcription of kpi.service.woChild →
// oee.service.rollup / calculateDetailed), and prints the gap against the manual
// calculation in
//     docs/WO-2026-0007/WO-2026-0007-Manual-KPI-Calculation.xlsx
//
// Paste the "SYSTEM" column into sheet "7 · Manual vs System" of that workbook and
// the Gap/Status columns fill themselves in.
//
// This script never writes. Safe to run against production.
//
// Run:  docker exec mes-api npx ts-node prisma/verify-wo-2026-0007.ts
//       docker exec mes-api npx ts-node prisma/verify-wo-2026-0007.ts --wo WO-2026-0006
// ============================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const argIdx = process.argv.indexOf('--wo');
const WO_NUMBER = argIdx > -1 ? process.argv[argIdx + 1] : 'WO-2026-0007';

// ── Manual baseline (from the workbook; scenario A, ISO 22400) ────────────
const MANUAL: Record<string, { value: number; unit: string }> = {
  'Scheduled window':            { value: 510, unit: 'min' },
  'Planned stop minutes':        { value: 30, unit: 'min' },
  'Unplanned downtime':          { value: 251, unit: 'min' },
  'Planned Production Time':     { value: 480, unit: 'min' },
  'Run time':                    { value: 229, unit: 'min' },
  'Availability':                { value: 47.71, unit: '%' },
  'Performance':                 { value: 55.26, unit: '%' },
  'Quality':                     { value: 98.33, unit: '%' },
  'OEE (schedule-based)':        { value: 25.93, unit: '%' },
  'OEE (time-based / AT-OEE)':   { value: 27.6, unit: '%' },
  'First-Pass Yield':            { value: 98.33, unit: '%' },
  'Scrap rate':                  { value: 1.67, unit: '%' },
  'Good quantity':               { value: 1120, unit: 'ctn' },
  'Scrap quantity':              { value: 19, unit: 'ctn' },
  'Throughput while running':    { value: 293, unit: 'ctn/h' },
  'MTBF':                        { value: 17.6, unit: 'min' },
  'MTTR':                        { value: 19.3, unit: 'min' },
  'Material yield (powder)':     { value: 97.82, unit: '%' },
};

// ── oee.service.ts — transcribed so this stays a genuine cross-check ──────
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const clampPct = (n: number) => Math.min(100, Math.max(0, n));

function calculateDetailed(i: {
  plannedProductionTime: number;
  unplannedDowntime: number;
  idealCycleTime: number;
  totalCount: number;
  goodCount: number;
}) {
  const ppt = Math.max(0, i.plannedProductionTime);
  const runTime = Math.max(0, ppt - Math.max(0, i.unplannedDowntime));
  const idealRunTime = Math.max(0, i.idealCycleTime * i.totalCount);
  const availability = ppt > 0 ? clampPct((runTime / ppt) * 100) : 0;
  const performance = runTime > 0 ? clampPct((idealRunTime / runTime) * 100) : 0;
  const quality = i.totalCount > 0 ? clampPct((i.goodCount / i.totalCount) * 100) : 0;
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

const spanMin = (s: Date | null, e: Date | null) =>
  !s ? 0 : Math.max(0, ((e ? e.getTime() : Date.now()) - s.getTime()) / 60_000);

// ── report helpers ────────────────────────────────────────────────────────
interface Row {
  metric: string;
  manual: number | null;
  system: number | null;
  unit: string;
  note: string;
}

const rows: Row[] = [];
const add = (metric: string, system: number | null, note = '') => {
  const m = MANUAL[metric];
  rows.push({ metric, manual: m?.value ?? null, system, unit: m?.unit ?? '', note });
};

function printTable() {
  const W = [30, 12, 12, 8, 9, 7];
  const line = (c: string) => c.repeat(W.reduce((a, b) => a + b, 0) + 7);
  const cell = (s: string, w: number, right = false) =>
    right ? s.padStart(w) : s.padEnd(w);

  console.log('\n' + line('═'));
  console.log(
    ` ${cell('KPI', W[0])} ${cell('MANUAL', W[1], true)} ${cell('SYSTEM', W[2], true)} ` +
      `${cell('UNIT', W[3])} ${cell('GAP', W[4], true)} ${cell('STATUS', W[5])}`,
  );
  console.log(line('─'));

  let matches = 0;
  let gaps = 0;
  for (const r of rows) {
    const manual = r.manual == null ? '—' : String(round2(r.manual));
    const system = r.system == null ? '—' : String(round2(r.system));
    let gap = '—';
    let status = '—';
    if (r.manual != null && r.system != null) {
      const d = r.system - r.manual;
      gap = (d > 0 ? '+' : '') + round2(d);
      // 0.6 absorbs the 1-decimal rounding the services apply.
      const ok = Math.abs(d) <= 0.6;
      status = ok ? 'MATCH' : 'GAP';
      if (ok) matches++;
      else gaps++;
    }
    console.log(
      ` ${cell(r.metric, W[0])} ${cell(manual, W[1], true)} ${cell(system, W[2], true)} ` +
        `${cell(r.unit, W[3])} ${cell(gap, W[4], true)} ${cell(status, W[5])}`,
    );
    if (r.note) console.log(`   ↳ ${r.note}`);
  }
  console.log(line('═'));
  console.log(` ${matches} match · ${gaps} gap${gaps === 1 ? '' : 's'}`);
  console.log(line('═') + '\n');
}

// ────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔍 ${WO_NUMBER} — manual vs system KPI comparison`);

  const wo = await prisma.workOrder.findUnique({
    where: { orderNumber: WO_NUMBER },
    include: {
      sku: { select: { itemNumber: true, name: true, baseUnit: true, innersPerCarton: true } },
      line: { select: { code: true, name: true } },
      jobOrders: {
        select: {
          id: true,
          machineId: true,
          status: true,
          idealCycleTimeSec: true,
          actualQtyGood: true,
          actualQtyRejected: true,
          plannedStart: true,
          plannedEnd: true,
          actualStart: true,
          actualEnd: true,
          sequenceOrder: true,
        },
      },
      downtimeEvents: {
        select: {
          machineId: true,
          startTime: true,
          endTime: true,
          durationMinutes: true,
          isPlanned: true,
          affectsOEE: true,
          category: true,
          reason: true,
        },
      },
      materialConsumptions: {
        select: { materialCode: true, materialName: true, quantityPlanned: true, quantityActual: true, unit: true },
      },
    },
  });

  if (!wo) {
    console.error(`\n❌ ${WO_NUMBER} not found. Run:  npx ts-node prisma/seed-wo-2026-0007.ts\n`);
    process.exit(1);
  }

  console.log(`   ${wo.sku?.itemNumber ?? '—'} · ${wo.sku?.name ?? '—'}`);
  console.log(`   line ${wo.line?.code ?? '—'} · status ${wo.status} · ${wo.jobOrders.length} job order(s)`);
  console.log(
    `   window ${wo.actualStart?.toISOString() ?? '—'} → ${wo.actualEnd?.toISOString() ?? '—'}`,
  );

  // ── Time model, exactly as kpi.service.woChild() derives it ────────────
  const dt = wo.downtimeEvents;
  const dtMin = (d: (typeof dt)[number]) => d.durationMinutes ?? spanMin(d.startTime, d.endTime);

  const plannedStopMin = dt.filter((d) => d.isPlanned).reduce((s, d) => s + dtMin(d), 0);
  const unplannedMin = dt.filter((d) => !d.isPlanned && d.affectsOEE).reduce((s, d) => s + dtMin(d), 0);
  const windowMin = spanMin(wo.actualStart, wo.actualEnd);

  // No job orders → woChild uses the WO header window as PPT and sums ALL of the
  // WO's unplanned downtime. Planned stops are NOT subtracted (see gap report).
  const ppt = windowMin;
  const runTime = Math.max(0, ppt - unplannedMin);
  const total = wo.actualQty || wo.goodQty + wo.scrapQty;
  const idealMin = wo.plannedCycleTime ? wo.plannedCycleTime / 60 : 0;

  const b = calculateDetailed({
    plannedProductionTime: ppt,
    unplannedDowntime: unplannedMin,
    idealCycleTime: idealMin,
    totalCount: total,
    goodCount: wo.goodQty,
  });

  // Time-based (AT-OEE) — kpi.service.timeBasedOee()
  const operating = windowMin;
  const net = Math.max(0, operating - unplannedMin);
  const availabilityTb = operating > 0 ? round1(clampPct((net / operating) * 100)) : 0;
  const oeeTb = round1((availabilityTb / 100) * (b.performance / 100) * (b.quality / 100) * 100);

  const unplannedCount = dt.filter((d) => !d.isPlanned && d.affectsOEE).length;

  // ── Assemble the comparison ────────────────────────────────────────────
  add('Scheduled window', windowMin);
  add('Planned stop minutes', plannedStopMin);
  add('Unplanned downtime', unplannedMin);
  add(
    'Planned Production Time',
    ppt,
    ppt > MANUAL['Planned Production Time'].value
      ? 'kpi.service.woChild() uses the full actualStart→actualEnd span as PPT and does NOT ' +
          'subtract planned stops, so the 30-min break is still inside the denominator. ' +
          'ISO 22400 requires 480. See gap G-01.'
      : '',
  );
  add('Run time', runTime, runTime !== MANUAL['Run time'].value ? 'Follows directly from the PPT gap above.' : '');
  add('Availability', b.availability, b.availability !== MANUAL['Availability'].value ? 'Consequence of G-01.' : '');
  add(
    'Performance',
    b.performance,
    b.performance >= 100
      ? 'CLAMPED AT 100% — the ideal cycle time is slower than the machine actually ran, so the ' +
          'speed loss is invisible. Run seed-bb-cycle-times.ts. See gap G-02.'
      : '',
  );
  add('Quality', b.quality);
  add('OEE (schedule-based)', b.oee);
  add('OEE (time-based / AT-OEE)', oeeTb);
  add('First-Pass Yield', total > 0 ? round2((wo.goodQty / total) * 100) : 0);
  add('Scrap rate', total > 0 ? round2((wo.scrapQty / total) * 100) : 0);
  add('Good quantity', wo.goodQty);
  add('Scrap quantity', wo.scrapQty);
  add('Throughput while running', runTime > 0 ? round2((wo.goodQty / runTime) * 60) : 0);
  add('MTBF', unplannedCount > 0 ? round2(runTime / unplannedCount) : 0, 'Downtime-event MTBF. The maintenance module computes MTBF from MaintenanceWO failures instead — a different definition by design.');
  add('MTTR', unplannedCount > 0 ? round2(unplannedMin / unplannedCount) : 0, 'Same caveat as MTBF.');

  const powder = wo.materialConsumptions.find((m) => m.unit === 'KG');
  add(
    'Material yield (powder)',
    powder && powder.quantityActual > 0
      ? round2((powder.quantityPlanned / powder.quantityActual) * 100)
      : null,
    powder
      ? `From MaterialConsumption ${powder.materialCode}: ${powder.quantityPlanned} planned vs ${powder.quantityActual} actual kg.`
      : 'No KG material consumption row — powder waste was not recorded.',
  );

  printTable();

  // ── Stored vs recomputed ───────────────────────────────────────────────
  console.log('Stored WorkOrder columns vs recomputed:');
  const storedRows: Array<[string, number | null, number]> = [
    ['oee', wo.oee, b.oee],
    ['availability', wo.availability, b.availability],
    ['performance', wo.performance, b.performance],
    ['quality', wo.quality, b.quality],
    ['downtimeMinutes', wo.downtimeMinutes, round1(unplannedMin)],
  ];
  for (const [name, stored, recomputed] of storedRows) {
    const ok = stored != null && Math.abs(stored - recomputed) <= 0.15;
    console.log(
      `   ${ok ? '✓' : '✗'} ${name.padEnd(16)} stored ${String(stored ?? '—').padStart(8)}   recomputed ${String(recomputed).padStart(8)}`,
    );
  }

  // ── Downtime Pareto ────────────────────────────────────────────────────
  console.log('\nDowntime Pareto (unplanned, by category):');
  const pareto = new Map<string, { min: number; n: number }>();
  for (const d of dt) {
    if (d.isPlanned || !d.affectsOEE) continue;
    const k = d.category;
    const cur = pareto.get(k) ?? { min: 0, n: 0 };
    cur.min += dtMin(d);
    cur.n += 1;
    pareto.set(k, cur);
  }
  for (const [cat, v] of [...pareto.entries()].sort((a, b2) => b2[1].min - a[1].min)) {
    console.log(
      `   ${cat.padEnd(22)} ${String(round1(v.min)).padStart(6)} min   ${String(v.n).padStart(2)} events   ` +
        `${String(round1((v.min / unplannedMin) * 100)).padStart(5)}% of unplanned`,
    );
  }
  console.log(`   ${'PLANNED (excluded)'.padEnd(22)} ${String(round1(plannedStopMin)).padStart(6)} min`);

  // ── Energy ratio ───────────────────────────────────────────────────────
  const energy = await prisma.energyWOMachineKpi.findMany({
    where: { workOrderId: wo.id },
    include: { machine: { select: { code: true, name: true } } },
    orderBy: { totalKwh: 'desc' },
  });
  console.log('\nEnergy ratio per machine:');
  if (energy.length === 0) {
    console.log('   — no rows. Needs EnergyReading data tagged with this workOrderId;');
    console.log('     the manual log carries no meter readings, so this stays empty until');
    console.log('     the line meters are streaming (POST /energy/work-orders/:id/machine-kpis/recompute).');
  } else {
    for (const e of energy) {
      console.log(
        `   ${e.machine.code.padEnd(4)} ${e.machine.name.padEnd(20)} ` +
          `${String(round2(e.totalKwh)).padStart(9)} kWh   ` +
          `${e.kwhPerUnit != null ? round2(e.kwhPerUnit).toFixed(3) : '—'} kWh/${e.outputUnit ?? 'unit'}   ` +
          `waste ${e.wastePct != null ? `${e.wastePct}%` : '—'}`,
      );
    }
  }

  console.log('\nPaste the SYSTEM column into sheet "7 · Manual vs System" of');
  console.log('docs/WO-2026-0007/WO-2026-0007-Manual-KPI-Calculation.xlsx\n');
}

main()
  .catch((e) => {
    console.error('❌ Verification failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
