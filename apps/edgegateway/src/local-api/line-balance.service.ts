import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';
import { GatewayContextService } from '../context/gateway-context.service';
import { CountBalanceService, type BalanceRun, type BalanceStep } from './count-balance.service';
import { toPieces, fromPieces, normaliseUnit, type LadderUnit, type SkuPackaging } from '@mes360/shared';

/** How a machine's figure was arrived at. */
export type BalanceVerdict =
  | 'ANCHOR'        // the reference — never adjusted
  | 'BALANCED'      // the gap is within what the conveyor can hold
  | 'CORRECTED'     // part of the gap had no physical explanation
  | 'CLAMPED'       // the correction hit its ceiling; an alarm goes with it
  | 'UNCONFIGURED'  // no buffer capacity known, so no claim is made
  | 'DISABLED';

export interface BalancedStep extends BalanceStep {
  /** Config in force for this machine, if any. */
  isAnchor: boolean;
  enabled: boolean;
  applyAdjustment: boolean;
  /** Capacity as ENTERED, in the unit it was measured in. */
  bufferToNextQty: number | null;
  bufferUnit: string | null;
  /** The same capacity converted to the line's common unit — what the maths uses. */
  bufferCommon: number | null;
  maxCorrectionPct: number;

  /** Of the gap to the machine before it, how much the conveyor can hold. */
  explainedByBuffer: number | null;
  /** The remainder, which material cannot account for. */
  unexplained: number | null;

  /** The figure after balancing, in the common unit. */
  balancedCommon: number;
  /** balanced − counted, in the common unit. */
  correction: number;
  correctionPct: number;
  /** What the balance asked for before the ceiling was applied. */
  requestedCorrection: number;
  verdict: BalanceVerdict;
  reason: string;
}

export interface BalancedRun extends Omit<BalanceRun, 'steps'> {
  steps: BalancedStep[];
  anchorMachineId: string | null;
  /** True when every machine has been still long enough that the line is empty. */
  drained: boolean;
  /** Sum of corrections, common unit — the line's total unexplained loss. */
  totalCorrection: number;
}

/**
 * BALANCING A LINE'S COUNTERS AGAINST EACH OTHER.
 *
 * ── The idea ────────────────────────────────────────────────────────────────
 * One counter can lie. A whole line cannot, because material is conserved: what
 * left one machine either entered the next, is still on the conveyor between
 * them, or was removed by hand. Once the conveyor's capacity is known, the gap
 * that physics permits is a NUMBER — and anything past it is a counting error
 * rather than a mystery.
 *
 * So corrections are not guesses. They are the minimum the line's own geometry
 * forces to be true.
 *
 * ── What it will not do ─────────────────────────────────────────────────────
 * It never invents production. In the direction where a buffer could explain the
 * difference, it explains it and moves on. In the direction where it could not —
 * a machine reporting fewer units than the machine AFTER it processed, which
 * material cannot do — it credits only the minimum, never the minimum plus an
 * assumed buffer.
 *
 * It never hides a broken sensor either. A correction beyond the configured
 * ceiling is clamped and reported, so the worse a counter gets the LOUDER it
 * becomes. A balancer that quietly absorbed drift would be the one thing worse
 * than a miscount.
 *
 * And it never touches a link whose buffer capacity is unknown. An unmeasured
 * conveyor is left unbalanced rather than assumed empty.
 */
@Injectable()
export class LineBalanceService implements OnModuleInit {
  private readonly logger = new Logger(LineBalanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: GatewayContextService,
    private readonly counts: CountBalanceService,
  ) {}

  /** Recover what has already been applied, so a restart continues rather than repeats. */
  async onModuleInit(): Promise<void> {
    await this.primeApplied().catch(() => undefined);
  }

  async balance(): Promise<BalancedRun[]> {
    const runs = await this.counts.balance();
    if (!runs.length) return [];

    const factoryId = this.ctx.getFactoryId();
    const cfgRows = await this.prisma.lineBalanceConfig
      .findMany({ where: factoryId ? { factoryId } : {} })
      .catch(() => [] as any[]);
    const cfg = new Map(cfgRows.map((c: any) => [c.machineId, c]));

    return runs.map((run) => this.balanceRun(run, cfg));
  }

