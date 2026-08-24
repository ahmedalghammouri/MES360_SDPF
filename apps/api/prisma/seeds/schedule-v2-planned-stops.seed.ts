import { PrismaClient } from '@prisma/client';

/**
 * The plant's real shift schedule, as master data — and STARTUP, which had
 * nowhere to live.
 *
 * ── What this closes ────────────────────────────────────────────────────────
 * Professional_Production_Schedule_v2.xlsx opens every shift with Cleaning then
 * Startup, breaks for a changeover between the day's two products, stops an
 * hour for lunch, and cleans down at the end. Measured against the store, the
 * line had reported PLANNED_STOP and CHANGEOVER exactly zero times — all of
 * that work was landing in IDLE and BREAKDOWN and being charged as unplanned
 * downtime. On one shift of the plan that is 240 minutes of 510, which drags
 * Availability from 100% to 53% with no fault having occurred.
 *
 * STARTUP was the worst of them: reachable as a downtime CAUSE (PD-STARTUP) but
 * filed under CHANGEOVER, absent from MachineState entirely, and therefore not
 * offered on the planned-stop form at all. The migration alongside this seed
 * adds it to both enums; this file gives it a rule, a cause and a template so
 * it behaves like every other activity on the schedule.
 *
 * ── What is deliberately NOT here ───────────────────────────────────────────
 * Durations and clock times come from the plant's own spreadsheet, not from a
 * sensible-looking default. A planned stop is the one thing that legitimately
 * removes time from the availability denominator, so every minute of it has to
 * be a decision somebody made and can point at.
 *
 * Idempotent: every write is an upsert keyed on the factory + code.
 */

/** Shift 1 — Day (07:30 → 19:30). Offsets are minutes from the shift's start. */
const SHIFT_1 = [
  { code: 'S1-CLEAN-AM',  name: 'Line Cleaning — start of shift', at: '07:30', mins: 30, cat: 'PLANNED_CLEANING', cause: 'PD-CLEAN' },
  { code: 'S1-STARTUP',   name: 'Startup — bring the line to speed', at: '08:00', mins: 30, cat: 'STARTUP',        cause: 'PD-STARTUP' },
  { code: 'S1-CHANGEOVER', name: 'Change Over — product to product', at: '10:00', mins: 45, cat: 'CHANGEOVER',     cause: 'PD-CO' },
  { code: 'S1-LUNCH',     name: 'Lunch Break',                     at: '12:00', mins: 60, cat: 'PLANNED_BREAK',   cause: 'PD-BREAK' },
  { code: 'S1-CLEAN-PM',  name: 'Line Cleaning — end of shift',    at: '14:45', mins: 75, cat: 'PLANNED_CLEANING', cause: 'PD-CLEAN' },
] as const;

/** Shift 2 — Night (19:30 → 07:30). The sheet leaves these untimed; anchored to the shift. */
const SHIFT_2 = [
  { code: 'S2-CLEAN',     name: 'Line Cleaning — start of shift', at: '19:30', mins: 30, cat: 'PLANNED_CLEANING', cause: 'PD-CLEAN' },
  { code: 'S2-STARTUP',   name: 'Startup — bring the line to speed', at: '20:00', mins: 30, cat: 'STARTUP',        cause: 'PD-STARTUP' },
  { code: 'S2-DINNER',    name: 'Dinner Break',                    at: '00:00', mins: 60, cat: 'PLANNED_BREAK',   cause: 'PD-BREAK' },
  { code: 'S2-SETUP',     name: 'Setup — format change',           at: '01:00', mins: 45, cat: 'CHANGEOVER',      cause: 'PD-CO' },
  { code: 'S2-HANDOVER',  name: 'Shift Handover',                  at: '07:00', mins: 30, cat: 'PLANNED_BREAK',   cause: 'PD-BREAK' },
] as const;

/**
 * Causes the schedule needs. PD-STARTUP already existed but was filed under
 * CHANGEOVER — a changeover is between products, a startup is before the first
 * one, and a plant shortening them does different things. Re-categorised here.
 */
const CAUSES = [
  { code: 'PD-CLEAN',   name: 'Cleaning',                      nameAr: 'تنظيف',        category: 'PLANNED_CLEANING' },
  { code: 'PD-STARTUP', name: 'Startup',                       nameAr: 'تشغيل وتجهيز', category: 'STARTUP' },
  { code: 'PD-CO',      name: 'Changeover (format / product)', nameAr: 'تغيير منتج',   category: 'CHANGEOVER' },
  { code: 'PD-BREAK',   name: 'Break / Meal',                  nameAr: 'استراحة',      category: 'PLANNED_BREAK' },
] as const;

