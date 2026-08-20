import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import {
  computeSchedule, auditSchedule, EMPTY_SCHEDULE_TOTALS,
  type ScheduleTotals, type ScheduleResult,
} from './oee-schedule.calc';

export interface ScheduleScope {
  machineId?: string;
  lineId?: string;
  jobOrderId?: string;
  workOrderId?: string;
  shiftTemplateId?: string;
}

export interface ScheduleSlice extends ScheduleResult {
  key: string;
  label: string;
  sublabel?: string | null;
}

/**
 * Reads `oee_schedule_minutes` and nothing else.
 *
 * ── Why every query goes through a per-job-order stage ───────────────────────
 * The committed slot is a property of a JOB ORDER, and it is stamped on every
 * one of that order's minutes. Summing it across rows would multiply an
 * eight-hour slot by however many minutes happen to be stored — so the slot is
 * collapsed per job order first (MIN of the start, MAX of the end), clipped to
 * the query window, and only then summed.
 *
 * The elapsed buckets sum normally, because those genuinely are per minute.
 * Mixing the two in one GROUP BY is the mistake this shape exists to prevent.
 *
 * ── Why the slot has its own upper bound ────────────────────────────────────
 * Minute rows only exist for time that has gone by, so clipping them at "now"
 * costs nothing. The slot is the opposite: its whole point is the part that has
 * NOT gone by, and clipping that at "now" deletes the term this engine exists to
 * report. A run whose slot ran an hour past the replay came back with 5.6
 * not-yet-reached minutes instead of 60 for exactly that reason.
 *
 * So `slotTo` is the end of the range the user ASKED for — end of the selected
 * day — while `to` stays capped at now for the rows. Ask for today and a slot
 * closing this evening is counted in full; ask for a narrow window and the slot
 * is still clipped to it.
 */
