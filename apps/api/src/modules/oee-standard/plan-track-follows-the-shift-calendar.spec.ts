import { StateTimelineService } from './state-timeline.service';

/**
 * The plan track draws what the plant SCHEDULED — bounded by the hours it is
 * actually manned.
 *
 * ── Why this is pinned ──────────────────────────────────────────────────────
 * `plannedSegments` fills the gaps between booked stops with scheduled
 * production. Its first version filled every gap in the requested window, which
 * is right on this plant and wrong everywhere else: SDPF runs two twelve-hour
 * templates that tile the day, so the bug was invisible here and would have
 * shown a single-shift plant sixteen hours of green production it never
 * scheduled. Verified against the live database before and after the fix: byte
 * for byte the same output, which is exactly why it needed a test rather than a
 * look.
 *
 * These drive the real service with a stubbed Prisma, so the shift arithmetic,
 * the midnight crossing and the union rule are the shipped ones.
 */

type Stop = {
  machineId: string; reason: string; category: string; affectsOEE: boolean;
  startTime: Date; endTime: Date | null; machine: { code: string };
};
type Template = { startTime: string; endTime: string; crossesMidnight: boolean };

const stubPrisma = (events: Stop[], templates: Template[]) => ({
  downtimeEvent: { findMany: jest.fn().mockResolvedValue(events) },
  shiftTemplate: { findMany: jest.fn().mockResolvedValue(templates) },
}) as any;

const stop = (fromH: number, fromM: number, toH: number, toM: number, reason = 'Cleaning', charged = false): Stop => ({
  machineId: 'M', reason, category: 'PLANNED', affectsOEE: charged,
  // Local time deliberately: the service resolves shift windows against the
  // plant's own clock, which is the only clock a shift means anything in.
  startTime: new Date(2026, 7, 25, fromH, fromM),
  endTime: new Date(2026, 7, 25, toH, toM),
  machine: { code: 'M1' },
});

const DAY_FROM = new Date(2026, 7, 25, 0, 0);
const DAY_TO = new Date(2026, 7, 26, 0, 0);

const run = async (events: Stop[], templates: Template[]) => {
  const svc = new StateTimelineService(stubPrisma(events, templates));
  return svc.plannedSegments('F', DAY_FROM, DAY_TO, {});
};

const minutesOf = (segs: Array<{ state: string; minutes: number }>, state: string) =>
  segs.filter((s) => s.state === state).reduce((a, s) => a + s.minutes, 0);

describe('the plan track is bounded by the shift calendar', () => {
  it('draws production only inside a single shift, not across the whole day', async () => {
    const segs = await run(
      [stop(12, 0, 13, 0, 'Lunch Break')],
      [{ startTime: '08:00', endTime: '16:00', crossesMidnight: false }],
    );
    // 8 manned hours, one booked out: 420 minutes of scheduled production.
    // The old behaviour returned 1380 — the whole day minus the stop.
    expect(minutesOf(segs, 'PRODUCTION')).toBe(420);
    expect(minutesOf(segs, 'PLANNED_STOP')).toBe(60);
  });

  it('fills the whole day when the templates tile it — this plant, unchanged', async () => {
    const segs = await run(
      [stop(4, 30, 5, 0), stop(9, 0, 10, 0, 'Lunch Break')],
      [
        { startTime: '07:30', endTime: '19:30', crossesMidnight: false },
        { startTime: '19:30', endTime: '07:30', crossesMidnight: true },
      ],
    );
    expect(minutesOf(segs, 'PRODUCTION') + minutesOf(segs, 'PLANNED_STOP')).toBe(24 * 60);
  });

  it('counts a stop booked twice over the same minutes once', async () => {
    // The union rule, here as well as in the finish estimate: this line runs its
    // steps start-to-start, so one line-wide window arrives as several rows.
    const segs = await run(
      [stop(9, 0, 10, 0, 'Lunch Break'), stop(9, 0, 10, 0, 'Lunch Break')],
      [{ startTime: '08:00', endTime: '16:00', crossesMidnight: false }],
    );
    expect(minutesOf(segs, 'PRODUCTION')).toBe(420);
  });

  it('still draws a stop booked outside the manned hours', async () => {
    // Somebody entered it on the schedule screen. Hiding it here would make this
    // chart disagree with the screen the plant typed it into.
    const segs = await run(
      [stop(2, 0, 3, 0, 'Maintenance')],
      [{ startTime: '08:00', endTime: '16:00', crossesMidnight: false }],
    );
    expect(minutesOf(segs, 'PLANNED_STOP')).toBe(60);
    expect(minutesOf(segs, 'PRODUCTION')).toBe(480); // the shift is untouched
  });

  it('carries an overnight shift across midnight into the window', async () => {
    const segs = await run(
      [stop(23, 0, 23, 30)],
      [{ startTime: '22:00', endTime: '06:00', crossesMidnight: true }],
    );
    // 00:00–06:00 belongs to the occurrence that began the previous evening, and
    // 22:00–24:00 to the one beginning tonight: 8 manned hours, 30 min booked.
    expect(minutesOf(segs, 'PRODUCTION')).toBe(8 * 60 - 30);
  });

  it('treats the whole window as manned when no templates are configured', async () => {
    // A plant that has not told the system its calendar. Named as an assumption
    // rather than left as an accident — and it is the only case that guesses.
    const segs = await run([stop(9, 0, 10, 0)], []);
    expect(minutesOf(segs, 'PRODUCTION')).toBe(24 * 60 - 60);
  });

  it('names each block from the schedule, and marks the charged ones', async () => {
    const segs = await run(
      [stop(8, 0, 8, 30, 'Startup', true), stop(12, 0, 13, 0, 'Lunch Break', false)],
      [{ startTime: '08:00', endTime: '16:00', crossesMidnight: false }],
    );
    const startup = segs.find((s) => s.label === 'Startup');
    const lunch = segs.find((s) => s.label === 'Lunch Break');
    // A planned stop that still costs the reading is not the same block as one
    // that leaves the denominator, and the row has to be able to say so.
    expect(startup?.kind).toBe('downtime');
    expect(lunch?.kind).toBe('planned');
  });

  it('returns nothing when nothing was booked, rather than a day of green', async () => {
    // No schedule is not "scheduled to run all day". The chart reads an empty
    // result as "this machine has no plan track" and draws one band.
    expect(await run([], [{ startTime: '08:00', endTime: '16:00', crossesMidnight: false }]))
      .toEqual([]);
  });
});
