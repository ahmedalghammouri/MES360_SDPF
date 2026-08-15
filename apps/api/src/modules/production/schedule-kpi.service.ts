import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { toPieces } from '../../common/units.util';

/**
 * ScheduleKpiService — the two production KPIs NCC asked for, using the formulas
 * they supplied verbatim:
 *
 *   MSA = Σ min(Actual Qty, Scheduled Qty) ÷ Total Scheduled Qty × 100
 *   Capacity Utilization (Volume) = Actual Units Produced ÷ Maximum Designed Unit Capacity × 100
 *
 * Both return the raw numerator and denominator alongside the percentage, so the
 * figure can be reconciled against the source rows without re-deriving anything.
 */

export interface MsaLine {
  productionOrderId: string;
  orderNumber: string;
  sku: string | null;
  scheduledQty: number;
  actualQty: number;
  /** min(actual, scheduled) — the credited quantity for this line. */
  creditedQty: number;
  attainmentPct: number;
  status: string;
}

export interface MsaResult {
  msaPct: number;
  totalScheduledQty: number;
  totalCreditedQty: number;
  totalActualQty: number;
  orderCount: number;
  window: { from: string; to: string };
  lines: MsaLine[];
  method: {
    formula: string;
    note: string;
  };
}

export interface CapacityUtilizationResult {
  utilizationPct: number;
  actualUnits: number;
  maxDesignedUnits: number;
  windowHours: number;
  machineCount: number;
  /** Machines in scope with no routing step carrying a cycle time — no denominator. */
  machinesMissingCapacity: { id: string; name: string; code: string | null; reason: string }[];
  byMachine: {
    machineId: string; name: string; code: string | null;
    /** Rated throughput in PIECES per hour, derived from the routing step. */
    ratedUnitsPerHour: number | null;
    /** The routing step the rate came from — so the figure is traceable to master data. */
    ratedFrom: {
      processId: string; processName: string; stepNumber: number; operationName: string;
      cycleTimeSec: number; outUnit: string | null; machineOverride: boolean;
    } | null;
    maxDesignedUnits: number;
    actualUnits: number;
    utilizationPct: number | null;
  }[];
  window: { from: string; to: string };
  method: {
    formula: string;
    capacityBasis: string;
    note: string;
  };
}

/** A machine's rated throughput, resolved from routing master data. */
export interface RatedCapacity {
  machineId: string;
  /** PIECES per hour — the canonical unit for all internal quantity arithmetic. */
  unitsPerHour: number;
  processId: string;
  processName: string;
  stepNumber: number;
  operationName: string;
  cycleTimeSec: number;
  outUnit: string | null;
  /** True when the rate came from a machine-specific override on the step. */
  machineOverride: boolean;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

@Injectable()
export class ScheduleKpiService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Rated throughput per machine, derived from the ROUTING STEPS — the same master
   * data that generates job orders and drives scheduling.
   *
   * There is deliberately no separate "design capacity" field to keep in sync: a
   * machine's rate is a property of the operation it performs on a given product,
   * and that already lives on `RoutingStep.cycleTimeSec` ("seconds per one out-unit"),
   * optionally overridden per machine on `RoutingStepMachineOption`. Reading it here
   * means capacity analytics can never drift from what the scheduler actually plans.
   *
   * Cycle times are normalised to PIECES before comparison, because a step producing
   * PALLETs and one producing INNERs are not otherwise comparable — and because the
   * actual output this rate is divided into is also totalled in pieces.
   *
   * When several routings cover the same machine (different products), the SLOWEST
   * rate is kept — capacity utilization must not be flattered by a rate the machine
   * only achieves on its easiest product.
   */
  async ratedCapacityByMachine(
    factoryId: string | null,
    machineIds: string[],
    opts: { skuId?: string } = {},
  ): Promise<Map<string, RatedCapacity>> {
    if (machineIds.length === 0) return new Map();

    const steps = await this.prisma.routingStep.findMany({
      where: {
        process: {
          ...(factoryId ? { factoryId } : {}),
          isActive: true,
          ...(opts.skuId ? { skuId: opts.skuId } : {}),
        },
        OR: [
          { machineId: { in: machineIds } },
          { machineOptions: { some: { machineId: { in: machineIds }, isActive: true } } },
        ],
      },
      select: {
        id: true, stepNumber: true, operationName: true, cycleTimeSec: true,
        outUnit: true, machineId: true,
        process: {
          select: {
            id: true, name: true,
            sku: { select: { baseUnit: true, unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true } },
          },
        },
        machineOptions: {
          where: { isActive: true, machineId: { in: machineIds } },
          select: { machineId: true, cycleTimeSec: true },
        },
      },
    });

    const wanted = new Set(machineIds);
    const out = new Map<string, RatedCapacity>();

    /** Record a candidate, keeping the slowest rate seen for the machine. */
    const consider = (
      machineId: string,
      cycleTimeSec: number | null | undefined,
      step: (typeof steps)[number],
      machineOverride: boolean,
    ) => {
      if (!wanted.has(machineId)) return;
      if (!cycleTimeSec || cycleTimeSec <= 0) return;

      // Out-units per hour, converted to PIECES so steps producing different pack
      // levels are comparable AND the rate shares a unit with the actual output it
      // is divided into. Base units would NOT work: baseUnit varies per SKU, so a
      // cross-product denominator built from it is not a consistent quantity.
      const outUnitsPerHour = 3600 / cycleTimeSec;
      const pkg = step.process.sku ?? null;
      const unitsPerHour = step.outUnit && pkg
        ? toPieces(outUnitsPerHour, step.outUnit, pkg)
        : outUnitsPerHour;
      if (!(unitsPerHour > 0)) return;

      const prev = out.get(machineId);
      if (prev && prev.unitsPerHour <= unitsPerHour) return; // keep the slowest

      out.set(machineId, {
        machineId,
        unitsPerHour,
        processId: step.process.id,
        processName: step.process.name,
        stepNumber: step.stepNumber,
        operationName: step.operationName,
        cycleTimeSec,
        outUnit: step.outUnit,
        machineOverride,
      });
    };

    for (const step of steps) {
      if (step.machineId) consider(step.machineId, step.cycleTimeSec, step, false);
      for (const opt of step.machineOptions) {
        // A machine-specific cycle time wins for that machine; otherwise it runs at
        // the step's default rate.
        consider(opt.machineId, opt.cycleTimeSec ?? step.cycleTimeSec, step, opt.cycleTimeSec != null);
      }
    }

    return out;
  }

