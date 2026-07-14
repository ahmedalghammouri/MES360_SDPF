import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectEdge, type CounterRole, type EdgeType } from '@mes360/industrial-drivers';

import { PrismaService } from '../prisma/prisma.service';

export interface CounterTag {
  id: string;
  machineId: string | null;
  factoryId: string;
  counterRole: CounterRole | null;
  edgeType: EdgeType;
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