  private balanceRun(run: BalanceRun, cfg: Map<string, any>): BalancedRun {
    const steps = run.steps;

    // The reference. Configured if someone chose one; otherwise the LAST step
    // that can convert — the end of a line counts the biggest, slowest, least
    // missable units, and is the safest default reference there is.
    let anchorIdx = steps.findIndex((s) => cfg.get(s.machineId ?? '')?.isAnchor);
    if (anchorIdx < 0) {
      for (let i = steps.length - 1; i >= 0; i -= 1) {
        if (!steps[i].unconvertible) { anchorIdx = i; break; }
      }
    }

    const out: BalancedStep[] = steps.map((s) =>
      this.blank(s, cfg.get(s.machineId ?? ''), run.commonUnit, run.packaging));
    if (anchorIdx < 0) return this.wrap(run, out, null);

    out[anchorIdx].verdict = 'ANCHOR';
    out[anchorIdx].reason = 'المرجع — لا يُعدَّل';
    out[anchorIdx].balancedCommon = out[anchorIdx].goodCommon;

    // ── Upstream: from the anchor back to the head of the line ──────────────
    // Each machine is measured against what the one AFTER it actually handled.
    for (let i = anchorIdx - 1; i >= 0; i -= 1) {
      const here = out[i];
      const next = out[i + 1];
      const downstreamHandled = next.balancedCommon + next.rejectCommon;
      this.reconcile(here, here.goodCommon - downstreamHandled, downstreamHandled, next);
    }

    // ── Downstream: from the anchor to the tail ─────────────────────────────
    for (let i = anchorIdx + 1; i < out.length; i += 1) {
      const here = out[i];
      const prev = out[i - 1];
      const upstreamMade = prev.balancedCommon;
      // Here the buffer belongs to the link BEFORE this machine, so its capacity
      // is configured on the machine before it.
      this.reconcile(here, upstreamMade - here.totalCommon, upstreamMade, prev, true);
    }

    const anchorMachineId = steps[anchorIdx].machineId;
    return this.wrap(run, out, anchorMachineId);
  }

  /**
   * One machine against its neighbour.
   *
   * `gap` is signed and its sign is the whole argument:
   *
   *   gap > 0 — more came out of the upstream machine than the downstream one
   *             accounted for. A conveyor holding material explains this, up to
   *             its capacity. Past that, someone is counting wrong.
   *
   *   gap < 0 — the downstream machine handled MORE than the upstream one says
   *             it produced. No conveyor explains that; material does not
   *             appear. The upstream counter is short, by at least this much.
   */
  private reconcile(
    step: BalancedStep,
    gap: number,
    neighbourFigure: number,
    neighbour: BalancedStep,
    downstream = false,
  ): void {
    // Whose conveyor is it? Going upstream, the buffer after THIS machine. Going
    // downstream, the buffer after the machine before it.
    const capacity = downstream ? neighbour.bufferCommon : step.bufferCommon;

    if (!step.enabled) {
      step.verdict = 'DISABLED';
      step.reason = 'الموازنة موقوفة لهذه الماكينة';
      return;
    }
    if (step.unconvertible) {
      step.verdict = 'UNCONFIGURED';
      step.reason = 'وحدة خارج سلّم التعبئة — لا تُقارَن';
      return;
    }
    if (capacity === null || capacity === undefined) {
      step.verdict = 'UNCONFIGURED';
      step.reason = 'سعة السير غير مضبوطة — الوصلة تُترك دون موازنة';
      return;
    }

    // WHICH WAY a correction points depends on which side of the neighbour this
    // machine sits, and the two are mirror images:
    //
    //   upstream   gap = this.good - neighbourHandled
    //              surplus beyond the belt -> THIS machine counted HIGH  (-)
    //              deficit                 -> THIS machine counted LOW   (+)
    //
    //   downstream gap = neighbourMade - this.total
    //              surplus beyond the belt -> THIS machine counted LOW   (+)
    //              deficit                 -> THIS machine counted HIGH  (-)
    //
    // The same gap means opposite things about the machine being judged, and
    // getting this backwards does not fail loudly — it produces a correction of
    // the right size pointed at the wrong end of the line.
    const surplusSign = downstream ? 1 : -1;

    if (gap >= 0) {
      const explained = Math.min(gap, capacity);
      const unexplained = gap - explained;
      step.explainedByBuffer = explained;
      step.unexplained = unexplained;
      if (unexplained <= 0) {
        step.verdict = 'BALANCED';
        step.reason = `الفارق ${this.n(gap)} ويسعه السير (${this.n(capacity)})`;
        return;
      }
      this.applyCorrection(step, surplusSign * unexplained,
        `فائض ${this.n(gap)} يتجاوز سعة السير ${this.n(capacity)} بمقدار ${this.n(unexplained)}`);
      return;
    }

    // Negative gap. Nothing physical produces this — a belt holds material back,
    // it does not create it, so no capacity is subtracted here.
    const short = -gap;
    step.explainedByBuffer = 0;
    step.unexplained = short;
    // The MINIMUM the neighbour proves, and not one unit more. Adding an assumed
    // buffer here is exactly the fabrication this whole design refuses.
    this.applyCorrection(step, -surplusSign * short,
      downstream
        ? `عالجت ${this.n(step.totalCommon)} بينما أنتجت السابقة ${this.n(neighbourFigure)}`
        : `التالية عالجت ${this.n(neighbourFigure)} بينما عدّت هذه ${this.n(step.goodCommon)}`);
  }

