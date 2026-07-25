import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '@prisma/client';
import { OEEService, RollupChild, OEEBreakdown } from './oee.service';
import { toBaseUnits } from '../../common/units.util';

/**
 * KpiService — OEE orchestration & roll-up (Phase 2 of the OEE/KPI engine).
 * See docs/DESIGN-oee-kpi-engine.md.
 *
 * The Job Order is the source of truth: each JO contributes a {@link RollupChild}
 * (planned/run minutes + earned ideal minutes + final good/total counts). Those
 * roll up via the pure {@link OEEService.rollup} primitive to the WO, then to the
 * PO. Status is propagated forward JO→WO→PO and a `production.kpi.updated` event
 * is emitted for real-time clients.
 */

type SkuPkg = { baseUnit?: string | null; unitsPerInner?: number | null; innersPerCarton?: number | null; cartonsPerPallet?: number | null };
type JoLite = {
  id: string; machineId: string | null; status: string;
  idealCycleTimeSec: number | null;
  actualQtyGood: number; actualQtyRejected: number;
  plannedStart: Date | null; plannedEnd: Date | null;
  actualStart: Date | null; actualEnd: Date | null;
  sequenceOrder: number;
  // optional — only the analytics queries enrich these for base-unit-correct output
  outputUnit?: string | null;
  workOrderId?: string | null; // groups a routed WO's steps so output = its FINAL step
  workOrder?: { sku?: SkuPkg | null } | null;
};
type DtLite = {
  machineId: string; startTime: Date; endTime: Date | null;
  durationMinutes: number | null; isPlanned: boolean; affectsOEE: boolean;
};
type WoLite = {
  status: string; plannedCycleTime: number | null;
  actualQty: number; goodQty: number; scrapQty: number;
  actualStart: Date | null; actualEnd: Date | null;
};

const JO_SELECT = {
  id: true, machineId: true, status: true, idealCycleTimeSec: true,
  actualQtyGood: true, actualQtyRejected: true,
  plannedStart: true, plannedEnd: true, actualStart: true, actualEnd: true, sequenceOrder: true,
} as const;
const DT_SELECT = {
  machineId: true, startTime: true, endTime: true, durationMinutes: true, isPlanned: true, affectsOEE: true,
} as const;
// Analytics select — adds the step output unit + product packaging so production
// counts can be normalised to the SKU base unit before aggregating across steps.
const JO_SELECT_ANALYTICS = {
  ...JO_SELECT,
  outputUnit: true,
  plannedQtyOut: true,
  workOrderId: true,
  workOrder: { select: { sku: { select: { baseUnit: true, unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true } } } },
} as const;

