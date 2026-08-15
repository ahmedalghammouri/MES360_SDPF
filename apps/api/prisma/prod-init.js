// ============================================================
// MES360° — Production init / master-data bootstrap
// ------------------------------------------------------------
// Runs ONCE when the stack first comes up (see the `migrate-seed`
// service in docker-compose.prod.yml). It is idempotent:
//
//   • DB empty   → load master data only (users, factories, SKUs,
//                  raw materials, machines, shifts, downtime tree,
//                  product master data) via seed-ncc-master.ts,
//                  then the Dashboard Center catalog.
//   • DB has data → skip, so restarts NEVER wipe what you entered.
//
// NOTE: seed-ncc-master.ts performs a full TRUNCATE on run, which is
// exactly why we guard it behind the "is the DB empty?" check here.
// No production / manufacturing demo data (work orders, production
// orders, inspections, NCR/CAPA, SPC, sensor history) is loaded.
// ============================================================
const { PrismaClient } = require('@prisma/client');
const { execFileSync } = require('child_process');
const path = require('path');

async function alreadySeeded() {
  const prisma = new PrismaClient();
  try {
    const count = await prisma.enterprise.count();
    return count;
  } catch (e) {
    // Table may not exist yet on a brand-new DB — treat as empty.
    return 0;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

function runSeed(file) {
  const tsNode = require.resolve('ts-node/dist/bin.js');
  const seedPath = path.join(__dirname, file);
  console.log(`\n▶ Running ${file} ...`);
  execFileSync('node', [tsNode, '--transpile-only', seedPath], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'), // /app  (so relative imports resolve)
  });
}

(async () => {
  const count = await alreadySeeded();

  if (count > 0) {
    console.log(`✅ Master data already present (${count} enterprise) — skipping master seed.`);
  } else {
    console.log('▶ Empty database detected — loading master data (no production/manufacturing data)...');
    runSeed('seed-ncc-master.ts'); // users, factories, machines, SKUs, materials, shifts, downtime tree
  }

  // The Dashboard Center catalog is idempotent CONFIG (slug/key-keyed upserts), NOT
  // production data — so (re)seed it on EVERY boot. This self-heals an empty catalog
  // and picks up newly added dashboards on each deploy, regardless of DB state.
  // A catalog failure must never block the stack from starting → log, don't exit.
  try {
    runSeed('seed-dashboard-center.ts');
  } catch (e) {
    console.error('⚠ Dashboard Center seed failed (non-fatal):', e?.message ?? e);
  }

  // RBAC — seed the canonical permission catalog on every boot (idempotent upserts,
  // picks up newly shipped permissions) and the default role→permission matrix on
  // first boot only (admin edits in the Access Control UI are never overwritten).
  try {
    runSeed('seed-rbac.ts');
  } catch (e) {
    console.error('⚠ RBAC seed skipped (non-fatal):', e?.message ?? e);
  }

  // Quantity units — repairs quantities stored before units were recorded, and
  // recomputes work-order totals from their job orders in PIECES. Convergent: every
  // value is re-derived from source, so running it on every boot is safe and it
  // self-heals if a bad write ever slips through.
  try {
    runSeed('backfill-quantity-units.ts');
  } catch (e) {
    console.error('⚠ Quantity-unit backfill skipped (non-fatal):', e?.message ?? e);
  }

  // Scope 2 grid emission factor — CONFIG, so it runs on every boot like the two
  // seeds above. It only fills a gap: a factory that already has a factor keeps it,
  // because the value is editable in the app and overwriting it would silently
  // revert the customer's own figure and change past carbon reports.
  try {
    runSeed('seed-emission-factors.ts');
  } catch (e) {
    console.error('⚠ Emission-factor seed skipped (non-fatal):', e?.message ?? e);
  }

  // Machine STATUS tags — CONFIG, same contract as the seed above: it only fills
  // a gap and never touches a machine that already has a status tag bound, so an
  // address or value map an engineer corrected on site survives every restart.
  //
  // Without these, a machine that stops produces no downtime event at all: the
  // counters go quiet and nothing records why.
  try {
    runSeed('seed-machine-status-tags.ts');
  } catch (e) {
    console.error('⚠ Machine status-tag seed skipped (non-fatal):', e?.message ?? e);
  }

  // Backfill the ProductionSnapshot fact store from existing job-order history so
  // dashboards have real per-shift/WO/PO/product history immediately. Idempotent
  // (unique-key upserts). Uses the compiled service; non-fatal if dist isn't present.
  try {
    const { ProductionSnapshotBackfill } = require('../dist/modules/historian/production-snapshot.backfill');
    const pc = new PrismaClient();
    const r = await new ProductionSnapshotBackfill().run(pc, { days: 90 });
    await pc.$disconnect().catch(() => {});
    console.log(`▶ ProductionSnapshot backfill: ${r.jobOrders} job orders → ${r.rows} rows`);
  } catch (e) {
    console.error('⚠ ProductionSnapshot backfill skipped (non-fatal):', e?.message ?? e);
  }

  console.log('\n✅ Init complete. Login: admin@mes360.sa');
})().catch((e) => {
  console.error('❌ prod-init failed:', e);
  process.exit(1);
});
