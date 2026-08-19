import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { KpiService, type MachineFactTotals } from './kpi.service';
import { OEEService } from './oee.service';
import { ScheduleKpiService } from './schedule-kpi.service';
import { currentShiftStart } from '../../common/shift-window.util';
import { toPieces, type SkuPackaging } from '../../common/units.util';

/**
 * What the plant is doing RIGHT NOW.
 *
 * ── Why this is a separate service ──────────────────────────────────────────
 * Every dashboard used to answer one question with two meanings at once: a card
 * showing "current output" and a chart showing "output over the selected period"
 * sat side by side, both driven by the same scope tree and the same time filter.
 * A reader could not tell which number described this minute and which described
 * last week, and when the two disagreed — as they did — neither could be trusted.
 *
 * So the split is enforced in the type system, not in a convention: this service
 * takes NO date range. Its window is the shift that is running, resolved from the
 * shift templates, and the only scope it accepts is a factory or a line. A caller
 * cannot accidentally ask it about last month, because there is no parameter for
 * last month.
 *
 * ── One engine, still ───────────────────────────────────────────────────────
 * The numbers come from KpiService.machineFactTotals — the same aggregate the
 * analytics pages read. "Live" describes WHICH window, never a second arithmetic.
 * Summing the current shift here and asking the analytics page for that same
 * shift must give identical figures, and a test asserts exactly that.
 *
 * The only thing read outside the fact store is MachineCurrentStatus, because
 * "what state is this machine in at this instant" is not a historical quantity
 * and has no meaning in a window.
 */

export interface LiveMachine {
  machineId: string;
  code: string;
  name: string;
  line: string | null;
  /** The instantaneous state — the one quantity a window cannot express. */
  state: string;
  stateSince: Date | null;
  /** Shift-to-date, from the fact store. */
  runMin: number;
  downMin: number;
  plannedMin: number;
  externalMin: number;
  unmeasuredMin: number;
  output: number;
  good: number;
  scrap: number;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
}

export interface LiveJobOrder {
  jobOrderId: string;
  operationName: string | null;
  sequenceOrder: number;
  machineId: string | null;
  machineCode: string | null;
  workOrderNumber: string | null;
  productionOrderNumber: string | null;
  sku: string | null;
  /** As ordered, in the unit it was ordered in. */
  plannedQty: number;
  plannedQtyUnit: string | null;
  goodQty: number;
  scrapQty: number;
  outputUnit: string | null;
  startedAt: Date | null;
}

