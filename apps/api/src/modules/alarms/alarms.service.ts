import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { PrismaService } from '../../database/prisma.service';
import { CreateAlarmDto, ResolveAlarmDto } from './dto/alarms.dto';

@Injectable()
export class AlarmsService {
  private readonly logger = new Logger(AlarmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async list(
    factoryId: string | null,
    filters: {
      machineId?: string;
      severity?: string;
      active?: boolean;
      jobOrderId?: string;
      workOrderId?: string;
      from?: string;
      to?: string;
      limit?: number;
    },
  ) {
    const where: any = {
      ...(factoryId ? { factoryId } : {}),
      ...(filters.machineId ? { machineId: filters.machineId } : {}),
      ...(filters.severity ? { severity: filters.severity } : {}),
      ...(filters.active ? { resolvedAt: null } : {}),
      ...(filters.jobOrderId ? { metadata: { path: ['jobOrderId'], equals: filters.jobOrderId } } : {}),
      ...(filters.workOrderId ? { metadata: { path: ['workOrderId'], equals: filters.workOrderId } } : {}),
      ...((filters.from || filters.to)
        ? {
            triggeredAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
    };

    return this.prisma.alarmEvent.findMany({
      where,
      orderBy: { triggeredAt: 'desc' },
      take: Math.min(filters.limit ?? 100, 500),
      include: { machine: { select: { id: true, name: true, code: true } } },
    });
  }

  async kpis(factoryId: string | null) {
    const where = factoryId ? { factoryId } : {};
    const dayAgo = new Date(Date.now() - 86_400_000);

    const [active, unacked, critical, last24h, resolved] = await Promise.all([
      this.prisma.alarmEvent.count({ where: { ...where, resolvedAt: null } }),
      this.prisma.alarmEvent.count({ where: { ...where, resolvedAt: null, acknowledgedAt: null } }),
      this.prisma.alarmEvent.count({ where: { ...where, resolvedAt: null, severity: 'CRITICAL' } }),
      this.prisma.alarmEvent.count({ where: { ...where, triggeredAt: { gte: dayAgo } } }),
      this.prisma.alarmEvent.findMany({
        where: { ...where, resolvedAt: { not: null }, triggeredAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
        select: { triggeredAt: true, resolvedAt: true },
        take: 500,
      }),
    ]);

    const avgResolutionMins = resolved.length
      ? Math.round(
          resolved.reduce((t, a) => t + (a.resolvedAt!.getTime() - a.triggeredAt.getTime()) / 60_000, 0) /
            resolved.length * 10,
        ) / 10
      : null;

    return { active, unacknowledged: unacked, critical, last24h, avgResolutionMins };
  }

  /** Manual alarm raised from the shop floor (job-order card / live dashboard). */
  async create(factoryId: string | null, userId: string, dto: CreateAlarmDto) {
    let resolvedFactoryId = factoryId;
    if (dto.machineId) {
      const machine = await this.prisma.machine.findFirst({
        where: { id: dto.machineId, ...(factoryId ? { factoryId } : {}) },
        select: { id: true, factoryId: true, name: true },
      });
      if (!machine) throw new NotFoundException('Machine not found');
      resolvedFactoryId = machine.factoryId;
    }
    if (!resolvedFactoryId) {
      const first = await this.prisma.factory.findFirst({ select: { id: true } });
      if (!first) throw new BadRequestException('No factory configured');
      resolvedFactoryId = first.id;
    }

    const alarm = await this.prisma.alarmEvent.create({
      data: {
        factoryId: resolvedFactoryId,
        machineId: dto.machineId ?? null,
        code: dto.code ?? 'OPERATOR_ALARM',
        description: dto.description,
        severity: (dto.severity ?? 'HIGH') as any,
        category: dto.category ?? 'OPERATOR',
        triggeredAt: new Date(),
        notes: dto.notes,
        metadata: {
          source: 'SHOP_FLOOR',
          raisedById: userId,
          ...(dto.jobOrderId ? { jobOrderId: dto.jobOrderId } : {}),
          ...(dto.workOrderId ? { workOrderId: dto.workOrderId } : {}),
        },
      },
      include: { machine: { select: { id: true, name: true, code: true } } },
    });

    this.eventEmitter.emit('alarm.created', { alarm, factoryId: resolvedFactoryId });
    this.logger.log(`Shop-floor alarm raised (${alarm.severity}): ${alarm.description}`);
    return alarm;
  }

  async acknowledge(factoryId: string | null, id: string, userId: string) {
    const alarm = await this.prisma.alarmEvent.findFirst({
      where: { id, ...(factoryId ? { factoryId } : {}) },
    });
    if (!alarm) throw new NotFoundException('Alarm not found');
    if (alarm.acknowledgedAt) throw new BadRequestException('Alarm already acknowledged');

    return this.prisma.alarmEvent.update({
      where: { id },
      data: { acknowledgedAt: new Date(), acknowledgedById: userId },
      include: { machine: { select: { id: true, name: true, code: true } } },
    });
  }

  async resolve(factoryId: string | null, id: string, userId: string, dto: ResolveAlarmDto) {
    const alarm = await this.prisma.alarmEvent.findFirst({
      where: { id, ...(factoryId ? { factoryId } : {}) },
    });
    if (!alarm) throw new NotFoundException('Alarm not found');
    if (alarm.resolvedAt) throw new BadRequestException('Alarm already resolved');

    const resolvedAt = new Date();
    return this.prisma.alarmEvent.update({
      where: { id },
      data: {
        resolvedAt,
        resolvedById: userId,
        // First resolution implies acknowledgement
        ...(alarm.acknowledgedAt ? {} : { acknowledgedAt: resolvedAt, acknowledgedById: userId }),
        durationMinutes: (resolvedAt.getTime() - alarm.triggeredAt.getTime()) / 60_000,
        ...(dto.notes ? { notes: dto.notes } : {}),
      },
      include: { machine: { select: { id: true, name: true, code: true } } },
    });
  }
}
