import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../database/prisma.service';
import { ProductionService } from './production.service';

/**
 * Auto-start scheduler. Every minute it:
 *   1. Starts work orders flagged `autoStart` once their plannedStart has arrived
 *      (which cascades their READY job orders via ProductionService.startWorkOrder).
 *   2. Starts any READY job order whose plannedStart has arrived, for IN_PROGRESS
 *      auto-start work orders (handles steps that become ready over time).
 *
 * Everything runs as the "system" actor (no userId). Failures are logged and
 * never throw — one stuck order must not block the rest of the batch.
 */
@Injectable()
export class WorkOrderSchedulerService {
  private readonly logger = new Logger(WorkOrderSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly production: ProductionService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    const now = new Date();

    // 1) Due auto-start work orders
    const dueWOs = await this.prisma.workOrder.findMany({
      where: {
        autoStart: true,
        deletedAt: null,
        status: { in: ['PLANNED', 'RELEASED'] },
        plannedStart: { lte: now },
      },
      select: { id: true, factoryId: true, orderNumber: true },
    });
    for (const wo of dueWOs) {
      try {
        await this.production.startWorkOrder(wo.factoryId, null, wo.id);
        this.logger.log(`Auto-started WO ${wo.orderNumber} (plannedStart reached)`);
      } catch (e) {
        this.logger.warn(`Auto-start of WO ${wo.orderNumber} skipped: ${(e as Error).message}`);
      }
    }

    // 2) Due READY job orders of running auto-start work orders
    const dueJOs = await this.prisma.jobOrder.findMany({
      where: {
        status: 'READY',
        plannedStart: { lte: now },
        workOrder: { autoStart: true, status: 'IN_PROGRESS', deletedAt: null },
      },
      select: { id: true, factoryId: true, operationName: true },
    });
    for (const jo of dueJOs) {
      try {
        await this.production.updateJobOrderStatus(jo.factoryId, jo.id, 'EXECUTING', {});
        this.logger.log(`Auto-started job order "${jo.operationName}" (plannedStart reached)`);
      } catch {
        /* dependency not met yet — try again next tick */
      }
    }
  }
}
