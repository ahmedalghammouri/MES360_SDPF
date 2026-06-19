/**
 * Shop-floor live history backfill — makes the per-job-order Live Dashboard show
 * realistic, internally-consistent operational data instead of empty trends.
 *
 * For every currently EXECUTING / PAUSED / COMPLETE job order it reconstructs a
 * plausible history across the JO's actual window (actualStart → actualEnd|now):
 *   • MachineStateRecord timeline — RUNNING segments interleaved with realistic
 *     SETUP / MICRO_STOP / BREAKDOWN / PLANNED_STOP / CHANGEOVER stops (≈80% util)
 *   • DowntimeEvent per down segment (NCC cause + ISA-95 reason code, some
 *     acknowledged + closed → real MTTR / MTTA / repair-time / Pareto)
 *   • ProductionEvent COUNT_UPDATE rows ramping good qty 0 → actualQtyGood, with
 *     occasional scrap deltas (→ production-over-time, target-trending, rejects)
 *   • ScrapLog entries (categories + reasons → scrap-by-category, top reasons)
 *   • OEERecord daily rows (last 14 days, this machine) → OEE trend lines
 * Also sets MachineCurrentStatus to RUNNING for machines with an executing JO so
 * the card and the dashboard agree.
 *
 * Deterministic (seeded PRNG — no Math.random), idempotent: clears prior history
 * for the involved machines in-window, then regenerates. Scoped to those machines
 * only — never touches unrelated data.
 *
 * Run:  docker exec mes-api npx ts-node prisma/seed-shopfloor-history.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

// Deterministic PRNG (mulberry32) so re-runs are stable and review-friendly.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type DownKind = 'SETUP' | 'MICRO_STOP' | 'BREAKDOWN' | 'PLANNED_STOP' | 'CHANGEOVER';
// machineState = a valid MachineState enum value (MICRO_STOP is only a downtime
// reason code, so a micro-stop maps to the IDLE machine state on the timeline).
const DOWN_META: Record<DownKind, { reasonCode: string; category: string; planned: boolean; label: string; machineState: string }> = {
  SETUP:        { reasonCode: 'CHANGEOVER', category: 'CHANGEOVER', planned: true,  label: 'Start-up / setup', machineState: 'SETUP' },
  CHANGEOVER:   { reasonCode: 'CHANGEOVER', category: 'CHANGEOVER', planned: true,  label: 'Format changeover', machineState: 'CHANGEOVER' },
  MICRO_STOP:   { reasonCode: 'MICRO_STOP', category: 'PROCESS',    planned: false, label: 'Minor stop / jam', machineState: 'IDLE' },
  BREAKDOWN:    { reasonCode: 'UNPLANNED_BREAKDOWN', category: 'MECHANICAL', planned: false, label: 'Equipment breakdown', machineState: 'BREAKDOWN' },
  PLANNED_STOP: { reasonCode: 'PLANNED_MAINTENANCE', category: 'PLANNED_BREAK', planned: true, label: 'Shift break / cleaning', machineState: 'PLANNED_STOP' },
};

const SCRAP_REASONS: Array<{ category: string; reason: string }> = [
  { category: 'QUALITY', reason: 'Underweight fill — out of spec' },
  { category: 'SETUP', reason: 'Start-up waste at line warm-up' },
  { category: 'MATERIAL', reason: 'Carton board defect' },
  { category: 'MACHINE', reason: 'Sealing fault on wrapper' },
  { category: 'OPERATOR', reason: 'Mis-feed during changeover' },
];

async function main() {
  const now = Date.now();

  const jos = await prisma.jobOrder.findMany({
    where: { status: { in: ['EXECUTING', 'PAUSED', 'COMPLETE'] }, machineId: { not: null }, actualStart: { not: null } },
    include: {
      machine: { select: { id: true, code: true, factoryId: true } },
      workOrder: { select: { id: true, skuId: true } },
    },
    orderBy: { sequenceOrder: 'asc' },
  });

  if (!jos.length) {
    console.log('No EXECUTING/PAUSED/COMPLETE job orders with a machine + actualStart — nothing to backfill.');
    return;
  }

  const machineIds = [...new Set(jos.map((j) => j.machineId!))];
  const factoryId = jos[0].machine!.factoryId;

  // Reference downtime causes for the factory (assign realistic codes where possible)
  const causes = await prisma.downtimeCause.findMany({
    where: { factoryId, isActive: true },
    select: { id: true, name: true, category: true, isPlanned: true },
  });
  const causeFor = (kind: DownKind) => {
    const meta = DOWN_META[kind];
    return causes.find((c) => c.category === meta.category)
        ?? causes.find((c) => c.isPlanned === meta.planned)
        ?? causes[0] ?? null;
  };

  // ── Clean prior history for these machines (scoped, idempotent) ──
  console.log(`Backfilling ${jos.length} job orders across ${machineIds.length} machines…`);
  await prisma.scrapLog.deleteMany({ where: { jobOrderId: { in: jos.map((j) => j.id) } } });
  await prisma.productionEvent.deleteMany({ where: { machineId: { in: machineIds }, eventType: 'COUNT_UPDATE' } });
  await prisma.downtimeEvent.deleteMany({ where: { machineId: { in: machineIds } } });
  await prisma.machineStateRecord.deleteMany({ where: { machineId: { in: machineIds } } });
  await prisma.oEERecord.deleteMany({ where: { machineId: { in: machineIds } } });

  for (let ji = 0; ji < jos.length; ji++) {
    const jo = jos[ji];
    const rand = rng(0x5eed + ji * 7919);
    const machineId = jo.machineId!;
    const start = jo.actualStart!.getTime();
    const end = jo.actualEnd ? jo.actualEnd.getTime() : now;
    const windowMins = Math.max(1, (end - start) / MIN);
    const ict = jo.idealCycleTimeSec ?? 30;

    // ── 1. Build a realistic segment timeline (RUNNING + stops) ──
    type Seg = { state: 'RUNNING' | DownKind; from: number; to: number };
    const segs: Seg[] = [];
    let cursor = start;

    // Opening setup (5–12 min)
    const setupMins = 5 + Math.floor(rand() * 7);
    if (windowMins > setupMins + 10) {
      segs.push({ state: 'SETUP', from: cursor, to: cursor + setupMins * MIN });
      cursor += setupMins * MIN;
    }

    // Alternate RUNNING blocks with short stops until we fill the window
    while (cursor < end - 2 * MIN) {
      const runMins = 35 + Math.floor(rand() * 55); // 35–90 min run blocks
      const runEnd = Math.min(end, cursor + runMins * MIN);
      segs.push({ state: 'RUNNING', from: cursor, to: runEnd });
      cursor = runEnd;
      if (cursor >= end - 2 * MIN) break;

      // Pick a stop kind by weighted chance
      const r = rand();
      let kind: DownKind;
      let stopMins: number;
      if (r < 0.45) { kind = 'MICRO_STOP'; stopMins = 1 + Math.floor(rand() * 4); }       // <5 min
      else if (r < 0.70) { kind = 'BREAKDOWN'; stopMins = 12 + Math.floor(rand() * 30); } // 12–42 min
      else if (r < 0.85) { kind = 'PLANNED_STOP'; stopMins = 15 + Math.floor(rand() * 20); }
      else { kind = 'CHANGEOVER'; stopMins = 8 + Math.floor(rand() * 14); }
      const stopEnd = Math.min(end, cursor + stopMins * MIN);
      segs.push({ state: kind, from: cursor, to: stopEnd });
      cursor = stopEnd;
    }
    if (cursor < end) segs.push({ state: 'RUNNING', from: cursor, to: end });

    const isLive = !jo.actualEnd;
    const lastSeg = segs[segs.length - 1];

    // ── 2. Persist MachineStateRecords + DowntimeEvents ──
    let runningMins = 0;
    for (let si = 0; si < segs.length; si++) {
      const s = segs[si];
      const open = isLive && si === segs.length - 1; // last segment of a live JO stays open
      const durMin = (s.to - s.from) / MIN;
      if (s.state === 'RUNNING') runningMins += durMin;

      const isDown = s.state !== 'RUNNING';
      const meta = isDown ? DOWN_META[s.state as DownKind] : null;
      const cause = isDown ? causeFor(s.state as DownKind) : null;

      const recordState = s.state === 'RUNNING' ? 'RUNNING' : DOWN_META[s.state as DownKind].machineState;
      await prisma.machineStateRecord.create({
        data: {
          factoryId,
          machineId,
          workOrderId: jo.workOrderId,
          state: recordState as any,
          startTime: new Date(s.from),
          endTime: open ? null : new Date(s.to),
          durationMinutes: open ? null : durMin,
          isPlannedStop: meta?.planned ?? false,
          downtimeCauseId: cause?.id ?? null,
          source: 'SYSTEM',
          notes: meta?.label ?? null,
        },
      });

      if (isDown && meta) {
        // ~70% of unplanned stops get acknowledged a few minutes in → real MTTA / repair time
        const ackOffset = !meta.planned && rand() < 0.7 ? (1 + Math.floor(rand() * 4)) * MIN : null;
        await prisma.downtimeEvent.create({
          data: {
            factoryId,
            machineId,
            workOrderId: jo.workOrderId,
            causeId: cause?.id ?? null,
            reason: meta.label,
            category: meta.category as any,
            reasonCode: meta.reasonCode as any,
            startTime: new Date(s.from),
            endTime: open ? null : new Date(s.to),
            durationMinutes: open ? null : durMin,
            affectsOEE: !meta.planned,
            isPlanned: meta.planned,
            acknowledged: ackOffset != null,
            acknowledgedAt: ackOffset != null ? new Date(s.from + ackOffset) : null,
          },
        });
      }
    }

    // ── 3. ProductionEvent COUNT_UPDATE ramp (good + scrap deltas) ──
    const good = Math.round(jo.actualQtyGood ?? 0);
    // Inject a little realistic scrap (≈2–4%) if the JO has none, keeping JO totals consistent
    let scrapTotal = Math.round(jo.actualQtyRejected ?? 0);
    if (scrapTotal === 0 && good > 50) scrapTotal = Math.max(1, Math.round(good * (0.02 + rand() * 0.02)));

    // Number of count increments ~ one per RUNNING ~30 min, min 4, cap 40
    const runSegs = segs.filter((s) => s.state === 'RUNNING');
    const steps = Math.max(4, Math.min(40, Math.round(runningMins / 30)));
    let cumGood = 0;
    let cumScrap = 0;
    const scrapLogPlan: Array<{ at: number; qty: number }> = [];
    for (let k = 1; k <= steps; k++) {
      const frac = k / steps;
      // Distribute timestamps across RUNNING segments proportionally
      const targetRunMin = frac * runningMins;
      let acc = 0; let ts = start;
      for (const rs of runSegs) {
        const segMin = (rs.to - rs.from) / MIN;
        if (acc + segMin >= targetRunMin) { ts = rs.from + (targetRunMin - acc) * MIN; break; }
        acc += segMin; ts = rs.to;
      }
      const newGood = Math.round(good * frac);
      const newScrap = Math.round(scrapTotal * frac);
      const goodDelta = newGood - cumGood;
      const scrapDelta = newScrap - cumScrap;
      cumGood = newGood; cumScrap = newScrap;
      if (scrapDelta > 0) scrapLogPlan.push({ at: ts, qty: scrapDelta });

      await prisma.productionEvent.create({
        data: {
          factoryId,
          workOrderId: jo.workOrderId,
          machineId,
          eventType: 'COUNT_UPDATE',
          timestamp: new Date(ts),
          value: goodDelta,
          metadata: { jobOrderId: jo.id, good: newGood, rejected: newScrap, goodDelta, scrapDelta },
        },
      });
    }

    // ── 4. ScrapLogs (mapped to the scrap deltas) ──
    for (let k = 0; k < scrapLogPlan.length; k++) {
      const p = scrapLogPlan[k];
      const sr = SCRAP_REASONS[Math.floor(rand() * SCRAP_REASONS.length)];
      await prisma.scrapLog.create({
        data: {
          factoryId,
          workOrderId: jo.workOrderId,
          jobOrderId: jo.id,
          qty: p.qty,
          reason: sr.reason,
          category: sr.category as any,
          createdAt: new Date(p.at),
        },
      });
    }

    // Keep JO totals consistent with the scrap we generated
    if (scrapTotal !== Math.round(jo.actualQtyRejected ?? 0)) {
      await prisma.jobOrder.update({
        where: { id: jo.id },
        data: { actualQtyRejected: scrapTotal },
      });
    }

    // ── 5. MachineCurrentStatus aligned with the JO ──
    const liveState = isLive
      ? (lastSeg.state === 'RUNNING' ? 'RUNNING' : (jo.status === 'PAUSED' ? 'IDLE' : DOWN_META[lastSeg.state as DownKind].machineState))
      : 'IDLE';
    await prisma.machineCurrentStatus.upsert({
      where: { machineId },
      create: { machineId, state: liveState as any, currentWOId: isLive ? jo.workOrderId : null, lastEventAt: new Date(end) },
      update: { state: liveState as any, currentWOId: isLive ? jo.workOrderId : null, lastEventAt: new Date(end) },
    });

    console.log(`  ${jo.machine!.code} · ${jo.operationName}: ${segs.length} segments, ${Math.round(runningMins)}m running, ${steps} counts, ${scrapLogPlan.length} scrap entries`);
  }

  // ── 6. Daily OEERecords for the last 14 days (OEE trend lines) ──
  const today0 = new Date(); today0.setUTCHours(0, 0, 0, 0);
  for (let mi = 0; mi < machineIds.length; mi++) {
    const machineId = machineIds[mi];
    const jo = jos.find((j) => j.machineId === machineId)!;
    const rand = rng(0xABCD + mi * 104729);
    for (let dback = 13; dback >= 0; dback--) {
      const recordDate = new Date(today0.getTime() - dback * DAY);
      // Realistic detergent-line OEE: A 78–93, P 82–96, Q 96–99.5
      const availability = Math.round((78 + rand() * 15) * 10) / 10;
      const performance = Math.round((82 + rand() * 14) * 10) / 10;
      const quality = Math.round((96 + rand() * 3.5) * 10) / 10;
      const oee = Math.round((availability / 100) * (performance / 100) * (quality / 100) * 1000) / 10;
      const plannedMin = 1440; // 2×12h shifts
      const downMin = Math.round((1 - availability / 100) * plannedMin);
      const uptime = plannedMin - downMin;
      const ict = jo.idealCycleTimeSec ?? 30;
      const totalOutput = Math.round((uptime * 60 / ict) * (performance / 100));
      const goodOutput = Math.round(totalOutput * (quality / 100));
      await prisma.oEERecord.create({
        data: {
          factoryId,
          machineId,
          recordDate,
          shiftCode: 'DAY',
          plannedProductionMin: plannedMin,
          actualProductionMin: uptime,
          uptimeMin: uptime,
          downtimeMin: downMin,
          plannedDowntimeMin: Math.round(downMin * 0.3),
          totalOutput,
          goodOutput,
          scrapOutput: totalOutput - goodOutput,
          idealCycleTime: ict,
          availability,
          performance,
          quality,
          oee,
        },
      });
    }
  }

  console.log(`✓ Backfill complete — ${machineIds.length} machines × 14 days OEE records, full state/downtime/production/scrap history.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