@Injectable()
export class KpiService {
  private readonly logger = new Logger(KpiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly oee: OEEService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── time helpers ───────────────────────────────────────────────────────────
  private spanMin(start: Date | null, end: Date | null): number {
    if (!start) return 0;
    const e = end ? end.getTime() : Date.now();
    return Math.max(0, (e - start.getTime()) / 60_000);
  }
  private overlapMin(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
    const s = Math.max(aStart.getTime(), bStart.getTime());
    const e = Math.min(aEnd.getTime(), bEnd.getTime());
    return Math.max(0, (e - s) / 60_000);
  }

  private joPpt(jo: JoLite): number {
    if (jo.actualStart) return this.spanMin(jo.actualStart, jo.actualEnd);
    if (jo.plannedStart && jo.plannedEnd) return this.spanMin(jo.plannedStart, jo.plannedEnd);
    return 0;
  }

  /** Unplanned downtime minutes attributed to a JO (its machine, overlapping its active window). */
  private joUnplanned(jo: JoLite, downtime: DtLite[]): number {
    if (!jo.actualStart) return 0;
    const js = jo.actualStart;
    const je = jo.actualEnd ?? new Date();
    let mins = 0;
    for (const d of downtime) {
      if (d.isPlanned || !d.affectsOEE) continue;
      if (jo.machineId && d.machineId !== jo.machineId) continue;
      const de = d.endTime ?? new Date();
      mins += this.overlapMin(js, je, d.startTime, de);
    }
    return mins;
  }

  /** Summed RollupChild for a WO — from its JOs (routed) or the WO header (non-routed). */
  private woChild(wo: WoLite, jos: JoLite[], downtime: DtLite[]): RollupChild {
    if (jos.length === 0) {
      const ppt = this.spanMin(wo.actualStart, wo.actualEnd);
      const unplanned = downtime
        .filter(d => !d.isPlanned && d.affectsOEE)
        .reduce((s, d) => s + (d.durationMinutes ?? this.spanMin(d.startTime, d.endTime)), 0);
      const total = wo.actualQty || (wo.goodQty + wo.scrapQty);
      const idealMin = wo.plannedCycleTime ? wo.plannedCycleTime / 60 : 0;
      return { ppt, runTime: Math.max(0, ppt - unplanned), idealRunTime: idealMin * total, totalCount: total, goodCount: wo.goodQty };
    }

    const ordered = [...jos].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    let ppt = 0, runTime = 0, idealRunTime = 0;
    for (const jo of ordered) {
      const p = this.joPpt(jo);
      const unplanned = this.joUnplanned(jo, downtime);
      const joTotal = (jo.actualQtyGood ?? 0) + (jo.actualQtyRejected ?? 0);
      const idealMin = jo.idealCycleTimeSec ? jo.idealCycleTimeSec / 60 : 0;
      ppt += p;
      runTime += Math.max(0, p - unplanned);
      idealRunTime += idealMin * joTotal; // earned minutes per step (unit-correct per step)
    }
    // Quality is unit-based → use the FINAL step's output (units are consistent there).
    const last = ordered[ordered.length - 1];
    const totalCount = (last.actualQtyGood ?? 0) + (last.actualQtyRejected ?? 0);
    const goodCount = last.actualQtyGood ?? 0;
    return { ppt, runTime, idealRunTime, totalCount, goodCount };
  }

  // ── status derivation (forward-only; never overrides hold/cancel) ───────────
  private deriveWoStatus(current: string, jos: { status: string }[]): string | null {
    if (['ON_HOLD', 'CANCELLED', 'COMPLETED'].includes(current) || jos.length === 0) return null;
    if (jos.every(j => ['COMPLETE', 'CANCELLED'].includes(j.status)) && jos.some(j => j.status === 'COMPLETE')) return 'COMPLETED';
    if (jos.some(j => ['EXECUTING', 'PAUSED'].includes(j.status))) return 'IN_PROGRESS';
    return null;
  }
  private derivePoStatus(current: string, woStatuses: string[]): string | null {
    if (['ON_HOLD', 'CANCELLED', 'COMPLETED'].includes(current) || woStatuses.length === 0) return null;
    if (woStatuses.every(s => ['COMPLETED', 'CANCELLED'].includes(s)) && woStatuses.some(s => s === 'COMPLETED')) return 'COMPLETED';
    if (woStatuses.some(s => s === 'IN_PROGRESS')) return 'IN_PROGRESS';
    return null;
  }

  // ── public API ──────────────────────────────────────────────────────────────

  /** Recompute a WO's OEE (rolled up from its JOs), propagate status & PO, emit live event. */
  async recomputeWorkOrderAndPO(workOrderId: string): Promise<void> {
    try {
      const wo = await this.prisma.workOrder.findUnique({
        where: { id: workOrderId },
        include: { jobOrders: { select: JO_SELECT }, downtimeEvents: { select: DT_SELECT } },
      });
      if (!wo) return;

      const child = this.woChild(wo as unknown as WoLite, wo.jobOrders as JoLite[], wo.downtimeEvents as DtLite[]);
      const b = this.oee.rollup([child]);
      const woStatus = this.deriveWoStatus(wo.status, wo.jobOrders as JoLite[]);

      await this.prisma.workOrder.update({
        where: { id: workOrderId },
        data: {
          oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality,
          downtimeMinutes: Math.max(0, Math.round((child.ppt - child.runTime) * 10) / 10),
          ...(woStatus && woStatus !== wo.status
            ? { status: woStatus as never, ...(woStatus === 'IN_PROGRESS' && !wo.actualStart ? { actualStart: new Date() } : {}) }
            : {}),
        },
      });

      const po = wo.productionOrderId ? await this.recomputeProductionOrder(wo.productionOrderId) : null;

      this.eventEmitter.emit('production.kpi.updated', {
        factoryId: wo.factoryId,
        workOrderId,
        productionOrderId: wo.productionOrderId,
        wo: { id: workOrderId, oee: b.oee, status: woStatus ?? wo.status },
        po,
      });
    } catch (e) {
      this.logger.error(`recomputeWorkOrderAndPO(${workOrderId}) failed`, e as Error);
    }
  }

  /** Recompute a PO's OEE (rolled up from its WOs) + completedQty + forward status. */
  async recomputeProductionOrder(productionOrderId: string): Promise<{ id: string; oee: number; status: string } | null> {
    const po = await this.prisma.productionOrder.findUnique({
      where: { id: productionOrderId },
      include: {
        workOrders: {
          where: { deletedAt: null, status: { not: 'CANCELLED' } },
          include: { jobOrders: { select: JO_SELECT }, downtimeEvents: { select: DT_SELECT } },
        },
      },
    });
    if (!po) return null;

    const children = po.workOrders.map(wo =>
      this.woChild(wo as unknown as WoLite, wo.jobOrders as JoLite[], wo.downtimeEvents as DtLite[]),
    );
    const b = this.oee.rollup(children);
    const poStatus = this.derivePoStatus(po.status, po.workOrders.map(w => w.status));
    const completedQty = po.workOrders.reduce((s, w) => s + (w.goodQty || 0), 0);

    await this.prisma.productionOrder.update({
      where: { id: productionOrderId },
      data: {
        oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality,
        completedQty,
        ...(poStatus && poStatus !== po.status
          ? {
              status: poStatus as never,
              ...(poStatus === 'IN_PROGRESS' && !po.actualStart ? { actualStart: new Date() } : {}),
              ...(poStatus === 'COMPLETED' ? { actualEnd: new Date() } : {}),
            }
          : {}),
      },
    });
    return { id: productionOrderId, oee: b.oee, status: poStatus ?? po.status };
  }

  // ── Asset-hierarchy OEE (Factory → Area → Line → Machine) ───────────────────

  /** Map a stored OEERecord to a RollupChild (idealRunTime reconstructed from stored performance). */
  private recordToChild(r: { plannedProductionMin: number; uptimeMin: number; performance: number; totalOutput: number; goodOutput: number }): RollupChild {
    return {
      ppt: r.plannedProductionMin || 0,
      runTime: r.uptimeMin || 0,
      idealRunTime: ((r.performance ?? 0) / 100) * (r.uptimeMin || 0),
      totalCount: r.totalOutput || 0,
      goodCount: r.goodOutput || 0,
    };
  }

  /**
   * Per-JO RollupChild for asset-hierarchy OEE (availability = run/planned span).
   *
   * PPT (planned production time) is CLAMPED to the analysis window when one is
   * given: a job order planned over weeks (e.g. a WO rescheduled months out for a
   * material delivery) must NOT contribute its whole multi-week planned span to a
   * one-week OEE — that single JO would otherwise collapse the aggregate
   * availability (the classic "plant OEE 1.4% while every machine is 99%" bug).
   * PPT is floored at the in-window actual run so availability never exceeds 100%.
   */
  private joRollupChild(jo: JoLite, win?: { from: number; to: number }): RollupChild {
    const ps = jo.plannedStart ? new Date(jo.plannedStart).getTime() : null;
    const pe = jo.plannedEnd ? new Date(jo.plannedEnd).getTime() : null;
    let plannedSpan = ps != null && pe != null ? (pe - ps) / 60_000 : 0;
    if (win && ps != null && pe != null) {
      // Only the planned time that falls inside the analysis window counts.
      plannedSpan = Math.max(0, Math.min(pe, win.to) - Math.max(ps, win.from)) / 60_000;
    }
    const actualSpan = this.spanMin(jo.actualStart, jo.actualEnd);
    let ppt = plannedSpan > 0 ? plannedSpan : actualSpan;
    if (actualSpan > ppt) ppt = actualSpan; // ran longer than planned-in-window → PPT ≥ run
    const good = jo.actualQtyGood ?? 0;
    const total = good + (jo.actualQtyRejected ?? 0);
    // A job order that produced NOTHING (e.g. a PAUSED step whose actualEnd is null,
    // so spanMin counts now−start as "run") has no production to measure OEE on.
    // Counting its open-ended run with zero earned time drags the aggregate
    // Performance down — so exclude no-output operations from the rollup entirely.
    if (total <= 0) return { ppt: 0, runTime: 0, idealRunTime: 0, totalCount: 0, goodCount: 0 };
    // idealRunTime (earned minutes) stays in the step's OWN unit → time is unit-safe,
    // and the rollup re-derives idealCycleTime = idealRunTime/totalCount so A/P are
    // unaffected by the unit of totalCount.
    const idealRunTime = (jo.idealCycleTimeSec ? jo.idealCycleTimeSec / 60 : 0) * total;
    // Counts are normalised to the product BASE UNIT so summing/quality across steps
    // (inners + cartons + pallets) is consistent — same principle as the live dashboard.
    const sku = jo.workOrder?.sku ?? null;
    const totalCount = sku && jo.outputUnit ? toBaseUnits(total, jo.outputUnit, sku) : total;
    const goodCount = sku && jo.outputUnit ? toBaseUnits(good, jo.outputUnit, sku) : good;
    return { ppt: Math.max(0, ppt), runTime: Math.max(0, actualSpan), idealRunTime, totalCount, goodCount };
  }

  private nodeFromChildren(id: string, name: string, code: string | null, type: string, children: RollupChild[], childNodes?: unknown[]) {
    const b = this.oee.rollup(children);
    return {
      id, name, code, type,
      oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality,
      output: b.totalCount, good: b.goodCount,
      losses: b.losses,
      children: childNodes ?? [],
    };
  }

  /**
   * Output / good / scrap for ANY multi-step scope (line, area, factory, plant).
   *
   * A routed work order flows the SAME physical batch through serial steps
   * (Filling → Cartoning → Palletising → Wrapping), each recording its own qty in
   * its own unit. Summing every step's count multiplies one batch by the number of
   * steps (the "10 pallets reported as 2 500" bug). The truthful line output is the
   * GOOD output of the FINAL step; scrap is the sum of rejects at EVERY step (units
   * lost anywhere on the line). Everything is normalised to the SKU base unit so
   * inners + cartons + pallets are comparable. Grouped per work order, then summed.
   */
  private finalStepCounts(jos: JoLite[]): { total: number; good: number; scrap: number } {
    const groups = new Map<string, JoLite[]>();
    for (const jo of jos) {
      const k = jo.workOrderId ?? `__jo_${jo.id}`; // un-routed JOs stand alone
      const arr = groups.get(k) ?? [];
      arr.push(jo);
      groups.set(k, arr);
    }
    let good = 0;
    let scrap = 0;
    for (const arr of groups.values()) {
      const ordered = [...arr].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
      const sku = ordered[0]?.workOrder?.sku ?? null;
      const toBase = (qty: number, unit?: string | null) =>
        sku && unit ? toBaseUnits(qty, unit, sku) : qty;
      // Good = FINAL step's good output (what actually left the line).
      const final = ordered[ordered.length - 1];
      good += toBase(final.actualQtyGood ?? 0, final.outputUnit);
      // Scrap = rejects at every step (a unit can be lost at any stage).
      for (const jo of ordered) scrap += toBase(jo.actualQtyRejected ?? 0, jo.outputUnit);
    }
    return { good, scrap, total: good + scrap };
  }

  /**
   * Weighted OEE for a set of job orders. Availability/Performance are time-weighted
   * across every JO (each machine's run vs planned + earned minutes), while the
   * count-based metrics (output, good, scrap → Quality) use {@link finalStepCounts}
   * so a routed WO is never multi-counted. This is the single aggregation primitive
   * for any scope above a single step.
   */
  private aggregateJos(jos: JoLite[], win?: { from: number; to: number }): OEEBreakdown {
    let ppt = 0, runTime = 0, idealRunTime = 0;
    for (const jo of jos) {
      const c = this.joRollupChild(jo, win);
      ppt += c.ppt; runTime += c.runTime; idealRunTime += c.idealRunTime;
    }
    const counts = this.finalStepCounts(jos);
    return this.oee.calculateDetailed({
      plannedProductionTime: ppt,
      unplannedDowntime: Math.max(0, ppt - runTime),
      // Re-derive cycle so calculateDetailed reproduces the summed earned minutes
      // exactly → Performance is unchanged; only counts/Quality are corrected.
      idealCycleTime: counts.total > 0 ? idealRunTime / counts.total : 0,
      totalCount: counts.total,
      goodCount: counts.good,
    });
  }

  // ── Fact-store reads (ProductionSnapshot) ──────────────────────────────────
  /** True when dashboards should aggregate the persisted fact store, not live JOs. */
  snapshotsEnabled(): boolean {
    return process.env.SNAPSHOTS_READ === 'on';
  }

  /** Build an OEEBreakdown-shaped result + AT-OEE from summed fact-store quantities. */
  private snapMetrics(good: number, scrap: number, ppt: number, run: number, down: number, earned: number) {
    const total = good + scrap;
    const b = this.oee.calculateDetailed({
      plannedProductionTime: ppt,
      unplannedDowntime: Math.max(0, ppt - run),
      idealCycleTime: total > 0 ? earned / total : 0,
      totalCount: total,
      goodCount: good,
    });
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const availabilityTb = (run + down) > 0 ? Math.min(100, (run / (run + down)) * 100) : 0;
    const oeeTb = (availabilityTb / 100) * (b.performance / 100) * (b.quality / 100) * 100;
    return { ...b, availabilityTb: r1(availabilityTb), oeeTb: r1(oeeTb), totalCount: total, goodCount: good, downMin: r1(down) };
  }

  /** SUM columns for a fact-store rollup. `good` filters to the group's final step
   *  (last sequenceOrder), referenced via the joined `fin` CTE alias. */
  private snapMetricCols(finAlias: string): Prisma.Sql {
    return Prisma.sql`
      COALESCE(SUM(s."scrapBase"),0)::float8 AS scrap,
      COALESCE(SUM(s."goodBase") FILTER (WHERE s."sequenceOrder" = ${Prisma.raw(finAlias)}.ms),0)::float8 AS good,
      COALESCE(SUM(s."plannedMin"),0)::float8 AS ppt,
      COALESCE(SUM(s."runMin"),0)::float8 AS run,
      COALESCE(SUM(s."downMin"),0)::float8 AS down,
      COALESCE(SUM(s."idealRunMin"),0)::float8 AS earned`;
  }

  /** Headline rollup (final step per WO across the scope) → metrics for one node/scope. */
  async snapshotScope(factoryId: string | null, from: Date, to: Date, machineIds: string[] | undefined) {
    if (machineIds && machineIds.length === 0) return this.snapMetrics(0, 0, 0, 0, 0, 0);
    const where = this.snapWhere(factoryId, from, to, machineIds);
    const [t] = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH scoped AS (SELECT * FROM production_snapshots WHERE ${where}),
           fin AS (SELECT "workOrderId", MAX("sequenceOrder") ms FROM scoped GROUP BY "workOrderId")
      SELECT ${this.snapMetricCols('f')} FROM scoped s JOIN fin f ON f."workOrderId" = s."workOrderId"`);
    return this.snapMetrics(t?.good ?? 0, t?.scrap ?? 0, t?.ppt ?? 0, t?.run ?? 0, t?.down ?? 0, t?.earned ?? 0);
  }

  private snapWhere(factoryId: string | null, from: Date, to: Date, machineIds?: string[]): Prisma.Sql {
    const c: Prisma.Sql[] = [
      Prisma.sql`granularity = 'MINUTE'`,
      Prisma.sql`"bucketStart" >= ${from}`,
      Prisma.sql`"bucketStart" < ${to}`,
    ];
    if (factoryId) c.push(Prisma.sql`"factoryId" = ${factoryId}`);
    if (machineIds) c.push(Prisma.sql`"machineId" = ANY(${machineIds})`);
    return Prisma.join(c, ' AND ');
  }

  /**
   * Window/scope aggregation from the persisted fact store — the canonical
   * read path. Mirrors the live engine EXACTLY: good = Σ good of the LAST step
   * PRESENT IN SCOPE per work order (so a single non-final machine still reports
   * its own throughput); scrap = Σ all in-scope steps; total derived; A/P/Q/OEE
   * recomputed from the summed quantities. The "final among in-scope" rule is the
   * SQL twin of kpi.finalStepCounts and avoids double-counting routed WOs.
   */
  async snapshotAggregate(
    factoryId: string | null, from: Date, to: Date, machineIds: string[] | undefined,
    bucket: 'hour' | 'day' = 'hour',
  ) {
    // Empty scope (a hierarchy node covering no machines) → all-zero result.
    if (machineIds && machineIds.length === 0) {
      const z = this.snapMetrics(0, 0, 0, 0, 0, 0);
      return { current: { oee: z.oee, availability: z.availability, performance: z.performance, quality: z.quality, availabilityTb: z.availabilityTb, oeeTb: z.oeeTb }, totalOutput: 0, goodOutput: 0, downtimeMin: 0, byEquipment: [], trend: [] };
    }
    const where = this.snapWhere(factoryId, from, to, machineIds);

    // Headline — final step per WO across the whole scope.
    const current = await this.snapshotScope(factoryId, from, to, machineIds);

    // Per-machine — each machine is its own scope (final step per WO ON THAT MACHINE).
    const perM = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH scoped AS (SELECT * FROM production_snapshots WHERE ${where}),
           fin AS (SELECT "machineId", "workOrderId", MAX("sequenceOrder") ms FROM scoped GROUP BY "machineId", "workOrderId")
      SELECT s."machineId" AS id, m.name, m.code, ${this.snapMetricCols('f')}
      FROM scoped s
      JOIN fin f ON f."machineId" = s."machineId" AND f."workOrderId" = s."workOrderId"
      JOIN machines m ON m.id = s."machineId"
      GROUP BY s."machineId", m.name, m.code`);
    const byEquipment = perM.map((r) => {
      const b = this.snapMetrics(r.good, r.scrap, r.ppt, r.run, r.down, r.earned);
      return { machineId: r.id, name: r.name, code: r.code, oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality, availabilityTb: b.availabilityTb, oeeTb: b.oeeTb, output: b.totalCount };
    }).sort((a, b) => b.oee - a.oee);

    // Trend — final step per WO within each time bucket.
    const labelF = bucket === 'hour'
      ? Prisma.sql`to_char("bucketStart", 'HH24') || ':00'`
      : Prisma.sql`(EXTRACT(MONTH FROM "bucketStart")::int || '/' || EXTRACT(DAY FROM "bucketStart")::int)`;
    const tr = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH scoped AS (SELECT *, ${labelF} AS period FROM production_snapshots WHERE ${where}),
           fin AS (SELECT period, "workOrderId", MAX("sequenceOrder") ms FROM scoped GROUP BY period, "workOrderId")
      SELECT s.period, MIN(s."bucketStart") AS sort, ${this.snapMetricCols('f')}
      FROM scoped s JOIN fin f ON f.period = s.period AND f."workOrderId" = s."workOrderId"
      GROUP BY s.period ORDER BY sort`);
    const trend = tr.map((r) => {
      const b = this.snapMetrics(r.good, r.scrap, r.ppt, r.run, r.down, r.earned);
      // Carry every metric per bucket so trend charts can plot any KPI (not just OEE).
      return {
        period: r.period, oee: b.oee, oeeTb: b.oeeTb,
        availability: b.availability, availabilityTb: b.availabilityTb,
        performance: b.performance, quality: b.quality,
        output: b.totalCount, good: b.goodCount, scrap: b.totalCount - b.goodCount, down: b.downMin,
      };
    });

    return {
      current: { oee: current.oee, availability: current.availability, performance: current.performance, quality: current.quality, availabilityTb: current.availabilityTb, oeeTb: current.oeeTb },
      totalOutput: current.totalCount,
      goodOutput: current.goodCount,
      downtimeMin: current.downMin,
      byEquipment,
      trend,
    };
  }

  /**
   * Per-day full OEE breakdown for ONE machine, from the fact store. The canonical
   * machine OEE trend — replaces the InfluxDB / OEERecord machine history so the JO
   * detail (and any machine analytics) matches every other dashboard exactly.
   * Each day uses the final step per WO on that machine, A/P/Q/OEE (+ time-based)
   * recomputed from the summed quantities.
   */
  async snapshotMachineTrend(factoryId: string | null, machineId: string, from: Date, to: Date) {
    const where = this.snapWhere(factoryId, from, to, [machineId]);
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH scoped AS (SELECT *, date_trunc('day', "bucketStart") AS d FROM production_snapshots WHERE ${where}),
           fin AS (SELECT d, "workOrderId", MAX("sequenceOrder") ms FROM scoped GROUP BY d, "workOrderId")
      SELECT s.d AS date, ${this.snapMetricCols('f')}
      FROM scoped s JOIN fin f ON f.d = s.d AND f."workOrderId" = s."workOrderId"
      GROUP BY s.d ORDER BY s.d`);
    return rows.map((r) => {
      const b = this.snapMetrics(r.good, r.scrap, r.ppt, r.run, r.down, r.earned);
      return {
        date: r.date,
        availability: b.availability, availabilityTb: b.availabilityTb,
        performance: b.performance, quality: b.quality,
        oee: b.oee, oeeTb: b.oeeTb,
      };
    });
  }

  /** Hierarchy node built from JOs (final-step counts) instead of pre-summed children. */
  private nodeFromJos(id: string, name: string, code: string | null, type: string, jos: JoLite[], win: { from: number; to: number }, childNodes?: unknown[]) {
    const b = this.aggregateJos(jos, win);
    return {
      id, name, code, type,
      oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality,
      output: b.totalCount, good: b.goodCount,
      losses: b.losses,
      children: childNodes ?? [],
    };
  }

  /** Resolve an analysis scope to the covered machine ids (undefined = whole factory). */
  async resolveScopeMachineIds(
    factoryId: string | null,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
  ): Promise<string[] | undefined> {
    if (!scope || (!scope.areaId && !scope.lineId && !scope.machineId)) return undefined;
    if (scope.machineId) return [scope.machineId];
    const ms = await this.prisma.machine.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(scope.lineId ? { lineId: scope.lineId } : {}),
        ...(scope.areaId ? { line: { areaId: scope.areaId } } : {}),
      },
      select: { id: true },
    });
    return ms.map((m) => m.id);
  }

  /**
   * The canonical per-machine OEE source: aggregates JOB ORDERS in a window (scoped
   * to machineIds) via the engine. Returns the rolled-up A/P/Q/OEE, output, a
   * per-equipment breakdown and a time-bucketed trend. Used by every OEE/KPI surface
   * so a routed WO's machines all get real OEE (not just the WO header machine).
   */
  async oeeAnalytics(
    factoryId: string | null,
    from: Date,
    to: Date,
    machineIds: string[] | undefined,
    bucket: 'hour' | 'day' = 'hour',
    opts: { workOrderId?: string; productionOrderId?: string } = {},
  ) {
    // Canonical read path: aggregate the persisted fact store (stable, dimension-
    // classified). Falls back to the live JO scan for PO/WO drill-downs (not yet
    // wired into snapshotAggregate) and whenever the SNAPSHOTS_READ flag is off.
    if (this.snapshotsEnabled() && !opts.workOrderId && !opts.productionOrderId) {
      return this.snapshotAggregate(factoryId, from, to, machineIds, bucket);
    }

    const jos = await this.prisma.jobOrder.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(machineIds ? { machineId: { in: machineIds } } : {}),
        // PO / WO drill-down — so every OEE card & chart reacts to the PO/WO filter.
        ...(opts.workOrderId ? { workOrderId: opts.workOrderId } : {}),
        ...(opts.productionOrderId ? { workOrder: { productionOrderId: opts.productionOrderId } } : {}),
        OR: [{ actualStart: { gte: from, lte: to } }, { actualEnd: { gte: from, lte: to } }],
      },
      select: { ...JO_SELECT_ANALYTICS, machine: { select: { id: true, name: true, code: true } } },
    });

    // Unplanned downtime overlapping these machines/window — needed for the SECOND
    // availability method (time-based / AT-OEE), exposed alongside schedule-based OEE
    // so every KPI/OEE surface can show both (matches the JO-live dashboard + historian).
    const dtMachineIds = [...new Set(jos.map((j) => j.machineId).filter(Boolean))] as string[];
    const downtime = dtMachineIds.length
      ? (await this.prisma.downtimeEvent.findMany({
          where: {
            ...(factoryId ? { factoryId } : {}),
            machineId: { in: dtMachineIds },
            startTime: { lte: to },
            OR: [{ endTime: null }, { endTime: { gte: from } }],
          },
          select: DT_SELECT,
        })) as unknown as DtLite[]
      : [];

    const all = jos as unknown as JoLite[];
    const win = { from: from.getTime(), to: to.getTime() };
    const current = this.aggregateJos(all, win);
    const currentTb = this.timeBasedOee(all, downtime, current.performance, current.quality);

    const perMachine = new Map<string, { name: string; code: string | null; jos: JoLite[] }>();
    const buckets = new Map<string, JoLite[]>();
    for (const jo of all) {
      if (jo.machineId) {
        const e = perMachine.get(jo.machineId) ?? { name: (jo as any).machine?.name ?? 'Unknown', code: (jo as any).machine?.code ?? null, jos: [] as JoLite[] };
        e.jos.push(jo);
        perMachine.set(jo.machineId, e);
      }
      const d = jo.actualStart ?? jo.actualEnd;
      if (d) {
        const dt = new Date(d);
        const label = bucket === 'hour' ? `${String(dt.getHours()).padStart(2, '0')}:00` : `${dt.getMonth() + 1}/${dt.getDate()}`;
        const arr = buckets.get(label) ?? [];
        arr.push(jo);
        buckets.set(label, arr);
      }
    }

    const byEquipment = [...perMachine.entries()].map(([id, { name, code, jos: mjos }]) => {
      const b = this.aggregateJos(mjos, win);
      const tb = this.timeBasedOee(mjos, downtime, b.performance, b.quality);
      return { machineId: id, name, code, oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality, availabilityTb: tb.availabilityTb, oeeTb: tb.oeeTb, output: b.totalCount };
    }).sort((a, b) => b.oee - a.oee);

    const trend = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([period, bjos]) => {
        const b = this.aggregateJos(bjos, win);
        const tb = this.timeBasedOee(bjos, downtime, b.performance, b.quality);
        // Carry every metric per bucket so trend charts can plot any KPI (not just OEE).
        return {
          period, oee: b.oee, oeeTb: tb.oeeTb,
          availability: b.availability, availabilityTb: tb.availabilityTb,
          performance: b.performance, quality: b.quality,
          output: b.totalCount, good: b.goodCount, scrap: b.totalCount - b.goodCount, down: tb.downtimeMin,
        };
      });

    return {
      // Schedule-based (classic) OEE + the time-based (AT-OEE) variant, side by side.
      current: {
        oee: current.oee, availability: current.availability, performance: current.performance, quality: current.quality,
        availabilityTb: currentTb.availabilityTb, oeeTb: currentTb.oeeTb,
      },
      totalOutput: current.totalCount,
      goodOutput: current.goodCount,
      downtimeMin: currentTb.downtimeMin,
      byEquipment,
      trend,
    };
  }

  /**
   * OEE grouped by a business dimension instead of time buckets — so a chart can
   * show OEE per Production Order / Work Order / Shift / Machine over the window,
   * not just a sparse time line. Each group is a proper time-weighted rollup
   * (same engine + window-clamped PPT as the headline OEE).
   */
  /** Fact-store rollup grouped by a business dimension (twin of oeeGroupedTrend). */
  async snapshotGrouped(
    factoryId: string | null, from: Date, to: Date, machineIds: string[] | undefined,
    groupBy: 'machine' | 'workOrder' | 'productionOrder' | 'shift',
  ) {
    if (machineIds && machineIds.length === 0) return [];
    const colSql: Record<string, string> = {
      machine: '"machineId"',
      workOrder: '"workOrderId"',
      productionOrder: `COALESCE("productionOrderId",'__direct')`,
      shift: `COALESCE("shiftInstanceId",'__noshift')`,
    };
    const col = Prisma.raw(colSql[groupBy] ?? '"machineId"');
    const where = this.snapWhere(factoryId, from, to, machineIds);
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH scoped AS (SELECT * FROM production_snapshots WHERE ${where}),
           fin AS (SELECT ${col} AS gk, "workOrderId" AS wo, MAX("sequenceOrder") ms FROM scoped GROUP BY ${col}, "workOrderId")
      SELECT ${col} AS key, ${this.snapMetricCols('f')}
      FROM scoped s JOIN fin f ON f.gk = ${col} AND f.wo = s."workOrderId"
      GROUP BY ${col}`);

    // Resolve human labels for the keys (one lightweight lookup per dimension).
    const keys = rows.map((r) => r.key).filter((k) => k && !String(k).startsWith('__'));
    const labels = new Map<string, string>();
    if (groupBy === 'machine' && keys.length) {
      (await this.prisma.machine.findMany({ where: { id: { in: keys } }, select: { id: true, name: true, code: true } }))
        .forEach((m) => labels.set(m.id, m.name ?? m.code ?? '—'));
    } else if (groupBy === 'workOrder' && keys.length) {
      (await this.prisma.workOrder.findMany({ where: { id: { in: keys } }, select: { id: true, orderNumber: true } }))
        .forEach((w) => labels.set(w.id, w.orderNumber));
    } else if (groupBy === 'productionOrder' && keys.length) {
      (await this.prisma.productionOrder.findMany({ where: { id: { in: keys } }, select: { id: true, orderNumber: true } }))
        .forEach((p) => labels.set(p.id, p.orderNumber));
    } else if (groupBy === 'shift' && keys.length) {
      (await this.prisma.shiftInstance.findMany({ where: { id: { in: keys } }, select: { id: true, shiftDate: true, shiftTemplate: { select: { name: true } } } }))
        .forEach((s) => labels.set(s.id, `${s.shiftTemplate?.name ?? 'Shift'} · ${new Date(s.shiftDate).toISOString().slice(0, 10)}`));
    }
    const fallback = groupBy === 'productionOrder' ? 'Direct WOs' : groupBy === 'shift' ? 'Unassigned' : '—';

    return rows
      .map((r) => {
        const b = this.snapMetrics(r.good, r.scrap, r.ppt, r.run, r.down, r.earned);
        return {
          key: r.key, label: labels.get(r.key) ?? fallback,
          oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality,
          output: Math.round(b.totalCount), good: Math.round(b.goodCount),
        };
      })
      .filter((r) => r.output > 0)
      .sort((a, b) => b.output - a.output);
  }

  async oeeGroupedTrend(
    factoryId: string | null,
    from: Date,
    to: Date,
    machineIds: string[] | undefined,
    groupBy: 'machine' | 'workOrder' | 'productionOrder' | 'shift',
    opts: { workOrderId?: string; productionOrderId?: string } = {},
  ) {
    if (this.snapshotsEnabled() && !opts.workOrderId && !opts.productionOrderId) {
      return this.snapshotGrouped(factoryId, from, to, machineIds, groupBy);
    }

    const jos = await this.prisma.jobOrder.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(machineIds ? { machineId: { in: machineIds } } : {}),
        ...(opts.workOrderId ? { workOrderId: opts.workOrderId } : {}),
        ...(opts.productionOrderId ? { workOrder: { productionOrderId: opts.productionOrderId } } : {}),
        OR: [{ actualStart: { gte: from, lte: to } }, { actualEnd: { gte: from, lte: to } }],
      },
      select: {
        ...JO_SELECT,
        outputUnit: true,
        plannedQtyOut: true,
        workOrderId: true,
        machine: { select: { name: true, code: true } },
        workOrder: {
          select: {
            orderNumber: true,
            productionOrderId: true,
            sku: { select: { baseUnit: true, unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true } },
            productionOrder: { select: { orderNumber: true } },
            shiftInstance: { select: { id: true, shiftDate: true, shiftTemplate: { select: { name: true } } } },
          },
        },
      },
    });

    const win = { from: from.getTime(), to: to.getTime() };
    const groups = new Map<string, { label: string; jos: JoLite[] }>();
    for (const jo of jos as any[]) {
      let key: string | null = null;
      let label = '';
      if (groupBy === 'machine') { key = jo.machineId; label = jo.machine?.name ?? jo.machine?.code ?? '—'; }
      else if (groupBy === 'workOrder') { key = jo.workOrderId; label = jo.workOrder?.orderNumber ?? '—'; }
      else if (groupBy === 'productionOrder') { key = jo.workOrder?.productionOrderId ?? '__direct'; label = jo.workOrder?.productionOrder?.orderNumber ?? 'Direct WOs'; }
      else { // shift
        const si = jo.workOrder?.shiftInstance;
        key = si?.id ?? '__noshift';
        label = si ? `${si.shiftTemplate?.name ?? 'Shift'} · ${new Date(si.shiftDate).toISOString().slice(0, 10)}` : 'Unassigned';
      }
      if (!key) continue;
      const g = groups.get(key) ?? { label, jos: [] as JoLite[] };
      g.jos.push(jo as unknown as JoLite);
      groups.set(key, g);
    }

    return [...groups.entries()]
      .map(([key, g]) => {
        const b = this.aggregateJos(g.jos, win);
        return {
          key, label: g.label,
          oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality,
          output: Math.round(b.totalCount), good: Math.round(b.goodCount),
        };
      })
      .filter((r) => r.output > 0)
      .sort((a, b) => b.output - a.output);
  }

  /**
   * Time-based availability (AT-OEE): runMin / (runMin + downMin), where runMin is operating
   * time net of unplanned downtime. Reuses the schedule-based Performance & Quality — only
   * Availability differs — exactly as the JO-live dashboard and historian define it.
   */
  private timeBasedOee(jos: JoLite[], downtime: DtLite[], performance: number, quality: number) {
    let operating = 0;
    let down = 0;
    for (const jo of jos) {
      operating += this.spanMin(jo.actualStart, jo.actualEnd);
      down += this.joUnplanned(jo, downtime);
    }
    const net = Math.max(0, operating - down);
    const availabilityTb = operating > 0 ? Math.min(100, (net / operating) * 100) : 0;
    const oeeTb = (availabilityTb / 100) * (performance / 100) * (quality / 100) * 100;
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return { availabilityTb: r1(availabilityTb), oeeTb: r1(oeeTb), downtimeMin: r1(down) };
  }

  /** JO-derived per-machine OEE rows (replaces sparse one-per-WO OEERecord for KPI history/lists). */
  async oeeRecordsFromJobOrders(
    factoryId: string | null,
    from: Date,
    to: Date,
    machineIds: string[] | undefined,
    limit = 200,
  ) {
    const jos = await this.prisma.jobOrder.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(machineIds ? { machineId: { in: machineIds } } : {}),
        OR: [{ actualStart: { gte: from, lte: to } }, { actualEnd: { gte: from, lte: to } }],
      },
      select: { ...JO_SELECT_ANALYTICS, machine: { select: { name: true, code: true } } },
      orderBy: { actualStart: 'desc' },
      take: limit,
    });

    // Unplanned downtime for these machines/window → per-record time-based (AT-OEE) values.
    const dtMachineIds = [...new Set(jos.map((j) => j.machineId).filter(Boolean))] as string[];
    const downtime = dtMachineIds.length
      ? (await this.prisma.downtimeEvent.findMany({
          where: {
            ...(factoryId ? { factoryId } : {}),
            machineId: { in: dtMachineIds },
            startTime: { lte: to },
            OR: [{ endTime: null }, { endTime: { gte: from } }],
          },
          select: DT_SELECT,
        })) as unknown as DtLite[]
      : [];

    const recWin = { from: from.getTime(), to: to.getTime() };
    return jos.map((jo) => {
      const b = this.oee.rollup([this.joRollupChild(jo as unknown as JoLite, recWin)]);
      const tb = this.timeBasedOee([jo as unknown as JoLite], downtime, b.performance, b.quality);
      // Planned output (base-unit normalised, like total/good) so reports can show a real
      // Planned vs Actual instead of Planned == Actual.
      const sku = (jo as any).workOrder?.sku ?? null;
      const plannedRaw = (jo as any).plannedQtyOut ?? 0;
      const plannedOutput = sku && jo.outputUnit ? toBaseUnits(plannedRaw, jo.outputUnit, sku) : plannedRaw;
      return {
        id: jo.id,
        machineId: jo.machineId,
        machine: (jo as any).machine ?? null,
        recordDate: (jo.actualStart ?? jo.actualEnd ?? new Date()),
        oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality,
        oeeTb: tb.oeeTb, availabilityTb: tb.availabilityTb,
        plannedOutput,
        totalOutput: b.totalCount, goodOutput: b.goodCount,
        scrapOutput: b.totalCount - b.goodCount,
      };
    });
  }

  /**
   * Weighted OEE rolled up the asset hierarchy + six-loss + Pareto by reason code,
   * over [dateFrom, dateTo] (defaults to the last 7 days). Powers the OEE Analytics tree.
   */
  async hierarchyOEE(
    factoryId: string | null,
    dateFrom?: string,
    dateTo?: string,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
  ) {
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999Z`) : new Date();
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00.000Z`) : new Date(to.getTime() - 7 * 86_400_000);
    const factoryFilter = factoryId ? { factoryId } : {};

    // Resolve the scope (area/line/machine) to the set of machines it covers.
    const machines = await this.prisma.machine.findMany({
      where: {
        ...factoryFilter,
        ...(scope?.machineId ? { id: scope.machineId } : {}),
        ...(scope?.lineId ? { lineId: scope.lineId } : {}),
        ...(scope?.areaId ? { line: { areaId: scope.areaId } } : {}),
      },
      select: { id: true, name: true, code: true, lineId: true, line: { select: { id: true, name: true, code: true, areaId: true, area: { select: { id: true, name: true, code: true } } } } },
    });
    const machineIds = machines.map((m) => m.id);

    // Per-machine OEE is sourced from JOB ORDERS (a WO spans many machines via its
    // routed steps), so every machine that ran a step gets real OEE — not just the
    // WO's header machine. Matches the per-JO OEE shown on the job-orders page.
    const [jobOrders, downtime] = await Promise.all([
      this.prisma.jobOrder.findMany({
        where: {
          ...factoryFilter,
          machineId: { in: machineIds },
          OR: [
            { actualStart: { gte: from, lte: to } },
            { actualEnd: { gte: from, lte: to } },
          ],
        },
        select: JO_SELECT_ANALYTICS,
      }),
      this.prisma.downtimeEvent.findMany({
        where: { ...factoryFilter, isPlanned: false, affectsOEE: true, startTime: { gte: from, lte: to }, machineId: { in: machineIds } },
        select: { reasonCode: true, durationMinutes: true },
      }),
    ]);

    // Bucket JOs by machine. Output/good/scrap roll up via final-step counts
    // (finalStepCounts) so a routed WO is never multi-counted up the hierarchy;
    // per-machine nodes still reflect each machine's own throughput.
    const hierWin = { from: from.getTime(), to: to.getTime() };
    const byMachine = new Map<string, JoLite[]>();
    for (const jo of jobOrders as JoLite[]) {
      if (!jo.machineId) continue;
      const arr = byMachine.get(jo.machineId) ?? [];
      arr.push(jo);
      byMachine.set(jo.machineId, arr);
    }
    const allJos: JoLite[] = [...byMachine.values()].flat();

    // Build Area → Line → Machine tree (only branches that have machines with data or exist)
    type Bucket = { id: string; name: string; code: string | null; lines: Map<string, { id: string; name: string; code: string | null; machines: typeof machines }> };
    const areas = new Map<string, Bucket>();
    const UNASSIGNED = { id: '__unassigned__', name: 'Unassigned', code: null as string | null };

    for (const m of machines) {
      const area = m.line?.area ?? UNASSIGNED;
      const lineId = m.line?.id ?? '__noline__';
      const lineName = m.line?.name ?? 'Unassigned line';
      const lineCode = m.line?.code ?? null;
      if (!areas.has(area.id)) areas.set(area.id, { id: area.id, name: area.name, code: (area as any).code ?? null, lines: new Map() });
      const ab = areas.get(area.id)!;
      if (!ab.lines.has(lineId)) ab.lines.set(lineId, { id: lineId, name: lineName, code: lineCode, machines: [] });
      ab.lines.get(lineId)!.machines.push(m);
    }

    const josOf = (ms: typeof machines): JoLite[] => ms.flatMap(m => byMachine.get(m.id) ?? []);
    const useSnap = this.snapshotsEnabled();

    // A node's metrics come from the fact store (snapshotScope, scope = its machine ids)
    // when SNAPSHOTS_READ is on, else from the live JO rollup. Shape is identical.
    const snapNode = async (id: string, name: string, code: string | null, type: string, ms: typeof machines, childNodes?: unknown[]) => {
      const b = await this.snapshotScope(factoryId, from, to, ms.map(x => x.id));
      return { id, name, code, type, oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality, output: b.totalCount, good: b.goodCount, losses: b.losses, children: childNodes ?? [] };
    };

    const tree = await Promise.all([...areas.values()].map(async ab => {
      const lineNodes = await Promise.all([...ab.lines.values()].map(async ln => {
        const machineNodes = useSnap
          ? await Promise.all(ln.machines.map(m => snapNode(m.id, m.name, m.code, 'MACHINE', [m])))
          : ln.machines.map(m => this.nodeFromJos(m.id, m.name, m.code, 'MACHINE', byMachine.get(m.id) ?? [], hierWin));
        return useSnap
          ? snapNode(ln.id, ln.name, ln.code, 'LINE', ln.machines, machineNodes)
          : this.nodeFromJos(ln.id, ln.name, ln.code, 'LINE', josOf(ln.machines), hierWin, machineNodes);
      }));
      const areaMachines = [...ab.lines.values()].flatMap(l => l.machines);
      return useSnap
        ? snapNode(ab.id, ab.name, ab.code, 'AREA', areaMachines, lineNodes)
        : this.nodeFromJos(ab.id, ab.name, ab.code, 'AREA', josOf(areaMachines), hierWin, lineNodes);
    }));
    tree.sort((a, b) => b.oee - a.oee);

    const plant = useSnap ? await this.snapshotScope(factoryId, from, to, machineIds) : this.aggregateJos(allJos, hierWin);

    // Pareto by reason code
    const paretoMap = new Map<string, { reasonCode: string; minutes: number; events: number }>();
    for (const d of downtime) {
      const k = d.reasonCode;
      const e = paretoMap.get(k) ?? { reasonCode: k, minutes: 0, events: 0 };
      e.minutes += d.durationMinutes ?? 0;
      e.events += 1;
      paretoMap.set(k, e);
    }
    const pareto = [...paretoMap.values()].sort((a, b) => b.minutes - a.minutes)
      .map(p => ({ ...p, minutes: Math.round(p.minutes * 10) / 10 }));

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      plant: {
        oee: plant.oee, availability: plant.availability, performance: plant.performance, quality: plant.quality,
        output: plant.totalCount, good: plant.goodCount, losses: plant.losses,
      },
      pareto,
      tree,
    };
  }

  /** Entry point from JO mutations — recompute the parent WO (and PO) and broadcast. */
  async propagateFromJobOrder(jobOrderId: string): Promise<void> {
    try {
      const jo = await this.prisma.jobOrder.findUnique({ where: { id: jobOrderId }, select: { workOrderId: true } });
      if (jo?.workOrderId) await this.recomputeWorkOrderAndPO(jo.workOrderId);
    } catch (e) {
      this.logger.error(`propagateFromJobOrder(${jobOrderId}) failed`, e as Error);
    }
  }
}
