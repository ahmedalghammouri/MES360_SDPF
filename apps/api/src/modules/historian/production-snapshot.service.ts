import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../database/prisma.service';
import { toBaseUnits, type SkuPackaging } from '../../common/units.util';

const MIN = 60_000;

/**
 * ProductionSnapshotService — writes the persistent OEE/production FACT store
 * (`production_snapshots`). Once a minute it captures, per active job order, the
 * production accrued in the current minute bucket (a DELTA against what closed
 * buckets already recorded) plus window-clamped time + A/P/Q/OEE, classified by
 * every dimension (shift/WO/PO/product/step/machine/line/area/factory).
 *
 * Design notes:
 *  • Each MINUTE row stores the per-bucket DELTA (not cumulative) so a window
 *    SUM is correct. The OPEN (current) bucket is upserted every tick; once its
 *    minute ends it is finalized (immutable). Restart-safe: the open delta is
 *    `JO.cumulative − Σ(finalized minute rows for this JO)`, read from the DB.
 *  • good = final step's good; scrap = every step's reject (both base-unit) —
 *    enforced at READ time via isFinalStep (see kpi.snapshotAggregate). Each row
 *    is per-step; the rollup rule avoids double-counting a routed WO.
 *  • Never throws — sampling must not disrupt production.
 */
@Injectable()
export class ProductionSnapshotService {
  private readonly logger = new Logger(ProductionSnapshotService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    try {
      await this.captureMinute(new Date());
    } catch (err) {
      this.logger.error('ProductionSnapshot tick failed', err as Error);
    }
  }

  /** Capture the current minute bucket for every active job order. */
  async captureMinute(at = new Date()): Promise<number> {
    const bucketStart = new Date(Math.floor(at.getTime() / MIN) * MIN);
    const bucketEnd = new Date(bucketStart.getTime() + MIN);

    // 1) Finalize any open MINUTE rows whose bucket has already ended (rollover).
    await this.prisma.productionSnapshot.updateMany({
      where: { granularity: 'MINUTE', isFinalized: false, bucketEnd: { lte: bucketStart } },
      data: { isFinalized: true },
    });

    // 2) Active job orders, enriched with every dimension needed to classify a row.
    const jos = await this.prisma.jobOrder.findMany({
      where: { status: { in: ['EXECUTING', 'PAUSED'] }, machineId: { not: null }, actualStart: { not: null } },
      select: {
        id: true, factoryId: true, machineId: true, workOrderId: true,
        sequenceOrder: true, operationName: true, outputUnit: true,
        idealCycleTimeSec: true, plannedStart: true, plannedEnd: true, actualStart: true,
        actualQtyGood: true, actualQtyRejected: true, plannedQtyOut: true,
        machine: { select: { lineId: true, areaId: true } },
        workOrder: {
          select: {
            productionOrderId: true, skuId: true, shiftInstanceId: true,
            sku: { select: { baseUnit: true, unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true } },
            shiftInstance: { select: { shiftTemplateId: true, shiftTemplate: { select: { code: true } } } },
          },
        },
      },
    });
    if (!jos.length) return 0;

    const woIds = [...new Set(jos.map((j) => j.workOrderId))];
    const joIds = jos.map((j) => j.id);
    const machineIds = [...new Set(jos.map((j) => j.machineId!).filter(Boolean))];

    // 3) Final-step lookup: max sequenceOrder across ALL of each WO's routed steps.
    const maxSeqRows = await this.prisma.jobOrder.groupBy({
      by: ['workOrderId'], where: { workOrderId: { in: woIds } }, _max: { sequenceOrder: true },
    });
    const maxSeq = new Map(maxSeqRows.map((r) => [r.workOrderId, r._max.sequenceOrder ?? 0]));

    // 4) Production already recorded in CLOSED minute buckets (per JO) → delta base.
    const priorRows = await this.prisma.productionSnapshot.groupBy({
      by: ['jobOrderId'],
      where: { granularity: 'MINUTE', isFinalized: true, jobOrderId: { in: joIds } },
      _sum: { goodRaw: true, scrapRaw: true },
    });
    const prior = new Map(priorRows.map((r) => [r.jobOrderId, { good: r._sum.goodRaw ?? 0, scrap: r._sum.scrapRaw ?? 0 }]));

    // 5) Downtime overlapping the current bucket window, per machine.
    const events = machineIds.length
      ? await this.prisma.downtimeEvent.findMany({
          where: { machineId: { in: machineIds }, startTime: { lte: at }, OR: [{ endTime: null }, { endTime: { gte: bucketStart } }] },
          select: { machineId: true, startTime: true, endTime: true, isPlanned: true, affectsOEE: true },
        })
      : [];

    let written = 0;
    for (const jo of jos) {
      const row = this.buildRow(jo, maxSeq, prior, events, bucketStart, bucketEnd, at);
      if (!row) continue;
      try {
        await this.prisma.productionSnapshot.upsert({
          where: { ux_snapshot_jo_bucket: { jobOrderId: jo.id, granularity: 'MINUTE', bucketStart } },
          create: row,
          update: row,
        });
        written++;
      } catch (e) {
        this.logger.warn(`snapshot upsert failed for JO ${jo.id}: ${(e as Error).message}`);
      }
    }
    return written;
  }

