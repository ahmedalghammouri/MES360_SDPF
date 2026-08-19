import { StateInferenceService } from './state-inference.service';

/**
 * The state truth table, as the plant specified it.
 *
 *   RUN  PROC   upstream      state
 *   ───  ────   ───────────   ──────────
 *    1     1    —             RUNNING
 *    1     0    stopped       STARVED     nothing is arriving
 *    1     0    running       BLOCKED     product is arriving and this machine is
 *                                         not consuming it, so something ahead of
 *                                         it is holding it
 *    0    0/1   stopped       STARVED     it shut down for want of work
 *    0    0/1   running       BREAKDOWN   work was there and it stopped anyway
 *
 * The upstream neighbour decides both halves, and that is the whole model: on a
 * serial line, whether material is arriving is the only question separating
 * "waiting" from "at fault", and the machine before you is the one that answers.
 *
 * This replaces an earlier version that inferred BLOCKED by asking DOWNSTREAM
 * whether it could accept — which needed a rule about neighbours that are
 * themselves symptoms, because a machine could be reported blocked by the very
 * machine it had starved. Deciding from upstream cannot produce that inversion.
 */
describe('StateInferenceService — the truth table', () => {
  const ME = 'm3', UP = 'm2';

  function build(opts: { processing?: 0 | 1 | null; idleForMs?: number; upstream?: string | null }) {
    const { processing = null, idleForMs = 10 * 60_000, upstream = 'RUNNING' } = opts;

    const prisma: any = {
      tagDefinition: {
        findFirst: jest.fn(async ({ where }: any) =>
          where?.signalRole === 'PROCESSING'
            ? (processing === null ? null : { id: 'tag-proc', idleThresholdMs: 5 * 60_000 })
            : null),
        findMany: jest.fn().mockResolvedValue([]), // no INFEED/OUTFEED signals bound
      },
      tagCurrentValue: {
        findUnique: jest.fn().mockResolvedValue(
          processing === null ? null
            : { value: processing, quality: 'GOOD', timestamp: new Date(Date.now() - idleForMs) },
        ),
      },
      machine: {
        findUnique: jest.fn().mockResolvedValue({ id: ME, lineId: 'L1', sortOrder: 3 }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'm1', sortOrder: 1 },
          { id: UP, sortOrder: 2 },
          { id: ME, sortOrder: 3 },
          { id: 'm4', sortOrder: 4 },
        ]),
      },
      machineCurrentStatus: {
        findUnique: jest.fn().mockResolvedValue(upstream === null ? null : { state: upstream }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    return new StateInferenceService(prisma as never);
  }

  // ── RUN = 1 ───────────────────────────────────────────────────────────────
  it('RUN 1 + PROC 1 → RUNNING', async () => {
    const s = build({ processing: 1 });
    await expect(s.classify(ME, 'RUNNING')).resolves.toBe('RUNNING');
  });

  it('RUN 1 + PROC 0 + upstream stopped → STARVED', async () => {
    // Nothing is arriving. The machine is ready and has no work.
    const s = build({ processing: 0, upstream: 'BREAKDOWN' });
    await expect(s.classify(ME, 'RUNNING')).resolves.toBe('STARVED');
  });

  it('RUN 1 + PROC 0 + upstream running → BLOCKED', async () => {
    // Product IS arriving and this machine is not consuming it, so something
    // ahead of it is holding it.
    const s = build({ processing: 0, upstream: 'RUNNING' });
    await expect(s.classify(ME, 'RUNNING')).resolves.toBe('BLOCKED');
  });

  // ── RUN = 0 ───────────────────────────────────────────────────────────────
  it('RUN 0 + upstream stopped → STARVED', async () => {
    const s = build({ processing: 0, upstream: 'BREAKDOWN' });
    await expect(s.classify(ME, 'BREAKDOWN')).resolves.toBe('STARVED');
  });

  it('RUN 0 + upstream running → stays BREAKDOWN', async () => {
    // Work was there and it stopped anyway: its own fault, and it must be
    // charged to availability rather than excused as an external loss.
    const s = build({ processing: 0, upstream: 'RUNNING' });
    await expect(s.classify(ME, 'BREAKDOWN')).resolves.toBe('BREAKDOWN');
  });

  it('RUN 0 + PROC 1 still follows upstream', async () => {
    // The table says 0/1 for PROC when RUN is 0 — a stale processing bit must
    // not rescue a machine that has stopped.
    const s = build({ processing: 1, upstream: 'BREAKDOWN' });
    await expect(s.classify(ME, 'BREAKDOWN')).resolves.toBe('STARVED');
  });

  // ── The conservative edges ────────────────────────────────────────────────
  it('leaves a running machine alone when no PROCESSING signal is wired', async () => {
    // Silence is not evidence. Declaring starvation here would move a real loss
    // out of OEE and flatter the equipment.
    const s = build({ processing: null });
    await expect(s.classify(ME, 'RUNNING')).resolves.toBe('RUNNING');
  });

  it('treats a brief gap between units as still processing', async () => {
    // A wrapper rests between pallets. Only a gap longer than that signal's own
    // slowest normal cycle counts as not processing.
    const s = build({ processing: 0, idleForMs: 30_000 });
    await expect(s.classify(ME, 'RUNNING')).resolves.toBe('RUNNING');
  });

  it('never overrules a machine that reported STARVED or BLOCKED itself', async () => {
    const s = build({ processing: 1, upstream: 'RUNNING' });
    await expect(s.classify(ME, 'STARVED')).resolves.toBe('STARVED');
    await expect(s.classify(ME, 'BLOCKED')).resolves.toBe('BLOCKED');
  });

  it('cannot starve the head of the line', async () => {
    const prisma: any = {
      tagDefinition: {
        findFirst: jest.fn().mockResolvedValue({ id: 't', idleThresholdMs: 1000 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      tagCurrentValue: { findUnique: jest.fn().mockResolvedValue({ value: 0, quality: 'GOOD', timestamp: new Date(0) }) },
      machine: {
        findUnique: jest.fn().mockResolvedValue({ id: 'm1', lineId: 'L1', sortOrder: 1 }),
        findMany: jest.fn().mockResolvedValue([{ id: 'm1', sortOrder: 1 }, { id: 'm2', sortOrder: 2 }]),
      },
      machineCurrentStatus: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    };
    const s = new StateInferenceService(prisma as never);
    // No upstream exists, so there is nothing that could be failing to feed it.
    await expect(s.classify('m1', 'RUNNING')).resolves.toBe('RUNNING');
  });
});
