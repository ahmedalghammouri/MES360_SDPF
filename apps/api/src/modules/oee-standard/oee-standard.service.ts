import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { computeOee, auditTotals, EMPTY_TOTALS, type OeeTotals, type OeeResult } from './oee-standard.calc';

export interface OeeScope {
  areaId?: string;
  machineId?: string;
  lineId?: string;
  jobOrderId?: string;
  workOrderId?: string;
  shiftTemplateId?: string;
}

/** A row of the machine table, and the shape a trend point takes. */
export interface OeeSlice extends OeeResult {
  key: string;
  label: string;
  sublabel?: string | null;
}

/**
 * Every query in this file reads `oee_minutes` under the alias `o`, and every
 * column it names is qualified with it.
 *
 * Not a style choice. Three of these queries join `machines`, `job_orders` and
 * `work_orders`, and all of those carry a `factoryId` of their own — so an
 * unqualified predicate is ambiguous and Postgres refuses the statement outright
 * (42702). It shipped because the account that tested it was a SUPER_ADMIN with
 * no factory, which meant the factory predicate was never added to the SQL at
 * all: the one path that breaks was the one path the test could not reach.
 */
/**
 * Time sums. Every machine's minutes count, wherever it sits in the routing.
 */
const TIME_SUMS = Prisma.sql`
  COALESCE(SUM(o."totalMin"), 0)::float8            AS "totalMin",
  COALESCE(SUM(o."plannedStopMin"), 0)::float8      AS "plannedStopMin",
  COALESCE(SUM(o."availabilityLossMin"), 0)::float8 AS "availabilityLossMin",
  COALESCE(SUM(o."externalLossMin"), 0)::float8     AS "externalLossMin",
  COALESCE(SUM(o."unmeasuredMin"), 0)::float8       AS "unmeasuredMin",
  COALESCE(SUM(o."operatingMin"), 0)::float8        AS "operatingMin"
`;

const SUMS = Prisma.sql`
  COALESCE(SUM(o."totalMin"), 0)::float8            AS "totalMin",
  COALESCE(SUM(o."plannedStopMin"), 0)::float8      AS "plannedStopMin",
  COALESCE(SUM(o."availabilityLossMin"), 0)::float8 AS "availabilityLossMin",
  COALESCE(SUM(o."externalLossMin"), 0)::float8     AS "externalLossMin",
  COALESCE(SUM(o."unmeasuredMin"), 0)::float8       AS "unmeasuredMin",
  COALESCE(SUM(o."operatingMin"), 0)::float8        AS "operatingMin",
  COALESCE(SUM(o."goodParts"), 0)::float8           AS "goodParts",
  COALESCE(SUM(o."rejectedParts"), 0)::float8       AS "rejectedParts",
  COALESCE(SUM(o."theoreticalParts"), 0)::float8    AS "theoreticalParts"
`;

/**
 * Reads `oee_minutes` and nothing else.
 *
 * The single aggregate in this engine. Every figure any surface shows — a
 * machine row, a shift comparison, a trend point, the plant total — is this one
 * query with a different GROUP BY, passed through the one calculator. There is
 * no second path to the same number, which is the property that makes two
 * screens agree.
 */
@Injectable()
export class OeeStandardService {
  constructor(private readonly prisma: PrismaService) {}

  private where(factoryId: string | null, from: Date, to: Date, scope: OeeScope): Prisma.Sql {
    const parts: Prisma.Sql[] = [Prisma.sql`o."bucketStart" >= ${from} AND o."bucketStart" < ${to}`];
    if (factoryId) parts.push(Prisma.sql`o."factoryId" = ${factoryId}`);
    if (scope.machineId) parts.push(Prisma.sql`o."machineId" = ${scope.machineId}`);
    if (scope.jobOrderId) parts.push(Prisma.sql`o."jobOrderId" = ${scope.jobOrderId}`);
    if (scope.workOrderId) parts.push(Prisma.sql`o."workOrderId" = ${scope.workOrderId}`);
    if (scope.shiftTemplateId) parts.push(Prisma.sql`o."shiftTemplateId" = ${scope.shiftTemplateId}`);
    if (scope.areaId) {
      // A machine belongs to an area either directly or through its line, and
      // the hierarchy allows both — asking for only one silently drops half a
      // plant from an area-scoped reading.
      parts.push(Prisma.sql`o."machineId" IN (
        SELECT m2.id FROM machines m2
        WHERE m2."areaId" = ${scope.areaId}
           OR m2."lineId" IN (SELECT l2.id FROM production_lines l2 WHERE l2."areaId" = ${scope.areaId})
      )`);
    }
    if (scope.lineId) {
      parts.push(Prisma.sql`o."machineId" IN (SELECT m2.id FROM machines m2 WHERE m2."lineId" = ${scope.lineId})`);
    }
    return Prisma.join(parts, ' AND ');
  }