/**
 * State rules for the two states the schedule introduces.
 *
 * `affectsOEE` is now load-bearing rather than decorative — the classifier
 * reads it (see minute-classification.ts). STARTUP and CHANGEOVER are INTENDED
 * (`isPlanned: true`, so they read as planned work in the state breakdown) and
 * still CHARGED (`affectsOEE: true`), because setup-and-adjustment and start-up
 * losses are two of the six big losses. A plant that never sees them charged
 * has no reason to shorten them.
 *
 * PLANNED_STOP and MAINTENANCE keep `affectsOEE: false` and stay outside the
 * ratio: a meal break is not time the plant planned to produce in.
 */
const STATE_RULES = [
  { state: 'STARTUP',      isDowntime: true, isPlanned: true,  affectsOEE: true,  category: 'STARTUP',          reasonCode: 'PD-STARTUP' },
  { state: 'CHANGEOVER',   isDowntime: true, isPlanned: true,  affectsOEE: true,  category: 'CHANGEOVER',       reasonCode: 'PD-CO' },
  { state: 'PLANNED_STOP', isDowntime: true, isPlanned: true,  affectsOEE: false, category: 'PLANNED_BREAK',    reasonCode: 'PD-BREAK' },
] as const;

/**
 * Set an enum column by asking Postgres, not the generated client.
 *
 * A Prisma Client only knows the enum labels that existed when it was built.
 * This seed ADDS one (STARTUP), so any write of that label through the client
 * fails with "Invalid value for argument `category`" on an image built before
 * the label existed — even though the database itself accepts it. The table and
 * column names are compile-time literals from the call sites above, never user
 * input; the value is bound.
 */
