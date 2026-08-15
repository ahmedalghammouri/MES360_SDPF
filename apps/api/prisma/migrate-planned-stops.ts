// ============================================================
// MES360° — bring implicit planned downtime into the open
// ------------------------------------------------------------
// Every shift template used to carry `breakMinutes` and `cleaningMinutes`, both
// defaulting to 30. Those minutes were subtracted from planned production time,
// so they set the OEE availability denominator for the whole plant — and nobody
// had entered them. The generator then invented WHEN they happened: the break at
// the midpoint of the shift, the cleaning at the end.
//
// This converts whatever each factory actually had into rows a person can see
// and edit:
//   • one ScheduleRule per shift template, carrying its existing `days`
//   • one PlannedStopTemplate per non-zero break / cleaning value
//
// Nothing is invented. A template with breakMinutes = 0 produces no break, and a
// factory that never configured cleaning ends up with no cleaning stop. If the
// old defaults were never changed, the 30-minute values ARE what the plant has
// been measured against, so they are carried across as-is and flagged in the
// output for review — silently dropping them would move every OEE figure.
//
// IDEMPOTENT: re-running skips anything already migrated.
//
//   DATABASE_URL="…/mes360…" npx ts-node --transpile-only prisma/migrate-planned-stops.ts
//   …--transpile-only prisma/migrate-planned-stops.ts --dry-run
// ============================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

/** The old generator put the break at the midpoint of the shift. */
const legacyBreakOffsetMin = (shiftDurationHours: number) =>
  Math.floor(shiftDurationHours / 2) * 60;

/** …and the cleaning at the very end. */
const legacyCleaningOffsetMin = (shiftDurationHours: number, cleaningMinutes: number) =>
  Math.max(0, Math.round(shiftDurationHours * 60 - cleaningMinutes));

async function main() {
  const templates = await prisma.shiftTemplate.findMany({
    where: { isActive: true },
    include: { factory: { select: { code: true } }, plannedStops: { select: { id: true } } },
    orderBy: [{ factoryId: 'asc' }, { startTime: 'asc' }],
  });

  let schedulesCreated = 0;
  let stopsCreated = 0;
  let skipped = 0;
  const review: string[] = [];

  for (const t of templates) {
    const label = `${t.factory.code}/${t.code}`;

    // Already migrated: it has planned stops of its own, or a schedule rule.
    if (t.plannedStops.length > 0 && t.scheduleRuleId) {
      skipped++;
      continue;
    }

    // ── 1. Recurrence ──────────────────────────────────────────────────────
    let scheduleRuleId = t.scheduleRuleId;
    if (!scheduleRuleId) {
      const days = Array.isArray(t.days) ? t.days : [];
      if (!DRY_RUN) {
        const rule = await prisma.scheduleRule.create({
          data: {
            factoryId: t.factoryId,
            name: `${t.name} — weekly`,
            daysOfWeek: days,
            // Carried over as perpetual because that is what `days` alone meant:
            // these weekdays, with no end. Making it perpetual explicitly means
            // nobody has to guess whether a missing endDate was deliberate.
            isPerpetual: true,
            isActive: true,
          },
        });
        scheduleRuleId = rule.id;
        await prisma.shiftTemplate.update({
          where: { id: t.id },
          data: { scheduleRuleId: rule.id },
        });
      }
      schedulesCreated++;
      if (days.length === 0) {
        review.push(`${label}: no working days were set — the shift will not recur until days are chosen`);
      }
    }

    // ── 2. The two implicit stops ──────────────────────────────────────────
    const candidates = [
      {
        suffix: 'BREAK',
        name: 'Scheduled Break',
        nameAr: 'استراحة مجدولة',
        minutes: t.breakMinutes,
        offset: legacyBreakOffsetMin(t.shiftDurationHours),
        category: 'PLANNED_BREAK' as const,
      },
      {
        suffix: 'CLEAN',
        name: 'Line Cleaning',
        nameAr: 'تنظيف الخط',
        minutes: t.cleaningMinutes,
        offset: legacyCleaningOffsetMin(t.shiftDurationHours, t.cleaningMinutes),
        category: 'PLANNED_CLEANING' as const,
      },
    ];

    for (const c of candidates) {
      if (!c.minutes || c.minutes <= 0) continue; // nothing was configured

      const code = `${t.code}-${c.suffix}`;
      const exists = await prisma.plannedStopTemplate.findFirst({
        where: { factoryId: t.factoryId, code },
        select: { id: true },
      });
      if (exists) { skipped++; continue; }

      if (!DRY_RUN) {
        await prisma.plannedStopTemplate.create({
          data: {
            factoryId: t.factoryId,
            code,
            name: `${c.name} — ${t.name}`,
            nameAr: c.nameAr,
            durationMinutes: c.minutes,
            // LINE scope with no targets yet: the old generator attached these to
            // every machine in the factory, which invented downtime for equipment
            // nobody had touched. Migrating that behaviour forward would carry the
            // defect across, so the scope must be chosen — the review list below
            // tells the operator which stops still need targets.
            scope: 'LINE',
            category: c.category,
            shiftTemplateId: t.id,
            startOffsetMin: c.offset,
            isActive: true,
            description:
              `Migrated from ${t.code}.${c.suffix === 'BREAK' ? 'breakMinutes' : 'cleaningMinutes'}. ` +
              'The start time is where the old generator placed it — confirm it against the real schedule.',
          },
        });
      }
      stopsCreated++;
      review.push(
        `${label}: ${c.name} ${c.minutes} min at +${c.offset} min — needs a line or machine target`,
      );
    }
  }

  console.log(`\n[planned-stops] ${DRY_RUN ? 'DRY RUN — nothing written' : 'migration complete'}`);
  console.log(`  shift templates seen : ${templates.length}`);
  console.log(`  schedules created    : ${schedulesCreated}`);
  console.log(`  planned stops created: ${stopsCreated}`);
  console.log(`  skipped (already done): ${skipped}`);

  if (review.length) {
    console.log(`\n  NEEDS REVIEW — these were implicit and are now visible:`);
    for (const r of review) console.log(`    • ${r}`);
    console.log(
      `\n  Until a stop has a target it produces nothing, which is deliberate:\n` +
      `  the old code applied every break to every machine in the factory.`,
    );
  }
}

main()
  .catch((e) => {
    console.error('[planned-stops] migration failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
