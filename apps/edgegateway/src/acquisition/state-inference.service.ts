import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Why a machine stopped — Starved, Blocked, or genuinely broken.
 *
 * ── The case NCC's plant actually presents ──────────────────────────────────
 * The obvious design — "a starved machine stops, so classify its stop" — does not
 * work here, and NCC's own signal document says why. For Cartomac and Uni-Tech:
 *
 *   ON: running/ready, INCLUDING the condition where the machine is ready
 *       but no product is currently being processed
 *
 * A starved machine on this line never looks stopped. Its Run Mode signal stays
 * ON while it waits. Waiting for a stop to appear would mean this never fires.
 *
 * NCC supplied the second signal that makes it detectable — the Uni-Tech wrapping
 * table's rotation, which "indicates that a pallet is being processed". Run Mode
 * says the machine is ABLE to work; the table says whether it IS working.
 *
 *   Run ON  + processing        → RUNNING
 *   Run ON  + NOT processing    → STARVED / BLOCKED   (ready, nothing to do)
 *   Run OFF                     → BREAKDOWN           (alarm / emergency stop)
 *
 * ── Direction ───────────────────────────────────────────────────────────────
 * Material flows along the line in `sortOrder`. Nothing arriving from upstream is
 * starvation; nowhere to discharge downstream is blockage. A machine at the head
 * of the line cannot be starved and one at the end cannot be blocked, so those
 * are never inferred.
 *
 * A neighbour's stop only counts as a cause if it is not itself a symptom. A
 * STARVED machine downstream is waiting for product, not refusing it; a BLOCKED
 * machine upstream has product and cannot pass it on. Reading either as a cause
 * inverts the line and hides the real constraint — see notFeeding / notAccepting.
 *
 * ── Precedence ──────────────────────────────────────────────────────────────
 *   1. An explicit STARVED/BLOCKED from the machine itself — never overruled.
 *   2. A bound signal (PROCESSING / INFEED_AVAILABLE / OUTFEED_BLOCKED).
 *      A measurement beats a guess.
 *   3. Inference from neighbouring machine states.
 *
 * Deliberately conservative. Every uncertain path returns the raw state: no
 * PROCESSING signal, no reading, a reading the gateway flagged BAD, or an idle
 * period short enough to be the normal gap between units all leave the machine
 * as it was. Over-reporting starvation is worse than under-reporting it, because
 * it moves real losses out of the machine's OEE and flatters the equipment.
 *
 * These states are excluded from Availability and Performance loss — see
 * EXTERNAL_STATES in the API's kpi.service — which is exactly what NCC asked for:
 * the palletiser and wrapper judged only when product is available to process.
 */

/** States that mean "not currently producing". */
const NOT_PRODUCING = new Set([
  'IDLE', 'STOPPED', 'BREAKDOWN', 'PLANNED_STOP', 'SETUP',
  'CHANGEOVER', 'MAINTENANCE', 'OFFLINE', 'STARVED', 'BLOCKED',
]);

/**
 * Stops that carry no explanation, and so are open to inference. BREAKDOWN is
 * included because that is what a bare "run signal went false" produces — it is a
 * default, not a diagnosis. SETUP, CHANGEOVER, PLANNED_STOP and MAINTENANCE are
 * NOT included: somebody has already said what those are.
 */
const UNEXPLAINED_STOPS = new Set(['IDLE', 'STOPPED', 'BREAKDOWN']);

/** Signal semantics, validated here rather than in the schema. */
const PROCESSING = 'PROCESSING';
const INFEED_AVAILABLE = 'INFEED_AVAILABLE';
const OUTFEED_BLOCKED = 'OUTFEED_BLOCKED';

/**
 * How long a PROCESSING signal must stay inactive before the machine counts as
 * starved rather than merely between units.
 *
 * The wrapping table rotates once per pallet. At the line's pace a pallet arrives
 * every few minutes, so the table is legitimately still for long stretches during
 * normal running. Too short a threshold reports starvation between every pallet;
 * too long and a real stoppage goes unrecorded. Configurable because the right
 * value is the plant's slowest normal cycle, which only the plant knows.
 */
const PROCESSING_IDLE_DEFAULT_MS = 5 * 60_000;

export interface LineNeighbours {
  upstream: string[];
  downstream: string[];
}

@Injectable()
export class StateInferenceService {
  private readonly logger = new Logger(StateInferenceService.name);

