import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { FALLBACK_VERDICTS, UNKNOWN_VERDICT, PRODUCING, type Verdict } from './minute-classification';

/** How a segment is drawn and counted. Mirrors the classification the writers use. */
export type SegmentKind = 'running' | 'planned' | 'external' | 'downtime' | 'unmeasured';

export interface TimelineSegment {
  machineId: string;
  machineCode: string;
  state: string;
  kind: SegmentKind;
  from: Date;
  to: Date;
  minutes: number;
}

export interface ProductionDetails {
  /** Episodes the plant would call a stop — one per state record, not per minute. */
  downtimeCount: number;
  downtimeMin: number;
  /** Named because the reference names it, and reported as zero because nothing measures it. */
  microstopCount: number;
  microstopMin: number;
  plannedStopCount: number;
  plannedStopMin: number;
  externalCount: number;
  externalMin: number;
}

export interface TimelineScope {
  machineId?: string;
  lineId?: string;
  areaId?: string;
}

/**
 * The machine-status timeline, and the episode counts that go with it.
 *
 * ── Why this reads state records rather than the minute stores ──────────────
 * A minute store answers "how much", and both engines already do that well. This
 * answers "when, and how many times", and those are episodes — a two-hour
 * breakdown is ONE downtime, not a hundred and twenty. Counting minutes and
 * calling the result a number of stops is the kind of arithmetic that makes a
 * Pareto chart meaningless.
 *
 * Classification is the same as the writers': the State Rules decide, with the
 * built-in table only as a fallback for a factory that has configured none. So a
 * segment drawn amber here is amber for the same reason the minute behind it was
 * charged to availability.
 */
@Injectable()
export class StateTimelineService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve every (machine, state) pair in one query.
   *
   * A rule for THIS machine beats the factory-wide rule, which beats the
   * built-in default. Loaded once for the window rather than per segment: a
   * shift can hold hundreds of segments and per-segment lookups turn a chart
   * into a query storm.
   */
  private async loadVerdicts(
    factoryId: string | null,
    machineIds: string[],
  ): Promise<(machineId: string, state: string) => Verdict> {
    let rows: Array<{ machineId: string | null; state: string; isDowntime: boolean; isPlanned: boolean; affectsOEE: boolean }> = [];
    try {
      rows = await this.prisma.machineStateRule.findMany({
        where: {
          isActive: true,
          ...(factoryId ? { factoryId } : {}),
          OR: [{ machineId: { in: machineIds } }, { machineId: null }],
        },
        select: { machineId: true, state: true, isDowntime: true, isPlanned: true, affectsOEE: true },
      });
    } catch {
      // A configuration read must never blank the chart.
      rows = [];
    }

    const specific = new Map<string, Verdict>();
    const factoryWide = new Map<string, Verdict>();
    for (const r of rows) {
      const v: Verdict = { isDowntime: r.isDowntime, isPlanned: r.isPlanned, affectsOEE: r.affectsOEE };
      if (r.machineId) specific.set(`${r.machineId}:${r.state}`, v);
      else factoryWide.set(r.state, v);
    }
    return (machineId, state) =>
      specific.get(`${machineId}:${state}`) ?? factoryWide.get(state) ?? FALLBACK_VERDICTS[state] ?? UNKNOWN_VERDICT;
  }

  private kindOf(state: string, v: Verdict): SegmentKind {
    if (PRODUCING.has(state)) return 'running';
    if (v.isDowntime && v.isPlanned) return 'planned';
    if (v.isDowntime && !v.affectsOEE) return 'external';
    return 'downtime';
  }

  /**
   * Segments overlapping [from, to), clipped to it.
   *
   * Clipped rather than filtered: a breakdown that began before the window is
   * still downtime inside it, and dropping it would leave a hole in the bar and
   * an undercount in the tally.
   */
  async segments(
    factoryId: string | null,
    from: Date,
    to: Date,
    scope: TimelineScope = {},
    limit = 4000,
  ): Promise<TimelineSegment[]> {
    const machineFilter: Prisma.Sql[] = [];
    if (scope.machineId) machineFilter.push(Prisma.sql`m.id = ${scope.machineId}`);
    if (scope.lineId) machineFilter.push(Prisma.sql`m."lineId" = ${scope.lineId}`);
    if (scope.areaId) {
      machineFilter.push(Prisma.sql`(m."areaId" = ${scope.areaId} OR m."lineId" IN (
        SELECT l2.id FROM production_lines l2 WHERE l2."areaId" = ${scope.areaId}))`);
    }
    if (factoryId) machineFilter.push(Prisma.sql`m."factoryId" = ${factoryId}`);
    const where = machineFilter.length
      ? Prisma.sql`AND ${Prisma.join(machineFilter, ' AND ')}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<Array<{
      machineId: string; machineCode: string; state: string; from: Date; to: Date;
    }>>(Prisma.sql`
      SELECT r."machineId", m.code AS "machineCode", r.state::text AS state,
             GREATEST(r."startTime", ${from}) AS "from",
             LEAST(COALESCE(r."endTime", ${to}), ${to}) AS "to"
      FROM machine_state_records r
      JOIN machines m ON m.id = r."machineId"
      WHERE r."startTime" < ${to}
        AND (r."endTime" IS NULL OR r."endTime" > ${from})
        ${where}
      ORDER BY r."machineId", r."startTime"
      LIMIT ${limit}
    `);
    if (rows.length === 0) return [];

    const verdictFor = await this.loadVerdicts(factoryId, [...new Set(rows.map((r) => r.machineId))]);
    return rows
      .map((r) => {
        const minutes = (r.to.getTime() - r.from.getTime()) / 60_000;
        return {
          machineId: r.machineId,
          machineCode: r.machineCode,
          state: r.state,
          kind: this.kindOf(r.state, verdictFor(r.machineId, r.state)),
          from: r.from,
          to: r.to,
          minutes,
        };
      })
      .filter((s) => s.minutes > 0);
  }

  /**
   * The counts under the chart: how many stops, and how long in total.
   *
   * Derived from the same segments the chart draws, so a reader who counts the
   * red blocks and a reader who reads the number are looking at one fact.
   */
  details(segments: TimelineSegment[]): ProductionDetails {
    const sum = (k: SegmentKind) =>
      segments.filter((s) => s.kind === k).reduce((a, s) => a + s.minutes, 0);
    const count = (k: SegmentKind) => segments.filter((s) => s.kind === k).length;

    return {
      downtimeCount: count('downtime'),
      downtimeMin: sum('downtime'),
      // The reference names microstops as their own level. Nothing in this plant
      // measures them yet, so they are reported as an explicit zero rather than
      // folded into downtime, where they would look measured.
      microstopCount: 0,
      microstopMin: 0,
      plannedStopCount: count('planned'),
      plannedStopMin: sum('planned'),
      externalCount: count('external'),
      externalMin: sum('external'),
    };
  }
}
