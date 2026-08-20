import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../database/prisma.service';
import { toPieces, type SkuPackaging } from '../../common/units.util';
import { resolveShiftAt, type ShiftTemplateWindow, type ResolvedShift } from '../../common/shift-window.util';
import { designSpeedPph } from './oee-standard.calc';
import {
  stopWindowsForShift, plannedStopMinutes,
  type StopDefinition, type MachinePlace,
} from './planned-stop-window.util';

const MIN = 60_000;

/** The only state that counts as producing. Setup and changeover are work, not output. */
const PRODUCING = new Set(['RUNNING']);

/** What a State Rule says about a state, once resolved for a machine. */
interface Verdict {
  isDowntime: boolean;
  isPlanned: boolean;
  affectsOEE: boolean;
}

/**
 * Used when a factory has configured no rule for a state. Deliberately the same
 * shape the seed writes, so a fresh install records downtime correctly instead
 * of silently recording none.
 */
const FALLBACK: Record<string, Verdict> = {
  RUNNING: { isDowntime: false, isPlanned: false, affectsOEE: true },
  IDLE: { isDowntime: true, isPlanned: false, affectsOEE: true },
  BREAKDOWN: { isDowntime: true, isPlanned: false, affectsOEE: true },
  PLANNED_STOP: { isDowntime: true, isPlanned: true, affectsOEE: false },
  MAINTENANCE: { isDowntime: true, isPlanned: true, affectsOEE: false },
  SETUP: { isDowntime: true, isPlanned: true, affectsOEE: true },
  CHANGEOVER: { isDowntime: true, isPlanned: true, affectsOEE: true },
  STARVED: { isDowntime: true, isPlanned: false, affectsOEE: false },
  BLOCKED: { isDowntime: true, isPlanned: false, affectsOEE: false },
  OFFLINE: { isDowntime: true, isPlanned: false, affectsOEE: false },
};
const UNKNOWN: Verdict = { isDowntime: true, isPlanned: false, affectsOEE: true };

type Span = [number, number];

/**
 * Merge overlapping spans — returning NEW spans, never editing the ones given.
 *
 * The obvious implementation seeds the output with the first input span and then
 * extends it in place. That aliases: the output shares array objects with the
 * input, so extending a span here quietly rewrites it wherever else it is held.
 *
 * It costs nothing until the same span is merged twice, which is exactly what
 * the classification below does — a running span is merged once into `operating`
 * and again into `claimedSoFar`. The second merge stretched the first result, and
 * a machine that ran for half a minute was booked as running for the whole one.
 * No error, no warning: just availability that reads too high.
 */
const merge = (spans: Span[]): Span[] => {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: Span[] = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i][0] <= last[1]) last[1] = Math.max(last[1], sorted[i][1]);
    else out.push([sorted[i][0], sorted[i][1]]);
  }
  return out;
};

/** Length of `spans` that does not fall inside `taken`. */
const subtract = (spans: Span[], taken: Span[]): Span[] => {
  if (taken.length === 0) return spans;
  const out: Span[] = [];
  for (const [s, e] of spans) {
    let cur = s;
    for (const [ts, te] of taken) {
      if (te <= cur || ts >= e) continue;
      if (ts > cur) out.push([cur, Math.min(ts, e)]);
      cur = Math.max(cur, te);
      if (cur >= e) break;
    }
    if (cur < e) out.push([cur, e]);
  }
  return out;
};

const len = (spans: Span[]) => spans.reduce((a, [s, e]) => a + (e - s), 0) / MIN;

/**
 * Writes `oee_minutes` — one row per machine-minute, against the Insights Hub
 * time model.
 *
 * ── Why a second writer rather than a change to the first ───────────────────
 * The two answer to different references. This one implements a published model
 * a plant can look up; the other grew from this plant's own history of defects.
 * Running them side by side is the only way to tell a disagreement between
 * engines from a disagreement with reality — and the ability to check is the
 * whole reason the plant asked for it.
 *
 * ── The classification, in strict precedence ────────────────────────────────
 *   1. SCHEDULED PLANNED STOP  a break somebody put on the calendar. Wins over
 *                              everything, including a machine that kept running
 *                              through it: the time was not ours to produce in.
 *   2. STATE RULE              whatever the plant configured this state to mean.
 *   3. UNOBSERVED              no state record at all → unmeasured, out of both
 *                              sides. Silence is not evidence of a stop.
 *
 * Because each layer is SUBTRACTED from what the layer above did not claim, the
 * five buckets sum to total time by construction. `auditTotals` checks it anyway
 * — the failure it catches is silent, and a silent loss of minutes inflates
 * availability rather than raising an error.
 */
