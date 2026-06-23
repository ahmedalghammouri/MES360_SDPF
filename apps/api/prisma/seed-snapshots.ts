/**
 * Backfill the ProductionSnapshot fact store from existing job-order history.
 * Idempotent (unique-key upserts). Safe to re-run.
 *
 * Run:  docker exec mes-api npx ts-node prisma/seed-snapshots.ts [days]
 *       (default window = last 60 days)
 */
import { PrismaClient } from '@prisma/client';
// Use the compiled service (the production image ships dist/, not src/).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ProductionSnapshotBackfill } = require('../dist/modules/historian/production-snapshot.backfill');

const prisma = new PrismaClient();
const days = parseInt(process.argv[2] ?? '60', 10) || 60;

new ProductionSnapshotBackfill()
  .run(prisma, { days })
  .then((r) => console.log(`✓ ProductionSnapshot backfill: ${r.jobOrders} job orders → ${r.rows} rows`))
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