  /** Line topology, cached briefly — machines do not move during a shift. */
  private topologyCache = new Map<string, { at: number; value: LineNeighbours }>();
  private static readonly TOPOLOGY_TTL_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Classify a stop. Returns the state to record — either the original, or
   * STARVED / BLOCKED when the context explains it.
   */
  async classify(machineId: string, rawState: string): Promise<string> {
    // ── The case NCC's signals actually present ─────────────────────────────
    // Cartomac and Uni-Tech report Run Mode ON while starved — "ready, but no
    // product currently being processed". A starved machine on this line never
    // looks stopped, so waiting for a stop to classify would never fire at all.
    //
    // When a machine says it is RUNNING, ask its PROCESSING signal whether product
    // is genuinely flowing. Ready-with-nothing-to-do is an external loss, not
    // production.
    if (rawState === 'RUNNING') {
      const idle = await this.readyButIdle(machineId);
      return idle ?? rawState;
    }

    // Rule 1: the machine said why. Nothing to infer.
    if (!UNEXPLAINED_STOPS.has(rawState)) return rawState;

    try {
      // Rule 2: a bound signal outranks any inference from neighbours.
      const fromSignal = await this.fromMaterialSignals(machineId);
      if (fromSignal) return fromSignal;

      // Rule 3: infer from the machines either side.
      const { upstream, downstream } = await this.neighbours(machineId);

      // A line end has no neighbour on that side, so it can never be starved by
      // an upstream that does not exist, nor blocked by a missing downstream.
      if (upstream.length > 0 && (await this.notFeeding(upstream))) return 'STARVED';
      if (downstream.length > 0 && (await this.notAccepting(downstream))) return 'BLOCKED';

      return rawState;
    } catch (err) {
      // Inference is an enrichment. If it fails, record the honest raw state
      // rather than losing the stop entirely.
      this.logger.warn(`state inference failed for machine ${machineId}: ${(err as Error).message}`);
      return rawState;
    }
  }

  /**
   * A machine reporting RUNNING that is not actually processing anything.
   *
   * Returns STARVED or BLOCKED when its PROCESSING signal has been inactive long
   * enough to rule out the normal gap between units, and null otherwise — null
   * meaning "leave it as RUNNING", which is the safe answer whenever there is no
   * PROCESSING signal, no reading, or a reading the gateway distrusts.
   *
   * Direction is decided by the line: nothing arriving from upstream is
   * starvation; nowhere to send it downstream is blockage. A machine at the end of
   * the line cannot be blocked, and one at the head cannot be starved.
   */
  private async readyButIdle(machineId: string): Promise<string | null> {
    const tag = await this.prisma.tagDefinition.findFirst({
      where: { machineId, isActive: true, signalRole: PROCESSING },
      select: { id: true, idleThresholdMs: true },
    });
    if (!tag) return null; // no way to tell — do not guess

    const reading = await this.prisma.tagCurrentValue
      .findUnique({ where: { tagId: tag.id }, select: { value: true, quality: true, timestamp: true } })
      .catch(() => null);
    if (!reading || reading.quality === 'BAD') return null;

    // Active right now, or active recently enough to be mid-cycle.
    if (Number(reading.value) >= 1) return null;
    const idleFor = Date.now() - new Date(reading.timestamp).getTime();
    // Per-SIGNAL, because the right value is that signal's slowest normal cycle:
    // a wrapper table rests for minutes between pallets, a filler does not.
    const idleLimit = tag.idleThresholdMs ?? PROCESSING_IDLE_DEFAULT_MS;
    if (idleFor < idleLimit) return null;

    const { upstream, downstream } = await this.neighbours(machineId);
    if (upstream.length > 0 && (await this.notFeeding(upstream))) return 'STARVED';
    if (downstream.length > 0 && (await this.notAccepting(downstream))) return 'BLOCKED';

    // Idle with the line apparently running around it. On a serial line the
    // commonest cause is still nothing arriving, and the head of the line is the
    // one place that cannot be true.
    return upstream.length > 0 ? 'STARVED' : null;
  }