@Injectable()
export class OeeStandardWriter {
  private readonly logger = new Logger(OeeStandardWriter.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    try {
      await this.captureMinute(new Date());
    } catch (err) {
      this.logger.error('OEE minute capture failed', err as Error);
    }
  }

  /** Rules resolved per machine+state, cached briefly so a poll is not a query storm. */
  private ruleCache = new Map<string, { at: number; v: Verdict }>();
  private static readonly RULE_TTL_MS = 30_000;

  private async verdictFor(factoryId: string, machineId: string, state: string): Promise<Verdict> {
    const key = `${machineId}:${state}`;
    const hit = this.ruleCache.get(key);
    if (hit && Date.now() - hit.at < OeeStandardWriter.RULE_TTL_MS) return hit.v;

    let v = FALLBACK[state] ?? UNKNOWN;
    try {
      const rows = await this.prisma.machineStateRule.findMany({
        where: { factoryId, state, isActive: true, OR: [{ machineId }, { machineId: null }] },
        select: { machineId: true, isDowntime: true, isPlanned: true, affectsOEE: true },
      });
      // Most specific first: a rule for THIS machine beats the factory rule.
      const chosen = rows.find((r) => r.machineId === machineId) ?? rows.find((r) => r.machineId === null);
      if (chosen) {
        v = { isDowntime: chosen.isDowntime, isPlanned: chosen.isPlanned, affectsOEE: chosen.affectsOEE };
      }
    } catch (err) {
      // A configuration read must never stop a minute being recorded.
      this.logger.warn(`state-rule lookup failed for ${state}: ${(err as Error).message}`);
    }
    this.ruleCache.set(key, { at: Date.now(), v });
    return v;
  }

