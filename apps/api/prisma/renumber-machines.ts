/**
 * Standalone runner for the machine renumbering.
 *
 *   docker exec mes-api-plocal sh -c "cd /app && node node_modules/ts-node/dist/bin.js \
 *     --transpile-only prisma/renumber-machines.ts [--dry-run]"
 */
import { PrismaClient } from '@prisma/client';
import { renumberMachines } from './seeds/renumber-machines.seed';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

renumberMachines(prisma, { dryRun })
  .then(({ changes, renamedTags }) => {
    if (changes.length === 0) {
      console.log('✓ Machine codes already contiguous — nothing to do.');
    } else {
      console.log(`${dryRun ? '(dry run) ' : ''}Machine codes:`);
      for (const c of changes) console.log(`   ${c.from.padEnd(6)} -> ${c.to.padEnd(6)} ${c.name}`);
    }
    if (renamedTags.length > 0) {
      console.log(`${dryRun ? '(dry run) ' : ''}Tag labels (${renamedTags.length}):`);
      for (const t of renamedTags) console.log(`   ${t.from}  ->  ${t.to}`);
    }
  })
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
