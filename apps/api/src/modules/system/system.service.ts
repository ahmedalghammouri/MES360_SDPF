import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

import { PrismaService } from '../../database/prisma.service';
import { InfluxService } from '../historian/influx.service';
import { MqttMonitorService } from '../iot/mqtt-monitor.service';
import { ResetSystemDto } from './dto/reset.dto';

const CONFIRM_PHRASE = 'RESET';
/** Broker-wide control topic the edge gateway subscribes to (retained). */
const HISTORIAN_CONTROL_TOPIC = 'mes360/control/historian';

interface ActingUser {
  id: string;
  email: string;
  passwordHash: string;
  factoryId?: string | null;
}

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly influx: InfluxService,
    private readonly mqtt: MqttMonitorService,
  ) {}

  /**
   * Snapshot of how much data each resettable subsystem currently holds —
   * drives the Danger-Zone status panel.
   */
  async getStatus() {
    const [
      productionOrders,
      workOrders,
      jobOrders,
      productionEvents,
      batchRecords,
      materialConsumptions,
      jobOrderMaterials,
      scrapLogs,
      rescheduleRequests,
      genealogyLinks,
      energyWoSummaries,
      // kept / unlinked
      inspections,
      maintenanceOrders,
      downtimeEvents,
      spcMeasurements,
    ] = await this.prisma.$transaction([
      this.prisma.productionOrder.count(),
      this.prisma.workOrder.count(),
      this.prisma.jobOrder.count(),
      this.prisma.productionEvent.count(),
      this.prisma.batchRecord.count(),
      this.prisma.materialConsumption.count(),
      this.prisma.jobOrderMaterial.count(),
      this.prisma.scrapLog.count(),
      this.prisma.rescheduleRequest.count(),
      this.prisma.genealogyLink.count(),
      this.prisma.energyWOSummary.count(),
      this.prisma.inspectionResult.count(),
      this.prisma.maintenanceWO.count(),
      this.prisma.downtimeEvent.count(),
      this.prisma.sPCMeasurement.count(),
    ]);

    const influxPoints = await this.influx.countPoints();

    const production = {
      productionOrders,
      workOrders,
      jobOrders,
      productionEvents,
      batchRecords,
      materialConsumptions,
      jobOrderMaterials,
      scrapLogs,
      rescheduleRequests,
      genealogyLinks,
      energyWoSummaries,
    };
    const productionTotal = Object.values(production).reduce((a, b) => a + b, 0);

    return {
      production,
      productionTotal,
      preserved: { inspections, maintenanceOrders, downtimeEvents, spcMeasurements },
      timeseries: {
        enabled: this.influx.isEnabled(),
        bucket: this.influx.getBucket(),
        points: influxPoints,
        paused: this.influx.isPaused(),
      },
    };
  }

  /** Pause/resume ALL historian writes — both the API's own scheduler AND the
   *  edge gateway (via a retained MQTT control message it subscribes to). Lets the
   *  owner keep the bucket empty after a wipe. Retained so a gateway that restarts
   *  picks up the current state on reconnect. */
  setHistorianPaused(paused: boolean) {
    this.influx.setPaused(paused);
    // Broadcast to the edge gateway(s), which write to InfluxDB directly.
    this.mqtt.publish(HISTORIAN_CONTROL_TOPIC, { paused }, true);
    return { paused: this.influx.isPaused() };
  }

  /**
   * Execute a destructive reset. Re-verifies the owner's password and the
   * safety phrase, performs the deletion in a single committed transaction,
   * optionally wipes the historian, and records an audit log.
   */
  async reset(user: ActingUser, dto: ResetSystemDto, ctx: { ip?: string; userAgent?: string }) {
    // 1. Re-authenticate — password must be re-entered for any destructive action.
    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) throw new UnauthorizedException('Password is incorrect');

    // 2. Typed safety phrase must match exactly.
    if ((dto.confirmation ?? '').trim() !== CONFIRM_PHRASE) {
      throw new BadRequestException(`Confirmation phrase must be exactly "${CONFIRM_PHRASE}"`);
    }

    const summary: Record<string, number> = {};
    let timeseriesWiped = false;

    if (dto.scope === 'production') {
      Object.assign(summary, await this.resetProduction());
      if (dto.wipeTimeseries) {
        timeseriesWiped = await this.influx.wipeBucket();
      }
    } else if (dto.scope === 'timeseries') {
      timeseriesWiped = await this.influx.wipeBucket();
    }

    // 3. Audit trail (best-effort — never blocks the reset result).
    try {
      await this.prisma.auditLog.create({
        data: {
          factoryId: user.factoryId ?? null,
          userId: user.id,
          action: 'SYSTEM_RESET',
          module: 'system',
          entityType: 'System',
          entityId: dto.scope,
          metadata: {
            scope: dto.scope,
            wipeTimeseries: !!dto.wipeTimeseries,
            timeseriesWiped,
            deleted: summary,
            actor: user.email,
            ip: ctx.ip ?? null,
            userAgent: ctx.userAgent ?? null,
          },
        },
      });
    } catch (err) {
      this.logger.error('Failed to write SYSTEM_RESET audit log', err as any);
    }

    this.logger.warn(
      `SYSTEM_RESET scope=${dto.scope} by ${user.email} — deleted ${JSON.stringify(summary)} timeseriesWiped=${timeseriesWiped}`,
    );

    return { scope: dto.scope, deleted: summary, timeseriesWiped };
  }

  /**
   * Replicates the verified production-data wipe: removes all production orders,
   * work orders, job orders and every dependent record, while preserving and
   * unlinking quality inspections, maintenance work orders, downtime events and
   * SPC measurements. Runs as one committed transaction.
   */
  private async resetProduction(): Promise<Record<string, number>> {
    return this.prisma.$transaction(
      async (tx) => {
        // a. Detach records we keep so the parent deletions don't cascade them away.
        await tx.inspectionResult.updateMany({ data: { workOrderId: null, batchRecordId: null } });
        await tx.downtimeEvent.updateMany({ data: { workOrderId: null } });
        await tx.maintenanceWO.updateMany({ data: { productionWOId: null } });
        await tx.sPCMeasurement.updateMany({ data: { workOrderId: null } });

        // b. Delete dependent children first, then parents.
        const jobOrderMaterials = (await tx.jobOrderMaterial.deleteMany({})).count;
        const scrapLogs = (await tx.scrapLog.deleteMany({})).count;
        const materialConsumptions = (await tx.materialConsumption.deleteMany({})).count;
        const productionEvents = (await tx.productionEvent.deleteMany({})).count;
        const genealogyLinks = (await tx.genealogyLink.deleteMany({})).count;
        const energyWoSummaries = (await tx.energyWOSummary.deleteMany({})).count;
        const rescheduleRequests = (await tx.rescheduleRequest.deleteMany({})).count;
        const batchRecords = (await tx.batchRecord.deleteMany({})).count;
        const jobOrders = (await tx.jobOrder.deleteMany({})).count;
        const workOrders = (await tx.workOrder.deleteMany({})).count;
        const productionOrders = (await tx.productionOrder.deleteMany({})).count;

        return {
          productionOrders,
          workOrders,
          jobOrders,
          productionEvents,
          batchRecords,
          materialConsumptions,
          jobOrderMaterials,
          scrapLogs,
          rescheduleRequests,
          genealogyLinks,
          energyWoSummaries,
        };
      },
      { timeout: 120_000 },
    );
  }
}
