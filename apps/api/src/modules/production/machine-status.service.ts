import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { KpiService } from './kpi.service';
import { resolveLocalRange } from '../../common/plant-time.util';
import { currentShiftStart } from '../../common/shift-window.util';

/**
 * Machine status analytics — the timeline, and the three OEE factors behind it.
 *
 * Reads two sources and keeps them distinct on purpose:
 *
 *   machine_state_records   what the machine WAS DOING, minute by minute
 *   production_snapshots    what it PRODUCED, per minute
 *
 * The first is the only place STARVED and BLOCKED minutes live, and until the
 * gateway was fixed on 15 Aug 2026 nothing wrote to it at all — the timeline
 * drew one solid bar for days and the OEE engine's external loss was always
 * zero. Anything read here is therefore only as deep as that fix; there is no
 * history before it, and no amount of querying will invent one.
 *
 * Every method takes the same scope (area / line / machine) and the same local
 * date range, so the three tabs of the screen can never disagree about which
 * machines or which window they are describing.
 */

/** States that mean the machine was producing. */
const PRODUCING = new Set(['RUNNING']);

/** Stops caused outside the machine — excluded from its own availability loss. */
const EXTERNAL = new Set(['STARVED', 'BLOCKED']);

/** Stops somebody planned. */
const PLANNED = new Set(['PLANNED_STOP', 'MAINTENANCE', 'SETUP', 'CHANGEOVER']);

export interface StatusScope {
  areaId?: string;
  lineId?: string;
  machineId?: string;
}

@Injectable()
export class MachineStatusService {
  private readonly logger = new Logger(MachineStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kpi: KpiService,
  ) {}

