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
      energyWoMachineKpis,
      productionSnapshots,
      oeeRecords,
      machineStateRecords,
      machineRuntimeHours,
      traceabilityLinks,
      traceEvents,
      finishedGoodsLots,
      shiftInstances,
      // energy meter history — its own scope
      energyReadings,
      energySummaries,
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
      this.prisma.energyWOMachineKpi.count(),
      this.prisma.productionSnapshot.count(),
      this.prisma.oEERecord.count(),
      this.prisma.machineStateRecord.count(),
      this.prisma.machineRuntimeHours.count(),
      this.prisma.traceabilityLink.count(),
      this.prisma.traceEvent.count(),
      this.prisma.finishedGoodsLot.count(),
      this.prisma.shiftInstance.count(),
      this.prisma.energyReading.count(),
      this.prisma.energySummary.count(),
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
      energyWoMachineKpis,
      productionSnapshots,
      oeeRecords,
      machineStateRecords,
      machineRuntimeHours,
      traceabilityLinks,
      traceEvents,
      finishedGoodsLots,
      shiftInstances,
    };
    const productionTotal = Object.values(production).reduce((a, b) => a + b, 0);

    // Energy meter history is reported and reset separately — see resetEnergy().
    const energy = { energyReadings, energySummaries, energyWoSummaries, energyWoMachineKpis };
    const energyTotal = Object.values(energy).reduce((a, b) => a + b, 0);

    return {
      production,
      productionTotal,
      energy,
      energyTotal,
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

    if (dto.scope === 'energy') {
      Object.assign(summary, await this.resetEnergy());
    } else if (dto.scope === 'production') {
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
        // Per work-order × machine energy ratios. These cascade from workOrder,
        // but are deleted (and counted) explicitly so the reported blast radius
        // matches what actually goes.
        const energyWoMachineKpis = (await tx.energyWOMachineKpi.deleteMany({})).count;
        const rescheduleRequests = (await tx.rescheduleRequest.deleteMany({})).count;

        // c. Production KPI history. None of this cascades from the work order —
        //    it is keyed on machine/shift/date — so without deleting it here a
        //    "reset" left OEE charts, machine-state timelines and the snapshot
        //    fact store fully populated against orders that no longer exist.
        const productionSnapshots = (await tx.productionSnapshot.deleteMany({})).count;
        const oeeRecords = (await tx.oEERecord.deleteMany({})).count;
        const machineStateRecords = (await tx.machineStateRecord.deleteMany({})).count;
        const machineRuntimeHours = (await tx.machineRuntimeHours.deleteMany({})).count;

        // d. Traceability + finished goods produced by those orders.
        const traceabilityLinks = (await tx.traceabilityLink.deleteMany({})).count;
        const traceEvents = (await tx.traceEvent.deleteMany({})).count;
        const finishedGoodsLots = (await tx.finishedGoodsLot.deleteMany({})).count;

        const batchRecords = (await tx.batchRecord.deleteMany({})).count;
        const jobOrders = (await tx.jobOrder.deleteMany({})).count;
        const workOrders = (await tx.workOrder.deleteMany({})).count;
        const productionOrders = (await tx.productionOrder.deleteMany({})).count;

        // e. Shift instances last — work orders, OEE records, machine states and
        //    snapshots all reference them, so they can only go once those are gone.
        //    They carry their own actualQty/goodQty/OEE, i.e. production history.
        const shiftInstances = (await tx.shiftInstance.deleteMany({})).count;

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
          energyWoMachineKpis,
          productionSnapshots,
          oeeRecords,
          machineStateRecords,
          machineRuntimeHours,
          traceabilityLinks,
          traceEvents,
          finishedGoodsLots,
          shiftInstances,
        };
      },
      { timeout: 120_000 },
    );
  }

  /**
   * Energy meter history in PostgreSQL: raw readings, period summaries and the
   * derived per-WO / per-machine ratios.
   *
   * Deliberately a scope of its own rather than part of the production reset:
   * these are real measurements streamed from physical meters and are keyed on
   * the meter, not on a work order. Sweeping them up with a production wipe would
   * silently destroy metering history that has nothing to do with the orders
   * being cleared. Meters, tariffs and device bindings are configuration and are
   * always preserved.
   */
  private async resetEnergy(): Promise<Record<string, number>> {
    return this.prisma.$transaction(
      async (tx) => {
        const energyWoMachineKpis = (await tx.energyWOMachineKpi.deleteMany({})).count;
        const energyWoSummaries = (await tx.energyWOSummary.deleteMany({})).count;
        const energySummaries = (await tx.energySummary.deleteMany({})).count;
        const energyReadings = (await tx.energyReading.deleteMany({})).count;
        return { energyReadings, energySummaries, energyWoSummaries, energyWoMachineKpis };
      },
      { timeout: 120_000 },
    );
  }
}