  /**
   * Capture the minute that has just CLOSED.
   *
   * The cron fires at second :00, when the current minute has barely begun.
   * Capturing it would record a full minute of total time against a couple of
   * milliseconds of operating time and collapse availability to nothing — the
   * same trap the first engine fell into, avoided here by never looking at a
   * minute that is still running.
   */
  async captureMinute(at = new Date()): Promise<number> {
    const bucketStart = new Date(Math.floor(at.getTime() / MIN) * MIN - MIN);
    const bucketEnd = new Date(bucketStart.getTime() + MIN);

    await this.prisma.oeeMinute.updateMany({
      where: { isFinalized: false, bucketStart: { lt: bucketStart } },
      data: { isFinalized: true },
    });

    // ── Scenario handling starts here ───────────────────────────────────────
    // EXECUTING and PAUSED both occupy the clock; a paused order still holds the
    // machine, and pretending otherwise would make the pause vanish from the
    // denominator instead of being charged as the deliberate stop it is.
    // COMPLETED orders stop accruing at actualEnd, which the clip below enforces
    // without needing a separate branch.
    const jos = await this.prisma.jobOrder.findMany({
      where: {
        status: { in: ['EXECUTING', 'PAUSED'] },
        machineId: { not: null },
        actualStart: { not: null, lte: bucketEnd },
      },
      select: {
        id: true, factoryId: true, machineId: true, workOrderId: true, status: true,
        idealCycleTimeSec: true, outputUnit: true,
        actualStart: true, actualEnd: true, plannedEnd: true,
        actualQtyGood: true, actualQtyRejected: true,
        machine: { select: { lineId: true } },
        workOrder: {
          select: {
            sku: { select: { baseUnit: true, unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true } },
          },
        },
      },
    });
    if (jos.length === 0) return 0;

    const machineIds = [...new Set(jos.map((j) => j.machineId!))];
    const joIds = jos.map((j) => j.id);
    const factoryIds = [...new Set(jos.map((j) => j.factoryId))];

    // What each machine reported it was doing, overlapping this bucket.
    const states = await this.prisma.machineStateRecord.findMany({
      where: {
        machineId: { in: machineIds },
        startTime: { lt: bucketEnd },
        OR: [{ endTime: null }, { endTime: { gt: bucketStart } }],
      },
      select: { machineId: true, state: true, startTime: true, endTime: true },
    });

    // Counts already booked in closed minutes → this minute's delta.
    const priorRows = await this.prisma.oeeMinute.groupBy({
      by: ['jobOrderId'],
      where: { jobOrderId: { in: joIds }, isFinalized: true },
      _sum: { goodParts: true, rejectedParts: true },
    });
    const prior = new Map(
      priorRows.map((r) => [r.jobOrderId, { good: r._sum.goodParts ?? 0, rejected: r._sum.rejectedParts ?? 0 }]),
    );

    // Shift and planned-stop definitions, per factory.
    const shiftByFactory = new Map<string, ResolvedShift | null>();
    const stopsByFactory = new Map<string, StopDefinition[]>();
    for (const fid of factoryIds) {
      const templates = (await this.prisma.shiftTemplate.findMany({
        where: { factoryId: fid, isActive: true },
        orderBy: { startTime: 'asc' },
        select: { id: true, code: true, name: true, startTime: true, endTime: true, crossesMidnight: true },
      })) as ShiftTemplateWindow[];
      shiftByFactory.set(fid, resolveShiftAt(bucketStart, templates));

      const defs = await this.prisma.plannedStopTemplate.findMany({
        where: { factoryId: fid, isActive: true },
        select: {
          id: true, code: true, name: true, durationMinutes: true, scope: true,
          shiftTemplateId: true, startOffsetMin: true, isActive: true,
          targets: { select: { machineId: true, lineId: true } },
        },
      });
      stopsByFactory.set(fid, defs as unknown as StopDefinition[]);
    }

    let written = 0;
    for (const jo of jos) {
      const row = await this.buildRow(
        jo, bucketStart, bucketEnd, at, states, prior,
        shiftByFactory.get(jo.factoryId) ?? null,
        stopsByFactory.get(jo.factoryId) ?? [],
      );
      if (!row) continue;
      try {
        await this.prisma.oeeMinute.upsert({
          where: { ux_oee_minute_jo_bucket: { jobOrderId: jo.id, bucketStart } },
          create: row,
          update: row,
        });
        written++;
      } catch (e) {
        this.logger.warn(`oee minute upsert failed for JO ${jo.id}: ${(e as Error).message}`);
      }
    }
    return written;
  }