  /** Machines in scope, in material-flow order so every view lists them alike. */
  private async machinesInScope(factoryId: string | null, scope: StatusScope) {
    const ids = await this.kpi.resolveScopeMachineIds(factoryId, scope);
    return this.prisma.machine.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(ids ? { id: { in: ids } } : {}),
        isActive: true,
        archivedAt: null,
      },
      select: {
        id: true, code: true, name: true, sortOrder: true,
        line: { select: { id: true, code: true, name: true, area: { select: { id: true, name: true } } } },
      },
      orderBy: [{ line: { code: 'asc' } }, { sortOrder: 'asc' }],
    });
  }

  /**
   * The window, as plant-local calendar days clamped to now.
   *
   * Shared with the rest of the API so a chart and a KPI card asked for "today"
   * cover the same seconds — the mismatch that used to make two screens disagree.
   *
   * `timeframe` is honoured for the SAME reason. These endpoints used to accept only
   * dateFrom/dateTo, so picking "Shift" in the sidebar measured the whole calendar
   * day here while /production/oee/calculate — which does resolve the shift from the
   * templates — measured the sixteen minutes since the shift began. Two pages, one
   * button, two windows, and every figure on them disagreed for a reason that had
   * nothing to do with the arithmetic underneath.
   */
  private async window(
    factoryId: string | null,
    dateFrom?: string,
    dateTo?: string,
    timeframe?: string,
  ) {
    const range = resolveLocalRange(dateFrom, dateTo, 7);
    if (String(timeframe ?? '').toLowerCase() !== 'shift') return range;
    // The REAL current shift start, not "since midnight". Falls back to the calendar
    // range when no shift template covers now — a guess would be worse than the day.
    //
    // factoryId is a PARAMETER, never an instance field: this service is a singleton
    // and two concurrent requests for different factories would otherwise resolve
    // each other's shift.
    const shiftStart = await currentShiftStart(this.prisma, factoryId);
    return shiftStart ? { from: shiftStart, to: range.to } : range;
  }

  // ────────────────────────────────────────────────────────────
  // AVAILABILITY — the timeline and what it adds up to
  // ────────────────────────────────────────────────────────────

  async availability(factoryId: string | null, scope: StatusScope, dateFrom?: string, dateTo?: string, timeframe?: string) {
    const { from, to } = await this.window(factoryId, dateFrom, dateTo, timeframe);
    const machines = await this.machinesInScope(factoryId, scope);
    if (machines.length === 0) {
      return { from, to, machines: [], totals: this.emptyTotals(), reasons: [] };
    }
    const machineIds = machines.map((m) => m.id);

    const records = await this.prisma.machineStateRecord.findMany({
      where: {
        machineId: { in: machineIds },
        startTime: { lte: to },
        OR: [{ endTime: null }, { endTime: { gte: from } }],
      },
      select: {
        id: true, machineId: true, state: true, startTime: true, endTime: true,
        downtimeCause: { select: { code: true, name: true } },
      },
      orderBy: { startTime: 'asc' },
      // Generous, but bounded: a chatty month must not stream unbounded rows
      // into a browser that can only draw a few hundred bands anyway.
      take: 5000,
    });

    const byMachine = new Map<string, typeof records>();
    for (const r of records) {
      byMachine.set(r.machineId, [...(byMachine.get(r.machineId) ?? []), r]);
    }

    const rows = machines.map((m) => {
      const segments = (byMachine.get(m.id) ?? []).map((r) => {
        // Clip to the window: a record that started before it or is still open
        // must contribute only the minutes that fall inside.
        const s = Math.max(from.getTime(), r.startTime.getTime());
        const e = Math.min(to.getTime(), r.endTime ? r.endTime.getTime() : to.getTime());
        return {
          id: r.id,
          state: String(r.state),
          startTime: new Date(s),
          endTime: new Date(e),
          minutes: Math.max(0, (e - s) / 60_000),
          cause: r.downtimeCause?.name ?? null,
        };
      }).filter((s) => s.minutes > 0);

      const buckets = this.bucketMinutes(segments);
      return {
        machineId: m.id,
        code: m.code,
        name: m.name,
        line: m.line?.code ?? null,
        area: m.line?.area?.name ?? null,
        segments,
        ...buckets,
        // Availability the way the OEE engine defines it: external losses are
        // removed from the denominator, so a machine is not punished for
        // waiting on the line. Reported alongside the raw uptime share so the
        // difference between the two is visible rather than argued about.
        availabilityPct: this.pct(buckets.runMin, buckets.runMin + buckets.unplannedMin),
        uptimePct: this.pct(buckets.runMin, buckets.totalMin),
        stops: segments.filter((s) => !PRODUCING.has(s.state)).length,
      };
    });

    const totals = rows.reduce((acc, r) => ({
      totalMin: acc.totalMin + r.totalMin,
      runMin: acc.runMin + r.runMin,
      unplannedMin: acc.unplannedMin + r.unplannedMin,
      plannedMin: acc.plannedMin + r.plannedMin,
      externalMin: acc.externalMin + r.externalMin,
      idleMin: acc.idleMin + r.idleMin,
      stops: acc.stops + r.stops,
    }), this.emptyTotals());

    return {
      from, to,
      machines: rows,
      totals: {
        ...totals,
        availabilityPct: this.pct(totals.runMin, totals.runMin + totals.unplannedMin),
        uptimePct: this.pct(totals.runMin, totals.totalMin),
      },
      reasons: await this.stopReasons(factoryId, machineIds, from, to),
    };
  }

  /** Minutes split by what the state MEANS, which is what the KPIs care about. */
  private bucketMinutes(segments: Array<{ state: string; minutes: number }>) {
    let totalMin = 0, runMin = 0, unplannedMin = 0, plannedMin = 0, externalMin = 0, idleMin = 0;
    for (const s of segments) {
      totalMin += s.minutes;
      if (PRODUCING.has(s.state)) { runMin += s.minutes; continue; }
      if (EXTERNAL.has(s.state)) { externalMin += s.minutes; continue; }
      if (PLANNED.has(s.state)) { plannedMin += s.minutes; continue; }
      if (s.state === 'IDLE' || s.state === 'OFFLINE') { idleMin += s.minutes; continue; }
      unplannedMin += s.minutes; // BREAKDOWN and anything unrecognised
    }
    return {
      totalMin: this.r(totalMin), runMin: this.r(runMin), unplannedMin: this.r(unplannedMin),
      plannedMin: this.r(plannedMin), externalMin: this.r(externalMin), idleMin: this.r(idleMin),
    };
  }

  /** Downtime Pareto over the same window — what actually cost the time. */
  private async stopReasons(factoryId: string | null, machineIds: string[], from: Date, to: Date) {
    const events = await this.prisma.downtimeEvent.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        machineId: { in: machineIds },
        startTime: { lte: to },
        OR: [{ endTime: null }, { endTime: { gte: from } }],
      },
      select: {
        category: true, reasonCode: true, isPlanned: true, affectsOEE: true,
        startTime: true, endTime: true,
        cause: { select: { name: true } },
      },
      take: 5000,
    });

    const agg = new Map<string, { label: string; category: string; minutes: number; count: number; isPlanned: boolean; affectsOEE: boolean }>();
    for (const e of events) {
      const s = Math.max(from.getTime(), e.startTime.getTime());
      const end = Math.min(to.getTime(), e.endTime ? e.endTime.getTime() : to.getTime());
      const minutes = Math.max(0, (end - s) / 60_000);
      if (minutes <= 0) continue;
      const label = e.cause?.name ?? String(e.reasonCode ?? e.category);
      const key = `${label}|${e.category}`;
      const prev = agg.get(key);
      agg.set(key, {
        label,
        category: String(e.category),
        minutes: (prev?.minutes ?? 0) + minutes,
        count: (prev?.count ?? 0) + 1,
        isPlanned: e.isPlanned,
        affectsOEE: e.affectsOEE,
      });
    }
    return [...agg.values()]
      .map((r) => ({ ...r, minutes: this.r(r.minutes) }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 20);
  }

  // ────────────────────────────────────────────────────────────
  // PERFORMANCE — pace, from the fact store
  // ────────────────────────────────────────────────────────────

  async performance(factoryId: string | null, scope: StatusScope, dateFrom?: string, dateTo?: string, timeframe?: string) {
    const { from, to } = await this.window(factoryId, dateFrom, dateTo, timeframe);
    const machines = await this.machinesInScope(factoryId, scope);
    if (machines.length === 0) return { from, to, machines: [], series: [], totals: null };
    const machineIds = machines.map((m) => m.id);

    // Aggregated in SQL: a week of per-minute rows is tens of thousands, and
    // pulling them into Node to sum would move the cost without removing it.
    const perMachine = await this.prisma.$queryRaw<Array<{
      machineId: string; runMin: number; idealRunMin: number; totalBase: number; goodBase: number;
    }>>(Prisma.sql`
      SELECT "machineId",
             COALESCE(SUM("runMin"), 0)::float      AS "runMin",
             COALESCE(SUM("idealRunMin"), 0)::float AS "idealRunMin",
             COALESCE(SUM("totalBase"), 0)::float   AS "totalBase",
             COALESCE(SUM("goodBase"), 0)::float    AS "goodBase"
      FROM production_snapshots
      WHERE "machineId" IN (${Prisma.join(machineIds)})
        AND "bucketStart" >= ${from} AND "bucketStart" < ${to}
      GROUP BY "machineId"
    `);
    const byId = new Map(perMachine.map((r) => [r.machineId, r]));

    const rows = machines.map((m) => {
      const r = byId.get(m.id);
      const runMin = r?.runMin ?? 0;
      const idealRunMin = r?.idealRunMin ?? 0;
      return {
        machineId: m.id, code: m.code, name: m.name, line: m.line?.code ?? null,
        runMin: this.r(runMin),
        idealRunMin: this.r(idealRunMin),
        // Performance is ideal time over actual running time. Capped at 100
        // because producing "faster than ideal" means the ideal is wrong, not
        // that the machine exceeded physics — see tracker item 27.
        performancePct: Math.min(100, this.pct(idealRunMin, runMin)),
        output: this.r(r?.totalBase ?? 0),
        goodOutput: this.r(r?.goodBase ?? 0),
        actualRatePerHour: runMin > 0 ? this.r((r?.totalBase ?? 0) / (runMin / 60)) : 0,
      };
    });

    const series = await this.dailySeries(machineIds, from, to);

    const sum = perMachine.reduce((a, r) => ({
      runMin: a.runMin + r.runMin, idealRunMin: a.idealRunMin + r.idealRunMin,
      totalBase: a.totalBase + r.totalBase,
    }), { runMin: 0, idealRunMin: 0, totalBase: 0 });

    return {
      from, to, machines: rows, series,
      totals: {
        runMin: this.r(sum.runMin),
        idealRunMin: this.r(sum.idealRunMin),
        performancePct: Math.min(100, this.pct(sum.idealRunMin, sum.runMin)),
        output: this.r(sum.totalBase),
      },
    };
  }

  // ────────────────────────────────────────────────────────────
  // QUALITY
  // ────────────────────────────────────────────────────────────

  async quality(factoryId: string | null, scope: StatusScope, dateFrom?: string, dateTo?: string, timeframe?: string) {
    const { from, to } = await this.window(factoryId, dateFrom, dateTo, timeframe);
    const machines = await this.machinesInScope(factoryId, scope);
    if (machines.length === 0) return { from, to, machines: [], series: [], totals: null };
    const machineIds = machines.map((m) => m.id);

    const perMachine = await this.prisma.$queryRaw<Array<{
      machineId: string; goodBase: number; scrapBase: number; reworkBase: number; totalBase: number;
    }>>(Prisma.sql`
      SELECT "machineId",
             COALESCE(SUM("goodBase"), 0)::float   AS "goodBase",
             COALESCE(SUM("scrapBase"), 0)::float  AS "scrapBase",
             COALESCE(SUM("reworkBase"), 0)::float AS "reworkBase",
             COALESCE(SUM("totalBase"), 0)::float  AS "totalBase"
      FROM production_snapshots
      WHERE "machineId" IN (${Prisma.join(machineIds)})
        AND "bucketStart" >= ${from} AND "bucketStart" < ${to}
      GROUP BY "machineId"
    `);
    const byId = new Map(perMachine.map((r) => [r.machineId, r]));

    const rows = machines.map((m) => {
      const r = byId.get(m.id);
      const total = r?.totalBase ?? 0;
      const good = r?.goodBase ?? 0;
      return {
        machineId: m.id, code: m.code, name: m.name, line: m.line?.code ?? null,
        good: this.r(good),
        scrap: this.r(r?.scrapBase ?? 0),
        rework: this.r(r?.reworkBase ?? 0),
        total: this.r(total),
        qualityPct: this.pct(good, total),
        scrapPct: this.pct(r?.scrapBase ?? 0, total),
      };
    });

    const series = await this.dailySeries(machineIds, from, to);

    const sum = perMachine.reduce((a, r) => ({
      good: a.good + r.goodBase, scrap: a.scrap + r.scrapBase,
      rework: a.rework + r.reworkBase, total: a.total + r.totalBase,
    }), { good: 0, scrap: 0, rework: 0, total: 0 });

    return {
      from, to, machines: rows, series,
      totals: {
        good: this.r(sum.good), scrap: this.r(sum.scrap), rework: this.r(sum.rework),
        total: this.r(sum.total),
        qualityPct: this.pct(sum.good, sum.total),
        scrapPct: this.pct(sum.scrap, sum.total),
      },
    };
  }

  /**
   * One row per plant-local day, shared by the performance and quality tabs.
   *
   * Bucketed in SQL at the plant's timezone rather than UTC: a night shift that
   * runs past midnight UTC belongs to the day the plant says it does, and
   * grouping on the raw timestamp would split it across two bars.
   */
  private async dailySeries(machineIds: string[], from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<Array<{
      day: Date; runMin: number; idealRunMin: number;
      goodBase: number; scrapBase: number; totalBase: number;
    }>>(Prisma.sql`
      SELECT date_trunc('day', "bucketStart" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Riyadh') AS day,
             COALESCE(SUM("runMin"), 0)::float      AS "runMin",
             COALESCE(SUM("idealRunMin"), 0)::float AS "idealRunMin",
             COALESCE(SUM("goodBase"), 0)::float    AS "goodBase",
             COALESCE(SUM("scrapBase"), 0)::float   AS "scrapBase",
             COALESCE(SUM("totalBase"), 0)::float   AS "totalBase"
      FROM production_snapshots
      WHERE "machineId" IN (${Prisma.join(machineIds)})
        AND "bucketStart" >= ${from} AND "bucketStart" < ${to}
      GROUP BY 1 ORDER BY 1
    `);

    return rows.map((r) => ({
      date: r.day,
      runMin: this.r(r.runMin),
      output: this.r(r.totalBase),
      good: this.r(r.goodBase),
      scrap: this.r(r.scrapBase),
      performancePct: Math.min(100, this.pct(r.idealRunMin, r.runMin)),
      qualityPct: this.pct(r.goodBase, r.totalBase),
    }));
  }

  private emptyTotals() {
    return { totalMin: 0, runMin: 0, unplannedMin: 0, plannedMin: 0, externalMin: 0, idleMin: 0, stops: 0 };
  }

  private pct(num: number, den: number): number {
    if (!den || den <= 0) return 0;
    return Math.round((num / den) * 1000) / 10;
  }

  private r(n: number): number {
    return Math.round(n * 100) / 100;
  }
}
