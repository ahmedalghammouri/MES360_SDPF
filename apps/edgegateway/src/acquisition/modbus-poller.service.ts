import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import {
  ModbusClient, instantiateMeterTags,
  type ModbusTransport, type RegisterType, type ModbusDataType, type EdgeType, type TagBinding,
} from '@mes360/industrial-drivers';

import { PrismaService } from '../prisma/prisma.service';
import { MqttService } from '../services/mqtt.service';
import { GatewayContextService } from '../context/gateway-context.service';
import { IngestService, type TagReadingRecord } from './ingest.service';
import { CounterService, type CounterTag } from './counter.service';
import { EnergyReadingService, type MeterContext } from './energy-reading.service';
import { StatusService, type StatusTag } from './status.service';
import { AlarmService } from './alarm.service';
import { ModbusLogService } from './modbus-log.service';

interface PolledTag {
  binding: TagBinding;
  tagId: string;
  code: string;
  factoryId: string;
  machineId: string | null;
  machineCode: string | null;
  isCounter: boolean;
  counterTag: CounterTag;
  energyRole: string | null;
  historize: boolean;
  mqttPublishMode: string;
  mqttPublishRateSec: number;
  historizationMode: string;
  historizationRateSec: number;
  deadband: number | null;
  isMachineStatus: boolean;
  statusTag: StatusTag;
}

interface DeviceRuntime {
  id: string;
  name: string;
  client: ModbusClient;
  tags: PolledTag[];
  meter: MeterContext | null;
  intervalMs: number;
  timer: NodeJS.Timeout | null;
  busy: boolean;
  signature: string; // detects config changes to trigger rebuild
}

/** Map a Device.protocol string to a Modbus transport. */
function transportFor(protocol: string): ModbusTransport {
  if (protocol === 'MODBUS_RTU') return 'RTU';
  if (protocol === 'MODBUS_RTU_TCP') return 'RTU_TCP';
  return 'TCP';
}

/**
 * Owns one Modbus connection per device assigned to this gateway, polls every
 * bound tag on its interval, and fans readings to the counter + ingest layers.
 * Reloads device/tag config periodically so online edits apply without restart.
 */
