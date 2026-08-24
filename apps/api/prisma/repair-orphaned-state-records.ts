/**
 * Standalone runner — closes orphaned open machine_state_records.
 *
 *   docker exec mes-api-plocal sh -c "cd /app && node node_modules/ts-node/dist/bin.js \
 *     --transpile-only prisma/repair-orphaned-state-records.ts [--dry-run]"
 *
 * See seeds/repair-orphaned-state-records.seed.ts for what this does and why
 * it is safe: every closed row marks a real transition the outbox race lost
 * the closing write for, not a guess.
 */
import { PrismaClient } from '@prisma/client';
import { repairOrphanedStateRecords } from './seeds/repair-orphaned-state-records.seed';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

repairOrphanedStateRecords(prisma, { dryRun })
  .then((results) => {
    if (results.length === 0) {
      console.log('✓ No orphaned open state records — nothing to do.');
    } else {
      for (const r of results) {
        console.log(
          `   ${r.machineCode.padEnd(8)} closed ${String(r.closed).padStart(3)} orphan(s)`
          + ` — current state: ${r.remainingOpenState ?? '(none)'}`,
        );
      }
    }
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
