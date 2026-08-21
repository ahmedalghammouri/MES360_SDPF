import * as fs from 'fs';
import * as path from 'path';

/**
 * `production_snapshots` is retired: nothing writes it, nothing reads it.
 *
 * ── Why a test and not just a deleted decorator ─────────────────────────────
 * A stopped cron is one line away from restarting, and a retired store that
 * quietly starts filling again is worse than one that never stopped — it looks
 * settled while a second set of numbers accumulates behind it. Two stores of the
 * same fact is precisely the condition this whole consolidation removed.
 *
 * ── What was checked before it stopped ──────────────────────────────────────
 * The two stores ran in parallel. Over every minute both covered, planned-stop
 * and unmeasured minutes were identical to the digit, good and scrap totals
 * matched per machine, and run-versus-down was conserved: minutes moved between
 * the two, never in or out. The differences were the two writers' minute
 * classifiers, and the survivor is the shared `classifyMinute`.
 *
 * The last functional reader — the energy denominator — had never actually read
 * it: it filtered `granularity: 'HOUR'` against a writer that only ever emitted
 * MINUTE, so it matched zero rows from the day it was written.
 *
 * ── What is deliberately still allowed ──────────────────────────────────────
 * Housekeeping. Counting the rows, deleting them with their work order, and
 * clearing them on a system reset all still touch the table, and should: the
 * rows are a real recorded measurement and the only independent check on the
 * store that replaced them. Reading them back into a KPI is what must not
 * return.
 */

const SRC = path.resolve(__dirname, '..', '..');

/** Housekeeping, not measurement — these may still touch the table. */
const ALLOWED = new Set([
  'modules/historian/production-snapshot.service.ts',   // the retired writer itself
  'modules/historian/production-snapshot.backfill.ts',  // rebuilds it on demand, never scheduled
  'modules/historian/historian.controller.ts',          // exposes that backfill
  'modules/system/system.service.ts',                   // row counts + reset
  'modules/production/production.service.ts',           // deletes rows with their work order
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

describe('the old fact store is retired', () => {
  const files = walk(SRC);
  const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');

  /**
   * Code only. These files EXPLAIN the retirement at length, and the prose names
   * the very things the rules forbid — the decorator that was removed, the
   * filter that never matched. A guard that reads its own subject's comments
   * fails on an accurate description of the fix.
   */
  const code = (src: string) => src
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
    })
    .join(String.fromCharCode(10));

  it('finds the source tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('nothing schedules the writer', () => {
    const w = code(fs.readFileSync(path.join(SRC, 'modules/historian/production-snapshot.service.ts'), 'utf8'));
    // The method survives so the comparison can be re-run by hand; the schedule
    // does not, so it cannot re-run by itself.
    expect(w).toContain('async tick()');
    expect(w).not.toMatch(/@Cron\(/);
    expect(w).not.toMatch(/@Interval\(/);
  });

  it('no KPI or analytics path reads it', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const r = rel(f);
      if (ALLOWED.has(r)) continue;
      for (const [i, line] of fs.readFileSync(f, 'utf8').split('\n').entries()) {
        if (line.trim().startsWith('*') || line.trim().startsWith('//')) continue;
        // `SNAPSHOT_COMPAT` is a projection of `oee_minutes` wearing the old
        // column names — the opposite of a read, and the reason every caller
        // moved without changing.
        if (/prisma\.productionSnapshot\.(findMany|findFirst|findUnique|groupBy|aggregate)/.test(line)
            || /FROM\s+production_snapshots/i.test(line)) {
          offenders.push(`${r}:${i + 1}  ${line.trim().slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the energy denominator reads the one store at a grain it actually keeps', () => {
    const e = code(fs.readFileSync(path.join(SRC, 'modules/energy/energy-analytics.service.ts'), 'utf8'));
    expect(e).toContain('FROM oee_minutes');
    // The filter that never matched.
    expect(e).not.toMatch(/granularity:\s*'HOUR'/);
    // And it applies the final-step rule rather than summing every station.
    expect(e).toMatch(/MAX\(s2\."sequenceOrder"\)/);
  });

  it('would catch a read coming back', () => {
    expect(/prisma\.productionSnapshot\.(findMany|findFirst|findUnique|groupBy|aggregate)/
      .test('const rows = await this.prisma.productionSnapshot.findMany({});')).toBe(true);
    expect(/FROM\s+production_snapshots/i.test('SELECT * FROM production_snapshots s')).toBe(true);
    // Housekeeping shapes are not reads.
    expect(/prisma\.productionSnapshot\.(findMany|findFirst|findUnique|groupBy|aggregate)/
      .test('await this.prisma.productionSnapshot.deleteMany({});')).toBe(false);
    expect(/prisma\.productionSnapshot\.(findMany|findFirst|findUnique|groupBy|aggregate)/
      .test('await this.prisma.productionSnapshot.count();')).toBe(false);
  });
});