  /**
   * A material-flow signal bound to this machine, if one is configured.
   *
   * `INFEED_AVAILABLE` false while stopped means nothing is arriving → STARVED.
   * `OUTFEED_BLOCKED` true while stopped means it cannot discharge → BLOCKED.
   * Returns null when no such tag exists or it has no recent reading, so the
   * caller falls through to topology.
   */
  private async fromMaterialSignals(machineId: string): Promise<string | null> {
    const tags = await this.prisma.tagDefinition.findMany({
      where: { machineId, isActive: true, signalRole: { in: [INFEED_AVAILABLE, OUTFEED_BLOCKED] } },
      select: { id: true, signalRole: true },
    });
    if (tags.length === 0) return null;

    for (const tag of tags) {
      // TagCurrentValue holds the latest reading per tag — exactly what a live
      // classification needs, and one indexed lookup rather than a history scan.
      const reading = await this.prisma.tagCurrentValue
        .findUnique({ where: { tagId: tag.id }, select: { value: true, quality: true } })
        .catch(() => null);
      // A BAD-quality reading is worse than no reading: acting on it would
      // classify a stop from a sensor the gateway itself distrusts.
      if (!reading || reading.value == null || reading.quality === 'BAD') continue;

      const on = Number(reading.value) >= 1;
      if (tag.signalRole === INFEED_AVAILABLE && !on) return 'STARVED';
      if (tag.signalRole === OUTFEED_BLOCKED && on) return 'BLOCKED';
    }
    return null;
  }

  /** Machines before and after this one on its line, ordered by material flow. */
  private async neighbours(machineId: string): Promise<LineNeighbours> {
    const cached = this.topologyCache.get(machineId);
    if (cached && Date.now() - cached.at < StateInferenceService.TOPOLOGY_TTL_MS) return cached.value;

    const me = await this.prisma.machine.findUnique({
      where: { id: machineId },
      select: { id: true, lineId: true, sortOrder: true },
    });

    const empty: LineNeighbours = { upstream: [], downstream: [] };
    // A machine outside any line has no material flow to reason about.
    if (!me?.lineId) {
      this.topologyCache.set(machineId, { at: Date.now(), value: empty });
      return empty;
    }

    const siblings = await this.prisma.machine.findMany({
      where: { lineId: me.lineId, isActive: true, archivedAt: null },
      select: { id: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });

    const value: LineNeighbours = {
      upstream: siblings.filter((s) => s.sortOrder < me.sortOrder).map((s) => s.id),
      downstream: siblings.filter((s) => s.sortOrder > me.sortOrder).map((s) => s.id),
    };
    this.topologyCache.set(machineId, { at: Date.now(), value });
    return value;
  }

  /**
   * True when NONE of these upstream machines is sending product down.
   *
   * "All", not "any": one upstream machine still running means material is still
   * arriving, so the stop downstream is not starvation.
   *
   * An upstream machine in BLOCKED is the exception, and it is not a detail. A
   * blocked machine is one that HAS product and cannot get rid of it — usually
   * because this machine stopped taking it. Counting it as "not feeding" would
   * blame the upstream for a jam this machine caused, then file the loss as
   * external and remove it from OEE. The machine would be rewarded for its own
   * blockage.
   */
  private async notFeeding(machineIds: string[]): Promise<boolean> {
    return this.allInactive(machineIds, 'BLOCKED');
  }

  /**
   * True when NONE of these downstream machines can take product.
   *
   * Mirror image of the above: a downstream machine in STARVED is WAITING for
   * product, which is the opposite of refusing it. It is the consequence of this
   * machine's stop, not its cause. Treating it as a blockage inverts the whole
   * line — the true starvation at the head of the line gets reported as a
   * blockage at every machine behind it, and the real constraint disappears.
   *
   * Found by live verification, not by the unit tests: with Filling stopped, the
   * palletiser was reported BLOCKED by the wrapper it had itself starved.
   */
  private async notAccepting(machineIds: string[]): Promise<boolean> {
    return this.allInactive(machineIds, 'STARVED');
  }

  /**
   * True when every one of these machines is stopped for a reason OTHER than
   * `excuse` — a state that proves the machine is a symptom rather than a cause.
   *
   * A machine with no status record yet is treated as producing: absence of
   * evidence is not evidence of a stop, and guessing the other way would invent
   * starvation across a fresh install.
   */
  private async allInactive(machineIds: string[], excuse: string): Promise<boolean> {
    const rows = await this.prisma.machineCurrentStatus.findMany({
      where: { machineId: { in: machineIds } },
      select: { machineId: true, state: true },
    });
    if (rows.length < machineIds.length) return false; // some machine unknown
    return rows.every((r) => {
      const state = String(r.state);
      return state !== excuse && NOT_PRODUCING.has(state);
    });
  }
}
