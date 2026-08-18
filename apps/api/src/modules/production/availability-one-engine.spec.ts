import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One engine computes availability. Not four.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * On 18 Aug 2026 a plant manager had four pages open at once and read four
 * different availabilities for the same machine at the same moment: 92.7%, 91.8%,
 * 0% and 0%. Each page carried its own arithmetic over its own source, so a data
 * bug in one was invisible to the others — and a number nobody can reconcile is
 * a number nobody believes, whichever one happens to be right.
 *
 * The fix was not to correct three of them. It was to leave exactly one
 * implementation — `KpiService.machineFactTotals` — and have every surface read
 * it. This test defends that shape, because the failure mode is additive: nothing
 * breaks when somebody writes a second query, it just quietly starts disagreeing.
 *
 * It reads source, so it needs no database and no running app.
 */
describe('availability has one implementation', () => {
  const read = (f: string) =>
    readFileSync(join(__dirname, f), 'utf8')
      // Comments discuss the old duplication by name; only code counts here.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

  const kpi = read('kpi.service.ts');
  const analytics = read('oee-analytics.service.ts');
  const status = read('machine-status.service.ts');

  it('exposes the aggregate from the KPI service', () => {
    expect(kpi).toContain('async machineFactTotals(');
  });

  it.each([
    ['oee-analytics.service.ts', () => analytics],
    ['machine-status.service.ts', () => status],
  ])('%s reads it rather than querying the fact store itself', (_f, get) => {
    const src = get();
    expect(src).toContain('machineFactTotals(');
    // The tell-tale of a second implementation: its own SUM over the snapshots.
    expect(src).not.toMatch(/SUM\(\s*"?runMin/i);
    expect(src).not.toMatch(/SUM\(\s*"?plannedMin/i);
  });

  it('leaves NO page summing runMin out of the fact store itself', () => {
    // kpi.service holds the canonical aggregates — per machine, per day, per scope.
    // Everywhere else must ask it. This is the invariant that keeps a fifth engine
    // from appearing: nothing breaks when somebody adds one, it just quietly starts
    // disagreeing with the other four, which is how this began.
    for (const src of [analytics, status]) {
      expect(src.match(/SUM\(\s*"?runMin/gi)).toBeNull();
      expect(src.match(/SUM\(\s*"?plannedMin/gi)).toBeNull();
      expect(src.match(/SUM\(\s*"?idealRunMin/gi)).toBeNull();
    }
  });

  it('gives the trend charts one implementation too', () => {
    // The daily series existed twice, and the machine-status copy was missing the
    // granularity filter the canonical one has.
    expect(kpi).toContain('async dailyFactTotals(');
    expect(analytics).toContain('dailyFactTotals(');
    expect(status).toContain('dailyFactTotals(');
  });

  it('keeps the granularity filter on every canonical aggregate', () => {
    // Without it a rollup row would be summed on top of the minutes it rolls up.
    const aggregates = kpi.split('async ').filter((b) => b.startsWith('machineFactTotals') || b.startsWith('dailyFactTotals'));
    expect(aggregates).toHaveLength(2);
    for (const a of aggregates) expect(a).toContain("granularity = 'MINUTE'");
  });

  it('does not let Machine Status derive availability from state records', () => {
    // The old line was `this.pct(buckets.runMin, buckets.runMin + buckets.unplannedMin)`
    // over minutes bucketed from machine_state_records. State records draw the
    // timeline; they are not a second opinion on the KPI.
    expect(status).not.toMatch(/pct\(\s*buckets\.runMin/);
  });

  it('reports no availability rather than 0% when nothing was planned', () => {
    // 0% accuses a machine of failing when it was never asked to run, and it was
    // the shape that made an idle machine look identical to a broken one.
    expect(status).toMatch(/plannedMin > 0 \? this\.pct\(/);
  });
});