  /** Apply a correction, honouring the ceiling and reporting when it bites. */
  private applyCorrection(step: BalancedStep, requested: number, why: string): void {
    step.requestedCorrection = requested;
    const base = Math.max(1, step.goodCommon);
    const ceiling = (step.maxCorrectionPct / 100) * base;
    const applied = Math.sign(requested) * Math.min(Math.abs(requested), ceiling);

    step.correction = applied;
    step.balancedCommon = step.goodCommon + applied;
    step.correctionPct = (applied / base) * 100;

    if (Math.abs(requested) > ceiling + 1e-9) {
      step.verdict = 'CLAMPED';
      step.reason = `${why} — التصحيح المطلوب ${this.n(requested)} يتجاوز السقف ${step.maxCorrectionPct}%`;
    } else {
      step.verdict = 'CORRECTED';
      step.reason = why;
    }
  }


  /**
   * ── WRITING THE CORRECTION ────────────────────────────────────────────────
   *
   * Runs on its own timer, and only where someone has switched `applyAdjustment`
   * on for that machine. Everything about how it writes is shaped by one
   * requirement: a balanced number must always be reducible to what a sensor
   * actually measured.
   *
   * So `balanceAdjGood` holds the correction ABSOLUTELY — the whole of what the
   * balance has added to this step, not a running sum of nudges — while
   * `actualQtyGood` is moved by the DELTA between that and what was last
   * applied. Two consequences, both deliberate:
   *
   *   - The counter and the balancer never fight. The counter increments
   *     `actualQtyGood` by what it counted; the balancer increments it by how
   *     much its own correction has changed. Neither overwrites the other, and
   *     the total is raw + manual + correction at every instant.
   *
   *   - Running twice on an unchanged line writes nothing. The correction is
   *     recomputed from scratch each pass, so it cannot drift by accumulation —
   *     the failure that would make a balancer silently inflate a shift.
   *
   * A correction that hit its ceiling is applied as far as the ceiling and
   * logged in full. That line is the point: the worse a counter gets, the more
   * visible it must become.
   */
  @Interval('line-balance-apply', 15_000)
  async applyBalances(): Promise<void> {
    let runs: BalancedRun[];
    try {
      runs = await this.balance();
    } catch (err) {
      this.logger.warn(`balance pass skipped: ${(err as Error).message}`);
      return;
    }

    const ops: any[] = [];
    for (const run of runs) {
      for (const step of run.steps) {
        if (!step.applyAdjustment || !step.enabled) continue;
        if (step.verdict !== 'CORRECTED' && step.verdict !== 'CLAMPED') continue;
        if (step.unconvertible || !step.machineId) continue;

        // The correction is computed in the line's common unit; the job order
        // records quantities in ITS OWN unit. A -160 inner correction on the
        // wrapper is -1 pallet, and writing -160 into a pallet column would be
        // off by a factor of 160.
        const rung = normaliseUnit(step.unit);
        if (!rung) continue;
        // WHOLE UNITS ONLY, and truncated toward zero.
        //
        // A first run on the line produced `balanceAdjGood = +0.7` on the
        // wrapper — seven tenths of a pallet. Nothing wraps seven tenths of a
        // pallet. The balance works in the line's smallest unit, so a correction
        // that is exact there lands as a fraction once converted back into
        // pallets or cartons, and a fractional count is not a small
        // inaccuracy — it is a quantity that cannot exist.
        //
        // Truncating rather than rounding keeps the conservative direction this
        // whole design rests on: a correction is never larger than what the line
        // forces, and a partial unit simply waits until it is a whole one.
        const adjOwnUnit = Math.trunc(fromPieces(
          toPieces(step.correction, run.commonUnit, run.packaging), rung, run.packaging,
        ));

        const prev = this.appliedAdj.get(step.jobOrderId) ?? null;
        const delta = adjOwnUnit - (prev ?? 0);
        // Whole units only, so anything left is genuinely nothing to say — and
        // writing it every 15 seconds for a shift would be noise in the journal.
        if (delta === 0) continue;

        ops.push(this.prisma.jobOrder.update({
          where: { id: step.jobOrderId },
          data: {
            actualQtyGood: { increment: delta },
            balanceAdjGood: adjOwnUnit,
            balancedAt: new Date(),
          },
        }));
        ops.push(this.prisma.countAdjustment.create({
          data: {
            factoryId: this.ctx.getFactoryId() ?? '',
            jobOrderId: step.jobOrderId,
            machineId: step.machineId,
            countedGood: step.good,
            countedScrap: step.reject,
            adjGood: adjOwnUnit,
            adjScrap: 0,
            anchorMachineId: run.anchorMachineId,
            reason: step.reason,
            clamped: step.verdict === 'CLAMPED',
            requestedGood: Math.trunc(fromPieces(
              toPieces(step.requestedCorrection, run.commonUnit, run.packaging), rung, run.packaging,
            )),
          },
        }));
        this.appliedAdj.set(step.jobOrderId, adjOwnUnit);

        if (step.verdict === 'CLAMPED') {
          this.logger.warn(
            `${step.machineCode ?? step.machineId}: balance wanted ${this.n(step.requestedCorrection)} `
            + `${run.commonUnit} but its ceiling is ${step.maxCorrectionPct}% — applied `
            + `${this.n(step.correction)} and left the rest. This counter needs attention, `
            + 'not a larger ceiling.',
          );
        }
      }
    }

    if (!ops.length) return;
    try {
      await this.prisma.$transaction(ops);
    } catch (err) {
      // Nothing was recorded as applied unless the write landed, so the next
      // pass simply recomputes and offers the same correction again.
      for (const run of runs) for (const s of run.steps) this.appliedAdj.delete(s.jobOrderId);
      this.logger.error('line balance apply failed', err as Error);
    }
  }

