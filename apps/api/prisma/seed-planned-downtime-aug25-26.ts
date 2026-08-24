/**
 * The two days the plan actually covers, as planned downtime EVENTS.
 *
 *   docker exec mes-api-prod sh -c "cd /app && node node_modules/ts-node/dist/bin.js \
 *     --transpile-only prisma/seed-planned-downtime-aug25-26.ts [--undo]"
 *
 * ── Why events and not templates ────────────────────────────────────────────
 * The first attempt at this wrote recurring planned-stop TEMPLATES, which was
 * the wrong shape for the thing being described. Professional_Production_
 * Schedule_v2.xlsx is a plan for 25 and 26 August — two dated columns, not a
 * rule that repeats. A template says "every Tuesday, forever"; nobody said
 * that, and every later Tuesday would have inherited a cleaning window nobody
 * scheduled. These are dated facts, so they are dated rows.
 *
 * ── What is deliberately NOT here ───────────────────────────────────────────
 * The sheet lists night-shift activities — Startup, Dinner Break, Setup — with
 * no times against them. They are omitted rather than placed at a plausible
 * hour. A planned stop is the one thing that legitimately removes time from
 * the availability denominator, so an invented minute here is an invented
 * point of Availability. This codebase has been bitten by exactly that before:
 * a stop with no clock landed at midnight and nobody could see why.
 *
 * Production blocks are not here either. They are the work, not a stop.
 *
 * Idempotent: every run removes the rows it wrote last time (matched on the
 * marker in `notes`) before writing them again. `--undo` removes them and
 * stops, for putting the plant back exactly as it was.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** The marker that makes this seed's own rows findable, and only its own. */
const MARKER = '[schedule-v2 25-26 Aug]';

/** Asia/Riyadh is UTC+3 with no DST, so the offset is a constant, not a lookup. */
const PLANT_UTC_OFFSET_HOURS = 3;

type Activity = {
  label: string;
  from: string;
  to: string;
  category: string;
  reasonCode: string;
  /**
   * Whether the stop is charged against OEE.
   *
   * Cleaning and meals are time the plant did not plan to produce in, so they
   * leave the denominator. Startup and changeover are intended work that still
   * costs output — two of the six big losses — so they stay in it. Same split
   * the machine state rules use, and the classifier now honours the flag.
   */
  affectsOEE: boolean;
};

/** Tuesday 25 August, day shift. Times exactly as the sheet states them. */
const AUG_25: Activity[] = [
  { label: 'Cleaning — start of shift', from: '07:30', to: '08:00', category: 'PLANNED_CLEANING', reasonCode: 'PLANNED_MAINTENANCE', affectsOEE: false },
  { label: 'Startup',                   from: '08:00', to: '08:30', category: 'STARTUP',          reasonCode: 'CHANGEOVER',          affectsOEE: true  },
  { label: 'Change Over',               from: '10:00', to: '10:45', category: 'CHANGEOVER',       reasonCode: 'CHANGEOVER',          affectsOEE: true  },
  { label: 'Lunch Break',               from: '12:00', to: '13:00', category: 'PLANNED_BREAK',    reasonCode: 'PLANNED_MAINTENANCE', affectsOEE: false },
  { label: 'Cleaning — end of shift',   from: '14:45', to: '16:00', category: 'PLANNED_CLEANING', reasonCode: 'PLANNED_MAINTENANCE', affectsOEE: false },
];

/** Wednesday 26 August. The changeover moves, and there is no timed close-down. */
const AUG_26: Activity[] = [
  { label: 'Cleaning — start of shift', from: '07:30', to: '08:00', category: 'PLANNED_CLEANING', reasonCode: 'PLANNED_MAINTENANCE', affectsOEE: false },
  { label: 'Startup',                   from: '08:00', to: '08:30', category: 'STARTUP',          reasonCode: 'CHANGEOVER',          affectsOEE: true  },
  { label: 'Change Over',               from: '11:30', to: '12:15', category: 'CHANGEOVER',       reasonCode: 'CHANGEOVER',          affectsOEE: true  },
  { label: 'Lunch Break',               from: '12:15', to: '13:15', category: 'PLANNED_BREAK',    reasonCode: 'PLANNED_MAINTENANCE', affectsOEE: false },
];