async function setEnum(
  prisma: PrismaClient,
  table: string,
  column: string,
  enumType: string,
  value: string,
  id: string,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "${table}" SET "${column}" = $1::"${enumType}" WHERE id = $2`,
    value, id,
  );
}

const hhmmToOffset = (clock: string, shiftStart: string): number => {
  const [h, m] = clock.split(':').map(Number);
  const [sh, sm] = shiftStart.split(':').map(Number);
  const diff = (h * 60 + m) - (sh * 60 + sm);
  // An overnight shift's 00:00 is AFTER its 19:30 start, not fourteen hours before.
  return diff < 0 ? diff + 24 * 60 : diff;
};

export async function seedScheduleV2PlannedStops(prisma: PrismaClient): Promise<{
  causes: number; rules: number; templates: number; skipped: string[];
}> {
  const skipped: string[] = [];

  const factory = await prisma.factory.findFirst({ select: { id: true, code: true } });
  if (!factory) {
    skipped.push('no factory — nothing to attach the schedule to');
    return { causes: 0, rules: 0, templates: 0, skipped };
  }

  // ── Causes ────────────────────────────────────────────────────────────────
  // findFirst rather than upsert: DowntimeCause has no unique on (factoryId,
  // code) — a cause may be scoped to one machine, so the same code can legally
  // appear more than once. These are factory-wide (machineId null).
  const causeId = new Map<string, string>();
  for (const c of CAUSES) {
    const existing = await prisma.downtimeCause.findFirst({
      where: { factoryId: factory.id, code: c.code, machineId: null },
      select: { id: true },
    });
    // The enum column is set by raw SQL below, never through the client.
    // A generated client only knows the labels that existed when it was built,
    // and this seed adds one — so writing `category: 'STARTUP'` through Prisma
    // fails with "Invalid value for argument `category`" on any image built
    // before the label existed, even though the DATABASE accepts it fine.
    // Raw SQL with an explicit cast asks Postgres, which is the only party that
    // actually knows.
    const data = { name: c.name, nameAr: c.nameAr, isPlanned: true, isActive: true };
    const row = existing
      ? await prisma.downtimeCause.update({ where: { id: existing.id }, data, select: { id: true } })
      : await prisma.downtimeCause.create({
          data: { factoryId: factory.id, code: c.code, ...data, category: 'OTHER' as never },
          select: { id: true },
        });
    await setEnum(prisma, 'downtime_causes', 'category', 'DowntimeCategory', c.category, row.id);
    causeId.set(c.code, row.id);
  }

  // ── State rules ───────────────────────────────────────────────────────────
  // Factory-wide (machineId null): every machine on the line stops together.
  let rules = 0;
  for (const r of STATE_RULES) {
    const existing = await prisma.machineStateRule.findFirst({
      where: { factoryId: factory.id, machineId: null, state: r.state },
      select: { id: true },
    });
    const data = {
      isDowntime: r.isDowntime, isPlanned: r.isPlanned, affectsOEE: r.affectsOEE,
      reasonCode: r.reasonCode, isActive: true,
    };
    const row = existing
      ? await prisma.machineStateRule.update({ where: { id: existing.id }, data, select: { id: true } })
      : await prisma.machineStateRule.create({
          data: { factoryId: factory.id, state: r.state, ...data, category: 'OTHER' as never },
          select: { id: true },
        });
    await setEnum(prisma, 'machine_state_rules', 'category', 'DowntimeCategory', r.category, row.id);
    rules++;
  }

  // ── Templates, one per activity per shift ─────────────────────────────────
  const shifts = await prisma.shiftTemplate.findMany({
    where: { factoryId: factory.id, isActive: true },
    select: { id: true, code: true, startTime: true },
  });
  const byCode = new Map(shifts.map((s) => [s.code, s]));

  let templates = 0;
  for (const [shiftCode, defs] of [['S1', SHIFT_1], ['S2', SHIFT_2]] as const) {
    const shift = byCode.get(shiftCode);
    if (!shift) {
      skipped.push(`shift ${shiftCode} not found — its ${defs.length} stops were not created`);
      continue;
    }
    for (const d of defs) {
      // BOTH anchors are written. `startTimeLocal` is what a person reads off
      // the schedule; `startOffsetMin` is what the placement code uses. Storing
      // the clock time alone is how every stop once ended up at midnight.
      const offset = hhmmToOffset(d.at, shift.startTime);
      const row = await prisma.plannedStopTemplate.upsert({
        where: { factoryId_code: { factoryId: factory.id, code: d.code } },
        create: {
          factoryId: factory.id, code: d.code, name: d.name,
          durationMinutes: d.mins, scope: 'LINE' as never,
          category: 'PLANNED_BREAK' as never, causeId: causeId.get(d.cause) ?? null,
          shiftTemplateId: shift.id, startOffsetMin: offset, startTimeLocal: d.at,
          isActive: true,
          description: `From Professional_Production_Schedule_v2.xlsx — ${d.at} for ${d.mins} min`,
        },
        update: {
          name: d.name, durationMinutes: d.mins,
          causeId: causeId.get(d.cause) ?? null,
          shiftTemplateId: shift.id, startOffsetMin: offset, startTimeLocal: d.at,
          isActive: true,
        },
        select: { id: true },
      });
      // Category through raw SQL — see the note on the causes above.
      await setEnum(prisma, 'planned_stop_templates', 'category', 'DowntimeCategory', d.cat, row.id);
      templates++;
    }
  }

  // ── Targets: which line each stop reaches ─────────────────────────────────
  //
  // A LINE-scoped stop with no targets applies to NOTHING — appliesTo() runs
  // `targets.some(...)` over an empty array and returns false, so the template
  // exists, looks configured on the screen, and silently places no windows.
  // That is exactly how a schedule can be "set up" and still leave every
  // planned minute charged as unplanned downtime.
  //
  // Every packing line in the factory is targeted rather than FACTORY scope,
  // which would also stop the warehouse.
  const lines = await prisma.productionLine.findMany({
    where: { factoryId: factory.id, isActive: true },
    select: { id: true, code: true },
  });
  const created = await prisma.plannedStopTemplate.findMany({
    where: { factoryId: factory.id, code: { in: [...SHIFT_1, ...SHIFT_2].map((d) => d.code) } },
    select: { id: true },
  });

  let targets = 0;
  for (const t of created) {
    for (const line of lines) {
      const has = await prisma.plannedStopTarget.findFirst({
        where: { templateId: t.id, lineId: line.id },
        select: { id: true },
      });
      if (!has) {
        await prisma.plannedStopTarget.create({ data: { templateId: t.id, lineId: line.id } });
        targets++;
      }
    }
  }
  if (lines.length === 0) skipped.push('no production lines — stops have nothing to apply to');
  else skipped.push(`${targets} target link(s) added across ${lines.length} line(s)`);

  // ── Retire the duplicates the audit found ─────────────────────────────────
  // S1_BREAK (machine scope, 12:00) and S1-BREAK (line scope, 13:30) were two
  // templates for one meal, at two different times, neither matching the plan.
  // Deactivated rather than deleted: an old window that already shaped a
  // published figure should stay explicable.
  //
  // Filtered against the codes THIS run just wrote, so a code that appears in
  // both lists is never created and then immediately switched off. That is not
  // hypothetical — S2-CLEAN was in both, and the first run of this seed left
  // the night shift with no cleaning window at all.
  const live = new Set([...SHIFT_1, ...SHIFT_2].map((d) => d.code as string));
  const supersededCodes = ['S1_BREAK', 'S1-BREAK', 'S2-BREAK', 'S1-CLEAN', 'S2-CLEAN']
    .filter((c) => !live.has(c));
  const retired = await prisma.plannedStopTemplate.updateMany({
    where: { factoryId: factory.id, code: { in: supersededCodes } },
    data: { isActive: false },
  });
  if (retired.count > 0) skipped.push(`${retired.count} superseded template(s) deactivated`);

  return { causes: CAUSES.length, rules, templates, skipped };
}