@Injectable()
export class OeeScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  private where(factoryId: string | null, from: Date, to: Date, scope: ScheduleScope): Prisma.Sql {
    const parts: Prisma.Sql[] = [Prisma.sql`o."bucketStart" >= ${from} AND o."bucketStart" < ${to}`];
    if (factoryId) parts.push(Prisma.sql`o."factoryId" = ${factoryId}`);
    if (scope.machineId) parts.push(Prisma.sql`o."machineId" = ${scope.machineId}`);
    if (scope.jobOrderId) parts.push(Prisma.sql`o."jobOrderId" = ${scope.jobOrderId}`);
    if (scope.workOrderId) parts.push(Prisma.sql`o."workOrderId" = ${scope.workOrderId}`);
    if (scope.shiftTemplateId) parts.push(Prisma.sql`o."shiftTemplateId" = ${scope.shiftTemplateId}`);
    if (scope.lineId) {
      parts.push(Prisma.sql`o."machineId" IN (SELECT m2.id FROM machines m2 WHERE m2."lineId" = ${scope.lineId})`);
    }
    return Prisma.join(parts, ' AND ');
  }

  /**
   * Per job order: the slot collapsed once, the buckets summed, and the late
   * start measured against the clipped slot.
   *
   * `notStartedMin` is the gap between the slot opening and the machine actually
   * starting — both clipped to the window, so a window that begins after the
   * order started reports no late start rather than a negative one.
   */
  private perJobOrder(
    factoryId: string | null, from: Date, to: Date, slotTo: Date, scope: ScheduleScope,
  ): Prisma.Sql {
    return Prisma.sql`
      SELECT o."jobOrderId",
             MIN(o."machineId")       AS "machineId",
             MIN(o."workOrderId")     AS "workOrderId",
             MIN(o."shiftCode")       AS "shiftCode",
             GREATEST(MIN(o."committedFrom"), ${from}) AS "slotFrom",
             LEAST(MAX(o."committedTo"), ${slotTo})    AS "slotTo",
             MIN(j."actualStart")     AS "actualStart",
             COALESCE(SUM(o."totalMin"), 0)::float8            AS "elapsedMin",
             COALESCE(SUM(o."plannedStopMin"), 0)::float8      AS "plannedStopMin",
             COALESCE(SUM(o."availabilityLossMin"), 0)::float8 AS "availabilityLossMin",
             COALESCE(SUM(o."externalLossMin"), 0)::float8     AS "externalLossMin",
             COALESCE(SUM(o."unmeasuredMin"), 0)::float8       AS "unmeasuredMin",
             COALESCE(SUM(o."operatingMin"), 0)::float8        AS "operatingMin",
             COALESCE(SUM(o."goodParts"), 0)::float8           AS "goodParts",
             COALESCE(SUM(o."rejectedParts"), 0)::float8       AS "rejectedParts",
             COALESCE(SUM(o."theoreticalParts"), 0)::float8    AS "theoreticalParts"
      FROM oee_schedule_minutes o
      JOIN job_orders j ON j.id = o."jobOrderId"
      WHERE ${this.where(factoryId, from, to, scope)}
      GROUP BY o."jobOrderId"
    `;
  }

  /** The per-job-order stage rolled into one set of totals. */
  private rollup(inner: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`
      SELECT
        COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (p."slotTo" - p."slotFrom")) / 60)), 0)::float8 AS "committedMin",
        COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (
          LEAST(COALESCE(p."actualStart", p."slotFrom"), p."slotTo") - p."slotFrom"
        )) / 60)), 0)::float8 AS "notStartedMin",
        COALESCE(SUM(p."elapsedMin"), 0)::float8            AS "elapsedMin",
        COALESCE(SUM(p."plannedStopMin"), 0)::float8        AS "plannedStopMin",
        COALESCE(SUM(p."availabilityLossMin"), 0)::float8   AS "availabilityLossMin",
        COALESCE(SUM(p."externalLossMin"), 0)::float8       AS "externalLossMin",
        COALESCE(SUM(p."unmeasuredMin"), 0)::float8         AS "unmeasuredMin",
        COALESCE(SUM(p."operatingMin"), 0)::float8          AS "operatingMin",
        COALESCE(SUM(p."goodParts"), 0)::float8             AS "goodParts",
        COALESCE(SUM(p."rejectedParts"), 0)::float8         AS "rejectedParts",
        COALESCE(SUM(p."theoreticalParts"), 0)::float8      AS "theoreticalParts"
      FROM (${inner}) p
    `;
  }

  async totals(
    factoryId: string | null, from: Date, to: Date, slotTo: Date, scope: ScheduleScope = {},
  ): Promise<ScheduleTotals> {
    const rows = await this.prisma.$queryRaw<ScheduleTotals[]>(
      this.rollup(this.perJobOrder(factoryId, from, to, slotTo, scope)),
    );
    return rows[0] ?? EMPTY_SCHEDULE_TOTALS;
  }

  async overview(
    factoryId: string | null, from: Date, to: Date, slotTo: Date, scope: ScheduleScope = {},
  ) {
    const t = await this.totals(factoryId, from, to, slotTo, scope);
    return { window: { from, to, slotTo }, ...computeSchedule(t), audit: auditSchedule(t) };
  }

  /** Grouped by any column the per-job-order stage carries. */
  private async grouped(
    factoryId: string | null, from: Date, to: Date, slotTo: Date, scope: ScheduleScope,
    column: 'machineId' | 'shiftCode',
  ): Promise<Array<ScheduleTotals & { key: string | null }>> {
    const inner = this.perJobOrder(factoryId, from, to, slotTo, scope);
    const col = column === 'machineId' ? Prisma.sql`p."machineId"` : Prisma.sql`p."shiftCode"`;
    return this.prisma.$queryRaw(Prisma.sql`
      SELECT ${col} AS key,
        COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (p."slotTo" - p."slotFrom")) / 60)), 0)::float8 AS "committedMin",
        COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (
          LEAST(COALESCE(p."actualStart", p."slotFrom"), p."slotTo") - p."slotFrom"
        )) / 60)), 0)::float8 AS "notStartedMin",
        COALESCE(SUM(p."elapsedMin"), 0)::float8          AS "elapsedMin",
        COALESCE(SUM(p."plannedStopMin"), 0)::float8      AS "plannedStopMin",
        COALESCE(SUM(p."availabilityLossMin"), 0)::float8 AS "availabilityLossMin",
        COALESCE(SUM(p."externalLossMin"), 0)::float8     AS "externalLossMin",
        COALESCE(SUM(p."unmeasuredMin"), 0)::float8       AS "unmeasuredMin",
        COALESCE(SUM(p."operatingMin"), 0)::float8        AS "operatingMin",
        COALESCE(SUM(p."goodParts"), 0)::float8           AS "goodParts",
        COALESCE(SUM(p."rejectedParts"), 0)::float8       AS "rejectedParts",
        COALESCE(SUM(p."theoreticalParts"), 0)::float8    AS "theoreticalParts"
      FROM (${inner}) p
      GROUP BY ${col}
    `);
  }

  async byMachine(
    factoryId: string | null, from: Date, to: Date, slotTo: Date, scope: ScheduleScope = {},
  ): Promise<ScheduleSlice[]> {
    const rows = await this.grouped(factoryId, from, to, slotTo, scope, 'machineId');
    const ids = rows.map((r) => r.key).filter((k): k is string => !!k);
    const machines = ids.length
      ? await this.prisma.machine.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } })
      : [];
    const byId = new Map(machines.map((m) => [m.id, m]));
    return rows
      .map((r) => ({
        key: r.key ?? 'unknown',
        label: byId.get(r.key ?? '')?.code ?? '—',
        sublabel: byId.get(r.key ?? '')?.name ?? null,
        ...computeSchedule(r),
      }))
      .sort((a, b) => (a.oee ?? 101) - (b.oee ?? 101));
  }

  async byShift(
    factoryId: string | null, from: Date, to: Date, slotTo: Date, scope: ScheduleScope = {},
  ): Promise<ScheduleSlice[]> {
    const rows = await this.grouped(factoryId, from, to, slotTo, scope, 'shiftCode');
    return rows
      .map((r) => ({ key: r.key ?? 'unassigned', label: r.key ?? 'Unassigned', ...computeSchedule(r) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Per job order — the level this basis is actually defined at.
   *
   * No rollup stage: the per-job-order query already IS one row per order, so
   * the slot is used directly rather than summed.
   */
  async byJobOrder(
    factoryId: string | null, from: Date, to: Date, slotTo: Date, scope: ScheduleScope = {},
  ): Promise<ScheduleSlice[]> {
    const inner = this.perJobOrder(factoryId, from, to, slotTo, scope);
    const rows = await this.prisma.$queryRaw<Array<ScheduleTotals & {
      jobOrderId: string; operationName: string | null; status: string;
      orderNumber: string | null; machineCode: string | null;
      slotFrom: Date; slotTo: Date;
    }>>(Prisma.sql`
      SELECT p."jobOrderId", j."operationName", j.status, w."orderNumber", m.code AS "machineCode",
             p."slotFrom", p."slotTo",
             GREATEST(0, EXTRACT(EPOCH FROM (p."slotTo" - p."slotFrom")) / 60)::float8 AS "committedMin",
             GREATEST(0, EXTRACT(EPOCH FROM (
               LEAST(COALESCE(p."actualStart", p."slotFrom"), p."slotTo") - p."slotFrom"
             )) / 60)::float8 AS "notStartedMin",
             p."elapsedMin", p."plannedStopMin", p."availabilityLossMin", p."externalLossMin",
             p."unmeasuredMin", p."operatingMin", p."goodParts", p."rejectedParts", p."theoreticalParts"
      FROM (${inner}) p
      JOIN job_orders j ON j.id = p."jobOrderId"
      LEFT JOIN work_orders w ON w.id = p."workOrderId"
      LEFT JOIN machines m ON m.id = p."machineId"
    `);
    return rows.map((r) => ({
      key: r.jobOrderId,
      label: `${r.orderNumber ?? '—'} · ${r.operationName ?? '—'}`,
      sublabel: `${r.machineCode ?? '—'} · ${r.status}`,
      ...computeSchedule(r),
    }));
  }

  /** Why the minutes went where they did. */
  async stateBreakdown(factoryId: string | null, from: Date, to: Date, scope: ScheduleScope = {}) {
    return this.prisma.$queryRaw<Array<{ state: string | null; minutes: number; rows: number }>>(Prisma.sql`
      SELECT o."machineState" AS state,
             COALESCE(SUM(o."totalMin"), 0)::float8 AS minutes,
             COUNT(*)::int AS rows
      FROM oee_schedule_minutes o WHERE ${this.where(factoryId, from, to, scope)}
      GROUP BY o."machineState" ORDER BY 2 DESC
    `);
  }
}
