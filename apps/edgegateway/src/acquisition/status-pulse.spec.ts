import { StatusService, type StatusTag } from './status.service';

/**
 * Three machine states carried on a single bit.
 *
 * NCC's Euro-Pack Robot signal (I/O ID 5):
 *   steady ON — running with product, or ready with none
 *   PULSING   — stop mode
 *   OFF       — alarm or emergency stop
 *
 * Reading the level alone cannot separate running from stopped, because a pulsing
 * signal is high half the time. Sampling it naively reports the machine as
 * alternately running and broken every second, filling the downtime log with
 * one-second events and destroying its availability.
 *
 * So the bit is judged by how often it CHANGES. These tests pin that, including
 * the case that makes the naive implementation look correct — a pulsing signal
 * sampled while it happens to be high.
 */
describe('StatusService — three states on one bit', () => {
  /** No state is written here; only `derive` is under test. */
  function build() {
    const prisma = {
      jobOrder: { count: jest.fn().mockResolvedValue(1) }, // an order IS running
      machineCurrentStatus: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      downtimeEvent: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
      workOrder: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
    };
    const inference = { classify: jest.fn(async (_m: string, s: string) => s) };
    const svc = new StatusService(prisma as never, inference as never);
    /** `derive` is private; this is the behaviour under test. */
    const derive = (tag: StatusTag, v: number) => (svc as never as {
      derive(t: StatusTag, n: number): Promise<string | null>;
    }).derive(tag, v);
    return { derive };
  }

  const pulsedTag: StatusTag = {
    tagId: 'euro-pack-run', factoryId: 'f1', machineId: 'm4',
    dataType: 'BOOL', statusMap: null, signalRole: 'RUN_MODE_PULSED',
  };
  const plainTag: StatusTag = {
    tagId: 'cartomac-run', factoryId: 'f1', machineId: 'm3',
    dataType: 'BOOL', statusMap: null, signalRole: 'RUN_MODE',
  };

  it('reads a steady HIGH signal as running', async () => {
    const { derive } = build();
    for (let i = 0; i < 10; i++) expect(await derive(pulsedTag, 1)).toBe('RUNNING');
  });

  it('reads a steady LOW signal as a fault', async () => {
    const { derive } = build();
    // First sample is the initial level, so no transition is recorded.
    await derive(pulsedTag, 0);
    expect(await derive(pulsedTag, 0)).toBe('BREAKDOWN');
  });

  it('reads a PULSING signal as stop mode, not as running or broken', async () => {
    const { derive } = build();
    let last: string | null = null;
    // Four full cycles — well past the edge threshold.
    for (let i = 0; i < 8; i++) last = await derive(pulsedTag, i % 2);
    expect(last).toBe('IDLE');
  });

  it('still reports stop mode when the pulse is sampled while HIGH', async () => {
    // The case that makes a level-only implementation look correct: the signal is
    // oscillating, and this particular sample lands on the high half.
    const { derive } = build();
    for (let i = 0; i < 8; i++) await derive(pulsedTag, i % 2);
    expect(await derive(pulsedTag, 1)).toBe('IDLE');
  });

  it('recovers to running once the signal settles high again', async () => {
    const { derive } = build();
    for (let i = 0; i < 8; i++) await derive(pulsedTag, i % 2);
    expect(await derive(pulsedTag, 1)).toBe('IDLE');

    // The window is time-based, so advance the clock rather than the sample count.
    const realNow = Date.now;
    Date.now = () => realNow() + 60_000;
    try {
      expect(await derive(pulsedTag, 1)).toBe('RUNNING');
    } finally {
      Date.now = realNow;
    }
  });

  it('does not treat a single start or stop as pulsing', async () => {
    // One machine stopping and restarting is two edges, not a pulse train.
    const { derive } = build();
    await derive(pulsedTag, 1);
    await derive(pulsedTag, 0);
    expect(await derive(pulsedTag, 1)).toBe('RUNNING');
  });

  it('leaves a plain RUN_MODE bit alone — no pulse logic applied', async () => {
    // Cartomac's signal has two states. Oscillation there is a machine starting and
    // stopping, and must be reported as exactly that.
    const { derive } = build();
    for (let i = 0; i < 8; i++) await derive(plainTag, i % 2);
    expect(await derive(plainTag, 1)).toBe('RUNNING');
    expect(await derive(plainTag, 0)).toBe('BREAKDOWN');
  });

  it('keeps RUN_MODE ON meaning ABLE to work, not necessarily working', async () => {
    // NCC: "ON: running/ready, INCLUDING the condition where the machine is ready
    // but no product is currently being processed." Whether it is actually working
    // is decided later, by the PROCESSING signal.
    const { derive } = build();
    expect(await derive(plainTag, 1)).toBe('RUNNING');
  });
});