  /** One set of totals for the whole scope. */
  /**
   * A roll-up over more than one machine — the plant, a line, an area.
   *
   * ── The rule the per-machine rows cannot apply for you ──────────────────────
   * TIME belongs to every machine: a minute the filler spent broken is a real
   * minute wherever it sat in the routing. QUANTITY does not. One physical unit
   * passes four stations on this line, and summing every step counts it four
   * times — which inflates output and DILUTES the scrap rate, because the scrap
   * stays where it happened while the good count is multiplied.
   *
   * Measured on this window: 34,037 good pieces summed across steps against
   * 19,757 from the final step, and quality reading 82.9% instead of 73.7%. Nine
   * points of scrap hidden by arithmetic.
   *
   * So good and theoretical come from the LAST step of each work order, and
   * scrap comes from ALL of them: a unit thrown away at the filler is a real
   * loss even though it never reached the wrapper.
   *
   * The per-machine and per-job-order rows below do NOT apply this — each of
   * those is one station's own output in its own right, and it would be wrong to
   * blank a filler's count because it is not the end of the line. That means the
   * roll-up is deliberately not the sum of the rows, which is why the page says
   * so rather than leaving somebody to add the column up and find a third number.
   */
  async totals(factoryId: string | null, from: Date, to: Date, scope: OeeScope = {}): Promise<OeeTotals> {
    const rows = await this.prisma.$queryRaw<OeeTotals[]>(Prisma.sql`
      WITH scoped AS (
        SELECT o.*, j."sequenceOrder"
        FROM oee_minutes o
        JOIN job_orders j ON j.id = o."jobOrderId"
        WHERE ${this.where(factoryId, from, to, scope)}
      ),
      fin AS (
        SELECT s2."workOrderId", MAX(s2."sequenceOrder") AS ms FROM scoped s2 GROUP BY s2."workOrderId"
      ),
      t AS (SELECT ${TIME_SUMS} FROM scoped o),
      q AS (
        SELECT COALESCE(SUM(o."goodParts"), 0)::float8        AS "goodParts",
               COALESCE(SUM(o."theoreticalParts"), 0)::float8 AS "theoreticalParts"
        FROM scoped o
        JOIN fin f ON f."workOrderId" IS NOT DISTINCT FROM o."workOrderId" AND f.ms = o."sequenceOrder"
      ),
      -- Scrap from every step. A unit rejected at the filler is gone whether or
      -- not anything downstream ever saw it.
      sc AS (SELECT COALESCE(SUM(o."rejectedParts"), 0)::float8 AS "rejectedParts" FROM scoped o)
      SELECT t.*, q."goodParts", q."theoreticalParts", sc."rejectedParts"
      FROM t, q, sc
    `);
    return rows[0] ?? EMPTY_TOTALS;
  }

  /**
   * The plant-level answer, with the engine's own audit attached.
   *
   * The audit travels WITH the numbers rather than sitting behind a debug flag.
   * A page that shows a figure and cannot show whether its minutes reconcile is
   * asking to be believed; one that shows both is asking to be checked.
   */
  async overview(factoryId: string | null, from: Date, to: Date, scope: OeeScope = {}) {
    const t = await this.totals(factoryId, from, to, scope);
    return { window: { from, to }, ...computeOee(t), audit: auditTotals(t) };
  }

  /** Per machine, worst OEE first — the list somebody acts on. */
  async byMachine(factoryId: string | null, from: Date, to: Date, scope: OeeScope = {}): Promise<OeeSlice[]> {
    const rows = await this.prisma.$queryRaw<Array<OeeTotals & { machineId: string; code: string; name: string; line: string | null }>>(Prisma.sql`
      SELECT o."machineId", m.code, m.name, l.code AS line, ${SUMS}
      FROM oee_minutes o
      JOIN machines m ON m.id = o."machineId"
      LEFT JOIN production_lines l ON l.id = m."lineId"
      WHERE ${this.where(factoryId, from, to, scope)}
      GROUP BY o."machineId", m.code, m.name, l.code
    `);
    return rows
      .map((r) => ({ key: r.machineId, label: r.code, sublabel: r.name, ...computeOee(r) }))
      .sort((a, b) => (a.oee ?? 101) - (b.oee ?? 101));
  }

