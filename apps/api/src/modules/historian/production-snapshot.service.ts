import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../database/prisma.service';
import { toPieces, type SkuPackaging } from '../../common/units.util';
import { resolveShiftAt, type ShiftTemplateWindow, type ResolvedShift } from '../../common/shift-window.util';
import { splitStoppedTime, observedTime } from '../../common/stopped-time.util';

const MIN = 60_000;

/**
 * States that count as producing. RUNNING is the only one: SETUP and CHANGEOVER
 * are work, but they are not output, and the rules already class them as planned
 * stops. Matches PRODUCING in machine-status.service — the timeline and the fact
 * store must not disagree about what "running" looks like.
 */
const PRODUCING_STATES: ReadonlySet<string> = new Set(['RUNNING']);

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

  /** Capture the just-completed minute bucket for every active job order. */
  async captureMinute(at = new Date()): Promise<number> {
    // The cron fires at second :00, so the bucket containing `at` has barely any
    // elapsed time — capturing it recorded a full minute of plannedMin against ~2 ms
    // of runMin, which collapsed schedule-based availability (and therefore OEE) to 0
    // while the time-based variant stayed healthy. Snapshot the CLOSED minute instead:
    // `at` is then past bucketEnd, so runMin is the full 60 s the job order actually ran.
    const bucketStart = new Date(Math.floor(at.getTime() / MIN) * MIN - MIN);
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

    // 5b) What the machines SAID they were doing in this bucket. Downtime events
    //     say why a stop was booked; these say whether the machine was running at
    //     all — the difference between a measurement and an assumption.
    const states = machineIds.length
      ? await this.prisma.machineStateRecord.findMany({
          where: { machineId: { in: machineIds }, startTime: { lte: at }, OR: [{ endTime: null }, { endTime: { gte: bucketStart } }] },
          select: { machineId: true, state: true, startTime: true, endTime: true },
        })
      : [];

    // 6) Which SHIFT this bucket belongs to — derived from the templates, not from a
    //    ShiftInstance row. Nothing creates those rows, so shift grouping was
    //    permanently "Unassigned" while the Command Center showed the shift NAME
    //    (which it derives from the templates). Deriving it per bucket attributes one
    //    production order across every shift it actually ran in, history included.
    const factoryIds = [...new Set(jos.map((j: any) => j.factoryId).filter(Boolean))] as string[];
    const shiftByFactory = new Map<string, ResolvedShift | null>();
    for (const fid of factoryIds) {
      const templates = (await this.prisma.shiftTemplate.findMany({
        where: { factoryId: fid, isActive: true },
        orderBy: { startTime: 'asc' },
        select: { id: true, code: true, name: true, startTime: true, endTime: true, crossesMidnight: true },
      })) as ShiftTemplateWindow[];
      shiftByFactory.set(fid, resolveShiftAt(bucketStart, templates));
    }

    let written = 0;
    for (const jo of jos) {
      const row = this.buildRow(
        jo, maxSeq, prior, events, states, bucketStart, bucketEnd, at,
        shiftByFactory.get(jo.factoryId) ?? null,
      );
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
    states: { machineId: string; state: string; startTime: Date; endTime: Date | null }[],
    bucketStart: Date, bucketEnd: Date, at: Date,
    shift: ResolvedShift | null = null,
  ) {
    const sku: SkuPackaging | null = jo.workOrder?.sku ?? null;
    const unit: string | undefined = jo.outputUnit ?? undefined;
    // The *Base columns hold PIECES — the smallest rung of the packaging ladder,
    // where conversion is exact and steps counting in different units can be summed.
    // This used toBaseUnits, which converts to the SKU INVENTORY base unit (CARTON
    // here), so every fact-store quantity was a carton count that the dashboards then
    // labelled "pcs". Inventory keeps its own base unit; analytics must not borrow it.
    const toBase = (q: number) => (sku && unit ? toPieces(q, unit, sku) : q);

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

    // Three kinds of stopped time, and the DowntimeEvent itself says which is which:
    // `isPlanned` and `affectsOEE` are stamped onto the event from the machine's
    // MachineStateRule when the state opens it. So the classification is the plant's
    // configuration, not a list of state names compiled into the code — mark a state
    // as planned, or as not affecting OEE, and this follows without a deploy.
    //
    // splitStoppedTime merges overlaps rather than summing durations: this log
    // contains duplicated events and minutes covered by a planned AND an unplanned
    // stop at once, and summing them made the stopped total exceed the bucket.
    const { plannedMin: plannedDownMin, externalMin, downMin } = splitStoppedTime(
      events.filter((ev) => ev.machineId === jo.machineId),
      winFrom, winTo, at.getTime(),
    );
    // Run time is OPERATING time: the span the job order occupied, minus every minute
    // the machine was stopped in it. Until this change runMin was the raw elapsed span,
    // so a machine that broke down mid-bucket still reported a full minute of run and
    // availability could not fall below 100% — the stop was only visible in the
    // time-based variant. Both bases now agree on what "running" means.
    //
    // Each kind of stop leaves the equation differently:
    //   • unplanned (downMin)      → out of run, STAYS in PPT  → charged to Availability
    //   • planned   (plannedDownMin) → out of both              → excluded by definition
    //   • external  (externalMin)  → out of both                → the line's constraint,
    //                                                             not this machine's fault
    // which makes PPT − run = downMin EXACTLY — the identity every read surface
    // assumes, and the reason the three kinds are split by precedence above rather
    // than summed.
    const psn = jo.plannedStart ? new Date(jo.plannedStart).getTime() : null;
    const pen = jo.plannedEnd ? new Date(jo.plannedEnd).getTime() : null;
    const excluded = plannedDownMin + externalMin;

    // ── Run time is MEASURED, not assumed ───────────────────────────────────
    //
    // `elapsedMin - stops` credits the machine with producing unless something
    // proves it stopped. That is fail-OPEN, and it is how machines that reported
    // no running time whatsoever still showed 97% availability: their stops never
    // produced downtime events, so nothing contradicted the assumption.
    //
    // The state history is the measurement. When the machine reported anything at
    // all in this bucket, run time is capped at the minutes it actually spent in a
    // producing state; the shortfall is time it was neither producing nor excused,
    // and it is charged as unplanned downtime so PPT − run still equals downMin.
    //
    // When the machine reported NOTHING — no status signal wired, like the
    // Checkweigher — there is no measurement to cap with, and silence is not
    // evidence of a stop. That case keeps the old assumption and is the argument
    // for binding a Run Mode signal to every machine.
    const { coveredMin, producingMin } = observedTime(
      states.filter((st) => st.machineId === jo.machineId),
      winFrom, winTo, at.getTime(), PRODUCING_STATES,
    );
    const accountable = Math.max(0, elapsedMin - downMin - excluded);
    // Run time is only ever the minutes the machine reported PRODUCING. Time it
    // did not report at all is neither run nor down — it is unmeasured, and
    // calling it production is the same fail-open assumption this replaced, just
    // applied to a different gap. A machine with no status signal now reports no
    // availability rather than a flattering one.
    const runMin = Math.min(accountable, Math.max(0, producingMin - excluded));
    // Observed but not producing and not excused → a stop, charged to availability.
    // Never observed → carved out of both sides, and reported as its own quantity.
    const unmeasuredMin = Math.max(0, accountable - Math.max(0, coveredMin - excluded));
    const unexplainedMin = Math.max(0, accountable - runMin - unmeasuredMin);
    // Anything the machine did not produce in, and no rule excused, is a stop —
    // named as unexplained rather than quietly folded into production.
    const plannedOverlap = (psn != null && pen != null)
      ? Math.max(0, (Math.min(pen, bucketEnd.getTime()) - Math.max(psn, bucketStart.getTime())) / MIN)
      : 0;
    // PPT is floored at the elapsed span (joRollupChild: "if actualSpan > ppt, ppt =
    // actualSpan") — NOT at runMin, or subtracting downtime from run would subtract it
    // from the denominator too and availability would stay pinned at 100%.
    const plannedMin = Math.max(0, Math.max(elapsedMin, plannedOverlap) - excluded - unmeasuredMin);

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
      // A linked ShiftInstance still wins when one exists — an explicitly started
      // shift is a deliberate record. Otherwise the shift is DERIVED from when this
      // bucket happened, so attribution never depends on someone pressing Start.
      shiftInstanceId: jo.workOrder?.shiftInstanceId ?? null,
      shiftTemplateId: jo.workOrder?.shiftInstance?.shiftTemplateId ?? shift?.templateId ?? null,
      shiftCode: jo.workOrder?.shiftInstance?.shiftTemplate?.code ?? shift?.code ?? null,
      operationName: jo.operationName ?? null,
      sequenceOrder: jo.sequenceOrder ?? 0,
      isFinalStep: (jo.sequenceOrder ?? 0) === (maxSeq.get(jo.workOrderId) ?? 0),
      outputUnit: unit ?? null,
      baseUnit: sku?.baseUnit ?? null,
      goodRaw, scrapRaw, reworkRaw: 0, totalRaw,
      plannedQtyOutRaw: jo.plannedQtyOut ?? null,
      goodBase, scrapBase, reworkBase: 0, totalBase,
      plannedQtyOutBase: jo.plannedQtyOut != null ? toBase(jo.plannedQtyOut) : null,
      plannedMin, runMin, downMin: downMin + unexplainedMin, plannedDownMin, externalMin, unmeasuredMin, microStopMin: 0,
      idealCycleSec: ict, idealRunMin,
      availability, performance, quality, oee, availabilityTb, oeeTb,
    };
  }
}
