import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectEdge, totalizerDelta, totalizerWidth, type CounterRole, type EdgeType } from '@mes360/industrial-drivers';

import { PrismaService } from '../prisma/prisma.service';

export interface CounterTag {
  id: string;
  machineId: string | null;
  factoryId: string;
  counterRole: CounterRole | null;
  edgeType: EdgeType;
  /** Registers the value spans — sets the wrap point for a TOTALIZER. */
  wordCount?: number | null;
}

export interface CountEvent {
  jobOrderId: string;
  machineId: string;
  role: CounterRole;
  good: number;
  rejected: number;
  total: number;
  // Per-edge increments — consumed by the API to journal shift/WO production trends.
  goodDelta: number;
  scrapDelta: number;
  ts: string;
}

interface CounterMem {
  lastRaw: number | boolean | null;
  accumulated: number; // total edges counted for the current JO (advanced on EVERY edge, DB or not)
  synced: number;      // the `accumulated` value already written to the JO in Postgres
  jobOrderId: string | null;
}

/**
 * Turns rising edges on COUNTER tags into Good/Bad/Total quantities on the
 * machine's currently EXECUTING Job Order.
 *
 *  - GOOD  edge → JobOrder.actualQtyGood += 1, status.goodCount += 1
 *  - BAD   edge → JobOrder.actualQtyRejected += 1, status.rejectCount += 1
 *  - TOTAL edge → bad is derived: rejected = total − good
 *
 * Map a device as either (GOOD + BAD) or (TOTAL + GOOD).
 *
 * **Outage-safe counting.** Edge detection runs on every poll and advances the
 * in-memory `accumulated` total regardless of Postgres availability; that total
 * is mirrored to a local disk file (`counter-state.json`) on every edge, so it
 * survives both a DB outage AND a gateway restart during one. The value written
 * to the JO (`synced`) trails `accumulated`; whenever the DB is reachable the
 * pending delta (`accumulated − synced`) is flushed to the JO and published.
 * Example: total=120, DB drops for 10 min while 10 parts pass → `accumulated`
 * climbs to 130 locally; when the DB returns, the JO jumps 120→130 and a count
 * event is published. Nothing is lost or double-counted (`synced` is the guard).
 */
@Injectable()
export class CounterService {
  private readonly logger = new Logger(CounterService.name);
  private readonly cache = new Map<string, CounterMem>();

  /** Tags with counted-but-unwritten edges, drained by {@link flush}. */
  private readonly pending = new Set<string>();
  /** Definitions seen by {@link observe}, so flush can act without the poller. */
  private readonly tags = new Map<string, CounterTag>();
  /** Tags being seeded from the DB right now — never seeded twice at once. */
  private readonly seeding = new Set<string>();
  /** Set when memory has moved ahead of the disk file. */
  private dirty = false;

