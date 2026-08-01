import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { Prisma, DowntimeCategory, DowntimeReasonCode } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { toBaseUnits, convertUnits } from '../../common/units.util';
import { plantWallClockToUtc } from '../../common/plant-time.util';
import { KpiService } from '../production/kpi.service';
import {
  CreateShiftTemplateDto, UpdateShiftTemplateDto, GenerateInstancesDto,
  ListInstancesQueryDto, StartShiftDto, CompleteShiftDto,
  GeneratePlannedDowntimeDto, ListPlannedDowntimeQueryDto,
  AddPlannedDowntimeDto, PlannedDowntimeScope,
} from './dto/shift.dto';

@Injectable()
export class ShiftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kpi: KpiService,
  ) {}

  private requireFactory(factoryId: string | null): string {
    if (!factoryId) {
      throw new BadRequestException('A factory context is required for shift configuration.');
    }
    return factoryId;
  }

  /** A shift crosses midnight when its end time is at or before its start time. */
  private crossesMidnight(startTime: string, endTime: string): boolean {
    return endTime <= startTime;
  }

  /** Planned production minutes = duration − breaks − cleaning (OEE availability denominator). */
  private plannedProductionMinutes(t: {
    shiftDurationHours: number; breakMinutes: number; cleaningMinutes: number;
  }): number {
    return Math.max(0, t.shiftDurationHours * 60 - t.breakMinutes - t.cleaningMinutes);
  }

  /** Combine a calendar date with an HH:mm time, optionally shifting by whole days (UTC-stable). */
  /**
   * Shift template times ("07:30") are PLANT-local. This used to build them with
   * Date.UTC(...), storing 07:30 UTC — 10:30 at a +03 plant — so every shift
   * instance, and every break/cleaning event derived from it, sat 3 hours late.
   */
  private combine(date: Date, hhmm: string, dayOffset = 0): Date {
    return plantWallClockToUtc(date, hhmm, dayOffset);
  }

  // ────────────────────────────────────────────────────────────
  // TEMPLATES
  // ────────────────────────────────────────────────────────────

  async listTemplates(factoryId: string | null, includeInactive = false) {
    const fid = this.requireFactory(factoryId);
    const templates = await this.prisma.shiftTemplate.findMany({
      where: { factoryId: fid, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ isActive: 'desc' }, { startTime: 'asc' }],
      include: { _count: { select: { instances: true } } },
    });
    return templates.map((t) => this.decorateTemplate(t));
  }

  async getTemplate(factoryId: string | null, id: string) {
    const fid = this.requireFactory(factoryId);
    const t = await this.prisma.shiftTemplate.findFirst({
      where: { id, factoryId: fid },
      include: { _count: { select: { instances: true } } },
    });
    if (!t) throw new NotFoundException('Shift template not found');
    return this.decorateTemplate(t);
  }

  private decorateTemplate(t: Prisma.ShiftTemplateGetPayload<{ include: { _count: { select: { instances: true } } } }>) {
    return {
      ...t,
      plannedProductionMinutes: this.plannedProductionMinutes(t),
      instanceCount: t._count.instances,
    };
  }

  async createTemplate(factoryId: string | null, dto: CreateShiftTemplateDto) {
    const fid = this.requireFactory(factoryId);

    const exists = await this.prisma.shiftTemplate.findUnique({
      where: { factoryId_code: { factoryId: fid, code: dto.code } },
    });
    if (exists) throw new ConflictException(`Shift code "${dto.code}" already exists for this factory`);

    if (dto.plannedProductionHours > dto.shiftDurationHours) {
      throw new BadRequestException('Planned production hours cannot exceed shift duration');
    }

    const created = await this.prisma.shiftTemplate.create({
      data: {
        factoryId: fid,
        code: dto.code,
        name: dto.name,
        nameAr: dto.nameAr ?? null,
        startTime: dto.startTime,
        endTime: dto.endTime,
        crossesMidnight: this.crossesMidnight(dto.startTime, dto.endTime),
        shiftDurationHours: dto.shiftDurationHours,
        plannedProductionHours: dto.plannedProductionHours,
        breakMinutes: dto.breakMinutes ?? 0,
        cleaningMinutes: dto.cleaningMinutes ?? 0,
        days: dto.days,
        targetQtyPerShift: dto.targetQtyPerShift ?? null,
        targetUnit: dto.targetUnit ?? 'CARTON',
        isActive: dto.isActive ?? true,
      },
      include: { _count: { select: { instances: true } } },
    });
    return this.decorateTemplate(created);
  }

  async updateTemplate(factoryId: string | null, id: string, dto: UpdateShiftTemplateDto) {
    const fid = this.requireFactory(factoryId);
    const current = await this.prisma.shiftTemplate.findFirst({ where: { id, factoryId: fid } });
    if (!current) throw new NotFoundException('Shift template not found');

    if (dto.code && dto.code !== current.code) {
      const clash = await this.prisma.shiftTemplate.findUnique({
        where: { factoryId_code: { factoryId: fid, code: dto.code } },
      });
      if (clash) throw new ConflictException(`Shift code "${dto.code}" already exists`);
    }

    const startTime = dto.startTime ?? current.startTime;
    const endTime = dto.endTime ?? current.endTime;
    const shiftDurationHours = dto.shiftDurationHours ?? current.shiftDurationHours;
    const plannedProductionHours = dto.plannedProductionHours ?? current.plannedProductionHours;
    if (plannedProductionHours > shiftDurationHours) {
      throw new BadRequestException('Planned production hours cannot exceed shift duration');
    }

    const updated = await this.prisma.shiftTemplate.update({
      where: { id },
      data: {
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.nameAr !== undefined && { nameAr: dto.nameAr }),
        startTime,
        endTime,
        crossesMidnight: this.crossesMidnight(startTime, endTime),
        shiftDurationHours,
        plannedProductionHours,
        ...(dto.breakMinutes !== undefined && { breakMinutes: dto.breakMinutes }),
        ...(dto.cleaningMinutes !== undefined && { cleaningMinutes: dto.cleaningMinutes }),
        ...(dto.days !== undefined && { days: dto.days }),
        ...(dto.targetQtyPerShift !== undefined && { targetQtyPerShift: dto.targetQtyPerShift }),
        ...(dto.targetUnit !== undefined && { targetUnit: dto.targetUnit }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: { _count: { select: { instances: true } } },
    });
    return this.decorateTemplate(updated);
  }

  async deleteTemplate(factoryId: string | null, id: string) {
    const fid = this.requireFactory(factoryId);
    const t = await this.prisma.shiftTemplate.findFirst({
      where: { id, factoryId: fid },
      include: { _count: { select: { instances: true } } },
    });
    if (!t) throw new NotFoundException('Shift template not found');

    // Preserve history: deactivate templates that already have instances; hard-delete unused ones.
    if (t._count.instances > 0) {
      await this.prisma.shiftTemplate.update({ where: { id }, data: { isActive: false } });
      return { id, deactivated: true, reason: 'Template has shift history and was deactivated instead of deleted' };
    }
    await this.prisma.shiftTemplate.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ────────────────────────────────────────────────────────────
  // INSTANCES
  // ────────────────────────────────────────────────────────────

  /** Materialise daily shift instances for a date range from active templates. Idempotent. */
  async generateInstances(factoryId: string | null, dto: GenerateInstancesDto) {
    const fid = this.requireFactory(factoryId);

    const from = new Date(`${dto.dateFrom}T00:00:00.000Z`);
    const to = dto.dateTo ? new Date(`${dto.dateTo}T00:00:00.000Z`) : from;
    if (to < from) throw new BadRequestException('dateTo must be on or after dateFrom');

    const templates = await this.prisma.shiftTemplate.findMany({
      where: {
        factoryId: fid,
        isActive: true,
        ...(dto.templateIds?.length ? { id: { in: dto.templateIds } } : {}),
      },
    });
    if (templates.length === 0) throw new BadRequestException('No active shift templates to generate from');

    let created = 0;
    let skipped = 0;
    const totalDays = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;

    for (let i = 0; i < totalDays; i++) {
      const day = new Date(from.getTime() + i * 86_400_000);
      const weekday = day.getUTCDay(); // 0=Sun … 6=Sat

      for (const t of templates) {
        const workingDays = (t.days as number[]) ?? [];
        if (!workingDays.includes(weekday)) continue;

        const exists = await this.prisma.shiftInstance.findFirst({
          where: {
            factoryId: fid,
            shiftTemplateId: t.id,
            shiftDate: day,
            lineId: dto.lineId ?? null,
          },
          select: { id: true },
        });
        if (exists) { skipped++; continue; }

        await this.prisma.shiftInstance.create({
          data: {
            factoryId: fid,
            shiftTemplateId: t.id,
            lineId: dto.lineId ?? null,
            shiftDate: day,
            startTime: this.combine(day, t.startTime),
            endTime: this.combine(day, t.endTime, t.crossesMidnight ? 1 : 0),
            targetQty: t.targetQtyPerShift ?? null,
            plannedDowntime: t.breakMinutes + t.cleaningMinutes,
            status: 'PLANNED',
          },
        });
        created++;
      }
    }

    let plannedDowntime: Awaited<ReturnType<ShiftService['generatePlannedDowntime']>> | undefined;
    if (dto.withPlannedDowntime) {
      plannedDowntime = await this.generatePlannedDowntime(fid, {
        dateFrom: dto.dateFrom, dateTo: dto.dateTo, templateIds: dto.templateIds,
      });
    }

    return { created, skipped, days: totalDays, templates: templates.length, plannedDowntime };
  }

  async listInstances(factoryId: string | null, query: ListInstancesQueryDto) {
    const fid = this.requireFactory(factoryId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const where: Prisma.ShiftInstanceWhereInput = {
      factoryId: fid,
      ...(query.status && { status: query.status }),
      ...(query.templateId && { shiftTemplateId: query.templateId }),
      ...(query.lineId && { lineId: query.lineId }),
      ...((query.dateFrom || query.dateTo) && {
        shiftDate: {
          ...(query.dateFrom && { gte: new Date(`${query.dateFrom}T00:00:00.000Z`) }),
          ...(query.dateTo && { lte: new Date(`${query.dateTo}T23:59:59.999Z`) }),
        },
      }),
    };

    const [total, data] = await Promise.all([
      this.prisma.shiftInstance.count({ where }),
      this.prisma.shiftInstance.findMany({
        where,
        include: {
          shiftTemplate: { select: { code: true, name: true, nameAr: true } },
          line: { select: { name: true, code: true } },
          operator: { select: { name: true } },
          supervisor: { select: { name: true } },
        },
        orderBy: [{ shiftDate: 'desc' }, { startTime: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async startShift(factoryId: string | null, id: string, dto: StartShiftDto) {
    const fid = this.requireFactory(factoryId);
    const inst = await this.prisma.shiftInstance.findFirst({ where: { id, factoryId: fid } });
    if (!inst) throw new NotFoundException('Shift instance not found');
    if (inst.status === 'COMPLETED') throw new BadRequestException('Shift already completed');

    return this.prisma.shiftInstance.update({
      where: { id },
      data: {
        status: 'IN_PROGRESS',
        startTime: new Date(),
        ...(dto.operatorId && { operatorId: dto.operatorId }),
        ...(dto.supervisorId && { supervisorId: dto.supervisorId }),
      },
    });
  }

  async completeShift(factoryId: string | null, id: string, dto: CompleteShiftDto) {
    const fid = this.requireFactory(factoryId);
    const inst = await this.prisma.shiftInstance.findFirst({
      where: { id, factoryId: fid },
      include: { shiftTemplate: true },
    });
    if (!inst) throw new NotFoundException('Shift instance not found');

    const actualQty = dto.actualQty ?? inst.actualQty;
    const goodQty = dto.goodQty ?? inst.goodQty;
    const scrapQty = dto.scrapQty ?? inst.scrapQty;

    // OEE from the configured planned production window (breaks/cleaning already excluded)
    const plannedMin = this.plannedProductionMinutes(inst.shiftTemplate);
    const runMin = Math.max(0, plannedMin - inst.downtimeMinutes);
    const availability = plannedMin > 0 ? (runMin / plannedMin) * 100 : 0;
    const performance = inst.targetQty && inst.targetQty > 0 ? Math.min(100, (actualQty / inst.targetQty) * 100) : 0;
    const quality = actualQty > 0 ? (goodQty / actualQty) * 100 : 0;
    const oee = (availability / 100) * (performance / 100) * (quality / 100) * 100;
    const round1 = (n: number) => Math.round(n * 10) / 10;

    return this.prisma.shiftInstance.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        endTime: new Date(),
        actualQty,
        goodQty,
        scrapQty,
        availability: round1(availability),
        performance: round1(performance),
        quality: round1(quality),
        oee: round1(oee),
        ...(dto.handoverNotes !== undefined && { handoverNotes: dto.handoverNotes }),
      },
    });
  }

  /** The shift instance currently in progress (or most recent today). Drives the live dashboard. */
  async getCurrent(factoryId: string | null) {
    const fid = this.requireFactory(factoryId);
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    const active = await this.prisma.shiftInstance.findFirst({
      where: { factoryId: fid, status: 'IN_PROGRESS' },
      include: {
        shiftTemplate: true,
        operator: { select: { name: true } },
        supervisor: { select: { name: true } },
      },
      orderBy: { startTime: 'desc' },
    });
    if (active) return active;

    return this.prisma.shiftInstance.findFirst({
      where: { factoryId: fid, shiftDate: { gte: dayStart } },
      include: {
        shiftTemplate: true,
        operator: { select: { name: true } },
        supervisor: { select: { name: true } },
      },
      orderBy: { startTime: 'asc' },
    });
  }

  /**
   * Live status of the shift in progress NOW, computed from the templates' clock
   * windows (works even when no ShiftInstance has been generated). Drives the
   * shop-floor shift progress bar: window, elapsed/remaining, time progress.
   */
  async getCurrentShiftStatus(factoryId: string | null) {
    const fid = this.requireFactory(factoryId);
    const templates = await this.prisma.shiftTemplate.findMany({
      where: { factoryId: fid, isActive: true },
      orderBy: { startTime: 'asc' },
    });
    if (templates.length === 0) return { active: null, shiftsPerDay: 0 };

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const parse = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
    const inWindow = (t: (typeof templates)[number]) => {
      const s = parse(t.startTime), e = parse(t.endTime);
      return t.crossesMidnight ? nowMin >= s || nowMin < e : nowMin >= s && nowMin < e;
    };

    const active = templates.find(inWindow) ?? templates[0];
    const s = parse(active.startTime), e = parse(active.endTime);

    // Concrete start datetime for the running shift (handles overnight shifts).
    const startDt = new Date(now);
    startDt.setHours(Math.floor(s / 60), s % 60, 0, 0);
    if (active.crossesMidnight && nowMin < e) startDt.setDate(startDt.getDate() - 1);
    else if (nowMin < s) startDt.setDate(startDt.getDate() - 1); // shift hasn't started today yet → previous occurrence

    const totalMin = active.shiftDurationHours * 60;
    const endDt = new Date(startDt.getTime() + totalMin * 60_000);
    const elapsedMin = Math.max(0, Math.min(totalMin, (now.getTime() - startDt.getTime()) / 60_000));
    const remainingMin = Math.max(0, totalMin - elapsedMin);

    return {
      active: {
        id: active.id, code: active.code, name: active.name, nameAr: active.nameAr,
        startTime: active.startTime, endTime: active.endTime,
        window: `${active.startTime}–${active.endTime}`,
        crossesMidnight: active.crossesMidnight,
        plannedProductionHours: active.plannedProductionHours,
        shiftDurationHours: active.shiftDurationHours,
        breakMinutes: active.breakMinutes, cleaningMinutes: active.cleaningMinutes,
        targetQtyPerShift: active.targetQtyPerShift,
        targetUnit: active.targetUnit ?? 'CARTON',
      },
      shiftStart: startDt.toISOString(),
      shiftEnd: endDt.toISOString(),
      now: now.toISOString(),
      elapsedMin: Math.round(elapsedMin),
      remainingMin: Math.round(remainingMin),
      totalMin,
      timeProgressPct: totalMin > 0 ? Math.round((elapsedMin / totalMin) * 1000) / 10 : 0,
      isActiveNow: inWindow(active),
      shiftsPerDay: templates.length,
    };
  }

  /**
   * Shift data analysis — aggregates the CURRENT shift window across the factory:
   * production (good/scrap from recorded COUNT_UPDATE events), quality, downtime,
   * and a per-machine breakdown (output, scrap, downtime, live state, OEE). All
   * from real operational data, scoped to the shift's start→now window.
   */
  async getShiftAnalysis(factoryId: string | null) {
    const fid = this.requireFactory(factoryId);
    const status = await this.getCurrentShiftStatus(factoryId);
    if (!status.active) {
      return { status, totals: null, machines: [], downtime: { totalMins: 0, occurrences: 0, byReason: [] } };
    }

    const from = new Date(status.shiftStart);
    const to = new Date(status.now);

    const [events, downtimeEvents, machines, oeeRecords, activeJos] = await Promise.all([
      this.prisma.productionEvent.findMany({
        where: { factoryId: fid, eventType: 'COUNT_UPDATE', timestamp: { gte: from, lte: to } },
        select: { machineId: true, metadata: true },
      }),
      this.prisma.downtimeEvent.findMany({
        where: { factoryId: fid, startTime: { lte: to }, OR: [{ endTime: null }, { endTime: { gte: from } }] },
        select: {
          machineId: true, startTime: true, endTime: true, isPlanned: true,
          reasonCode: true, reason: true, cause: { select: { name: true } },
        },
      }),
      this.prisma.machine.findMany({
        where: { factoryId: fid, isActive: true },
        select: {
          id: true, name: true, code: true,
          currentStatus: { select: { state: true, oee: true, availability: true, performance: true, quality: true } },
        },
        orderBy: { sortOrder: 'asc' },
      }),
      // Per-machine OEE fallback — from the fact store (final-step per machine) when
      // enabled, else the legacy per-machine OEERecord rows.
      this.kpi.snapshotsEnabled()
        ? this.kpi.snapshotAggregate(fid, new Date(from.getFullYear(), from.getMonth(), from.getDate()), to, undefined)
            .then((a) => a.byEquipment.map((e) => ({ machineId: e.machineId, oee: e.oee, availability: e.availability, performance: e.performance, quality: e.quality })))
        : this.prisma.oEERecord.findMany({
            where: { factoryId: fid, recordDate: { gte: new Date(from.getFullYear(), from.getMonth(), from.getDate()) } },
            select: { machineId: true, oee: true, availability: true, performance: true, quality: true },
          }),
      // Active job orders give each machine its output UNIT + product packaging, so
      // production can be normalised to the base unit before aggregating.
      this.prisma.jobOrder.findMany({
        where: { factoryId: fid, status: { in: ['EXECUTING', 'PAUSED', 'COMPLETE'] }, machineId: { not: null }, actualStart: { not: null } },
        select: {
          machineId: true, workOrderId: true, sequenceOrder: true, outputUnit: true,
          workOrder: { select: { sku: { select: { baseUnit: true, unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true, name: true } } } },
        },
      }),
    ]);

    // ── Unit-aware production: each step records output in its own packaging unit
    // (inners → cartons → pallets), so we convert to base units. To avoid double
    // counting the SAME material as it flows through the line, the shift "finished
    // output" is taken from the TERMINAL step of each work order; scrap is summed
    // across all steps (every reject is a real loss). ──
    const joByMachine = new Map<string, any>();
    const maxSeqByWO = new Map<string, number>();
    const minSeqByWO = new Map<string, number>();
    for (const jo of activeJos) {
      if (!jo.machineId) continue;
      // keep the latest-sequence JO per machine (the step it's running now)
      const prev = joByMachine.get(jo.machineId);
      if (!prev || jo.sequenceOrder > prev.sequenceOrder) joByMachine.set(jo.machineId, jo);
      maxSeqByWO.set(jo.workOrderId, Math.max(maxSeqByWO.get(jo.workOrderId) ?? 0, jo.sequenceOrder));
      minSeqByWO.set(jo.workOrderId, Math.min(minSeqByWO.get(jo.workOrderId) ?? jo.sequenceOrder, jo.sequenceOrder));
    }

    // Per-machine production from recorded count deltas (in the machine's own unit)
    const prodByMachine = new Map<string, { good: number; scrap: number }>();
    for (const ev of events) {
      const meta = (ev.metadata ?? {}) as any;
      if (!ev.machineId) continue;
      const cur = prodByMachine.get(ev.machineId) ?? { good: 0, scrap: 0 };
      cur.good += meta.goodDelta ?? 0;
      cur.scrap += meta.scrapDelta ?? 0;
      prodByMachine.set(ev.machineId, cur);
    }

    // Resolve the shift's base unit from the products in play (single product → its
    // base unit; otherwise fall back to base pieces).
    const baseUnits = new Set(activeJos.map((j) => j.workOrder?.sku?.baseUnit ?? 'EA'));
    const shiftBaseUnit = baseUnits.size === 1 ? [...baseUnits][0] : 'EA';

    // Per-machine downtime (clamped to the shift window) + reason tally
    const clamp = (s: Date, e: Date | null) => {
      const a = Math.max(s.getTime(), from.getTime());
      const b = Math.min((e ?? to).getTime(), to.getTime());
      return Math.max(0, (b - a) / 60_000);
    };
    const downByMachine = new Map<string, number>();
    const reasonTally = new Map<string, { label: string; mins: number; count: number }>();
    let totalDownMins = 0; let plannedDownMins = 0;
    for (const ev of downtimeEvents) {
      const mins = clamp(ev.startTime, ev.endTime);
      if (mins <= 0) continue;
      totalDownMins += mins;
      if (ev.isPlanned) plannedDownMins += mins;
      if (ev.machineId) downByMachine.set(ev.machineId, (downByMachine.get(ev.machineId) ?? 0) + mins);
      const key = ev.cause?.name ?? ev.reason ?? ev.reasonCode ?? 'Unspecified';
      const r = reasonTally.get(key) ?? { label: key, mins: 0, count: 0 };
      r.mins += mins; r.count += 1; reasonTally.set(key, r);
    }

    const oeeByMachine = new Map<string, number>();
    for (const o of oeeRecords) {
      // latest wins (records are per day) — keep max recordDate implicitly via last
      oeeByMachine.set(o.machineId, o.oee);
    }

    // The shift target is defined in a chosen unit (PIECE/INNER/CARTON/PALLET);
    // express finished output + scrap in that SAME unit so the comparison is direct.
    const targetQty = status.active.targetQtyPerShift ?? null;
    const targetUnit = (status.active as any).targetUnit ?? shiftBaseUnit;

    let finishedGoodTarget = 0; // finished output (terminal steps) in target unit
    let startedGoodTarget = 0;  // input/started output (lead step) in target unit
    let totalScrapTarget = 0;   // all rejects across steps in target unit

    const machineRows = machines.map((m) => {
      const p = prodByMachine.get(m.id) ?? { good: 0, scrap: 0 };
      const jo = joByMachine.get(m.id);
      const unit = jo?.outputUnit ?? null;
      const sku = jo?.workOrder?.sku ?? null;
      const isTerminal = jo ? jo.sequenceOrder >= (maxSeqByWO.get(jo.workOrderId) ?? jo.sequenceOrder) : false;
      const isLead = jo ? jo.sequenceOrder <= (minSeqByWO.get(jo.workOrderId) ?? jo.sequenceOrder) : false;
      // Convert this step's output to the target unit (and to base, for reference)
      const goodTarget = sku && unit ? convertUnits(p.good, unit, targetUnit, sku) : p.good;
      const scrapTarget = sku && unit ? convertUnits(p.scrap, unit, targetUnit, sku) : p.scrap;
      const goodBase = sku ? toBaseUnits(p.good, unit, sku) : p.good;
      if (isTerminal) finishedGoodTarget += goodTarget;
      if (isLead) startedGoodTarget += goodTarget;
      totalScrapTarget += scrapTarget;
      const total = p.good + p.scrap;
      // This step's shift target, converted from the target unit to the step's own
      // output unit via the packaging relationship.
      const stepTarget = targetQty != null && sku && unit
        ? Math.round(convertUnits(targetQty, targetUnit, unit, sku))
        : targetQty;
      return {
        id: m.id, name: m.name, code: m.code,
        state: m.currentStatus?.state ?? 'OFFLINE',
        good: Math.round(p.good), scrap: Math.round(p.scrap),
        unit,                              // the machine's own packaging unit
        goodBase: Math.round(goodBase),    // equivalent in the product base unit
        isTerminal,                        // true = finished-goods step of its WO
        isLead,                            // true = first/input step of its WO
        shiftTarget: stepTarget,           // shift target in THIS step's unit
        shiftTargetPct: stepTarget ? Math.round((p.good / stepTarget) * 1000) / 10 : null,
        quality: total > 0 ? Math.round((p.good / total) * 1000) / 10 : null,
        downtimeMins: Math.round((downByMachine.get(m.id) ?? 0) * 10) / 10,
        oee: m.currentStatus?.oee ?? oeeByMachine.get(m.id) ?? null,
      };
    }).sort((a, b) => b.goodBase - a.goodBase);

    const finishedGood = Math.round(finishedGoodTarget);
    const startedGood = Math.round(startedGoodTarget);
    const inProcess = Math.max(0, startedGood - finishedGood); // entered the line, not yet finished
    const scrapTarget = Math.round(totalScrapTarget);
    const grand = finishedGood + scrapTarget;
    const target = targetQty;
    const runningMachines = machineRows.filter((m) => m.state === 'RUNNING').length;

    return {
      status,
      totals: {
        // finished output + scrap expressed in the shift TARGET unit
        good: finishedGood,
        started: startedGood,   // units that entered the line this shift (lead step)
        inProcess,              // started − finished = work-in-process on the line
        scrap: scrapTarget,
        total: grand,
        unit: targetUnit,
        quality: grand > 0 ? Math.round((finishedGood / grand) * 1000) / 10 : null,
        target,
        targetProgressPct: target ? Math.round((finishedGood / target) * 1000) / 10 : null,
        runningMachines,
        totalMachines: machineRows.length,
        downtimeMins: Math.round(totalDownMins * 10) / 10,
        plannedDownMins: Math.round(plannedDownMins * 10) / 10,
        unplannedDownMins: Math.round((totalDownMins - plannedDownMins) * 10) / 10,
        // pace vs the time elapsed in the shift (finished base units / hr)
        paceGoodPerHr: status.elapsedMin > 0 ? Math.round((finishedGood / status.elapsedMin) * 60) : null,
        projectedGood: status.elapsedMin > 0 ? Math.round((finishedGood / status.elapsedMin) * status.totalMin) : null,
      },
      machines: machineRows,
      downtime: {
        totalMins: Math.round(totalDownMins * 10) / 10,
        occurrences: downtimeEvents.length,
        byReason: [...reasonTally.values()].sort((a, b) => b.mins - a.mins).slice(0, 8)
          .map((r) => ({ ...r, mins: Math.round(r.mins * 10) / 10 })),
      },
    };
  }

  /** Factory shift configuration summary — segments dashboards/reports by the real shift model. */
  async getConfigSummary(factoryId: string | null) {
    const fid = this.requireFactory(factoryId);
    const templates = await this.prisma.shiftTemplate.findMany({
      where: { factoryId: fid, isActive: true },
      orderBy: { startTime: 'asc' },
    });

    const workingDays = new Set<number>();
    let plannedHoursPerDay = 0;
    for (const t of templates) {
      (t.days as number[]).forEach((d) => workingDays.add(d));
      plannedHoursPerDay += t.plannedProductionHours;
    }

    return {
      shiftsPerDay: templates.length,
      workingDaysPerWeek: workingDays.size,
      workingDays: [...workingDays].sort((a, b) => a - b),
      plannedProductionHoursPerDay: plannedHoursPerDay,
      shifts: templates.map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        nameAr: t.nameAr,
        window: `${t.startTime}–${t.endTime}`,
        plannedProductionHours: t.plannedProductionHours,
        shiftDurationHours: t.shiftDurationHours,
        targetQtyPerShift: t.targetQtyPerShift,
      })),
    };
  }

  // ────────────────────────────────────────────────────────────
  // PLANNED DOWNTIME (break + cleaning) — links the shift model
  // to the downtime reason catalogue and the OEE engine.
  // ────────────────────────────────────────────────────────────

  /**
   * Resolve the planned downtime reason codes for break & cleaning, reusing any
   * existing factory-level planned cause of that category (so we don't duplicate
   * the seeded catalogue) and creating one only if none exists.
   */
  async ensurePlannedCauses(factoryId: string) {
    const resolve = async (
      category: DowntimeCategory, code: string, name: string, nameAr: string, sortOrder: number,
    ) => {
      const existing = await this.prisma.downtimeCause.findFirst({
        where: { factoryId, category, isPlanned: true, machineId: null, isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
      if (existing) return existing;
      return this.prisma.downtimeCause.create({
        data: { factoryId, machineId: null, code, name, nameAr, category, isPlanned: true, level: 1, sortOrder, isActive: true },
      });
    };
    const breakCause = await resolve(DowntimeCategory.PLANNED_BREAK, 'PLN-BREAK', 'Scheduled Break', 'استراحة مجدولة', 90);
    const cleaningCause = await resolve(DowntimeCategory.PLANNED_CLEANING, 'PLN-CLEAN', 'Line Cleaning', 'تنظيف الخط', 91);
    return { breakCause, cleaningCause };
  }

  /** Planned downtime reason codes for this factory (powers the shift UI link). */
  async listPlannedCauses(factoryId: string | null) {
    const fid = this.requireFactory(factoryId);
    await this.ensurePlannedCauses(fid);
    return this.prisma.downtimeCause.findMany({
      where: { factoryId: fid, isPlanned: true, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Materialise planned downtime events (break + cleaning) from the shift model
   * for every shift instance in a date range, per target machine. Each event is
   * isPlanned + affectsOEE:false so it is excluded from OEE availability loss and
   * the unplanned-downtime Pareto, but visible in the downtime module. Idempotent.
   */
  async generatePlannedDowntime(factoryId: string | null, dto: GeneratePlannedDowntimeDto) {
    const fid = this.requireFactory(factoryId);
    const { breakCause, cleaningCause } = await this.ensurePlannedCauses(fid);

    const from = new Date(`${dto.dateFrom}T00:00:00.000Z`);
    const to = dto.dateTo ? new Date(`${dto.dateTo}T23:59:59.999Z`) : new Date(`${dto.dateFrom}T23:59:59.999Z`);

    const instances = await this.prisma.shiftInstance.findMany({
      where: {
        factoryId: fid,
        shiftDate: { gte: from, lte: to },
        ...(dto.templateIds?.length ? { shiftTemplateId: { in: dto.templateIds } } : {}),
      },
      include: { shiftTemplate: true },
    });
    if (instances.length === 0) {
      throw new BadRequestException('No shift instances in range — generate shifts first');
    }

    const machines = await this.prisma.machine.findMany({
      where: { factoryId: fid, isActive: true, ...(dto.machineIds?.length ? { id: { in: dto.machineIds } } : {}) },
      select: { id: true },
    });
    if (machines.length === 0) {
      throw new BadRequestException('No active machines to attach planned downtime to');
    }

    let created = 0;
    let skipped = 0;
    const HOUR = 3_600_000;
    const MIN = 60_000;

    for (const inst of instances) {
      const t = inst.shiftTemplate;
      const start = inst.startTime;
      const end = inst.endTime ?? new Date(start.getTime() + t.shiftDurationHours * HOUR);
      const breakStart = new Date(start.getTime() + Math.floor(t.shiftDurationHours / 2) * HOUR);
      const cleanStart = new Date(end.getTime() - t.cleaningMinutes * MIN);

      const slots = [
        { cause: breakCause, category: DowntimeCategory.PLANNED_BREAK, dur: t.breakMinutes, s: breakStart, e: new Date(breakStart.getTime() + t.breakMinutes * MIN) },
        { cause: cleaningCause, category: DowntimeCategory.PLANNED_CLEANING, dur: t.cleaningMinutes, s: cleanStart, e: end },
      ];

      for (const m of machines) {
        for (const slot of slots) {
          if (slot.dur <= 0 || !slot.cause) continue;
          // Idempotent by (instance, machine, category) so re-runs never duplicate
          const exists = await this.prisma.downtimeEvent.findFirst({
            where: { shiftInstanceId: inst.id, machineId: m.id, category: slot.category, isPlanned: true },
            select: { id: true },
          });
          if (exists) { skipped++; continue; }
          await this.prisma.downtimeEvent.create({
            data: {
              factoryId: fid,
              machineId: m.id,
              shiftInstanceId: inst.id,
              causeId: slot.cause.id,
              category: slot.category,
              reasonCode: DowntimeReasonCode.PLANNED_MAINTENANCE,
              startTime: slot.s,
              endTime: slot.e,
              durationMinutes: slot.dur,
              isPlanned: true,
              affectsOEE: false,
              notes: `Auto-generated planned downtime from shift ${t.code}`,
            },
          });
          created++;
        }
      }
    }

    return { created, skipped, instances: instances.length, machines: machines.length };
  }

  /** List planned downtime events (isPlanned) for the shift UI. */
  async listPlannedDowntime(factoryId: string | null, query: ListPlannedDowntimeQueryDto) {
    const fid = this.requireFactory(factoryId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const where: Prisma.DowntimeEventWhereInput = {
      factoryId: fid,
      isPlanned: true,
      ...(query.machineId && { machineId: query.machineId }),
      ...((query.dateFrom || query.dateTo) && {
        startTime: {
          ...(query.dateFrom && { gte: new Date(`${query.dateFrom}T00:00:00.000Z`) }),
          ...(query.dateTo && { lte: new Date(`${query.dateTo}T23:59:59.999Z`) }),
        },
      }),
    };

    const [total, data, totalMinutes] = await Promise.all([
      this.prisma.downtimeEvent.count({ where }),
      this.prisma.downtimeEvent.findMany({
        where,
        include: {
          machine: { select: { name: true, code: true } },
          cause: { select: { code: true, name: true, category: true } },
        },
        orderBy: { startTime: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.downtimeEvent.aggregate({ where, _sum: { durationMinutes: true } }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      totalPlannedMinutes: totalMinutes._sum.durationMinutes ?? 0,
    };
  }

  /**
   * Manually add planned downtime for a hierarchy scope: AREA applies to every
   * machine in all its lines (and any machine directly under the area), LINE
   * applies to every machine in the line, MACHINE applies to one machine.
   */
  async addPlannedDowntime(factoryId: string | null, dto: AddPlannedDowntimeDto) {
    const fid = this.requireFactory(factoryId);

    const cause = await this.prisma.downtimeCause.findFirst({ where: { id: dto.causeId, factoryId: fid } });
    if (!cause) throw new NotFoundException('Downtime reason not found');

    let where: Prisma.MachineWhereInput;
    if (dto.scopeType === PlannedDowntimeScope.MACHINE) {
      where = { id: dto.scopeId, factoryId: fid };
    } else if (dto.scopeType === PlannedDowntimeScope.LINE) {
      where = { factoryId: fid, lineId: dto.scopeId, isActive: true };
    } else {
      // AREA: machines directly under the area OR under any line in that area
      where = { factoryId: fid, isActive: true, OR: [{ areaId: dto.scopeId }, { line: { areaId: dto.scopeId } }] };
    }

    const machines = await this.prisma.machine.findMany({ where, select: { id: true } });
    if (machines.length === 0) throw new BadRequestException('No machines found for the selected scope');

    const start = new Date(dto.startTime);
    const end = new Date(start.getTime() + dto.durationMinutes * 60_000);
    const reasonCode = cause.category === DowntimeCategory.CHANGEOVER
      ? DowntimeReasonCode.CHANGEOVER
      : DowntimeReasonCode.PLANNED_MAINTENANCE;

    let created = 0;
    let skipped = 0;
    for (const m of machines) {
      const exists = await this.prisma.downtimeEvent.findFirst({
        where: { machineId: m.id, causeId: cause.id, startTime: start, isPlanned: true },
        select: { id: true },
      });
      if (exists) { skipped++; continue; }
      await this.prisma.downtimeEvent.create({
        data: {
          factoryId: fid,
          machineId: m.id,
          shiftInstanceId: dto.shiftInstanceId ?? null,
          causeId: cause.id,
          category: cause.category,
          reasonCode,
          startTime: start,
          endTime: end,
          durationMinutes: dto.durationMinutes,
          isPlanned: true,
          affectsOEE: false,
          notes: dto.notes ?? `Manual planned downtime (${dto.scopeType.toLowerCase()})`,
        },
      });
      created++;
    }

    return { created, skipped, machines: machines.length, scope: dto.scopeType };
  }

  async deletePlannedDowntime(factoryId: string | null, id: string) {
    const fid = this.requireFactory(factoryId);
    const ev = await this.prisma.downtimeEvent.findFirst({ where: { id, factoryId: fid, isPlanned: true } });
    if (!ev) throw new NotFoundException('Planned downtime event not found');
    await this.prisma.downtimeEvent.delete({ where: { id } });
    return { id, deleted: true };
  }
}
