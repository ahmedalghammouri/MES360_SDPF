// Copies the canonical Prisma schema from the API into the gateway so the
// gateway generates its OWN client (needed for the standalone .exe) while
// keeping a single source of truth. Adds the Windows binary target required by
// the packaged executable.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../api/prisma/schema.prisma');
const destDir = resolve(here, '../prisma');
const dest = resolve(destDir, 'schema.prisma');

let schema = readFileSync(src, 'utf8');

// Ensure the windows query engine is generated for the packaged .exe.
schema = schema.replace(
  /binaryTargets\s*=\s*\[[^\]]*\]/,
  'binaryTargets   = ["native", "windows", "linux-musl-openssl-3.0.x"]',
);

mkdirSync(destDir, { recursive: true });
writeFileSync(dest, schema);
console.log(`[sync-schema] ${src} -> ${dest}`);
