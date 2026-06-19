/**
 * Seed SIDCO's real shift configuration from the NCC Prerequisites file
 * (Sheet "2. Production & Shift"):
 *   - 2 shifts/day, 12h each, 11 planned production hours
 *   - 0.5h break + 0.5h cleaning per shift
 *   - Working days: Saturday → Thursday (Friday off)
 *   - Target: 3000 boxes/shift
 *   Shift 1: 07:30 → 19:30   |   Shift 2 (crosses midnight): 19:30 → 07:30
 *
 * Idempotent: upserts templates by (factoryId, code) and generates the
 * current week's shift instances without duplicating existing ones.
 *
 * Run:  npx ts-node prisma/seed-sidco-shifts.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Sat=6, Sun=0, Mon=1, Tue=2, Wed=3, Thu=4  (Friday=5 is the weekend)
const WORKING_DAYS = [6, 0, 1, 2, 3, 4];

const TEMPLATES = [
  {
    code: 'S1', name: 'Day Shift', nameAr: 'الوردية الصباحية',
    startTime: '07:30', endTime: '19:30', crossesMidnight: false,
  },
  {
    code: 'S2', name: 'Night Shift', nameAr: 'الوردية الليلية',
    startTime: '19:30', endTime: '07:30', crossesMidnight: true,
  },
];

const COMMON = {
  shiftDurationHours: 12, plannedProductionHours: 11,
  breakMinutes: 30, cleaningMinutes: 30,
  days: WORKING_DAYS, targetQtyPerShift: 3000, isActive: true,
};

function combine(date: Date, hhmm: string, dayOffset = 0): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + dayOffset, h, m, 0, 0));
}

async function main() {
  const factory = await prisma.factory.findFirst({ where: { code: 'SIDCO' } });
  if (!factory) throw new Error('SIDCO factory not found');
  console.log(`SIDCO factory: ${factory.id}`);

  const templates = [];
  for (const t of TEMPLATES) {
    const tpl = await prisma.shiftTemplate.upsert({
      where: { factoryId_code: { factoryId: factory.id, code: t.code } },
      update: { ...t, ...COMMON },
      create: { factoryId: factory.id, ...t, ...COMMON },
    });
    templates.push(tpl);
    console.log(`  ✔ ${tpl.code} ${tpl.name} ${tpl.startTime}–${tpl.endTime} (target ${tpl.targetQtyPerShift})`);
  }

  // Generate this week's instances (today + 6 days), idempotent
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  let created = 0;
  for (let i = 0; i < 7; i++) {
    const day = new Date(start.getTime() + i * 86_400_000);
    const weekday = day.getUTCDay();
    for (const t of templates) {
      if (!WORKING_DAYS.includes(weekday)) continue;
      const exists = await prisma.shiftInstance.findFirst({
        where: { factoryId: factory.id, shiftTemplateId: t.id, shiftDate: day, lineId: null },
        select: { id: true },
      });
      if (exists) continue;
      await prisma.shiftInstance.create({
        data: {
          factoryId: factory.id, shiftTemplateId: t.id, shiftDate: day,
          startTime: combine(day, t.startTime),
          endTime: combine(day, t.endTime, t.crossesMidnight ? 1 : 0),
          targetQty: t.targetQtyPerShift,
          plannedDowntime: t.breakMinutes + t.cleaningMinutes,
          status: 'PLANNED',
        },
      });
      created++;
    }
  }
  console.log(`  ✔ Generated ${created} shift instances for the week`);
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