  private async buildRow(
    jo: any,
    bucketStart: Date,
    bucketEnd: Date,
    at: Date,
    states: Array<{ machineId: string; state: string; startTime: Date; endTime: Date | null }>,
    prior: Map<string, { good: number; rejected: number }>,
    shift: ResolvedShift | null,
    stopDefs: StopDefinition[],
  ) {
    // ── Total time: the job order's occupancy of this minute ─────────────────
    // Clipped at BOTH ends. actualEnd closes a finished order; `at` stops an open
    // one from claiming a future it has not lived yet.
    //
    // Note what is deliberately NOT here: plannedEnd. An order that overruns its
    // schedule keeps accruing total time, because the schedule was a plan and OEE
    // measures what happened. Capping total time at plannedEnd would make the
    // overrun free — the machine would run past its slot and the loss would
    // simply not appear anywhere.
    const joStart = new Date(jo.actualStart).getTime();
    const joEnd = jo.actualEnd ? new Date(jo.actualEnd).getTime() : at.getTime();
    const winFrom = Math.max(bucketStart.getTime(), joStart);
    const winTo = Math.min(bucketEnd.getTime(), joEnd, at.getTime());
    const totalMin = Math.max(0, (winTo - winFrom) / MIN);
    if (totalMin <= 0) return null;

    const whole: Span[] = [[winFrom, winTo]];

    // ── Layer 1: scheduled planned stops ────────────────────────────────────
    const place: MachinePlace = { machineId: jo.machineId, lineId: jo.machine?.lineId ?? null };
    const windows = shift ? stopWindowsForShift(stopDefs, shift, place) : [];
    const scheduledSpans: Span[] = merge(
      windows
        .map((w) => [Math.max(w.start.getTime(), winFrom), Math.min(w.end.getTime(), winTo)] as Span)
        .filter(([s, e]) => e > s),
    );

    // ── Layer 2: what the machine said, classified by State Rules ───────────
    const mine = states.filter((s) => s.machineId === jo.machineId);
    const byKind: Record<'operating' | 'planned' | 'external' | 'avail', Span[]> = {
      operating: [], planned: [], external: [], avail: [],
    };
    let dominant: string | null = null;
    let dominantMs = 0;

    for (const seg of mine) {
      const s = Math.max(new Date(seg.startTime).getTime(), winFrom);
      const e = Math.min(seg.endTime ? new Date(seg.endTime).getTime() : at.getTime(), winTo);
      if (e <= s) continue;
      if (e - s > dominantMs) { dominantMs = e - s; dominant = seg.state; }

      if (PRODUCING.has(seg.state)) { byKind.operating.push([s, e]); continue; }
      const v = await this.verdictFor(jo.factoryId, jo.machineId, seg.state);
      if (v.isDowntime && v.isPlanned) byKind.planned.push([s, e]);
      else if (v.isDowntime && !v.affectsOEE) byKind.external.push([s, e]);
      // Not producing and not excused is an availability loss — including a state
      // the plant marked as "not downtime". Inside planned production time, a
      // minute that made nothing is a loss whatever it is called.
      else byKind.avail.push([s, e]);
    }

    // A paused order is a deliberate human decision about that time, so it reads
    // as a planned stop for any part of the minute the machine did not itself
    // account for. Charging it to availability would blame the machine for a
    // choice somebody made about it.
    const pausedSpans: Span[] = jo.status === 'PAUSED' ? [[winFrom, winTo]] : [];

    // ── Precedence, applied by subtraction so nothing is counted twice ───────
    const planned = merge([...scheduledSpans, ...byKind.planned, ...pausedSpans]);
    const operating = subtract(merge(byKind.operating), planned);
    const external = subtract(merge(byKind.external), [...planned, ...operating].sort((a, b) => a[0] - b[0]));
    const claimedSoFar = merge([...planned, ...operating, ...external]);
    const avail = subtract(merge(byKind.avail), claimedSoFar);
    // Whatever no layer claimed was never observed at all.
    const unmeasured = subtract(whole, merge([...claimedSoFar, ...avail]));

    const plannedStopMin = len(planned);
    const operatingMin = len(operating);
    const externalLossMin = len(external);
    const availabilityLossMin = len(avail);
    const unmeasuredMin = len(unmeasured);

    // ── Counts: the delta this minute, in pieces ────────────────────────────
    const sku: SkuPackaging | null = jo.workOrder?.sku ?? null;
    const unit: string | undefined = jo.outputUnit ?? undefined;
    const toBase = (q: number) => (sku && unit ? toPieces(q, unit, sku) : q);

    const p = prior.get(jo.id) ?? { good: 0, rejected: 0 };
    const goodParts = Math.max(0, toBase(jo.actualQtyGood ?? 0) - p.good);
    const rejectedParts = Math.max(0, toBase(jo.actualQtyRejected ?? 0) - p.rejected);

    // Design speed in PIECES per hour, so a theoretical output and an actual count
    // are the same kind of thing. The cycle time is per OUTPUT unit, so it is
    // converted on the same ladder the counts are.
    const perOutputUnit = toBase(1) || 1;
    const speedOut = designSpeedPph(jo.idealCycleTimeSec);
    const designSpeed = speedOut != null ? speedOut * perOutputUnit : null;
    const theoreticalParts = designSpeed != null ? (operatingMin / 60) * designSpeed : 0;

    return {
      bucketStart,
      isFinalized: false,
      factoryId: jo.factoryId,
      machineId: jo.machineId,
      jobOrderId: jo.id,
      workOrderId: jo.workOrderId ?? null,
      shiftTemplateId: shift?.templateId ?? null,
      shiftCode: shift?.code ?? null,
      machineState: dominant,
      jobOrderStatus: jo.status,
      totalMin, plannedStopMin, availabilityLossMin, externalLossMin, unmeasuredMin, operatingMin,
      goodParts, rejectedParts, theoreticalParts,
      designSpeedPph: designSpeed,
    };
  }
}