  /** Per job order — the level this engine actually measures at. */
  async byJobOrder(factoryId: string | null, from: Date, to: Date, scope: OeeScope = {}): Promise<OeeSlice[]> {
    const rows = await this.prisma.$queryRaw<Array<OeeTotals & {
      jobOrderId: string; operationName: string | null; status: string;
      orderNumber: string | null; machineCode: string | null;
    }>>(Prisma.sql`
      SELECT o."jobOrderId", j."operationName", j.status,
             w."orderNumber", m.code AS "machineCode", ${SUMS}
      FROM oee_minutes o
      JOIN job_orders j ON j.id = o."jobOrderId"
      LEFT JOIN work_orders w ON w.id = o."workOrderId"
      LEFT JOIN machines m ON m.id = o."machineId"
      WHERE ${this.where(factoryId, from, to, scope)}
      GROUP BY o."jobOrderId", j."operationName", j.status, w."orderNumber", m.code
    `);
    return rows.map((r) => ({
      key: r.jobOrderId,
      label: `${r.orderNumber ?? '—'} · ${r.operationName ?? '—'}`,
      sublabel: `${r.machineCode ?? '—'} · ${r.status}`,
      ...computeOee(r),
    }));
  }

  /** Per shift — the second dimension this store keeps. */
  async byShift(factoryId: string | null, from: Date, to: Date, scope: OeeScope = {}): Promise<OeeSlice[]> {
    const rows = await this.prisma.$queryRaw<Array<OeeTotals & { shiftCode: string | null }>>(Prisma.sql`
      SELECT o."shiftCode", ${SUMS}
      FROM oee_minutes o WHERE ${this.where(factoryId, from, to, scope)}
      GROUP BY o."shiftCode"
    `);
    return rows
      .map((r) => ({ key: r.shiftCode ?? 'unassigned', label: r.shiftCode ?? 'Unassigned', ...computeOee(r) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * A trend, bucketed by hour or day.
   *
   * `date_trunc` on the stored bucket rather than a separate rollup table: at a
   * minute a machine, a year of this line is under three million rows, and a
   * second store of the same fact is the thing that lets two numbers drift.
   */
  async trend(
    factoryId: string | null, from: Date, to: Date,
    granularity: 'hour' | 'day' = 'hour',
    scope: OeeScope = {},
  ): Promise<Array<OeeSlice & { at: Date }>> {
    const unit = granularity === 'day' ? 'day' : 'hour';
    const rows = await this.prisma.$queryRaw<Array<OeeTotals & { at: Date }>>(Prisma.sql`
      WITH scoped AS (
        SELECT o.*, j."sequenceOrder", date_trunc(${unit}, o."bucketStart") AS at
        FROM oee_minutes o
        JOIN job_orders j ON j.id = o."jobOrderId"
        WHERE ${this.where(factoryId, from, to, scope)}
      ),
      -- The final step is resolved PER BUCKET, so a work order whose last station
      -- had not started early in the window is not credited with output it had
      -- not made yet.
      fin AS (SELECT s2.at, s2."workOrderId", MAX(s2."sequenceOrder") AS ms
              FROM scoped s2 GROUP BY s2.at, s2."workOrderId"),
      t AS (SELECT o.at, ${TIME_SUMS},
                   COALESCE(SUM(o."rejectedParts"), 0)::float8 AS "rejectedParts"
            FROM scoped o GROUP BY o.at),
      q AS (SELECT o.at,
                   COALESCE(SUM(o."goodParts"), 0)::float8        AS "goodParts",
                   COALESCE(SUM(o."theoreticalParts"), 0)::float8 AS "theoreticalParts"
            FROM scoped o
            JOIN fin f ON f.at = o.at
                      AND f."workOrderId" IS NOT DISTINCT FROM o."workOrderId"
                      AND f.ms = o."sequenceOrder"
            GROUP BY o.at)
      SELECT t.at, t."totalMin", t."plannedStopMin", t."availabilityLossMin", t."externalLossMin",
             t."unmeasuredMin", t."operatingMin", t."rejectedParts",
             COALESCE(q."goodParts", 0) AS "goodParts",
             COALESCE(q."theoreticalParts", 0) AS "theoreticalParts"
      FROM t LEFT JOIN q ON q.at = t.at
      ORDER BY t.at
    `);
    return rows.map((r) => ({
      at: r.at, key: r.at.toISOString(), label: r.at.toISOString(), ...computeOee(r),
    }));
  }

  /**
   * Why a machine's minutes went where they did, in the window.
   *
   * The time model says how much was lost; this says under which state. Without
   * it "availability loss 3 h" is a number nobody can act on.
   */
  async stateBreakdown(factoryId: string | null, from: Date, to: Date, scope: OeeScope = {}) {
    return this.prisma.$queryRaw<Array<{ state: string | null; minutes: number; rows: number }>>(Prisma.sql`
      SELECT o."machineState" AS state,
             COALESCE(SUM(o."totalMin"), 0)::float8 AS minutes,
             COUNT(*)::int AS rows
      FROM oee_minutes o WHERE ${this.where(factoryId, from, to, scope)}
      GROUP BY o."machineState" ORDER BY 2 DESC
    `);
  }
}
