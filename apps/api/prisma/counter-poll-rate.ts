/**
 * Standalone runner for the counter poll rate.
 *
 *   docker exec mes-api-plocal sh -c "cd /app && node node_modules/ts-node/dist/bin.js \
 *     --transpile-only prisma/counter-poll-rate.ts [--dry-run] [--ms=25]"
 */
import { PrismaClient } from '@prisma/client';
import { setCounterPollRate } from './seeds/counter-poll-rate.seed';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');
const msArg = process.argv.find((a) => a.startsWith('--ms='));
const intervalMs = msArg ? Number(msArg.slice(5)) : undefined;

setCounterPollRate(prisma, { dryRun, intervalMs })
  .then((changes) => {
    if (changes.length === 0) {
      console.log('✓ Counter devices already polled at or below the target — nothing to do.');
    } else {
      for (const c of changes) {
        console.log(`   ${c.device.padEnd(22)} ${c.from ?? 'default'}ms -> ${c.to}ms`);
      }
    }
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
