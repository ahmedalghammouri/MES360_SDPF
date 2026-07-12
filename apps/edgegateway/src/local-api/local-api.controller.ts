import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, BadRequestException, ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { MqttService } from '../services/mqtt.service';
import { InfluxService } from '../services/influx.service';
import { GatewayContextService } from '../context/gateway-context.service';
import { ModbusPollerService } from '../acquisition/modbus-poller.service';
import { BufferService } from '../acquisition/buffer.service';
import { ModbusLogService } from '../acquisition/modbus-log.service';
import { METER_TEMPLATES, instantiateMeterTags } from '@mes360/industrial-drivers';
import { readConfigFile, writeConfigFile } from '../config/config-store';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * REST API consumed by the gateway's embedded dashboard. `/api/auth/login` is
 * public; everything else requires a shared-JWT Bearer token.
 */
@Controller('api')
export class LocalApiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly influx: InfluxService,
    private readonly ctx: GatewayContextService,
    private readonly poller: ModbusPollerService,
    private readonly buffer: BufferService,
    private readonly mlog: ModbusLogService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('auth/login')
  login(@Body() body: { email?: string; password?: string }) {
    if (!body?.email || !body?.password) throw new BadRequestException('email and password required');
    return this.auth.login(body.email, body.password);
  }

  @UseGuards(JwtAuthGuard)
  @Get('status')
  async status() {
    let dbOk = true;
    try { await this.prisma.$queryRaw`SELECT 1`; } catch { dbOk = false; }
    const mes = await this.checkMesReachable();
    return {
      gatewayId: this.ctx.getGatewayId(),
      factoryId: this.ctx.getFactoryId(),
      ready: this.ctx.isReady(),
      sinks: { db: dbOk, mqtt: this.mqtt.isConnected(), influx: this.influx.isEnabled(), mes },
      devices: this.poller.status(),
      buffers: {
        pgTagValue: this.buffer.size('pg-tagvalue'),
        influx: this.buffer.size('influx'),
        mqtt: this.buffer.size('mqtt'),
      },
    };
  }

  private async checkMesReachable(): Promise<boolean | null> {
    const url = this.config.get<string>('mesPlatformUrl');
    if (!url) return null; // not configured
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: ctrl.signal });
      clearTimeout(t);
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Settings (service connections) ───────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('settings')
  settings() {
    const stored = readConfigFile();
    // Effective values: stored override, else current runtime config.
    return {
      gatewayName: stored.gatewayName ?? this.config.get('gatewayName'),
      factoryCode: stored.factoryCode ?? this.config.get('factoryCode') ?? '',
      databaseUrl: stored.databaseUrl ?? this.config.get('databaseUrl') ?? '',
      mqttBrokerUrl: stored.mqttBrokerUrl ?? this.config.get('mqtt.brokerUrl') ?? '',
      influxUrl: stored.influxUrl ?? this.config.get('influx.url') ?? '',
      influxToken: stored.influxToken ?? this.config.get('influx.token') ?? '',
      influxOrg: stored.influxOrg ?? this.config.get('influx.org') ?? '',
      influxBucket: stored.influxBucket ?? this.config.get('influx.bucket') ?? '',
      mesPlatformUrl: stored.mesPlatformUrl ?? this.config.get('mesPlatformUrl') ?? '',
      defaultPollIntervalMs: stored.defaultPollIntervalMs ?? this.config.get('defaultPollIntervalMs'),
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('settings')
  saveSettings(@Body() b: any) {
    const allowed = [
      'gatewayName', 'factoryCode', 'databaseUrl', 'mqttBrokerUrl',
      'influxUrl', 'influxToken', 'influxOrg', 'influxBucket', 'mesPlatformUrl', 'defaultPollIntervalMs',
    ];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (b[k] !== undefined) patch[k] = b[k];
    writeConfigFile(patch);
    return { ok: true, restartRequired: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('restart')
  restart() {
    // Exit cleanly; NSSM (service) or a dev runner restarts the process so the
    // new settings take effect. Delay so the HTTP response is flushed first.
    setTimeout(() => process.exit(0), 300);
    return { ok: true, restarting: true };
  }

  // ── Hierarchy (for scope binding) ────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('machines')
  machines() {
    const factoryId = this.ctx.getFactoryId();
    return this.prisma.machine.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true },
      select: { id: true, code: true, name: true }, orderBy: { code: 'asc' },
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('lines')
  lines() {
    const factoryId = this.ctx.getFactoryId();
    return this.prisma.productionLine.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true },
      select: { id: true, code: true, name: true }, orderBy: { code: 'asc' },
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('areas')
  areas() {
    const factoryId = this.ctx.getFactoryId();
    return this.prisma.area.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true },
      select: { id: true, code: true, name: true }, orderBy: { code: 'asc' },
    });
  }

  /** Reject a duplicate active COUNTER role on the same machine (prevents double-counting). */
  private async assertCounterRoleUnique(factoryId: string, machineId: string | null, counterRole: string | null | undefined, tagType: string | undefined, excludeId?: string) {
    if (tagType !== 'COUNTER' || !machineId || !counterRole || !['GOOD', 'BAD', 'TOTAL'].includes(counterRole)) return;
    const clash = await this.prisma.tagDefinition.findFirst({
      where: { factoryId, machineId, counterRole: counterRole as any, isActive: true, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { code: true },
    });
    if (clash) throw new ConflictException(`This machine already has a ${counterRole} counter tag (${clash.code}).`);
  }

  /** Derive areaId (and lineId) from the chosen scope so devices/tags/meters
   *  roll up consistently machine → line → area. */
  private async resolveScope(b: { machineId?: string | null; lineId?: string | null; areaId?: string | null }) {
    let machineId = b.machineId ?? null;
    let lineId = b.lineId ?? null;
    let areaId = b.areaId ?? null;
    if (!areaId) {
      if (machineId) {
        const m = await this.prisma.machine.findUnique({ where: { id: machineId }, select: { lineId: true, areaId: true } });
        if (m) { areaId = m.areaId ?? null; if (!lineId) lineId = m.lineId ?? null; }
      } else if (lineId) {
        const l = await this.prisma.productionLine.findUnique({ where: { id: lineId }, select: { areaId: true } });
        if (l) areaId = l.areaId ?? null;
      }
    }
    return { machineId, lineId, areaId };
  }

  // ── Energy meters ────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('meter-templates')
  meterTemplates() {
    return METER_TEMPLATES.map((t) => ({ key: t.key, label: t.label, manufacturer: t.manufacturer, models: t.models, tagCount: t.tags.length }));
  }

  @UseGuards(JwtAuthGuard)
  @Get('meters')
  async meters() {
    const factoryId = this.ctx.getFactoryId();
    return this.prisma.energyMeter.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true },
      include: {
        device: { select: { id: true, deviceCode: true, protocol: true, status: true } },
        _count: { select: { tags: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  /** Create a meter + its Modbus device (linked) in one step, optionally applying a template. */
  @UseGuards(JwtAuthGuard)
  @Post('meters')
  async createMeter(@Body() b: any) {
    if (!b?.meterNumber || !b?.name) throw new BadRequestException('meterNumber and name required');
    const factoryId = this.ctx.getFactoryId();
    if (!factoryId) throw new BadRequestException('Gateway not bound to a factory yet');
    const scope = await this.resolveScope(b);

    const device = await this.prisma.device.create({
      data: {
        factoryId,
        gatewayId: this.ctx.getGatewayId(),
        name: `${b.name} (meter)`,
        deviceCode: `${b.meterNumber}-DEV`,
        type: 'METER',
        protocol: b.protocol ?? 'MODBUS',
        ipAddress: b.ipAddress ?? null,
        port: b.port ?? 502,
        unitId: b.unitId ?? 1,
        serialPort: b.serialPort ?? null,
        baudRate: b.baudRate ?? null,
        parity: b.parity ?? null,
        dataBits: b.dataBits ?? null,
        stopBits: b.stopBits ?? null,
        pollIntervalMs: b.pollIntervalMs ?? null,
        machineId: scope.machineId,
        lineId: scope.lineId,
        areaId: scope.areaId,
        status: 'DISCONNECTED',
      },
    });

    const meter = await this.prisma.energyMeter.create({
      data: {
        factoryId,
        deviceId: device.id,
        machineId: scope.machineId,
        lineId: scope.lineId,
        areaId: scope.areaId,
        meterNumber: b.meterNumber,
        name: b.name,
        type: b.type ?? 'ELECTRICAL',
        unit: b.unit ?? 'kWh',
        manufacturer: b.manufacturer ?? null,
        model: b.model ?? null,
        templateKey: b.templateKey ?? null,
        location: b.location ?? null,
      },
    });
    if (b.templateKey) await this.applyTemplateTags(meter.id, b.meterNumber, factoryId, device.id, b.templateKey, b.machineId ?? null);
    return meter;
  }

  @UseGuards(JwtAuthGuard)
  @Post('meters/:id/apply-template')
  async applyTemplate(@Param('id') id: string, @Body() b: { templateKey: string }) {
    const meter = await this.prisma.energyMeter.findUnique({ where: { id } });
    if (!meter) throw new BadRequestException('Meter not found');
    if (!b?.templateKey) throw new BadRequestException('templateKey required');
    const created = await this.applyTemplateTags(meter.id, meter.meterNumber, meter.factoryId, meter.deviceId, b.templateKey, meter.machineId);
    await this.prisma.energyMeter.update({ where: { id }, data: { templateKey: b.templateKey } });
    return { ok: true, created };
  }

  private async applyTemplateTags(meterId: string, meterNumber: string, factoryId: string, deviceId: string | null, templateKey: string, machineId: string | null) {
    const specs = instantiateMeterTags(templateKey, meterNumber);
    let created = 0;
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
      created++;
    }
    return created;
  }

  // ── Devices ──────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('devices')
  async devices() {
    const gatewayId = this.ctx.getGatewayId();
    return this.prisma.device.findMany({
      where: { ...(gatewayId ? { gatewayId } : {}), isActive: true },
      include: { machine: { select: { id: true, code: true, name: true } }, tagDefinitions: { where: { isActive: true } } },
      orderBy: { name: 'asc' },
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('devices')
  async createDevice(@Body() b: any) {
    if (!b?.name || !b?.deviceCode) throw new BadRequestException('name and deviceCode required');
    const factoryId = this.ctx.getFactoryId();
    if (!factoryId) throw new BadRequestException('Gateway not bound to a factory yet');
    const scope = await this.resolveScope(b);
    return this.prisma.device.create({
      data: {
        factoryId,
        gatewayId: this.ctx.getGatewayId(),
        name: b.name,
        deviceCode: b.deviceCode,
        type: b.type ?? 'PLC',
        protocol: b.protocol ?? 'MODBUS',
        ipAddress: b.ipAddress ?? null,
        port: b.port ?? 502,
        unitId: b.unitId ?? 1,
        serialPort: b.serialPort ?? null,
        baudRate: b.baudRate ?? null,
        parity: b.parity ?? null,
        dataBits: b.dataBits ?? null,
        stopBits: b.stopBits ?? null,
        pollIntervalMs: b.pollIntervalMs ?? null,
        machineId: scope.machineId,
        lineId: scope.lineId,
        areaId: scope.areaId,
        status: 'DISCONNECTED',
      },
    });
  }

  @UseGuards(JwtAuthGuard)
  @Patch('devices/:id')
  updateDevice(@Param('id') id: string, @Body() b: any) {
    return this.prisma.device.update({
      where: { id },
      data: {
        ...(b.name !== undefined && { name: b.name }),
        ...(b.protocol !== undefined && { protocol: b.protocol }),
        ...(b.ipAddress !== undefined && { ipAddress: b.ipAddress }),
        ...(b.port !== undefined && { port: b.port }),
        ...(b.unitId !== undefined && { unitId: b.unitId }),
        ...(b.serialPort !== undefined && { serialPort: b.serialPort }),
        ...(b.baudRate !== undefined && { baudRate: b.baudRate }),
        ...(b.parity !== undefined && { parity: b.parity }),
        ...(b.dataBits !== undefined && { dataBits: b.dataBits }),
        ...(b.stopBits !== undefined && { stopBits: b.stopBits }),
        ...(b.pollIntervalMs !== undefined && { pollIntervalMs: b.pollIntervalMs }),
        ...(b.machineId !== undefined && { machineId: b.machineId }),
        ...(b.lineId !== undefined && { lineId: b.lineId }),
        ...(b.areaId !== undefined && { areaId: b.areaId }),
        ...(b.isActive !== undefined && { isActive: b.isActive }),
      },
    });
  }

  // ── Tags ─────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('tags')
  tags(@Query('deviceId') deviceId?: string, @Query('meterId') meterId?: string) {
    const factoryId = this.ctx.getFactoryId();
    return this.prisma.tagDefinition.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(deviceId ? { deviceId } : {}),
        ...(meterId ? { meterId } : {}),
        isActive: true,
      },
      include: { currentValue: true, machine: { select: { code: true } } },
      orderBy: { name: 'asc' },
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('tags')
  async createTag(@Body() b: any) {
    if (!b?.code || !b?.name) throw new BadRequestException('code and name required');
    const factoryId = this.ctx.getFactoryId();
    if (!factoryId) throw new BadRequestException('Gateway not bound to a factory yet');
    await this.assertCounterRoleUnique(factoryId, b.machineId ?? null, b.counterRole, b.tagType);
    const scope = await this.resolveScope(b);
    return this.prisma.tagDefinition.create({
      data: {
        factoryId,
        code: b.code,
        name: b.name,
        dataType: b.dataType ?? 'INT',
        tagType: b.tagType ?? 'MEASUREMENT',
        unit: b.unit ?? null,
        deviceId: b.deviceId ?? null,
        machineId: scope.machineId,
        lineId: scope.lineId,
        areaId: scope.areaId,
        meterId: b.meterId ?? null,
        energyRole: b.energyRole ?? null,
        address: b.address ?? null,
        registerType: b.registerType ?? 'HOLDING',
        wordCount: b.wordCount ?? 1,
        wordOrder: b.wordOrder ?? 'BIG',
        scaleFactor: b.scaleFactor ?? null,
        offset: b.offset ?? null,
        counterRole: b.counterRole ?? null,
        edgeType: b.edgeType ?? 'RISING',
        pollIntervalMs: b.pollIntervalMs ?? null,
      },
    });
  }

  @UseGuards(JwtAuthGuard)
  @Patch('tags/:id')
  async updateTag(@Param('id') id: string, @Body() b: any) {
    const existing = await this.prisma.tagDefinition.findUnique({ where: { id }, select: { factoryId: true, machineId: true, counterRole: true, tagType: true } });
    if (existing) {
      const effMachineId = b.machineId !== undefined ? b.machineId : existing.machineId;
      const effRole = b.counterRole !== undefined ? b.counterRole : existing.counterRole;
      const effType = b.tagType !== undefined ? b.tagType : existing.tagType;
      await this.assertCounterRoleUnique(existing.factoryId, effMachineId, effRole, effType, id);
    }
    const allowed = [
      'name', 'unit', 'dataType', 'tagType', 'machineId', 'lineId', 'areaId', 'deviceId', 'address', 'registerType',
      'wordCount', 'wordOrder', 'scaleFactor', 'offset', 'counterRole', 'edgeType', 'pollIntervalMs', 'isActive',
    ];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (b[k] !== undefined) data[k] = b[k];
    return this.prisma.tagDefinition.update({ where: { id }, data });
  }

  @UseGuards(JwtAuthGuard)
  @Delete('tags/:id')
  async deleteTag(@Param('id') id: string) {
    await this.prisma.tagDefinition.update({ where: { id }, data: { isActive: false } });
    return { ok: true };
  }

  // ── Live values & job orders (for monitoring + counter mapping) ──
  @UseGuards(JwtAuthGuard)
  @Get('live')
  async live() {
    const factoryId = this.ctx.getFactoryId();
    return this.prisma.tagCurrentValue.findMany({
      where: factoryId ? { factoryId } : {},
      include: { tag: { select: { code: true, name: true, unit: true, tagType: true, counterRole: true } } },
      orderBy: { timestamp: 'desc' },
      take: 200,
    });
  }

  /** Tail of the Modbus error log (timeouts, CRC/port errors) for the dashboard. */
  @UseGuards(JwtAuthGuard)
  @Get('logs/modbus')
  modbusLog(@Query('lines') lines?: string) {
    const n = Math.min(Math.max(parseInt(lines ?? '200', 10) || 200, 1), 1000);
    return { path: this.mlog.path(), lines: this.mlog.tail(n) };
  }

  @UseGuards(JwtAuthGuard)
  @Get('job-orders')
  async jobOrders() {
    const factoryId = this.ctx.getFactoryId();
    return this.prisma.jobOrder.findMany({
      where: { ...(factoryId ? { factoryId } : {}), status: 'EXECUTING' },
      select: {
        id: true, operationName: true, machineId: true,
        actualQtyGood: true, actualQtyRejected: true,
        machine: { select: { code: true, name: true } },
        workOrder: { select: { orderNumber: true } },
      },
      orderBy: { actualStart: 'desc' },
      take: 100,
    });
  }
}
