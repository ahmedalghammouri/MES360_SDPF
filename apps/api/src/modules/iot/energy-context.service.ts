import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';

/**
 * EnergyContextService
 *
 * Elevates raw energy meter readings into manufacturing-contextualized data:
 * - Links each reading to the active Work Order and WorkCenter
 * - Snapshots the machine state at reading time (RUNNING / IDLE / BREAKDOWN)
 * - Detects anomalies: high power draw during idle/downtime states
 * - Computes per-WO energy summaries when a WO completes
 * - Answers: "kWh per unit", "kWh per kg batch", "idle energy waste"
 */
@Injectable()
export class EnergyContextService {
  private readonly logger = new Logger(EnergyContextService.name);

  // Machine nominal power thresholds for anomaly detection (machineCode → kW)
  // Defaults to 10 kW if machine not listed
  private readonly NOMINAL_POWER: Record<string, number> = {
    'M1-BIG-BETTI': 15,
    'M2-CARTOMAC':  22,
    'M4-EURO-PACK': 18,
    'M5-UNITECH':   8,
    'UTIL-BOILER-01': 45,
    'UTIL-COMP-01': 30,
    'UTIL-COMP-02': 30,
  };

  // Anomaly threshold: flag if power > nominal × this multiplier during idle/down
  private readonly ANOMALY_MULTIPLIER = 0.6; // >60% of nominal while idle = anomaly

  constructor(private readonly prisma: PrismaService) {}

  // ── Context enrichment on IoT ingestion ──────────────────────

  /**
   * Called from IotService after a tag reading arrives.
   * Enriches EnergyReading with current WO, WorkCenter, and machine state context.
   */
  async enrichEnergyReading(readingId: string, machineId: string | null): Promise<void> {
    try {
      const [machineStatus, activeWO] = await Promise.all([
        machineId
          ? this.prisma.machineCurrentStatus.findUnique({
              where: { machineId },
              select: { state: true, currentWOId: true, machine: { select: { code: true } } },
            })
          : null,
        machineId
          ? this.prisma.workOrder.findFirst({
              where: { status: 'IN_PROGRESS', jobOrders: { some: { machineId } } },
              select: { id: true },
            })
          : null,
      ]);

      // machineState fallback chain: current status → last reading's state → UNKNOWN
      let machineState: string = machineStatus?.state ?? '';
      if (!machineState && machineId) {
        const lastReading = await this.prisma.energyReading.findFirst({
          where: { machineId, machineState: { not: null } },
          orderBy: { timestamp: 'desc' },
          select: { machineState: true },
        });
        machineState = lastReading?.machineState ?? 'UNKNOWN';
      }
      if (!machineState) machineState = 'UNKNOWN';

      const workOrderId = activeWO?.id ?? machineStatus?.currentWOId ?? null;

      // Find WorkCenter linked to this machine's active routing step
      const workCenterId = workOrderId
        ? await this.resolveWorkCenterForWO(workOrderId)
        : null;

      await this.prisma.energyReading.update({
        where: { id: readingId },
        data: {
          machineState,
          workOrderId,
          workCenterId,
          machineId,
        } as any,
      });
    } catch (err) {
      this.logger.error(`Failed to enrich energy reading ${readingId}`, err);
    }
  }

  // ── Anomaly detection ────────────────────────────────────────

  /**
   * Checks an energy reading for high power during idle/down state.
   * Called after enrichment. Returns anomaly flag + message if triggered.
   */
  async detectPowerAnomaly(readingId: string): Promise<{ isAnomaly: boolean; message?: string }> {
    const reading = await this.prisma.energyReading.findUnique({
      where: { id: readingId },
      include: { meter: { select: { machineId: true, machine: { select: { code: true } } } } },
    });
    if (!reading) return { isAnomaly: false };

    const powerKw = (reading as any).powerKw;
    if (!powerKw || powerKw <= 0) return { isAnomaly: false };

    const machineState = (reading as any).machineState;
    if (machineState === 'RUNNING') return { isAnomaly: false };

    const machineCode = (reading.meter as any)?.machine?.code ?? '';
    const nominalKw = this.NOMINAL_POWER[machineCode] ?? 10;
    const threshold = nominalKw * this.ANOMALY_MULTIPLIER;

    if (powerKw > threshold) {
      const msg = `High power (${powerKw.toFixed(1)} kW, ${((powerKw / nominalKw) * 100).toFixed(0)}% of nominal) while machine is ${machineState}`;
      this.logger.warn(`Energy anomaly on ${machineCode}: ${msg}`);
      return { isAnomaly: true, message: msg };
    }
    return { isAnomaly: false };
  }