  /**
   * Job order + running state per machine.
   *
   * One second: long enough that several counters on one machine share a
   * single pair of queries, short enough that starting a job order takes
   * effect before anybody notices.
   */
  private readonly ctxCache = new Map<string, { at: number; value: { joId: string | null; running: boolean; dbUp: boolean } }>();
  private static readonly CTX_TTL_MS = 1_000;
  private readonly stateFile: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const dir = config.get<string>('bufferDir') ?? './buffer';
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.stateFile = join(dir, 'counter-state.json');
    this.loadLocalFile();
  }

  /** Seed the cache from the local disk file (authoritative during a DB outage). */
  private loadLocalFile(): void {
    try {
      if (!existsSync(this.stateFile)) return;
      const raw = JSON.parse(readFileSync(this.stateFile, 'utf8')) as Record<string, Partial<CounterMem>>;
      for (const [tagId, s] of Object.entries(raw)) {
        this.cache.set(tagId, {
          lastRaw: s.lastRaw ?? null,
          accumulated: s.accumulated ?? 0,
          synced: s.synced ?? s.accumulated ?? 0,
          jobOrderId: s.jobOrderId ?? null,
        });
      }
      this.logger.log(`Restored ${this.cache.size} counter state(s) from disk`);
    } catch (err) {
      this.logger.warn(`counter-state load failed: ${(err as Error).message}`);
    }
  }

  /** Persist all counter state to disk (small file, written only when a count changes). */
  private saveLocal(): void {
    try {
      const obj: Record<string, CounterMem> = {};
      for (const [tagId, m] of this.cache) {
        obj[tagId] = {
          lastRaw: typeof m.lastRaw === 'boolean' ? (m.lastRaw ? 1 : 0) : m.lastRaw,
          accumulated: m.accumulated,
          synced: m.synced,
          jobOrderId: m.jobOrderId,
        };
      }
      writeFileSync(this.stateFile, JSON.stringify(obj));
    } catch (err) {
      this.logger.error(`counter-state save failed: ${(err as Error).message}`);
    }
  }

  private async load(tagId: string): Promise<CounterMem> {
    const cached = this.cache.get(tagId);
    if (cached) return cached;
    // Not in the local file → first run for this tag; seed from the DB record (fully synced).
    const state = await this.prisma.gatewayCounterState
      .findUnique({ where: { tagId } })
      .catch(() => null);
    const mem: CounterMem = {
      lastRaw: state?.lastRawValue ?? null,
      accumulated: state?.accumulated ?? 0,
      synced: state?.accumulated ?? 0,
      jobOrderId: state?.jobOrderId ?? null,
    };
    this.cache.set(tagId, mem);
    return mem;
  }

  /** Mirror the current (already-synced) state to Postgres. Best-effort. */
  private async persistDb(tagId: string, mem: CounterMem, edgeAt?: string): Promise<void> {
    const raw = typeof mem.lastRaw === 'boolean' ? (mem.lastRaw ? 1 : 0) : mem.lastRaw;
    await this.prisma.gatewayCounterState
      .upsert({
        where: { tagId },
        create: {
          tagId,
          lastRawValue: raw,
          accumulated: mem.accumulated,
          jobOrderId: mem.jobOrderId,
          ...(edgeAt ? { lastEdgeAt: new Date(edgeAt) } : {}),
        },
        update: {
          lastRawValue: raw,
          accumulated: mem.accumulated,
          jobOrderId: mem.jobOrderId,
          ...(edgeAt ? { lastEdgeAt: new Date(edgeAt) } : {}),
        },
      })
      .catch((err) => this.logger.error(`Counter state persist failed (${tagId})`, err as Error));
  }

  /**
   * Count an edge. SYNCHRONOUS, and deliberately so.
   *
   * ── The bug this exists for ─────────────────────────────────────────────────
   * `process()` below did two fresh database queries — the executing job order
   * and the machine's current state — plus a file write and up to two more
   * writes, PER COUNTER TAG, PER POLL. The poller awaited all of that inline and
   * skipped the next cycle while it ran (`if (dev.busy) return`).
   *
   * So the real sampling period was not the configured 100 ms; it was however
   * long that chain took, and on a device with four counters it is far longer. A
   * filler running 120 parts a minute emits a pulse every 500 ms, and pulses
   * that open and close between two samples are simply never seen. The counts
   * came out low and the input looked permanently TRUE, because the sampler was
   * only ever awake for part of the wave.
   *
   * Nothing here touches the database or the disk. It reads the cache, compares
   * against the previous raw level, and adds to an in-memory total. The poll
   * loop can then run at its configured rate, and {@link flush} does the
   * persisting on its own schedule.
   *
   * A tag not yet in the cache is SEEDED asynchronously and counts from the next
   * cycle. Missing one edge on the very first poll of a tag's life is the price
   * of never blocking the loop; missing them at 2 Hz forever is not.
   */
  observe(tag: CounterTag, raw: number | boolean | null, _ts: string): void {
    if (!tag.machineId || !tag.counterRole || tag.counterRole === 'NONE') return;

    const mem = this.cache.get(tag.id);
    if (!mem) {
      // First sighting. Seed from the DB in the background; do not block.
      if (!this.seeding.has(tag.id)) {
        this.seeding.add(tag.id);
        void this.load(tag.id).finally(() => this.seeding.delete(tag.id));
      }
      return;
    }

    // A totalizer has no pulse to measure — the device did the counting and the
    // gateway reads a running total, so its sample rate is not in question.
    if (tag.edgeType !== 'TOTALIZER') this.measurePulse(tag, mem.lastRaw, raw);

    const inc = tag.edgeType === 'TOTALIZER'
      ? totalizerDelta(mem.lastRaw, raw, totalizerWidth(tag.wordCount))
      : detectEdge(mem.lastRaw, raw, tag.edgeType);
    mem.lastRaw = raw;
    if (inc > 0) {
      mem.accumulated += inc;
      this.pending.add(tag.id);
      this.tags.set(tag.id, tag);
      this.dirty = true;
    }
  }

  /** How long each counter tag has held its present level, and the shortest seen. */
  private readonly pulse = new Map<string, {
    since: number; samples: number; minMs: number; minSamples: number; reportedAt: number;
  }>();
  /** A level seen in this many samples or fewer is at the edge of being missed. */
  private static readonly ALIAS_SAMPLES = 2;

  /**
   * Measure the geometry of the signal being counted.
   *
   * Whether a counter is accurate is not a question about the code — it is the
   * relationship between how long the contact stays closed and how often the
   * gateway looks. A pulse shorter than the poll interval is invisible no matter
   * how the edge is detected, and it fails SILENTLY: the tag simply reads as a
   * flat level and the count comes out low, which is exactly how 44 cartons were
   * recorded as 4 on 23 Aug 2026.
   *
   * So the gateway measures it and says so. The shortest level it has actually
   * observed, in milliseconds and in samples, is the number that decides whether
   * a device's poll interval is fast enough — and it can only be known from the
   * plant floor, not from a design document.
   */
  private measurePulse(tag: CounterTag, prevRaw: number | boolean | null, raw: number | boolean | null): void {
    const level = raw === true || (typeof raw === 'number' && raw >= 1);
    const was = prevRaw === true || (typeof prevRaw === 'number' && prevRaw >= 1);
    const now = Date.now();

    let p = this.pulse.get(tag.id);
    if (!p) {
      this.pulse.set(tag.id, { since: now, samples: 1, minMs: Infinity, minSamples: Infinity, reportedAt: 0 });
      return;
    }

    if (level === was) { p.samples += 1; return; }

    // The level just ended — record how long it lasted.
    const heldMs = now - p.since;
    if (p.samples < p.minSamples || (p.samples === p.minSamples && heldMs < p.minMs)) {
      p.minSamples = p.samples;
      p.minMs = heldMs;
    }
    p.since = now;
    p.samples = 1;

    if (p.minSamples <= CounterService.ALIAS_SAMPLES && now - p.reportedAt > 60_000) {
      p.reportedAt = now;
      this.logger.warn(
        `counter ${tag.id}: shortest signal level seen lasted ${p.minSamples} sample(s) / ${p.minMs}ms. `
        + 'A pulse is only counted reliably when the device is polled several times faster than it lasts '
        + "— lower this device's poll interval, or counts will be low.",
      );
    }
  }

  /**
   * Write what {@link observe} counted. Called on a timer, not on the poll.
   *
   * The gate that used to run per pulse — is a job order executing, is the
   * machine running — runs ONCE PER MACHINE here, from a short-lived cache. It
   * is the same rule: an edge is only credited to a job order that exists and a
   * machine that is running. What changed is how often the question is asked.
   *
   * A machine that stopped between the pulse and the flush keeps its count: the
   * pulse is evidence a unit was made, and the state signal arriving a second
   * later does not unmake it.
   */
  async flush(): Promise<CountEvent[]> {
    if (this.pending.size === 0 && !this.dirty) return [];
    const events: CountEvent[] = [];
    const ids = [...this.pending];
    this.pending.clear();

    for (const tagId of ids) {
      const tag = this.tags.get(tagId);
      const mem = this.cache.get(tagId);
      if (!tag || !mem || !tag.machineId) continue;

      let ctx: { joId: string | null; running: boolean; dbUp: boolean };
      try {
        ctx = await this.machineContext(tag.machineId);
      } catch {
        // Database unreachable. The count stays in memory and on disk, and this
        // tag is queued again so the whole backlog lands on reconnect.
        this.pending.add(tagId);
        continue;
      }

      if (ctx.dbUp && ctx.joId !== mem.jobOrderId) {
        if (mem.jobOrderId) {
          /**
           * A real handover: one order ended and another began. Settle the old
           * one's remainder, then start the new one from zero — its total must
           * not inherit the previous order's parts.
           */
          if (mem.accumulated > mem.synced) {
            await this.applyToJob(tag, mem.jobOrderId, mem.accumulated, mem.accumulated - mem.synced, new Date().toISOString())
              .catch(() => undefined);
          }
          mem.accumulated = 0;
          mem.synced = 0;
        } else {
          /**
           * FIRST attribution, and the counts are kept.
           *
           * Edges are now taken before the order behind them is resolved — that
           * is the point of the split — so between the gateway starting and the
           * first flush, pulses accumulate against a null order. Treating that
           * as a handover threw them away: every count from the first second of
           * a shift vanished, and the tests here caught it before the line did.
           *
           * `synced` stays at zero so the whole accumulated total is written as
           * this order's first delta.
           */
        }
        mem.jobOrderId = ctx.joId;
      }

      if (ctx.dbUp && mem.jobOrderId && ctx.running && mem.accumulated > mem.synced) {
        const delta = mem.accumulated - mem.synced;
        const ev = await this.applyToJob(tag, mem.jobOrderId, mem.accumulated, delta, new Date().toISOString());
        mem.synced = mem.accumulated;
        await this.persistDb(tag.id, mem, new Date().toISOString());
        if (ev) events.push(ev);
      }
    }

    // One file write for the whole batch, not one per pulse.
    if (this.dirty) { this.saveLocal(); this.dirty = false; }
    return events;
  }

  /**
   * Job order + running state for a machine, cached briefly.
   *
   * Asked once per machine per flush instead of twice per counter per poll. The
   * TTL is short enough that a job order released now is credited within a
   * second, and long enough that two counters on one machine share the answer.
   */
  private async machineContext(machineId: string) {
    const hit = this.ctxCache.get(machineId);
    if (hit && Date.now() - hit.at < CounterService.CTX_TTL_MS) return hit.value;

    const jo = await this.prisma.jobOrder.findFirst({
      where: { machineId, status: 'EXECUTING' },
      orderBy: { actualStart: 'desc' },
      select: { id: true },
    });
    const status = await this.prisma.machineCurrentStatus
      .findUnique({ where: { machineId }, select: { state: true } })
      .catch(() => null);

    const value = {
      joId: jo?.id ?? null,
      // Unknown state counts as running: a pulse arrived, so something is.
      running: !status?.state || status.state === 'RUNNING',
      dbUp: true,
    };
    this.ctxCache.set(machineId, { at: Date.now(), value });
    return value;
  }

  /**
   * Process one counter reading. Returns a CountEvent when an edge was applied
   * to a running Job Order (for MQTT publish / API roll-up), else null.
   */
  async process(tag: CounterTag, raw: number | boolean | null, ts: string): Promise<CountEvent | null> {
    if (!tag.machineId || !tag.counterRole || tag.counterRole === 'NONE') return null;

    const mem = await this.load(tag.id);
    const inc = detectEdge(mem.lastRaw, raw, tag.edgeType);
    mem.lastRaw = raw; // always advance the raw snapshot (no backlog jump on resume)

    // Resolve the machine's currently executing Job Order. A THROW here means the DB
    // is unreachable (outage) — distinct from a successful query that returns no JO.
    let dbUp = true;
    let jo: { id: string; actualQtyGood: number; actualQtyRejected: number } | null = null;
    try {
      jo = await this.prisma.jobOrder.findFirst({
        where: { machineId: tag.machineId, status: 'EXECUTING' },
        orderBy: { actualStart: 'desc' },
        select: { id: true, actualQtyGood: true, actualQtyRejected: true },
      });
    } catch {
      dbUp = false; // Postgres down → keep counting locally, sync on reconnect.
    }

    // Machine RUNNING gate — only enforceable when the DB is up. During an outage
    // the state is unknown, so we keep counting (a producing machine is running).
    let notRunning = false;
    if (dbUp) {
      const status = await this.prisma.machineCurrentStatus
        .findUnique({ where: { machineId: tag.machineId }, select: { state: true } })
        .catch(() => null);
      notRunning = !!status?.state && status.state !== 'RUNNING';
    }

    let changed = false;

    // Job-order transition (only when the DB is up so we don't mistake an outage for
    // a JO ending). Flush any unsynced delta to the OLD JO before switching.
    if (dbUp) {
      const newJoId = jo?.id ?? null;
      if (newJoId !== mem.jobOrderId) {
        if (mem.jobOrderId && mem.accumulated > mem.synced) {
          await this.applyToJob(tag, mem.jobOrderId, mem.accumulated, mem.accumulated - mem.synced, ts).catch(() => undefined);
        }
        mem.jobOrderId = newJoId;
        mem.accumulated = 0;
        mem.synced = 0;
        changed = true;
      }
    }

    // Count the edge locally. This is the key change: it happens whether or not the
    // DB is reachable, so no pulse is lost during an outage.
    if (inc > 0 && !(dbUp && notRunning)) {
      mem.accumulated += inc;
      changed = true;
    }

    // Persist locally on any change so counts survive an outage + restart.
    if (changed) this.saveLocal();

    // Flush the pending delta to the JO whenever the DB is reachable — this catches
    // up the whole backlog on reconnect, even on a poll with no new edge.
    let event: CountEvent | null = null;
    if (dbUp && mem.jobOrderId && !notRunning && mem.accumulated > mem.synced) {
      const delta = mem.accumulated - mem.synced;
      event = await this.applyToJob(tag, mem.jobOrderId, mem.accumulated, delta, ts);
      mem.synced = mem.accumulated; // only advance after a successful write (no double-count)
      this.saveLocal();
      await this.persistDb(tag.id, mem, ts);
    }
    return event;
  }

  private async applyToJob(
    tag: CounterTag,
    jobOrderId: string,
    total: number,
    inc: number,
    ts: string,
  ): Promise<CountEvent> {
    const role = tag.counterRole as CounterRole;
    let goodDelta = 0;
    let scrapDelta = 0;

    if (role === 'GOOD') {
      await this.prisma.jobOrder.update({ where: { id: jobOrderId }, data: { actualQtyGood: { increment: inc } } });
      await this.bumpStatus(tag.machineId!, { goodCount: { increment: inc } });
      goodDelta = inc;
    } else if (role === 'BAD') {
      await this.prisma.jobOrder.update({ where: { id: jobOrderId }, data: { actualQtyRejected: { increment: inc } } });
      await this.bumpStatus(tag.machineId!, { rejectCount: { increment: inc } });
      scrapDelta = inc;
    } else if (role === 'TOTAL') {
      const fresh = await this.prisma.jobOrder.findUnique({
        where: { id: jobOrderId },
        select: { actualQtyGood: true, actualQtyRejected: true, manualQtyGood: true, manualQtyRejected: true },
      });
      const good = fresh?.actualQtyGood ?? 0;
      const prevRejected = fresh?.actualQtyRejected ?? 0;
      const manualGood = fresh?.manualQtyGood ?? 0;
      const manualBad = fresh?.manualQtyRejected ?? 0;
      // Derive the AUTO bad from the sensed total minus AUTO good, then add the
      // operator-entered scrap back — so the counter NEVER overwrites manual scrap.
      const autoGood = Math.max(0, good - manualGood);
      const autoBad = Math.max(0, total - autoGood);
      const bad = autoBad + manualBad;
      scrapDelta = Math.max(0, bad - prevRejected);
      await this.prisma.jobOrder.update({ where: { id: jobOrderId }, data: { actualQtyRejected: bad } });
      const status = await this.prisma.machineCurrentStatus.findUnique({
        where: { machineId: tag.machineId! }, select: { goodCount: true },
      }).catch(() => null);
      await this.bumpStatus(tag.machineId!, { rejectCount: Math.max(0, total - (status?.goodCount ?? 0)) });
    }

    const jo = await this.prisma.jobOrder.findUnique({
      where: { id: jobOrderId }, select: { actualQtyGood: true, actualQtyRejected: true },
    });
    const good = jo?.actualQtyGood ?? 0;
    const rejected = jo?.actualQtyRejected ?? 0;
    return { jobOrderId, machineId: tag.machineId!, role, good, rejected, total: good + rejected, goodDelta, scrapDelta, ts };
  }

  /** Upsert MachineCurrentStatus, supporting both increment ops and absolute sets. */
  private async bumpStatus(machineId: string, data: Record<string, unknown>): Promise<void> {
    const createDefaults: Record<string, number> = { goodCount: 0, rejectCount: 0 };
    for (const [k, v] of Object.entries(data)) {
      createDefaults[k] = typeof v === 'object' && v && 'increment' in (v as any) ? (v as any).increment : (v as number);
    }
    await this.prisma.machineCurrentStatus
      .upsert({
        where: { machineId },
        create: { machineId, state: 'RUNNING', lastEventAt: new Date(), ...createDefaults } as any,
        update: { ...data, lastEventAt: new Date() } as any,
      })
      .catch((err) => this.logger.error(`Status update failed (${machineId})`, err as Error));
  }
}
