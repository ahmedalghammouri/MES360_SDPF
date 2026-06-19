import { Injectable, Logger } from '@nestjs/common';
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
  accumulated: number; // total edges attributed to the current JO
  jobOrderId: string | null;
}

/**
 * Turns rising edges on COUNTER tags into Good/Bad/Total quantities on the
 * machine's currently EXECUTING Job Order. Restart-safe: per-tag state is
 * seeded from `GatewayCounterState` so a service restart never double-counts.
 *
 *  - GOOD  edge → JobOrder.actualQtyGood += 1, status.goodCount += 1
 *  - BAD   edge → JobOrder.actualQtyRejected += 1, status.rejectCount += 1
 *  - TOTAL edge → bad is derived: rejected = total − good
 *
 * Map a device as either (GOOD + BAD) or (TOTAL + GOOD).
 */
@Injectable()
export class CounterService {
  private readonly logger = new Logger(CounterService.name);
  private readonly cache = new Map<string, CounterMem>();

  constructor(private readonly prisma: PrismaService) {}

  private async load(tagId: string): Promise<CounterMem> {
    const cached = this.cache.get(tagId);
    if (cached) return cached;
    const state = await this.prisma.gatewayCounterState
      .findUnique({ where: { tagId } })
      .catch(() => null);
    const mem: CounterMem = {
      lastRaw: state?.lastRawValue ?? null,
      accumulated: state?.accumulated ?? 0,
      jobOrderId: state?.jobOrderId ?? null,
    };
    this.cache.set(tagId, mem);
    return mem;
  }

  private async persist(tagId: string, mem: CounterMem, edgeAt?: string): Promise<void> {
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

    // Resolve the machine's currently executing Job Order.
    const jo = await this.prisma.jobOrder
      .findFirst({
        where: { machineId: tag.machineId, status: 'EXECUTING' },
        orderBy: { actualStart: 'desc' },
        select: { id: true, actualQtyGood: true, actualQtyRejected: true },
      })
      .catch(() => null);

    let changed = false;
    if ((jo?.id ?? null) !== mem.jobOrderId) {
      mem.jobOrderId = jo?.id ?? null; // new JO → counts start fresh
      mem.accumulated = 0;
      changed = true;
    }
    mem.lastRaw = raw; // always advance the raw snapshot (no backlog jump on resume)

    // Counters only accumulate while the machine is RUNNING. The machine-status tag
    // sets MachineCurrentStatus.state; if the state is KNOWN and not RUNNING we skip
    // the increment. (Unknown/null state is allowed, so setups without a status tag
    // keep working.)
    const status = await this.prisma.machineCurrentStatus
      .findUnique({ where: { machineId: tag.machineId }, select: { state: true } })
      .catch(() => null);
    const notRunning = !!status?.state && status.state !== 'RUNNING';

    let event: CountEvent | null = null;
    if (inc > 0 && jo && !notRunning) {
      mem.accumulated += inc;
      event = await this.applyToJob(tag, jo.id, mem.accumulated, inc, ts);
      changed = true;
    }

    if (changed) await this.persist(tag.id, mem, inc > 0 ? ts : undefined);
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