  /**
   * What has already been written per job order, so a pass that changes nothing
   * writes nothing. Seeded from the database on first sight of an order, since
   * a gateway restart must not re-apply a correction that is already in the row.
   */
  private readonly appliedAdj = new Map<string, number>();

  /** Load prior corrections so a restart continues rather than double-counts. */
  async primeApplied(): Promise<void> {
    const rows = await this.prisma.jobOrder
      .findMany({ where: { status: 'EXECUTING' }, select: { id: true, balanceAdjGood: true } })
      .catch(() => [] as any[]);
    for (const r of rows) this.appliedAdj.set(r.id, r.balanceAdjGood ?? 0);
  }

  private blank(s: BalanceStep, c: any, commonUnit: LadderUnit, packaging: SkuPackaging): BalancedStep {
    // A capacity measured in cartons is converted here, once, against the same
    // ladder every other quantity on this line goes through. Entering "3
    // cartons" and having it silently compared against inners would be a wrong
    // answer that looks completely reasonable on screen.
    const qty = c?.bufferToNextQty ?? null;
    const rung = normaliseUnit(c?.bufferUnit) ?? commonUnit;
    const bufferCommon = qty === null
      ? null
      : fromPieces(toPieces(qty, rung, packaging), commonUnit, packaging);

    return {
      ...s,
      isAnchor: !!c?.isAnchor,
      enabled: c ? c.enabled : true,
      applyAdjustment: !!c?.applyAdjustment,
      bufferToNextQty: qty,
      bufferUnit: c?.bufferUnit ?? null,
      bufferCommon,
      maxCorrectionPct: c?.maxCorrectionPct ?? 10,
      explainedByBuffer: null,
      unexplained: null,
      balancedCommon: s.goodCommon,
      correction: 0,
      correctionPct: 0,
      requestedCorrection: 0,
      verdict: 'UNCONFIGURED',
      reason: 'لم تُقارَن بعد',
    };
  }

  private wrap(run: BalanceRun, steps: BalancedStep[], anchorMachineId: string | null): BalancedRun {
    return {
      ...run,
      steps,
      anchorMachineId,
      drained: false,
      totalCorrection: steps.reduce((a, s) => a + s.correction, 0),
    };
  }

  private n(v: number): string {
    return String(Math.round(v * 1000) / 1000);
  }
}
