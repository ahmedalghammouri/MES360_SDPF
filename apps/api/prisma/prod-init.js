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
    console.log(`✅ Master data already present (${count} enterprise) — skipping seed.`);
    return;
  }

  console.log('▶ Empty database detected — loading master data (no production/manufacturing data)...');
  runSeed('seed-ncc-master.ts');      // users, factories, machines, SKUs, materials, shifts, downtime tree
  runSeed('seed-dashboard-center.ts'); // dashboard catalog (config, not production data)
  console.log('\n✅ Master data + dashboard catalog seeded. Login: admin@mes360.sa / admin@mes360.sa@admin@mes360.sa');
})().catch((e) => {
  console.error('❌ prod-init failed:', e);
  process.exit(1);
});