  /**
   * Master Schedule Attainment.
   *
   * The `min()` is the point of the formula: over-producing one order must not
   * mask a shortfall on another, so each schedule line is credited at most its
   * scheduled quantity. A 100% MSA therefore means "every order met its plan",
   * not "total output matched total plan".
   *
   * Scope: production orders whose PLANNED window overlaps the reporting window —
   * attainment is measured against what was scheduled to be delivered in the
   * period, regardless of when work actually happened.
   */
  async masterScheduleAttainment(
    factoryId: string | null,
    from: Date,
    to: Date,
    opts: { lineId?: string; skuId?: string } = {},
  ): Promise<MsaResult> {
    const orders = await this.prisma.productionOrder.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(opts.skuId ? { skuId: opts.skuId } : {}),
        ...(opts.lineId ? { workOrders: { some: { lineId: opts.lineId } } } : {}),
        // Cancelled orders were never a commitment — excluded from both sides.
        status: { not: 'CANCELLED' },
        plannedStart: { lte: to },
        plannedEnd: { gte: from },
      },
      select: {
        id: true, orderNumber: true, targetQty: true, completedQty: true, status: true,
        sku: { select: { name: true, code: true } },
      },
      orderBy: { plannedStart: 'asc' },
    });

    const lines: MsaLine[] = orders.map((o) => {
      const scheduledQty = o.targetQty ?? 0;
      const actualQty = o.completedQty ?? 0;
      const creditedQty = Math.min(actualQty, scheduledQty);
      return {
        productionOrderId: o.id,
        orderNumber: o.orderNumber,
        sku: o.sku?.name ?? o.sku?.code ?? null,
        scheduledQty,
        actualQty,
        creditedQty,
        attainmentPct: scheduledQty > 0 ? r1((creditedQty / scheduledQty) * 100) : 0,
        status: o.status,
      };
    });

    const totalScheduledQty = lines.reduce((s, l) => s + l.scheduledQty, 0);
    const totalCreditedQty = lines.reduce((s, l) => s + l.creditedQty, 0);
    const totalActualQty = lines.reduce((s, l) => s + l.actualQty, 0);

    return {
      msaPct: totalScheduledQty > 0 ? r1((totalCreditedQty / totalScheduledQty) * 100) : 0,
      totalScheduledQty,
      totalCreditedQty,
      totalActualQty,
      orderCount: lines.length,
      window: { from: from.toISOString(), to: to.toISOString() },
      lines,
      method: {
        formula: 'MSA = Σ min(Actual Qty, Scheduled Qty) ÷ Total Scheduled Qty × 100',
        note:
          'Each order is credited at most its scheduled quantity, so over-producing one ' +
          'order cannot mask a shortfall on another. Scope: orders whose planned window ' +
          'overlaps the period. Cancelled orders are excluded from both numerator and denominator.',
      },
    };
  }

  /**
   * Volume-based capacity utilization.
   *
   * Denominator is the DESIGNED rate over the calendar hours of the window, where
   * the rate comes from the routing step's cycle time — not from a separate capacity
   * field. That is the strictest of the four possible bases (design, demonstrated,
   * available, scheduled) and the one the supplied formula names, so the result reads
   * low whenever the line is not scheduled to run. It answers "how much of the
   * designed volume did we use", not "how well did we run when we ran" — that second
   * question is OEE Performance.
   */
  async volumeCapacityUtilization(
    factoryId: string | null,
    from: Date,
    to: Date,
    opts: { areaId?: string; lineId?: string; machineId?: string; skuId?: string } = {},
  ): Promise<CapacityUtilizationResult> {
    const machines = await this.prisma.machine.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        isActive: true,
        archivedAt: null,
        ...(opts.machineId ? { id: opts.machineId } : {}),
        ...(opts.lineId ? { lineId: opts.lineId } : {}),
        ...(opts.areaId ? { OR: [{ areaId: opts.areaId }, { line: { areaId: opts.areaId } }] } : {}),
      },
      select: { id: true, name: true, code: true },
    });

    const machineIds = machines.map((m) => m.id);
    const rated = await this.ratedCapacityByMachine(factoryId, machineIds, { skuId: opts.skuId });

    // Actual good output per machine in the window, from the job orders that ran on it.
    //
    // A `groupBy` + `_sum` was wrong here: each machine records output in ITS OWN
    // unit (inners at the filler, cartons at the cartoner, pallets at the
    // palletiser), and the database cannot convert. Summing in SQL therefore added
    // unlike quantities. Rows are fetched with their unit and totalled in pieces,
    // which is also the unit the rated capacity below is expressed in — so
    // numerator and denominator finally share a unit.
    const producedRows = machineIds.length
      ? await this.prisma.jobOrder.findMany({
          where: {
            ...(factoryId ? { factoryId } : {}),
            machineId: { in: machineIds },
            // Overlap, not containment — a job order that began before the window
            // and is still running is exactly the one that matters, and the old
            // start-or-end-inside form excluded it, zeroing the KPI. Mirrors
            // joOverlapsWindow() in kpi.service.ts.
            AND: [
              { actualStart: { lte: to } },
              { OR: [{ actualEnd: null }, { actualEnd: { gte: from } }] },
            ],
          },
          select: {
            machineId: true, actualQtyGood: true, outputUnit: true,
            workOrder: { select: { sku: { select: { unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true, baseUnit: true } } } },
          },
        })
      : [];
    const actualByMachine = new Map<string, number>();
    for (const row of producedRows) {
      if (!row.machineId) continue;
      const pieces = toPieces(row.actualQtyGood ?? 0, row.outputUnit, row.workOrder?.sku ?? null);
      actualByMachine.set(row.machineId, (actualByMachine.get(row.machineId) ?? 0) + pieces);
    }

    const windowHours = Math.max(0, (to.getTime() - from.getTime()) / 3_600_000);

    const byMachine = machines.map((m) => {
      const rate = rated.get(m.id) ?? null;
      const maxDesignedUnits = rate ? rate.unitsPerHour * windowHours : 0;
      const actualUnits = actualByMachine.get(m.id) ?? 0;
      return {
        machineId: m.id,
        name: m.name,
        code: m.code,
        ratedUnitsPerHour: rate ? r1(rate.unitsPerHour) : null,
        ratedFrom: rate
          ? {
              processId: rate.processId,
              processName: rate.processName,
              stepNumber: rate.stepNumber,
              operationName: rate.operationName,
              cycleTimeSec: rate.cycleTimeSec,
              outUnit: rate.outUnit,
              machineOverride: rate.machineOverride,
            }
          : null,
        maxDesignedUnits: Math.round(maxDesignedUnits),
        actualUnits,
        utilizationPct: maxDesignedUnits > 0 ? r1((actualUnits / maxDesignedUnits) * 100) : null,
      };
    });

    const machinesMissingCapacity = machines
      .filter((m) => !rated.has(m.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        code: m.code,
        reason: 'No active routing step with a cycle time assigns this machine.',
      }));

    const maxDesignedUnits = byMachine.reduce((s, m) => s + m.maxDesignedUnits, 0);
    const actualUnits = byMachine.reduce((s, m) => s + m.actualUnits, 0);

    return {
      utilizationPct: maxDesignedUnits > 0 ? r1((actualUnits / maxDesignedUnits) * 100) : 0,
      actualUnits,
      maxDesignedUnits,
      windowHours: r1(windowHours),
      machineCount: machines.length,
      machinesMissingCapacity,
      byMachine: byMachine.sort((a, b) => (b.utilizationPct ?? -1) - (a.utilizationPct ?? -1)),
      window: { from: from.toISOString(), to: to.toISOString() },
      method: {
        formula: 'Capacity Utilization (Volume) = Actual Units Produced ÷ Maximum Designed Unit Capacity × 100',
        capacityBasis:
          'Rated throughput from the routing step cycle time (3600 ÷ cycleTimeSec, converted to ' +
          'PIECES) × calendar hours in the window. A machine-specific cycle time on the step ' +
          'overrides the step default. Where several routings cover a machine, the slowest rate is used. ' +
          'This is the same master data that generates job orders, so capacity can never drift from the plan.',
        note:
          machinesMissingCapacity.length > 0
            ? `${machinesMissingCapacity.length} machine(s) in scope are not assigned to any active ` +
              'routing step with a cycle time, so they contribute nothing to the denominator — add ' +
              'them to the process routing for a complete figure.'
            : 'Every machine in scope resolves a rated capacity from its routing step.',
      },
    };
  }
}