const DAYS: Array<{ date: string; activities: Activity[] }> = [
  { date: '2026-08-25', activities: AUG_25 },
  { date: '2026-08-26', activities: AUG_26 },
];

/** A plant wall-clock time on a plant date, as the instant it really is. */
function plantInstant(date: string, hhmm: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - PLANT_UTC_OFFSET_HOURS, mm, 0, 0));
}

async function removeSeeded(factoryId: string): Promise<number> {
  const { count } = await prisma.downtimeEvent.deleteMany({
    where: { factoryId, isPlanned: true, notes: { contains: MARKER } },
  });
  return count;
}

async function main() {
  const undo = process.argv.includes('--undo');

  const factory = await prisma.factory.findFirst({ select: { id: true, code: true } });
  if (!factory) { console.log('No factory — nothing to do.'); return; }

  const removed = await removeSeeded(factory.id);
  if (removed > 0) console.log(`Removed ${removed} previously seeded event(s).`);
  if (undo) { console.log('✓ Undo complete — nothing written.'); return; }

  // Every machine on the packing line stops together for a line-wide activity.
  // Downtime is recorded per machine, so a line stop is one row each — that is
  // what makes it show against the machine whose availability it affects.
  const machines = await prisma.machine.findMany({
    where: { factoryId: factory.id, isActive: true, lineId: { not: null } },
    select: { id: true, code: true },
    orderBy: { code: 'asc' },
  });
  if (machines.length === 0) { console.log('No machines on a line — nothing to write.'); return; }

  // Causes, matched by code so the events land under the reason tree the plant
  // already uses rather than inventing a parallel set of labels.
  const causes = await prisma.downtimeCause.findMany({
    where: { factoryId: factory.id, code: { in: ['PD-CLEAN', 'PD-STARTUP', 'PD-CO', 'PD-BREAK'] } },
    select: { id: true, code: true },
  });
  const causeFor: Record<string, string | null> = {
    PLANNED_CLEANING: causes.find((c) => c.code === 'PD-CLEAN')?.id ?? null,
    STARTUP:          causes.find((c) => c.code === 'PD-STARTUP')?.id ?? null,
    CHANGEOVER:       causes.find((c) => c.code === 'PD-CO')?.id ?? null,
    PLANNED_BREAK:    causes.find((c) => c.code === 'PD-BREAK')?.id ?? null,
  };

  const rows: any[] = [];
  for (const day of DAYS) {
    for (const a of day.activities) {
      const startTime = plantInstant(day.date, a.from);
      const endTime = plantInstant(day.date, a.to);
      const durationMinutes = (endTime.getTime() - startTime.getTime()) / 60_000;
      for (const m of machines) {
        rows.push({
          factoryId: factory.id,
          machineId: m.id,
          causeId: causeFor[a.category] ?? null,
          category: a.category,
          reasonCode: a.reasonCode,
          reason: a.label,
          startTime,
          endTime,
          durationMinutes,
          isPlanned: true,
          affectsOEE: a.affectsOEE,
          acknowledged: true,
          notes: `${a.label} — ${day.date} ${a.from}–${a.to} ${MARKER}`,
        });
      }
    }
  }

  await prisma.downtimeEvent.createMany({ data: rows });

  console.log(`\nWrote ${rows.length} planned downtime event(s) across ${machines.length} machine(s):`);
  for (const day of DAYS) {
    const mins = day.activities.reduce(
      (a, x) => a + (plantInstant(day.date, x.to).getTime() - plantInstant(day.date, x.from).getTime()) / 60_000, 0,
    );
    console.log(`  ${day.date}  ${day.activities.length} activities · ${mins} min per machine`);
    for (const a of day.activities) console.log(`     ${a.from}–${a.to}  ${a.label}`);
  }
  console.log('\nNight-shift activities in the sheet carry no times and were NOT invented.');
  console.log('✓ Re-run any time; --undo removes them.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
