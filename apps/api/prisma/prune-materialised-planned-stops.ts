/**
 * Remove the state records the schedule materialiser wrote, and the templates
 * that fed it.
 *
 *   docker exec mes-api-prod sh -c "cd /app && node node_modules/ts-node/dist/bin.js \
 *     --transpile-only prisma/prune-materialised-planned-stops.ts [--dry-run] [--keep-templates]"
 *
 * ── Why this exists as a deliberate act ─────────────────────────────────────
 * Turning materialisation off stops the writer; it does not un-write. That is
 * the right default — on a plant that had been running it for weeks, a toggle
 * that also deleted would rewrite every one of those weeks without being asked.
 * But it leaves a real job to do when the feature was switched on by mistake,
 * and this is that job, run on purpose rather than as a side effect.
 *
 * ── What it will not touch ──────────────────────────────────────────────────
 * Only rows this writer authored, matched on `source = 'SCHEDULE'`. The
 * sensor's account of the machine — SYSTEM and OPERATOR records — is the
 * measurement, and nothing here goes near it. Planned downtime EVENTS are also
 * untouched: those are dated facts somebody booked, not derived rows.
 *
 * `--dry-run` counts without deleting. `--keep-templates` removes the records
 * but leaves the definitions, for turning materialisation back on later.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SCHEDULE_SOURCE = 'SCHEDULE';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const keepTemplates = process.argv.includes('--keep-templates');

  // ── What is there ─────────────────────────────────────────────────────────
  const byState = await prisma.machineStateRecord.groupBy({
    by: ['state'],
    where: { source: SCHEDULE_SOURCE },
    _count: { _all: true },
  });
  const total = byState.reduce((a, r) => a + r._count._all, 0);

  const templates = await prisma.plannedStopTemplate.findMany({
    select: { code: true, name: true, isActive: true },
    orderBy: { code: 'asc' },
  });

  const enabled = await prisma.factory.findMany({
    where: { plannedStopMaterialisation: true },
    select: { code: true },
  });

  console.log('── What is on file ──────────────────────────────────────');
  if (total === 0) console.log('   materialised records : none');
  else {
    console.log(`   materialised records : ${total}`);
    for (const r of byState) console.log(`      ${r.state.padEnd(14)} ${r._count._all}`);
  }
  console.log(`   planned-stop templates : ${templates.length}`);
  for (const t of templates) {
    console.log(`      ${t.code.padEnd(16)} ${t.isActive ? 'active  ' : 'inactive'} ${t.name}`);
  }
  console.log(
    `   materialisation enabled on : ${enabled.length === 0 ? 'no factory' : enabled.map((f) => f.code).join(', ')}`,
  );

  // Worth saying out loud: deleting the records while the writer is still on
  // means the next tick puts them straight back.
  if (enabled.length > 0 && !dryRun) {
    console.log(
      `\n   ⚠ Materialisation is still ON for ${enabled.map((f) => f.code).join(', ')}.`
      + '\n     The hourly job will rewrite these records within the hour.'
      + '\n     Turn it off first: Settings → System → "Write the shift schedule into machine history".',
    );
  }

  if (dryRun) {
    console.log('\n── Dry run — nothing deleted ────────────────────────────');
    console.log(`   would delete ${total} state record(s)`);
    console.log(`   would delete ${keepTemplates ? 0 : templates.length} template(s)`);
    return;
  }

  // ── Remove ────────────────────────────────────────────────────────────────
  console.log('\n── Removing ─────────────────────────────────────────────');
  const records = await prisma.machineStateRecord.deleteMany({
    where: { source: SCHEDULE_SOURCE },
  });
  console.log(`   state records : ${records.count} removed`);

  if (keepTemplates) {
    console.log('   templates     : kept (--keep-templates)');
  } else {
    // Targets go first — the FK from planned_stop_targets is what would
    // otherwise refuse the delete, the same class of blocker as scrap_logs on
    // job orders.
    const ids = templates.length
      ? (await prisma.plannedStopTemplate.findMany({ select: { id: true } })).map((t) => t.id)
      : [];
    if (ids.length > 0) {
      await prisma.plannedStopTarget.deleteMany({ where: { templateId: { in: ids } } });
    }
    const tpl = await prisma.plannedStopTemplate.deleteMany({});
    console.log(`   templates     : ${tpl.count} removed`);
  }

  const left = await prisma.machineStateRecord.groupBy({
    by: ['source'],
    _count: { _all: true },
  });
  console.log('\n── What remains ─────────────────────────────────────────');
  for (const r of left) console.log(`   ${r.source.padEnd(10)} ${r._count._all}`);
  console.log('\n✓ Sensor records (SYSTEM, OPERATOR) and planned downtime events are untouched.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
