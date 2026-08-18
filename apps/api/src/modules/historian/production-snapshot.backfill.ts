import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { toPieces, type SkuPackaging } from '../../common/units.util';
import { splitStoppedTime } from '../../common/stopped-time.util';

const MIN = 60_000;

/**
 * ProductionSnapshotBackfill — reconstructs the `production_snapshots` fact store
 * for HISTORICAL job orders so dashboards have real per-shift/WO/PO/product/machine
 * history immediately (not just from "now" forward).
 *
 * Deterministic + idempotent: counts are apportioned across each JO's actual run
 * window (exact totals preserved, remainder on the last bucket); downtime overlap
 * gives per-bucket time. Re-running upserts the same rows (unique key). Rows are
 * written finalized (immutable). Granularity = MINUTE, matching the live writer.
 */
@Injectable()
export class ProductionSnapshotBackfill {
  private readonly logger = new Logger(ProductionSnapshotBackfill.name);

  async run(
    prisma: PrismaClient,
    opts: { factoryId?: string | null; from?: Date; to?: Date; days?: number } = {},
  ): Promise<{ jobOrders: number; rows: number }> {
    const to = opts.to ?? new Date();
    const from = opts.from ?? new Date(to.getTime() - (opts.days ?? 30) * 24 * 60 * MIN);

    const jos = await prisma.jobOrder.findMany({
      where: {
        ...(opts.factoryId ? { factoryId: opts.factoryId } : {}),
        actualStart: { not: null, lte: to },
        OR: [{ actualEnd: { gte: from } }, { actualEnd: null }],
      },
      select: {
        id: true, factoryId: true, machineId: true, workOrderId: true,
        sequenceOrder: true, operationName: true, outputUnit: true,
        idealCycleTimeSec: true, plannedStart: true, plannedEnd: true,
        actualStart: true, actualEnd: true,
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

    // Filter window in code (actualStart <= to) — keeps the where clause simple/portable.
    const inWindow = jos.filter((j) => j.actualStart && j.actualStart.getTime() <= to.getTime());
    if (!inWindow.length) return { jobOrders: 0, rows: 0 };

    const woIds = [...new Set(inWindow.map((j) => j.workOrderId))];
    const maxSeqRows = await prisma.jobOrder.groupBy({ by: ['workOrderId'], where: { workOrderId: { in: woIds } }, _max: { sequenceOrder: true } });
    const maxSeq = new Map(maxSeqRows.map((r) => [r.workOrderId, r._max.sequenceOrder ?? 0]));

    let rows = 0;
    for (const jo of inWindow) {
      rows += await this.backfillJo(prisma, jo, maxSeq, from, to);
    }
    this.logger.log(`Backfill complete — ${inWindow.length} job orders, ${rows} snapshot rows`);
    return { jobOrders: inWindow.length, rows };
  }

  private async backfillJo(prisma: PrismaClient, jo: any, maxSeq: Map<string, number>, from: Date, to: Date): Promise<number> {
    const sku: SkuPackaging | null = jo.workOrder?.sku ?? null;
    const unit: string | undefined = jo.outputUnit ?? undefined;
    // The *Base columns hold PIECES — the smallest rung of the packaging ladder,
    // where conversion is exact and steps counting in different units can be summed.
    // This used toBaseUnits, which converts to the SKU INVENTORY base unit (CARTON
    // here), so every fact-store quantity was a carton count that the dashboards then
    // labelled "pcs". Inventory keeps its own base unit; analytics must not borrow it.
    const toBase = (q: number) => (sku && unit ? toPieces(q, unit, sku) : q);

    const startMs = jo.actualStart!.getTime();
    const endMs = Math.min((jo.actualEnd ?? to).getTime(), to.getTime());
    if (endMs <= startMs) return 0;

    const bucket0 = Math.floor(startMs / MIN) * MIN;
    const buckets: number[] = [];
    for (let b = bucket0; b < endMs; b += MIN) buckets.push(b);
    if (!buckets.length) return 0;

    const finalGood = jo.actualQtyGood ?? 0;
    const finalScrap = jo.actualQtyRejected ?? 0;
    const isFinal = (jo.sequenceOrder ?? 0) === (maxSeq.get(jo.workOrderId) ?? 0);

    // Downtime overlapping the JO run, split planned/unplanned.
    const events = jo.machineId
      ? await prisma.downtimeEvent.findMany({
          where: { machineId: jo.machineId, startTime: { lte: new Date(endMs) }, OR: [{ endTime: null }, { endTime: { gte: new Date(startMs) } }] },
          select: { startTime: true, endTime: true, isPlanned: true, affectsOEE: true },
        })
      : [];

    // Apportion counts evenly across active minutes; last bucket carries remainder.
    const n = buckets.length;
    const goodPer = finalGood / n;
    const scrapPer = finalScrap / n;
    let written = 0;

    for (let i = 0; i < n; i++) {
      const bStart = buckets[i];
      const bEnd = bStart + MIN;
      const winFrom = Math.max(bStart, startMs);
      const winTo = Math.min(bEnd, endMs);
      const elapsedMin = Math.max(0, (winTo - winFrom) / MIN);

      const goodRaw = i === n - 1 ? Math.max(0, finalGood - goodPer * (n - 1)) : goodPer;
      const scrapRaw = i === n - 1 ? Math.max(0, finalScrap - scrapPer * (n - 1)) : scrapPer;
      const totalRaw = goodRaw + scrapRaw;

      // Same three-way split as the live writer, through the SAME helper — overlaps
      // and duplicate events merged, then assigned by precedence.
      const { plannedMin: plannedDownMin, externalMin, downMin } =
        splitStoppedTime(events, winFrom, winTo, winTo);
      // Run time is OPERATING time — see production-snapshot.service for the full
      // reasoning. Unplanned stops leave run but stay in PPT (so they are charged to
      // Availability); planned and rule-excluded stops leave both.
      const psn = jo.plannedStart ? jo.plannedStart.getTime() : null;
      const pen = jo.plannedEnd ? jo.plannedEnd.getTime() : null;
      const excluded = plannedDownMin + externalMin;
      const runMin = Math.max(0, elapsedMin - downMin - excluded);
      const plannedOverlap = (psn != null && pen != null)
        ? Math.max(0, (Math.min(pen, bEnd) - Math.max(psn, bStart)) / MIN)
        : 0;
      // PPT floored at the ELAPSED span, not at runMin — flooring at run would pull the
      // downtime out of the denominator too and pin availability back at 100%.
      const plannedMin = Math.max(0, Math.max(elapsedMin, plannedOverlap) - excluded);

      const goodBase = toBase(goodRaw);
      const scrapBase = toBase(scrapRaw);
      const totalBase = goodBase + scrapBase;
      const ict: number | null = jo.idealCycleTimeSec ?? null;
      // Earned minutes use the RAW count (idealCycleTimeSec is per output unit) — see kpi.joRollupChild.
      const idealRunMin = ict ? (ict / 60) * totalRaw : 0;

      const availability = plannedMin > 0 ? Math.min(100, (runMin / plannedMin) * 100) : null;
      const availabilityTb = (runMin + downMin) > 0 ? Math.min(100, (runMin / (runMin + downMin)) * 100) : null;
      const performance = runMin > 0 && idealRunMin > 0 ? Math.min(100, (idealRunMin / runMin) * 100) : null;
      const quality = totalBase > 0 ? (goodBase / totalBase) * 100 : null;
      const oee = availability != null && performance != null && quality != null ? (availability / 100) * (performance / 100) * (quality / 100) * 100 : null;
      const oeeTb = availabilityTb != null && performance != null && quality != null ? (availabilityTb / 100) * (performance / 100) * (quality / 100) * 100 : null;

      const data = {
        bucketStart: new Date(bStart), bucketEnd: new Date(bEnd), granularity: 'MINUTE', isFinalized: true,
        factoryId: jo.factoryId,
        areaId: jo.machine?.areaId ?? null, lineId: jo.machine?.lineId ?? null, machineId: jo.machineId ?? null,
        jobOrderId: jo.id, workOrderId: jo.workOrderId,
        productionOrderId: jo.workOrder?.productionOrderId ?? null, skuId: jo.workOrder?.skuId ?? null,
        shiftInstanceId: jo.workOrder?.shiftInstanceId ?? null,
        shiftTemplateId: jo.workOrder?.shiftInstance?.shiftTemplateId ?? null,
        shiftCode: jo.workOrder?.shiftInstance?.shiftTemplate?.code ?? null,
        operationName: jo.operationName ?? null, sequenceOrder: jo.sequenceOrder ?? 0, isFinalStep: isFinal,
        outputUnit: unit ?? null, baseUnit: sku?.baseUnit ?? null,
        goodRaw, scrapRaw, reworkRaw: 0, totalRaw, plannedQtyOutRaw: jo.plannedQtyOut ?? null,
        goodBase, scrapBase, reworkBase: 0, totalBase, plannedQtyOutBase: jo.plannedQtyOut != null ? toBase(jo.plannedQtyOut) : null,
        plannedMin, runMin, downMin, plannedDownMin, externalMin, microStopMin: 0, idealCycleSec: ict, idealRunMin,
        availability, performance, quality, oee, availabilityTb, oeeTb,
      };
      await prisma.productionSnapshot.upsert({
        where: { ux_snapshot_jo_bucket: { jobOrderId: jo.id, granularity: 'MINUTE', bucketStart: new Date(bStart) } },
        create: data, update: data,
      });
      written++;
    }
    return written;
  }
}
