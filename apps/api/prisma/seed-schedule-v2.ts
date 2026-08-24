/**
 * Standalone runner — the plant's shift schedule as master data, then the
 * schedule written into the machines' own state history.
 *
 *   docker exec mes-api-prod sh -c "cd /app && node node_modules/ts-node/dist/bin.js \
 *     --transpile-only prisma/seed-schedule-v2.ts [--days 7]"
 *
 * Two steps, in this order and for a reason:
 *
 *   1. seedScheduleV2PlannedStops — causes, state rules and templates from
 *      Professional_Production_Schedule_v2.xlsx. Idempotent upserts.
 *   2. materialize — turns those templates into `machine_state_records` marked
 *      `source: 'SCHEDULE'`, so the timeline and the OEE maths read one source
 *      of truth instead of disagreeing inside every scheduled window.
 *
 * Step 2 replaces only its own previous output. The sensor's records are never
 * edited or deleted — where the two overlap, every reader gives the schedule
 * precedence, which is the rule the classifier already applied to the minutes.
 */
import { PrismaClient } from '@prisma/client';

import { seedScheduleV2PlannedStops } from './seeds/schedule-v2-planned-stops.seed';
import { PlannedStopMaterializerService } from '../src/modules/oee-standard/planned-stop-materializer.service';

const prisma = new PrismaClient();

const argDays = () => {
  const i = process.argv.indexOf('--days');
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 90) : 7;
};

async function main() {
  console.log('── Step 1: schedule master data ───────────────────────────────');
  const r = await seedScheduleV2PlannedStops(prisma);
  console.log(`   causes    ${r.causes}`);
  console.log(`   rules     ${r.rules}`);
  console.log(`   templates ${r.templates}`);
  for (const s of r.skipped) console.log(`   note      ${s}`);

  console.log('\n── Step 2: write the schedule into state history ──────────────');
  const factory = await prisma.factory.findFirst({ select: { id: true, code: true } });
  if (!factory) {
    console.log('   no factory — skipped');
    return;
  }

  const days = argDays();
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  from.setHours(0, 0, 0, 0);

  // The service takes a PrismaService; the concrete client satisfies the same
  // surface, and running it here rather than duplicating the placement logic is
  // the point — one implementation, whether it runs on a cron or by hand.
  const svc = new PlannedStopMaterializerService(prisma as never);
  const out = await svc.materialize(factory.id, from, to);

  console.log(`   window    ${from.toISOString()} → ${to.toISOString()}`);
  console.log(`   written   ${out.written}`);
  console.log(`   replaced  ${out.removed}`);
  console.log(`   machines  ${out.machines}`);
  if (out.unplaced > 0) {
    console.log(`   unplaced  ${out.unplaced}  (outside the window, or no clock anchor)`);
  }

  console.log('\n✓ Done. Re-run any time — every step replaces only its own output.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