  // ── WO Energy Summary ────────────────────────────────────────

  /**
   * Computes and persists the energy summary for a completed Work Order.
   * Called by production.service when WO transitions to COMPLETED.
   */
  @OnEvent('workorder.completed')
  async computeWOEnergySummary(payload: { workOrderId: string; factoryId: string; qtyProduced?: number; batchSizeKg?: number }) {
    const { workOrderId, factoryId, qtyProduced, batchSizeKg } = payload;

    try {
      const readings = await this.prisma.energyReading.findMany({
        where: { workOrderId },
        select: {
          value: true,
          powerKw: true,
          machineState: true,
          timestamp: true,
        },
        orderBy: { timestamp: 'asc' },
      }) as any[];

      if (readings.length < 2) {
        this.logger.debug(`WO ${workOrderId}: insufficient energy readings for summary`);
        return;
      }

      // Compute cumulative kWh as delta between readings (time-series integration)
      let totalKwh = 0;
      let runningKwh = 0;
      let idleKwh = 0;
      let downtimeKwh = 0;
      let peakPowerKw = 0;
      let anomalyCount = 0;

      for (let i = 1; i < readings.length; i++) {
        const prev = readings[i - 1];
        const curr = readings[i];
        const deltaKwh = Math.max(0, curr.value - prev.value); // cumulative meter delta
        const state = prev.machineState ?? 'IDLE';
        const pKw = curr.powerKw ?? 0;

        totalKwh += deltaKwh;
        if (state === 'RUNNING') runningKwh += deltaKwh;
        else if (state === 'IDLE') idleKwh += deltaKwh;
        else if (state === 'BREAKDOWN' || state === 'PLANNED_STOP') downtimeKwh += deltaKwh;

        if (pKw > peakPowerKw) peakPowerKw = pKw;

        // Count anomalies (high power while not running)
        if (pKw > 0 && state !== 'RUNNING') {
          const machineCode = '';
          const nominalKw = 10;
          if (pKw > nominalKw * this.ANOMALY_MULTIPLIER) anomalyCount++;
        }
      }

      const powerReadings = readings.filter((r: any) => r.powerKw && r.powerKw > 0);
      const avgPowerKw = powerReadings.length > 0
        ? powerReadings.reduce((sum: number, r: any) => sum + r.powerKw, 0) / powerReadings.length
        : null;

      const kwhPerUnit = qtyProduced && qtyProduced > 0 ? totalKwh / qtyProduced : null;
      const kwhPerKgBatch = batchSizeKg && batchSizeKg > 0 ? totalKwh / batchSizeKg : null;

      await this.prisma.energyWOSummary.upsert({
        where: { workOrderId },
        create: {
          workOrderId,
          factoryId,
          totalKwh,
          runningKwh,
          idleKwh,
          downtimeKwh,
          kwhPerUnit,
          kwhPerKgBatch,
          peakPowerKw: peakPowerKw || null,
          avgPowerKw,
          anomalyCount,
        } as any,
        update: {
          totalKwh,
          runningKwh,
          idleKwh,
          downtimeKwh,
          kwhPerUnit,
          kwhPerKgBatch,
          peakPowerKw: peakPowerKw || null,
          avgPowerKw,
          anomalyCount,
          computedAt: new Date(),
        } as any,
      });

      this.logger.log(
        `Energy summary for WO ${workOrderId}: ${totalKwh.toFixed(2)} kWh total, ` +
        `${idleKwh.toFixed(2)} kWh wasted (idle/down), ${anomalyCount} anomalies`,
      );
    } catch (err) {
      this.logger.error(`Failed to compute energy summary for WO ${workOrderId}`, err);
    }
  }

