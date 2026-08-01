// ============================================================
// MES360° — CORRECT THE PLANT-TIMEZONE OFFSET ON EXISTING SHIFT DATA
// ------------------------------------------------------------
// `ShiftService.combine()` used to build shift-instance boundaries with
// `Date.UTC(y, m, d, h, m)` from the template's PLANT-local "HH:mm". So a shift
// defined as 07:30 was stored as 07:30 UTC = 10:30 Riyadh — every shift instance,
// and every break/cleaning event generated from it, sits `+offset` too late.
//
// combine() is fixed (see plantWallClockToUtc); this script repairs the rows that
// were written before the fix.
//
// WHAT IT TOUCHES
//   shift_instances   startTime, endTime               (shiftDate is a plain date — untouched)
//   downtime_events   startTime, endTime  WHERE isPlanned = true AND shiftInstanceId IS NOT NULL
//
// It shifts them by −offset (−3h for Asia/Riyadh), turning "07:30 stored as UTC"
// into the instant that actually IS 07:30 at the plant.
//
// SAFETY
//   • Dry-run by default — prints every change and writes nothing.
//   • `--apply` performs the update inside ONE transaction.
//   • Idempotent guard: a row is only shifted when its plant-local clock matches
//     the shift template's declared HH:mm *before* correction and does not match
//     *after*. Re-running finds nothing left to do.
//   • Unplanned downtime, actual production timestamps and energy readings are
//     never touched — those were recorded from real instants and are correct.
//
// Run:  docker exec -w /app mes-api npx ts-node --transpile-only \
//         prisma/fix-shift-timezone-offset.ts            # dry run
//       ... prisma/fix-shift-timezone-offset.ts --apply  # commit
// ============================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const TZ = process.env.PLANT_TZ || (process.env.TZ && process.env.TZ !== 'UTC' ? process.env.TZ : 'Asia/Riyadh');

// Inlined rather than imported from src/common/plant-time.util: the production
// image ships only dist/, so a src-relative import would not resolve there.
function plantParts(date: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { year: g('year'), month: g('month'), day: g('day'), hour: g('hour') % 24, minute: g('minute') };
}

const pad = (n: number) => String(n).padStart(2, '0');
const hhmmAt = (d: Date) => {
  const p = plantParts(d, TZ);
  return `${pad(p.hour)}:${pad(p.minute)}`;
};
const utc = (d: Date) => d.toISOString().replace('.000Z', 'Z');

/** Offset of the plant zone at `at`, in ms (+3h for Riyadh). */
function offsetMs(at: Date): number {
  const p = plantParts(at, TZ);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0) - Math.floor(at.getTime() / 60_000) * 60_000;
}

async function main() {
  console.log(`\n🕓 Plant-timezone correction — zone ${TZ}${APPLY ? '' : '   (DRY RUN — nothing will be written)'}\n`);

  const instances = await prisma.shiftInstance.findMany({
    include: { shiftTemplate: { select: { code: true, startTime: true, endTime: true, crossesMidnight: true } } },
    orderBy: { startTime: 'asc' },
  });
  if (instances.length === 0) {
    console.log('No shift instances found — nothing to do.\n');
    return;
  }

  const instanceUpdates: Array<{ id: string; startTime: Date; endTime: Date | null; label: string }> = [];
  let alreadyOk = 0;

  for (const inst of instances) {
    const tpl = inst.shiftTemplate;
    if (!tpl) continue;

    const off = offsetMs(inst.startTime);
    const shifted = new Date(+inst.startTime - off);

    // Only correct rows that are demonstrably mis-stored: the CURRENT plant-local
    // clock does NOT match the template, but it WOULD after shifting. That makes
    // the script safe to re-run and safe against already-correct rows.
    const nowMatches = hhmmAt(inst.startTime) === tpl.startTime;
    const shiftedMatches = hhmmAt(shifted) === tpl.startTime;

    if (nowMatches || !shiftedMatches) {
      alreadyOk++;
      continue;
    }

    instanceUpdates.push({
      id: inst.id,
      startTime: shifted,
      endTime: inst.endTime ? new Date(+inst.endTime - off) : null,
      label:
        `${tpl.code}  ${utc(inst.startTime)} (${hhmmAt(inst.startTime)} plant) ` +
        `→ ${utc(shifted)} (${hhmmAt(shifted)} plant, matches template ${tpl.startTime})`,
    });
  }

  // Planned downtime generated FROM those instances moves by the same offset.
  const ids = instanceUpdates.map((u) => u.id);
  const downs = ids.length
    ? await prisma.downtimeEvent.findMany({
        where: { isPlanned: true, shiftInstanceId: { in: ids } },
        select: { id: true, shiftInstanceId: true, startTime: true, endTime: true, category: true },
      })
    : [];

  console.log(`Shift instances      : ${instances.length} total · ${instanceUpdates.length} to correct · ${alreadyOk} already correct`);
  console.log(`Planned downtime     : ${downs.length} events attached to those instances\n`);

  if (instanceUpdates.length === 0) {
    console.log('✅ Nothing to correct — every shift instance already matches its template.\n');
    return;
  }

  console.log('Sample of the change (first 8):');
  for (const u of instanceUpdates.slice(0, 8)) console.log(`   ${u.label}`);
  if (instanceUpdates.length > 8) console.log(`   … and ${instanceUpdates.length - 8} more`);

  if (downs.length) {
    const d = downs[0];
    const off = offsetMs(d.startTime);
    console.log('\nSample planned-downtime change:');
    console.log(
      `   ${d.category}  ${utc(d.startTime)} (${hhmmAt(d.startTime)} plant) ` +
        `→ ${utc(new Date(+d.startTime - off))} (${hhmmAt(new Date(+d.startTime - off))} plant)`,
    );
  }

  if (!APPLY) {
    console.log('\n⚠️  DRY RUN — re-run with --apply to commit.\n');
    return;
  }

  await prisma.$transaction(
    [
      ...instanceUpdates.map((u) =>
        prisma.shiftInstance.update({
          where: { id: u.id },
          data: { startTime: u.startTime, ...(u.endTime ? { endTime: u.endTime } : {}) },
        }),
      ),
      ...downs.map((d) => {
        // Use the offset of the event's own instant so a DST boundary (if the plant
        // ever has one) is handled per row rather than with a single constant.
        const off = offsetMs(d.startTime);
        return prisma.downtimeEvent.update({
          where: { id: d.id },
          data: {
            startTime: new Date(+d.startTime - off),
            ...(d.endTime ? { endTime: new Date(+d.endTime - off) } : {}),
          },
        });
      }),
    ],
  );

  console.log(`\n✅ Corrected ${instanceUpdates.length} shift instances and ${downs.length} planned downtime events.`);
  console.log('   Re-run without --apply to confirm nothing is left.\n');
}

main()
  .catch((e) => {
    console.error('❌ Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