@Injectable()
export class ModbusPollerService implements OnModuleDestroy {
  private readonly logger = new Logger(ModbusPollerService.name);
  private readonly devices = new Map<string, DeviceRuntime>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly ingest: IngestService,
    private readonly counter: CounterService,
    private readonly energy: EnergyReadingService,
    private readonly statusSvc: StatusService,
    private readonly alarms: AlarmService,
    private readonly ctx: GatewayContextService,
    private readonly config: ConfigService,
    private readonly mlog: ModbusLogService,
  ) {}

  onModuleDestroy() {
    for (const d of this.devices.values()) {
      if (d.timer) clearInterval(d.timer);
      void d.client.disconnect();
    }
  }

  /** Reconcile runtime against DB config every 10s (also the first load). */
  @Interval('poller-reload', 10_000)
  async reload() {
    const gatewayId = this.ctx.getGatewayId();
    if (!gatewayId) return;

    let configured;
    try {
      configured = await this.prisma.device.findMany({
        where: { gatewayId, protocol: { startsWith: 'MODBUS' }, isActive: true },
        include: {
          machine: { select: { id: true, code: true } },
          energyMeter: { select: { id: true, machineId: true, unit: true, meterNumber: true, templateKey: true } },
          tagDefinitions: {
            where: { isActive: true, address: { not: null } },
            include: { machine: { select: { id: true, code: true } } },
          },
        },
      });
    } catch (err) {
      this.logger.debug(`Device reload failed: ${(err as Error).message}`);
      return;
    }

    const seen = new Set<string>();
    const defaultInterval = this.config.get<number>('defaultPollIntervalMs') ?? 1000;

    for (const dev of configured) {
      seen.add(dev.id);

      // Auto-provision a meter's ENERGY tags from its template the first time we
      // see it (templateKey set by the web/edge UI, but no energy tags yet). The
      // tags are picked up on the next reload tick.
      const m = dev.energyMeter;
      if (m?.templateKey && !dev.tagDefinitions.some((t) => t.tagType === 'ENERGY')) {
        await this.provisionMeterTags(dev.id, m.id, dev.factoryId, m.machineId ?? dev.machineId ?? null, m.meterNumber, m.templateKey);
        continue; // reload next tick with the new tags
      }

      const signature = JSON.stringify({
        proto: dev.protocol, ip: dev.ipAddress, port: dev.port, unit: dev.unitId, poll: dev.pollIntervalMs,
        serial: [dev.serialPort, dev.baudRate, dev.parity, dev.dataBits, dev.stopBits], meter: dev.energyMeter?.id ?? null,
        tags: dev.tagDefinitions.map((t) => [t.id, t.address, t.registerType, t.dataType, t.scaleFactor, t.offset, t.wordCount, t.wordOrder, t.counterRole, t.edgeType, t.machineId, t.energyRole, (t as any).historizationEnabled, (t as any).mqttPublishMode, (t as any).mqttPublishRateSec, (t as any).historizationMode, (t as any).historizationRateSec, (t as any).deadband, (t as any).isMachineStatus, (t as any).signalRole, (t as any).pulseWindowMs, (t as any).pulseMinEdges, (t as any).idleThresholdMs]),
      });
      const existing = this.devices.get(dev.id);
      if (existing && existing.signature === signature) continue; // unchanged

      // (Re)build this device's runtime.
      if (existing) {
        if (existing.timer) clearInterval(existing.timer);
        await existing.client.disconnect().catch(() => undefined);
      }

      const client = new ModbusClient({
        transport: transportFor(dev.protocol),
        host: dev.ipAddress ?? '127.0.0.1',
        port: dev.port ?? 502,
        serialPort: dev.serialPort ?? undefined,
        baudRate: dev.baudRate ?? undefined,
        parity: (dev.parity as 'none' | 'even' | 'odd') ?? undefined,
        dataBits: (dev.dataBits as 7 | 8) ?? undefined,
        stopBits: (dev.stopBits as 1 | 2) ?? undefined,
        unitId: dev.unitId ?? 1,
        timeoutMs: 3000,
      });

      const tags: PolledTag[] = dev.tagDefinitions.map((t) => {
        const binding: TagBinding = {
          id: t.id,
          code: t.code,
          address: parseInt(String(t.address), 10) || 0,
          registerType: (t.registerType as RegisterType) ?? 'HOLDING',
          dataType: t.dataType as ModbusDataType,
          wordCount: t.wordCount ?? 1,
          wordOrder: (t.wordOrder as 'BIG' | 'LITTLE') ?? 'BIG',
          scaleFactor: t.scaleFactor,
          offset: t.offset,
          counterRole: t.counterRole as any,
          edgeType: (t.edgeType as EdgeType) ?? 'RISING',
        };
        return {
          binding,
          tagId: t.id,
          code: t.code,
          factoryId: t.factoryId,
          machineId: t.machineId ?? dev.machineId ?? null,
          machineCode: t.machine?.code ?? dev.machine?.code ?? null,
          isCounter: t.tagType === 'COUNTER' && !!t.counterRole && t.counterRole !== 'NONE',
          counterTag: {
            id: t.id,
            machineId: t.machineId ?? dev.machineId ?? null,
            factoryId: t.factoryId,
            counterRole: t.counterRole as any,
            edgeType: (t.edgeType as EdgeType) ?? 'RISING',
          },
          energyRole: t.energyRole ?? null,
          historize: (t as any).historizationEnabled !== false,
          mqttPublishMode: ((t as any).mqttPublishMode as string) ?? 'CHANGE',
          mqttPublishRateSec: ((t as any).mqttPublishRateSec as number) ?? 0,
          historizationMode: ((t as any).historizationMode as string) ?? 'CHANGE',
          historizationRateSec: ((t as any).historizationRateSec as number) ?? 60,
          deadband: ((t as any).deadband as number | null) ?? null,
          isMachineStatus: !!(t as any).isMachineStatus,
          statusTag: {
            tagId: t.id,
            factoryId: t.factoryId,
            machineId: t.machineId ?? dev.machineId ?? null,
            dataType: t.dataType as string,
            statusMap: ((t as any).statusMap as Record<string, string> | null) ?? null,
            // How this bit is to be READ. On an eight-input module a bit's meaning
            // cannot be inferred from its value; it has to be declared.
            signalRole: ((t as any).signalRole as string | null) ?? null,
            pulseWindowMs: ((t as any).pulseWindowMs as number | null) ?? null,
            pulseMinEdges: ((t as any).pulseMinEdges as number | null) ?? null,
          },
        };
      });

      const meter: MeterContext | null = dev.energyMeter
        ? {
            meterId: dev.energyMeter.id,
            factoryId: dev.factoryId,
            machineId: dev.energyMeter.machineId ?? dev.machineId ?? null,
            unit: dev.energyMeter.unit,
          }
        : null;

      const runtime: DeviceRuntime = {
        id: dev.id,
        name: dev.name,
        client,
        tags,
        meter,
        intervalMs: dev.pollIntervalMs ?? defaultInterval,
        timer: null,
        busy: false,
        signature,
      };
      // Establish the connection now, sequentially per device. Lazy-connecting
      // many clients at once on the first poll tick triggers a connect storm
      // that modbus-serial mishandles (most reads then "Timed out"). The reload
      // loop is already serial, so awaiting here connects devices one at a time.
      await runtime.client.connect().catch((err) => {
        const conn = dev.protocol === 'MODBUS_RTU'
          ? `${dev.serialPort ?? '?'} @ ${dev.baudRate ?? '?'} ${dev.parity ?? 'none'}`
          : `${dev.ipAddress ?? '?'}:${dev.port ?? 502}`;
        this.mlog.log(dev.name, 'connect', (err as Error)?.message ?? String(err), { proto: dev.protocol, conn, unitId: dev.unitId ?? 1 });
      });
      runtime.timer = setInterval(() => void this.pollDevice(runtime), runtime.intervalMs);
      this.devices.set(dev.id, runtime);
      this.logger.log(`Device "${dev.name}" loaded: ${tags.length} tag(s) @ ${runtime.intervalMs}ms`);
    }

    // Drop devices no longer assigned to this gateway.
    for (const [id, d] of this.devices) {
      if (seen.has(id)) continue;
      if (d.timer) clearInterval(d.timer);
      await d.client.disconnect().catch(() => undefined);
      this.devices.delete(id);
    }
  }

  private async pollDevice(dev: DeviceRuntime) {
    if (dev.busy) return; // skip if previous cycle still running
    dev.busy = true;
    let anyError = false;
    const energyRoleValues = new Map<string, number>();
    let lastTs = new Date().toISOString();
    try {
      // One coalesced set of block reads per cycle instead of a round-trip per
      // tag — the key to fast counter polling and light meter reads.
      const results = await dev.client.readTagsBlocked(dev.tags.map((t) => t.binding));
      for (const tag of dev.tags) {
        const res = results.get(tag.tagId);
        if (!res) continue;
        const ts = res.timestamp.toISOString();
        lastTs = ts;

        if (res.quality !== 'GOOD') {
          anyError = true;
          this.mlog.log(dev.name, 'read', res.error ?? 'read failed', {
            tag: tag.code, address: tag.binding.address, register: tag.binding.registerType, quality: res.quality,
          });
          continue;
        }

        const numeric =
          typeof res.value === 'number' ? res.value
          : typeof res.value === 'boolean' ? (res.value ? 1 : 0)
          : null;

        const record: TagReadingRecord = {
          tagId: tag.tagId,
          factoryId: tag.factoryId,
          code: tag.code,
          machineId: tag.machineId,
          machineCode: tag.machineCode,
          deviceId: dev.id,
          value: String(res.value ?? ''),
          numeric,
          quality: res.quality,
          timestamp: ts,
          historize: tag.historize,
          mqttPublishMode: tag.mqttPublishMode,
          mqttPublishRateSec: tag.mqttPublishRateSec,
          historizationMode: tag.historizationMode,
          historizationRateSec: tag.historizationRateSec,
          deadband: tag.deadband,
        };
        await this.ingest.ingest(record);

        // Machine-status driver tag → derive and apply the live machine state,
        // which is what opens and closes downtime events. Counting is NOT gated
        // on it: a pulse that arrives is a unit that was made, and discarding it
        // because the state signal disagreed would lose real production.
        if (tag.isMachineStatus) {
          await this.statusSvc.process(tag.statusTag, numeric, ts);
        }

        // Configured alarms on this tag. Runs on every GOOD reading, not only on
        // status tags — a threshold on a temperature or a meter is the ordinary case.
        await this.alarms.evaluate(tag.tagId, tag.machineId, numeric, ts);

        if (tag.isCounter) {
          const event = await this.counter.process(tag.counterTag, res.raw, ts);
          if (event) {
            this.mqtt.publish(`mes360/${tag.factoryId}/jo/${event.jobOrderId}/count`, event);
          }
        }
        if (tag.energyRole && numeric !== null) energyRoleValues.set(tag.energyRole, numeric);
      }

      // Energy meter → write an EnergyReading (throttled) + publish for API enrichment.
      if (dev.meter && energyRoleValues.size) {
        const ev = await this.energy.process(dev.meter, energyRoleValues, lastTs);
        if (ev) this.mqtt.publish(`mes360/${dev.meter.factoryId}/energy/${ev.meterId}`, ev);
      }

      await this.markDevice(dev.id, anyError ? 'ERROR' : 'CONNECTED', anyError ? 'One or more tag reads failed' : null);
    } catch (err) {
      this.mlog.log(dev.name, 'poll', (err as Error)?.message ?? String(err));
      await this.markDevice(dev.id, 'ERROR', (err as Error).message);
    } finally {
      dev.busy = false;
    }
  }

  /** Instantiate a meter's ENERGY tags from its template (idempotent). */
  private async provisionMeterTags(
    deviceId: string, meterId: string, factoryId: string, machineId: string | null, meterNumber: string, templateKey: string,
  ) {
    try {
      const specs = instantiateMeterTags(templateKey, meterNumber);
      for (const s of specs) {
        const exists = await this.prisma.tagDefinition.findFirst({ where: { factoryId, code: s.code } });
        if (exists) continue;
        await this.prisma.tagDefinition.create({
          data: {
            factoryId, meterId, deviceId, machineId,
            code: s.code, name: s.name, dataType: s.dataType as any, tagType: 'ENERGY',
            unit: s.unit, address: s.address, registerType: s.registerType,
            wordCount: s.wordCount, wordOrder: s.wordOrder, scaleFactor: s.scaleFactor,
            energyRole: s.energyRole,
          },
        });
      }
      this.logger.log(`Provisioned ${specs.length} tag(s) for meter ${meterNumber} (${templateKey})`);
    } catch (err) {
      this.logger.error(`Meter tag provisioning failed (${meterNumber})`, err as Error);
    }
  }

  private async markDevice(id: string, status: string, lastError: string | null) {
    await this.prisma.device
      .update({ where: { id }, data: { status, lastSeenAt: new Date(), lastError } })
      .catch(() => undefined);
  }

  /** Drain disk buffers periodically when sinks recover. */
  @Interval('buffer-drain', 20_000)
  async drain() {
    await this.ingest.drainBuffers().catch(() => undefined);
  }

  /** Snapshot for the local dashboard. */
  status() {
    return Array.from(this.devices.values()).map((d) => ({
      id: d.id,
      name: d.name,
      connected: d.client.isConnected(),
      tagCount: d.tags.length,
      intervalMs: d.intervalMs,
    }));
  }
}