  // ── Query methods ─────────────────────────────────────────────

  /**
   * Energy consumption breakdown for a Work Order.
   * Returns structured summary with waste analysis.
   */
  async getWOEnergySummary(workOrderId: string) {
    const summary = await (this.prisma as any).energyWOSummary.findUnique({
      where: { workOrderId },
    });
    if (!summary) return null;

    const wasteKwh = summary.idleKwh + summary.downtimeKwh;
    const wastePct = summary.totalKwh > 0 ? (wasteKwh / summary.totalKwh) * 100 : 0;

    return {
      ...summary,
      wasteKwh: parseFloat(wasteKwh.toFixed(3)),
      wastePct: parseFloat(wastePct.toFixed(1)),
      efficiencyPct: parseFloat((100 - wastePct).toFixed(1)),
    };
  }

  /**
   * Timeseries energy readings for a Work Order or WorkCenter within a time window.
   * Used to render the line chart in the Energy contextualization panel.
   */
  async getEnergyTimeseries(filters: {
    workOrderId?: string;
    workCenterId?: string;
    factoryId?: string;
    from: Date;
    to: Date;
    bucketMins?: number;
  }) {
    const { workOrderId, workCenterId, factoryId, from, to } = filters;

    const readings = await this.prisma.energyReading.findMany({
      where: {
        ...(workOrderId && { workOrderId }),
        ...(workCenterId && { workCenterId }),
        ...(factoryId && { factoryId }),
        timestamp: { gte: from, lte: to },
      },
      select: {
        timestamp: true,
        value: true,
        powerKw: true,
        machineState: true,
      },
      orderBy: { timestamp: 'asc' },
    }) as any[];

    return readings.map(r => ({
      timestamp: r.timestamp.toISOString(),
      value: r.value,
      powerKw: r.powerKw ?? null,
      machineState: r.machineState ?? 'UNKNOWN',
    }));
  }

  /**
   * Aggregate energy by WorkCenter for a time window — used for the plant energy map.
   */
  async getEnergyByWorkCenter(factoryId: string, from: Date, to: Date) {
    const readings = await (this.prisma.energyReading as any).groupBy({
      by: ['workCenterId'],
      where: {
        factoryId,
        workCenterId: { not: null },
        timestamp: { gte: from, lte: to },
      },
      _sum: { value: true, powerKw: true },
      _count: { id: true },
    }) as any[];

    // Resolve WorkCenter names
    const wcIds = readings.map((r: any) => r.workCenterId).filter(Boolean);
    const workCenters = await (this.prisma as any).workCenter.findMany({
      where: { id: { in: wcIds } },
      select: { id: true, code: true, name: true, level: true },
    });
    const wcMap = new Map(workCenters.map((wc: any) => [wc.id, wc]));

    return readings.map((r: any) => ({
      workCenterId: r.workCenterId,
      workCenter: wcMap.get(r.workCenterId) ?? null,
      totalKwh: r._sum.value ?? 0,
      avgPowerKw: r._sum.powerKw && r._count.id ? r._sum.powerKw / r._count.id : null,
      readingCount: r._count.id,
    }));
  }

  // ── Private helpers ───────────────────────────────────────────

  private async resolveWorkCenterForWO(workOrderId: string): Promise<string | null> {
    try {
      const wo = await this.prisma.workOrder.findUnique({
        where: { id: workOrderId },
        include: {
          sku: {
            include: {
              manufacturingProcesses: {
                include: { routingSteps: { where: { workCenterId: { not: null } }, take: 1, orderBy: { stepNumber: 'asc' } } },
              },
            },
          },
        },
      });
      return (wo?.sku?.manufacturingProcesses?.[0]?.routingSteps?.[0] as any)?.workCenterId ?? null;
    } catch {
      return null;
    }
  }

  private async getEnergySummaryForWO(workOrderId: string) {
    return (this.prisma as any).energyWOSummary.findUnique({ where: { workOrderId } });
  }
}