  private buildRow(
    jo: any,
    maxSeq: Map<string, number>,
    prior: Map<string, { good: number; scrap: number }>,
    events: { machineId: string | null; startTime: Date; endTime: Date | null; isPlanned: boolean; affectsOEE: boolean }[],
    bucketStart: Date, bucketEnd: Date, at: Date,
  ) {
    const sku: SkuPackaging | null = jo.workOrder?.sku ?? null;
    const unit: string | undefined = jo.outputUnit ?? undefined;
    const toBase = (q: number) => (sku && unit ? toBaseUnits(q, unit, sku) : q);

    // DELTA in this bucket = JO cumulative − what closed buckets already recorded.
    const p = prior.get(jo.id) ?? { good: 0, scrap: 0 };
    const goodRaw = Math.max(0, (jo.actualQtyGood ?? 0) - p.good);
    const scrapRaw = Math.max(0, (jo.actualQtyRejected ?? 0) - p.scrap);
    const totalRaw = goodRaw + scrapRaw;

    // Window-clamped time for this bucket [max(bucketStart, joStart), min(at, bucketEnd)].
    const joStart = jo.actualStart!.getTime();
    const winFrom = Math.max(bucketStart.getTime(), joStart);
    const winTo = Math.min(at.getTime(), bucketEnd.getTime());
    const elapsedMin = Math.max(0, (winTo - winFrom) / MIN);

    let downMin = 0, plannedDownMin = 0;
    for (const ev of events) {
      if (ev.machineId !== jo.machineId) continue;
      const from = Math.max(ev.startTime.getTime(), winFrom);
      const to = Math.min((ev.endTime ?? at).getTime(), winTo);
      const m = Math.max(0, (to - from) / MIN);
      if (m <= 0) continue;
      if (ev.isPlanned) plannedDownMin += m;
      else if (ev.affectsOEE) downMin += m;
    }
    // Mirror kpi.joRollupChild EXACTLY for OEE parity: runMin = actual operating span
    // in the bucket (downtime is NOT subtracted — it only feeds the time-based variant);
    // plannedMin = planned-window overlap with the bucket (falls back to runMin when the
    // JO has no planned span, so availability = 100 like joRollupChild's actualSpan floor).
    const psn = jo.plannedStart ? new Date(jo.plannedStart).getTime() : null;
    const pen = jo.plannedEnd ? new Date(jo.plannedEnd).getTime() : null;
    const runMin = elapsedMin;
    const plannedOverlap = (psn != null && pen != null)
      ? Math.max(0, (Math.min(pen, bucketEnd.getTime()) - Math.max(psn, bucketStart.getTime())) / MIN)
      : 0;
    // PPT is floored at runMin (joRollupChild: "if actualSpan > ppt, ppt = actualSpan"),
    // so availability ≤ 100 and Performance = earned/run (not earned/ppt).
    const plannedMin = Math.max(runMin, plannedOverlap);

    const goodBase = toBase(goodRaw);
    const scrapBase = toBase(scrapRaw);
    const totalBase = goodBase + scrapBase;
    const ict: number | null = jo.idealCycleTimeSec ?? null;
    // Earned minutes use the step's RAW count — idealCycleTimeSec is per OUTPUT UNIT
    // (e.g. per inner), so it must NOT be multiplied by base units (cartons). This
    // keeps Performance unit-safe and matches kpi.joRollupChild.
    const idealRunMin = ict ? (ict / 60) * totalRaw : 0;

    // Per-bucket metrics (informational; read-side recomputes from summed quantities).
    const availability = plannedMin > 0 ? Math.min(100, (runMin / plannedMin) * 100) : null;
    const availabilityTb = (runMin + downMin) > 0 ? Math.min(100, (runMin / (runMin + downMin)) * 100) : null;
    const performance = runMin > 0 && idealRunMin > 0 ? Math.min(100, (idealRunMin / runMin) * 100) : null;
    const quality = totalBase > 0 ? (goodBase / totalBase) * 100 : null;
    const pct = (a: number | null) => (a == null ? null : a / 100);
    const oee = availability != null && performance != null && quality != null
      ? pct(availability)! * pct(performance)! * pct(quality)! * 100 : null;
    const oeeTb = availabilityTb != null && performance != null && quality != null
      ? pct(availabilityTb)! * pct(performance)! * pct(quality)! * 100 : null;

    return {
      bucketStart, bucketEnd, granularity: 'MINUTE', isFinalized: false,
      factoryId: jo.factoryId,
      areaId: jo.machine?.areaId ?? null,
      lineId: jo.machine?.lineId ?? null,
      machineId: jo.machineId ?? null,
      jobOrderId: jo.id,
      workOrderId: jo.workOrderId,
      productionOrderId: jo.workOrder?.productionOrderId ?? null,
      skuId: jo.workOrder?.skuId ?? null,
      shiftInstanceId: jo.workOrder?.shiftInstanceId ?? null,
      shiftTemplateId: jo.workOrder?.shiftInstance?.shiftTemplateId ?? null,
      shiftCode: jo.workOrder?.shiftInstance?.shiftTemplate?.code ?? null,
      operationName: jo.operationName ?? null,
      sequenceOrder: jo.sequenceOrder ?? 0,
      isFinalStep: (jo.sequenceOrder ?? 0) === (maxSeq.get(jo.workOrderId) ?? 0),
      outputUnit: unit ?? null,
      baseUnit: sku?.baseUnit ?? null,
      goodRaw, scrapRaw, reworkRaw: 0, totalRaw,
      plannedQtyOutRaw: jo.plannedQtyOut ?? null,
      goodBase, scrapBase, reworkBase: 0, totalBase,
      plannedQtyOutBase: jo.plannedQtyOut != null ? toBase(jo.plannedQtyOut) : null,
      plannedMin, runMin, downMin, plannedDownMin, microStopMin: 0,
      idealCycleSec: ict, idealRunMin,
      availability, performance, quality, oee, availabilityTb, oeeTb,
    };
  }
}
