import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * "Now" and "over a period" are different questions, and the code must keep them
 * apart on its own.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * Every dashboard used to answer both at once: a card showing current output
 * beside a chart showing output over the selected window, both driven by the same
 * scope tree and the same time filter. A reader could not tell which number
 * described this minute and which described last week — and when they disagreed,
 * neither could be trusted.
 *
 * The separation was a convention, and conventions drift. These tests make it
 * structural: the live service has no date parameter to abuse, and the analytics
 * service has no live table to read. Both still go through the one aggregate, so
 * "live" describes a WINDOW, never a second arithmetic.
 */
describe('live and analytics are separate by construction', () => {
  const src = (f: string) =>
    readFileSync(join(__dirname, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

  const live = src('live-kpi.service.ts');
  const liveCtl = src('live.controller.ts');
  const analytics = src('oee-analytics.service.ts');

  describe('the live service cannot be asked about the past', () => {
    it('takes no date range in any signature', () => {
      // The whole point: there is no parameter to pass one. A live page cannot
      // quietly become a historical one.
      expect(live).not.toMatch(/dateFrom/);
      expect(live).not.toMatch(/dateTo/);
    });

    it('exposes no date range on the endpoint either', () => {
      expect(liveCtl).not.toMatch(/dateFrom|dateTo|timeframe/);
    });

    it('derives its window from the shift templates', () => {
      expect(live).toContain('currentShiftStart(');
    });

    it('reads the one canonical aggregate, not a query of its own', () => {
      expect(live).toContain('machineFactTotals(');
      expect(live.match(/SUM\(\s*"?runMin/gi)).toBeNull();
      expect(live.match(/SUM\(\s*"?plannedMin/gi)).toBeNull();
    });
  });

  describe('the analytics service cannot read the present', () => {
    it('does not read the live machine state table', () => {
      // MachineCurrentStatus holds "now" and has no meaning in a window. An
      // analytics page that consulted it would report an instant inside a period.
      expect(analytics).not.toMatch(/machineCurrentStatus/i);
    });

    it('does not read job orders directly', () => {
      // Job-order state is live. Everything historical about a job order is in
      // the fact store, tagged with its id.
      expect(analytics).not.toMatch(/prisma\.jobOrder\b/);
    });
  });

  describe('no surface grades a job order on its own', () => {
    const production = src('production.service.ts');

    it('has removed calcJobOrderOEE entirely', () => {
      // It computed availability as elapsed-since-start over planned duration with
      // NO downtime subtracted — the fail-open assumption, still running in its own
      // corner long after the fact store stopped making it. The shop-floor live
      // page and every per-step badge read from it.
      expect(production).not.toMatch(/calcJobOrderOEE/);
    });

    it('reads step factors from the fact store instead', () => {
      expect(production).toContain('jobOrderFactTotals(');
    });

    it('batches them, so a list of steps is one query not forty', () => {
      expect(production).toMatch(/jobOrderFactors\(\s*[\s\S]{0,120}flatMap/);
    });
  });

  describe('the browser cannot reintroduce a time filter either', () => {
    // The web package has no test runner of its own, and this invariant is worth
    // more than the tidiness of keeping the check in the same package as the code.
    // Both live in one repo and ship together.
    const liveDir = join(__dirname, '../../../../web/src/features/live');
    // Comments are stripped: live-shared.tsx states the rule in prose, naming the
    // hook it must never import, and a scan that counted prose as code would fail
    // on the explanation rather than on the code.
    const read = (f: string) => readFileSync(join(liveDir, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    it('the live feature folder exists where expected', () => {
      // A moved folder must fail loudly rather than skip silently — a guard that
      // quietly stops running is worse than no guard.
      expect(existsSync(liveDir)).toBe(true);
    });

    it.each(['live-shared.tsx', 'live-production-view.tsx', 'live-machines-view.tsx'])(
      '%s does not import the time-range hook',
      (f) => {
        expect(read(f)).not.toMatch(/use-time-range|useTimeRange/);
      },
    );

    it.each(['live-production-view.tsx', 'live-machines-view.tsx'])(
      '%s goes through the shared hook rather than its own query',
      (f) => {
        const src = read(f);
        expect(src).toContain('useLive(');
        // A page with its own useQuery could point at a historical endpoint and
        // drift from its sibling without anyone noticing.
        expect(src).not.toMatch(/useQuery\(/);
      },
    );

    it('sends only a line from the scope tree, never a machine', () => {
      const src = read('live-shared.tsx');
      expect(src).toMatch(/type === 'LINE'/);
    });
  });

  describe('both answer with the same arithmetic', () => {
    it('routes through the canonical aggregate in kpi.service', () => {
      for (const s of [live, analytics]) expect(s).toContain('machineFactTotals(');
    });

    it('reports no availability rather than 0% when nothing was planned', () => {
      // Shared rule: 0% accuses a machine of failing when it was never asked to
      // run. Both surfaces must agree on that, or the same machine reads 0% on
      // one page and "—" on the other.
      expect(live).toMatch(/plannedMin > 0 \?/);
    });
  });
});
