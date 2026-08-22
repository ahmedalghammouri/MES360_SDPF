/**
 * Standalone runner.
 *   docker exec mes-api-plocal sh -c "cd /app && node node_modules/ts-node/dist/bin.js \
 *     --transpile-only prisma/seed-m1-carton-pusher.ts"
 */
import { PrismaClient } from '@prisma/client';
import { seedM1CartonPusher } from './seeds/m1-carton-pusher.seed';

const prisma = new PrismaClient();
seedM1CartonPusher(prisma)
  .then((r) => console.log('M1_CARTON_PUSHER:', JSON.stringify(r)))
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
