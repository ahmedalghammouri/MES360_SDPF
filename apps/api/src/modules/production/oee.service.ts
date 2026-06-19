import { Injectable } from '@nestjs/common';

export interface OEEInput {
  plannedProductionTime: number; // minutes
  downtime: number; // minutes
  idealCycleTime: number; // minutes per unit
  totalCount: number;
  goodCount: number;
}

export interface OEEResult {
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  actualRunTime: number;
}

/**
 * Six-big-losses input (ISO 22400). `plannedProductionTime` must already EXCLUDE
 * planned stops (breaks, cleaning, planned maintenance). Only unplanned losses
 * are passed in here.
 */
export interface OEEDetailedInput {
  plannedProductionTime: number; // PPT, minutes (already net of planned stops)
  unplannedDowntime: number;     // minutes — availability loss (breakdown, setup, starved, blocked, external)
  microStopMinutes?: number;     // minutes — informational performance-loss bucket
  idealCycleTime: number;        // minutes per unit
  totalCount: number;
  goodCount: number;
}

export interface OEEBreakdown {
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  // raw minutes — carried so parents can roll up consistently
  ppt: number;            // planned production time
  runTime: number;        // ppt − unplanned downtime
  idealRunTime: number;   // idealCycleTime × totalCount (the "earned" run minutes)
  totalCount: number;
  goodCount: number;
  losses: {
    availabilityLossMin: number;
    performanceLossMin: number;
    qualityLossMin: number;
  };
}

/** A child contribution for a weighted roll-up (JO→WO→PO, Machine→Line→Area→Plant). */
export interface RollupChild {
  ppt: number;          // planned production minutes
  runTime: number;      // running minutes
  idealRunTime: number; // idealCycleTime × totalCount minutes
  totalCount: number;
  goodCount: number;
}

/** Machine-state segment (shape of MachineStateRecord) for time-based availability. */
export interface StateSegment {
  state: string;            // RUNNING | IDLE | PLANNED_STOP | BREAKDOWN | SETUP | CHANGEOVER | STARVED | BLOCKED | OFFLINE | MAINTENANCE
  durationMinutes: number;
  isPlannedStop?: boolean;
}

const PLANNED_STATES = new Set(['PLANNED_STOP', 'MAINTENANCE']);
const RUNNING_STATES = new Set(['RUNNING']);

const round1 = (n: number) => Math.round(n * 10) / 10;
const clampPct = (n: number) => Math.min(100, Math.max(0, n));

@Injectable()
export class OEEService {
  calculate(input: OEEInput): OEEResult {
    const { plannedProductionTime, downtime, idealCycleTime, totalCount, goodCount } = input;

    const actualRunTime = plannedProductionTime - downtime;

    // Availability = Actual Run Time / Planned Production Time
    const availability = plannedProductionTime > 0
      ? (actualRunTime / plannedProductionTime) * 100
      : 0;

    // Performance = (Ideal Cycle Time × Total Count) / Actual Run Time
    const performance = actualRunTime > 0
      ? ((idealCycleTime * totalCount) / actualRunTime) * 100
      : 0;

    // Quality = Good Count / Total Count
    const quality = totalCount > 0 ? (goodCount / totalCount) * 100 : 0;

    // OEE = Availability × Performance × Quality
    const oee = (availability / 100) * (performance / 100) * (quality / 100) * 100;

    return {
      oee: Math.min(Math.round(oee * 10) / 10, 100),
      availability: Math.min(Math.round(availability * 10) / 10, 100),
      performance: Math.min(Math.round(performance * 10) / 10, 100),
      quality: Math.min(Math.round(quality * 10) / 10, 100),
      actualRunTime,
    };
  }

  /**
   * Standards-based OEE from six-loss inputs. Returns percentages AND the raw
   * minute quantities so the same result can be fed into `rollup`.
   */
  calculateDetailed(input: OEEDetailedInput): OEEBreakdown {
    const ppt = Math.max(0, input.plannedProductionTime);
    const runTime = Math.max(0, ppt - Math.max(0, input.unplannedDowntime));
    const idealRunTime = Math.max(0, input.idealCycleTime * input.totalCount);

    const availability = ppt > 0 ? clampPct((runTime / ppt) * 100) : 0;
    const performance = runTime > 0 ? clampPct((idealRunTime / runTime) * 100) : 0;
    const quality = input.totalCount > 0 ? clampPct((input.goodCount / input.totalCount) * 100) : 0;
    const oee = (availability / 100) * (performance / 100) * (quality / 100) * 100;

    return {
      oee: round1(oee),
      availability: round1(availability),
      performance: round1(performance),
      quality: round1(quality),
      ppt,
      runTime,
      idealRunTime,
      totalCount: input.totalCount,
      goodCount: input.goodCount,
      losses: {
        availabilityLossMin: round1(ppt - runTime),
        performanceLossMin: round1(Math.max(0, runTime - idealRunTime)),
        qualityLossMin: round1(input.totalCount > 0 ? (input.idealCycleTime * (input.totalCount - input.goodCount)) : 0),
      },
    };
  }

  /**
   * Time-segmented availability from MachineStateRecord-shaped rows.
   * Planned stops are excluded from PPT (not counted as loss). Availability =
   * running minutes / PPT.
   */
  availabilityFromSegments(segments: StateSegment[]): {
    ppt: number; runTime: number; plannedDowntime: number; unplannedDowntime: number; availability: number;
  } {
    let scheduled = 0, planned = 0, run = 0;
    for (const s of segments) {
      const d = s.durationMinutes ?? 0;
      scheduled += d;
      const isPlanned = s.isPlannedStop || PLANNED_STATES.has(s.state);
      if (isPlanned) planned += d;
      else if (RUNNING_STATES.has(s.state)) run += d;
    }
    const ppt = Math.max(0, scheduled - planned);
    const unplanned = Math.max(0, ppt - run);
    return {
      ppt: round1(ppt),
      runTime: round1(run),
      plannedDowntime: round1(planned),
      unplannedDowntime: round1(unplanned),
      availability: ppt > 0 ? round1(clampPct((run / ppt) * 100)) : 0,
    };
  }

  /**
   * Consistent ISO roll-up: sums the underlying minute/count quantities of the
   * children and recomputes A/P/Q from the totals (NOT a naive average of
   * percentages). The single primitive for JO→WO→PO and Machine→Line→Area→Plant.
   */
  rollup(children: RollupChild[]): OEEBreakdown {
    const sum = children.reduce(
      (a, c) => ({
        ppt: a.ppt + Math.max(0, c.ppt || 0),
        runTime: a.runTime + Math.max(0, c.runTime || 0),
        idealRunTime: a.idealRunTime + Math.max(0, c.idealRunTime || 0),
        totalCount: a.totalCount + Math.max(0, c.totalCount || 0),
        goodCount: a.goodCount + Math.max(0, c.goodCount || 0),
      }),
      { ppt: 0, runTime: 0, idealRunTime: 0, totalCount: 0, goodCount: 0 },
    );

    return this.calculateDetailed({
      plannedProductionTime: sum.ppt,
      unplannedDowntime: Math.max(0, sum.ppt - sum.runTime),
      idealCycleTime: sum.totalCount > 0 ? sum.idealRunTime / sum.totalCount : 0,
      totalCount: sum.totalCount,
      goodCount: sum.goodCount,
    });
  }

  getClassification(oee: number): 'world-class' | 'good' | 'acceptable' | 'poor' {
    if (oee >= 85) return 'world-class';
    if (oee >= 65) return 'good';
    if (oee >= 45) return 'acceptable';
    return 'poor';
  }
}
