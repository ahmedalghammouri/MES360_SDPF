import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Standard 0-based INT → MachineState map (used when a status tag has no explicit statusMap). */
const DEFAULT_STATUS_MAP: Record<string, string> = {
  '0': 'IDLE',
  '1': 'RUNNING',
  '2': 'BREAKDOWN',
  '3': 'PLANNED_STOP',
  '4': 'SETUP',
  '5': 'CHANGEOVER',
  '6': 'STARVED',
  '7': 'BLOCKED',
  '8': 'OFFLINE',
  '9': 'MAINTENANCE',
};

const DOWN_STATES = new Set(['PLANNED_STOP', 'BREAKDOWN', 'SETUP', 'CHANGEOVER', 'STARVED', 'BLOCKED', 'MAINTENANCE']);
const STATE_DEFAULTS: Record<string, { reasonCode: string; category: string; planned: boolean }> = {
  BREAKDOWN:    { reasonCode: 'UNPLANNED_BREAKDOWN', category: 'MECHANICAL', planned: false },
  PLANNED_STOP: { reasonCode: 'PLANNED_MAINTENANCE', category: 'PLANNED_BREAK', planned: true },
  MAINTENANCE:  { reasonCode: 'PLANNED_MAINTENANCE', category: 'PLANNED_MAINTENANCE', planned: true },
  SETUP:        { reasonCode: 'CHANGEOVER', category: 'CHANGEOVER', planned: true },
  CHANGEOVER:   { reasonCode: 'CHANGEOVER', category: 'CHANGEOVER', planned: true },
  STARVED:      { reasonCode: 'STARVED', category: 'MATERIAL', planned: false },
  BLOCKED:      { reasonCode: 'BLOCKED', category: 'PROCESS', planned: false },
};
const OEE_EXCLUDED = new Set(['PLANNED_MAINTENANCE', 'EXTERNAL']);

export interface StatusTag {
  tagId: string;
  factoryId: string;
  machineId: string | null;
  dataType: string; // BOOL | INT | ...
  statusMap: Record<string, string> | null;
}

/**
 * Drives a machine's live state from its designated status tag:
 *   • BOOL → true = RUNNING; false = BREAKDOWN (unplanned stop) when a JO is in
 *     progress, otherwise IDLE.
 *   • INT  → mapped via the tag's statusMap (else the standard 0-based default).
 * Updates MachineCurrentStatus and opens/closes the matching DowntimeEvent so the
 * downtime + OEE engine sees the stop. Returns the derived state (for counter gating).
 */
@Injectable()
export class StatusService {
  private readonly logger = new Logger(StatusService.name);

  constructor(private readonly prisma: PrismaService) {}

  async process(tag: StatusTag, numeric: number | null, ts: string): Promise<string | null> {
    if (!tag.machineId || numeric === null) return null;
    const state = await this.derive(tag, numeric);
    if (!state) return null;
    try {
      await this.apply(tag.factoryId, tag.machineId, state, new Date(ts));
    } catch (err) {
      this.logger.error(`status apply failed for machine ${tag.machineId}`, err as Error);
    }
    return state;
  }

  private async derive(tag: StatusTag, numeric: number): Promise<string | null> {
    if (tag.dataType === 'BOOL') {
      if (numeric >= 1) return 'RUNNING';
      // false → unplanned stop if a job order is executing, else idle.
      const activeJo = await this.prisma.jobOrder.count({
        where: { machineId: tag.machineId!, status: 'EXECUTING' },
      });
      return activeJo > 0 ? 'BREAKDOWN' : 'IDLE';
    }
    const map = tag.statusMap ?? DEFAULT_STATUS_MAP;
    return map[String(Math.round(numeric))] ?? null;
  }

  private async apply(factoryId: string, machineId: string, state: string, when: Date): Promise<void> {
    const current = await this.prisma.machineCurrentStatus.findUnique({ where: { machineId }, select: { state: true } }).catch(() => null);
    if (current?.state === state) return; // no change → nothing to do

    await this.prisma.machineCurrentStatus.upsert({
      where: { machineId },
      create: { machineId, state: state as any, lastEventAt: when },
      update: { state: state as any, lastEventAt: when },
    });

    const open = await this.prisma.downtimeEvent.findFirst({ where: { machineId, endTime: null } });

    if (DOWN_STATES.has(state) && !open) {
      const d = STATE_DEFAULTS[state] ?? { reasonCode: 'UNPLANNED_BREAKDOWN', category: 'OTHER', planned: false };
      const activeWO = await this.prisma.workOrder.findFirst({ where: { status: 'IN_PROGRESS', jobOrders: { some: { machineId } } }, select: { id: true } });
      await this.prisma.downtimeEvent.create({
        data: {
          factoryId, machineId,
          workOrderId: activeWO?.id ?? null,
          reasonCode: d.reasonCode as any,
          category: d.category as any,
          reason: `Auto (status tag): ${state}`,
          startTime: when,
          isPlanned: d.planned,
          affectsOEE: !OEE_EXCLUDED.has(d.reasonCode),
        } as any,
      });
    } else if (!DOWN_STATES.has(state) && open) {
      const durationMinutes = (when.getTime() - open.startTime.getTime()) / 60_000;
      await this.prisma.downtimeEvent.update({ where: { id: open.id }, data: { endTime: when, durationMinutes } });
      if (open.workOrderId) {
        await this.prisma.workOrder.update({ where: { id: open.workOrderId }, data: { downtimeMinutes: { increment: durationMinutes } } }).catch(() => undefined);
      }
    }
  }
}