@Injectable()
export class LiveKpiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kpi: KpiService,
    private readonly oee: OEEService,
    private readonly scheduleKpi: ScheduleKpiService,
  ) {}

  /**
   * The current shift's window: its start from the templates, to now.
   *
   * Falls back to midnight when a factory has no shift templates — a plant that
   * has not configured shifts still needs a live page, and "today so far" is the
   * least surprising substitute. The response says which of the two it used, so
   * the reader is never guessing what "now" covers.
   */
  private async shiftWindow(factoryId: string | null) {
    const to = new Date();
    const start = await currentShiftStart(this.prisma, factoryId);
    if (start) return { from: start, to, basis: 'SHIFT' as const };
    const midnight = new Date(to);
    midnight.setHours(0, 0, 0, 0);
    return { from: midnight, to, basis: 'DAY' as const };
  }

  /**
   * Live snapshot of a factory or line: what is running, on what, and how it is
   * going so far this shift.
   *
   * @param scope factory-wide when `lineId` is omitted. There is deliberately no
   *   machine-level scope: a live page answers "how is the plant running", and
   *   one machine in isolation is an analytics question.
   */
  async overview(factoryId: string | null, scope: { lineId?: string } = {}) {
    const win = await this.shiftWindow(factoryId);

    const machines = await this.prisma.machine.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        isActive: true,
        archivedAt: null,
        ...(scope.lineId ? { lineId: scope.lineId } : {}),
      },
      select: {
        id: true, code: true, name: true,
        line: { select: { code: true } },
      },
      orderBy: [{ line: { code: 'asc' } }, { sortOrder: 'asc' }],
    });
    if (machines.length === 0) {
      // Same shape as the populated path — a caller must never have to branch on
      // whether a key exists.
      return {
        window: win, machines: [], jobOrders: [], totals: this.emptyTotals(), shift: null,
        plant: {
          calendarMin: 0, utilization: null, teep: null,
          scheduleAttainment: null, scheduledOrders: 0,
          capacityUtilization: null, machinesWithoutRate: 0,
        },
      };
    }
    const machineIds = machines.map((m) => m.id);

    // Shift-to-date facts — the SAME aggregate every analytics page reads.
    const facts = await this.kpi.machineFactTotals(machineIds, win.from, win.to);

    // The instantaneous state. Not a window quantity, so it is read live.
    const statuses = await this.prisma.machineCurrentStatus.findMany({
      where: { machineId: { in: machineIds } },
      select: { machineId: true, state: true, lastEventAt: true },
    });
    const stateBy = new Map(statuses.map((s) => [s.machineId, s]));

    const rows: LiveMachine[] = machines.map((m) => {
      const f = facts.get(m.id);
      const st = stateBy.get(m.id);
      return {
        machineId: m.id,
        code: m.code,
        name: m.name,
        line: m.line?.code ?? null,
        state: String(st?.state ?? 'OFFLINE'),
        stateSince: st?.lastEventAt ?? null,
        ...this.factorsOf(f),
      };
    });

    const totals = this.rollup(facts);

    // ── The three figures that used to live on analytics pages ──────────────
    // They belong here: each is a reading of how the plant stands right now, and
    // a reading belongs on a live page. All three are computed over the SAME
    // shift window as everything else above, so they cannot disagree with it.
    //
    // Utilisation is how much of the clock the plant even planned to use, and
    // TEEP carries OEE the rest of the way to the calendar — the gap between the
    // two is capacity the company already owns and is not using.
    const calendarMin = ((win.to.getTime() - win.from.getTime()) / 60_000) * machines.length;
    const utilization = calendarMin > 0 ? this.r((totals.plannedMin / calendarMin) * 100) : null;
    const teep = utilization != null && totals.oee != null
      ? this.r((totals.oee / 100) * (utilization / 100) * 100)
      : null;

    const [msa, capacity] = await Promise.all([
      this.scheduleKpi
        .masterScheduleAttainment(factoryId, win.from, win.to, scope.lineId ? { lineId: scope.lineId } : {})
        .catch(() => null),
      this.scheduleKpi
        .volumeCapacityUtilization(factoryId, win.from, win.to, scope.lineId ? { lineId: scope.lineId } : {})
        .catch(() => null),
    ]);

    return {
      window: win,
      shift: await this.currentShiftLabel(factoryId),
      machines: rows,
      jobOrders: await this.runningJobOrders(factoryId, machineIds),
      totals,
      plant: {
        calendarMin: this.r(calendarMin),
        utilization,
        teep,
        // Orders whose planned window overlaps this shift. Null rather than zero
        // when nothing was scheduled — 0% would read as total failure.
        scheduleAttainment: msa && msa.totalScheduledQty > 0 ? msa.msaPct : null,
        scheduledOrders: msa?.orderCount ?? 0,
        // Actual pieces this shift against the designed capacity for its hours.
        capacityUtilization: capacity && capacity.maxDesignedUnits > 0 ? capacity.utilizationPct : null,
        machinesWithoutRate: capacity?.machinesMissingCapacity.length ?? 0,
      },
    };
  }

  /**
   * The job orders actually EXECUTING right now, with the order context a floor
   * operator recognises: which work order, which production order, which product.
   *
   * Quantities are shown as the step counts them — an operator at the cartoner
   * thinks in cartons, and converting that to pieces on their own screen helps
   * nobody. The rollups above convert; this list does not.
   */
  private async runningJobOrders(factoryId: string | null, machineIds: string[]): Promise<LiveJobOrder[]> {
    const jos = await this.prisma.jobOrder.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        status: 'EXECUTING',
        machineId: { in: machineIds },
      },
      select: {
        id: true, operationName: true, sequenceOrder: true, machineId: true,
        plannedQtyOut: true, actualQtyGood: true, actualQtyRejected: true,
        outputUnit: true, actualStart: true,
        machine: { select: { code: true } },
        workOrder: {
          select: {
            orderNumber: true,
            sku: { select: { name: true, code: true } },
            productionOrder: { select: { orderNumber: true } },
          },
        },
      },
      orderBy: { sequenceOrder: 'asc' },
    });

    return jos.map((jo) => ({
      jobOrderId: jo.id,
      operationName: jo.operationName,
      sequenceOrder: jo.sequenceOrder ?? 0,
      machineId: jo.machineId,
      machineCode: jo.machine?.code ?? null,
      workOrderNumber: jo.workOrder?.orderNumber ?? null,
      productionOrderNumber: jo.workOrder?.productionOrder?.orderNumber ?? null,
      sku: jo.workOrder?.sku?.name ?? jo.workOrder?.sku?.code ?? null,
      plannedQty: jo.plannedQtyOut ?? 0,
      plannedQtyUnit: jo.outputUnit ?? null,
      goodQty: jo.actualQtyGood ?? 0,
      scrapQty: jo.actualQtyRejected ?? 0,
      outputUnit: jo.outputUnit ?? null,
      startedAt: jo.actualStart ?? null,
    }));
  }

  /** Which shift this is, by name, so the page can say what it is measuring. */
  private async currentShiftLabel(factoryId: string | null) {
    if (!factoryId) return null;
    const templates = await this.prisma.shiftTemplate.findMany({
      where: { factoryId, isActive: true },
      orderBy: { startTime: 'asc' },
      select: { id: true, code: true, name: true, startTime: true, endTime: true, crossesMidnight: true },
    });
    if (templates.length === 0) return null;
    const { resolveShiftAt } = await import('../../common/shift-window.util');
    const r = resolveShiftAt(new Date(), templates as never);
    return r ? { code: r.code, name: r.name, startedAt: r.shiftStart } : null;
  }

  /** A/P/Q/OEE for one machine's shift-to-date facts. */
  private factorsOf(f: MachineFactTotals | undefined) {
    const runMin = f?.runMin ?? 0;
    const plannedMin = f?.plannedMin ?? 0;
    const idealRunMin = f?.idealRunMin ?? 0;
    const total = f?.totalBase ?? 0;
    const good = f?.goodBase ?? 0;

    // Availability is null, never 0, when nothing was planned — 0% accuses a
    // machine of failing when it was never asked to run. Same rule as every
    // other surface.
    const availability = plannedMin > 0 ? this.r((runMin / plannedMin) * 100) : null;
    const performance = runMin > 0 ? Math.min(100, this.r((idealRunMin / runMin) * 100)) : null;
    const quality = total > 0 ? this.r((good / total) * 100) : null;
    const oee = availability != null && performance != null && quality != null
      ? this.r((availability / 100) * (performance / 100) * (quality / 100) * 100)
      : null;

    return {
      runMin: this.r(runMin),
      downMin: this.r(f?.downMin ?? 0),
      plannedMin: this.r(plannedMin),
      externalMin: this.r(f?.externalMin ?? 0),
      unmeasuredMin: this.r(f?.unmeasuredMin ?? 0),
      output: this.r(total),
      good: this.r(good),
      scrap: this.r(f?.scrapBase ?? 0),
      availability, performance, quality, oee,
    };
  }

  /**
   * Plant totals: minutes and counts summed, then divided ONCE.
   *
   * Never an average of the machine percentages — that would weight a machine
   * that ran ten minutes the same as one that ran the whole shift.
   */
  private rollup(facts: Map<string, MachineFactTotals>) {
    const z = { runMin: 0, plannedMin: 0, downMin: 0, externalMin: 0, unmeasuredMin: 0, idealRunMin: 0, totalBase: 0, goodBase: 0, scrapBase: 0 };
    for (const f of facts.values()) {
      z.runMin += f.runMin; z.plannedMin += f.plannedMin; z.downMin += f.downMin;
      z.externalMin += f.externalMin; z.unmeasuredMin += f.unmeasuredMin;
      z.idealRunMin += f.idealRunMin;
      z.totalBase += f.totalBase; z.goodBase += f.goodBase; z.scrapBase += f.scrapBase;
    }
    return this.factorsOf(z as MachineFactTotals);
  }

  private emptyTotals() {
    return this.factorsOf(undefined);
  }

  private r(n: number): number {
    return Math.round(n * 10) / 10;
  }
}
