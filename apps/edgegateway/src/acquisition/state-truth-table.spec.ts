import { StateInferenceService } from './state-inference.service';

/**
 * The state truth table.
 *
 *   RUN  PROC   cause                    state
 *   ───  ────   ──────────────────────   ──────────
 *    1     1    —                        RUNNING
 *    1     0    nothing arriving         STARVED
 *    1     0    cannot discharge         BLOCKED
 *    0    0/1   nothing arriving         STARVED
 *    0    0/1   cannot discharge         BLOCKED
 *    0    0/1   neither                  BREAKDOWN
 *
 * ── The point these tests defend ────────────────────────────────────────────
 * STARVED and BLOCKED name WHERE the cause is, and they point in opposite
 * directions along the line:
 *
 *   STARVED  nothing is arriving  → the machine BEFORE  (upstream)
 *   BLOCKED  nowhere to discharge → the machine AFTER   (downstream)
 *
 * So each is asked of its own side. An earlier draft of this file inferred
 * BLOCKED from "the machine before is running" — reasoning that if material
 * arrives and is not consumed, something ahead must be holding it. That is a
 * proxy, not the thing itself: a machine can be fed, idle and simply faulty, and
 * the proxy files its breakdown as an external loss, removing it from OEE.
 */
describe('StateInferenceService — the truth table', () => {
  // A five-station line: M1 fills → M2 weighs → M3 cartons → M4 palletises →
  // M5 wraps. M3 is the machine under test, so it has both neighbours.
  const LINE = [
    { id: 'm1', sortOrder: 1 }, { id: 'm2', sortOrder: 2 }, { id: 'm3', sortOrder: 3 },
    { id: 'm4', sortOrder: 4 }, { id: 'm5', sortOrder: 5 },
  ];
  const ME = 'm3';

  function build(opts: {
    states: Record<string, string>;
    processing?: 0 | 1 | null;
    idleForMs?: number;
  }) {
    const { states, processing = null, idleForMs = 10 * 60_000 } = opts;
    const prisma: any = {
      machine: {
        findUnique: jest.fn(async ({ where }: any) => ({
          ...LINE.find((m) => m.id === where.id)!, lineId: 'L1',
        })),
        findMany: jest.fn().mockResolvedValue(LINE),
      },
      machineCurrentStatus: {
        findMany: jest.fn(async ({ where }: any) =>
          (where.machineId.in as string[])
            .filter((id) => states[id] !== undefined)
            .map((id) => ({ machineId: id, state: states[id] }))),
        findUnique: jest.fn(async ({ where }: any) =>
          states[where.machineId] ? { state: states[where.machineId] } : null),
      },
      tagDefinition: {
        findFirst: jest.fn(async ({ where }: any) =>
          where?.signalRole === 'PROCESSING'
            ? (processing === null ? null : { id: 'proc', idleThresholdMs: 5 * 60_000 })
            : null),
        findMany: jest.fn().mockResolvedValue([]),   // no INFEED/OUTFEED bound
      },
      tagCurrentValue: {
        findUnique: jest.fn(async () =>
          processing === null ? null
            : { value: processing, quality: 'GOOD', timestamp: new Date(Date.now() - idleForMs) }),
      },
    };
    return new StateInferenceService(prisma as never);
  }

  const RUN = 'RUNNING';
  /** Everything up and running except where stated. */
  const allRunning = { m1: RUN, m2: RUN, m3: RUN, m4: RUN, m5: RUN };

  // ── RUN = 1 ───────────────────────────────────────────────────────────────
  it('RUN 1 + PROC 1 → RUNNING', async () => {
    const s = build({ states: allRunning, processing: 1 });
    await expect(s.classify(ME, RUN)).resolves.toBe(RUN);
  });

  it('RUN 1 + PROC 0 + nothing arriving → STARVED', async () => {
    // Upstream is down, so the cartoner is ready with nothing to card.
    const s = build({ states: { ...allRunning, m1: 'BREAKDOWN', m2: 'BREAKDOWN' }, processing: 0 });
    await expect(s.classify(ME, RUN)).resolves.toBe('STARVED');
  });

  it('RUN 1 + PROC 0 + cannot discharge → BLOCKED', async () => {
    // Fed, but the machines AFTER it have stopped — the cartons have nowhere to
    // go. This is the case the upstream proxy could not tell apart from a fault.
    const s = build({ states: { ...allRunning, m4: 'BREAKDOWN', m5: 'BREAKDOWN' }, processing: 0 });
    await expect(s.classify(ME, RUN)).resolves.toBe('BLOCKED');
  });

  it('RUN 1 + PROC 0 + fed and able to discharge → stays RUNNING', async () => {
    // Nothing outside the machine explains it. Calling this STARVED or BLOCKED
    // would excuse an internal problem as somebody else's.
    const s = build({ states: allRunning, processing: 0 });
    await expect(s.classify(ME, RUN)).resolves.toBe(RUN);
  });

  // ── RUN = 0 ───────────────────────────────────────────────────────────────
  it('RUN 0 + nothing arriving → STARVED', async () => {
    const s = build({ states: { ...allRunning, m1: 'BREAKDOWN', m2: 'BREAKDOWN', m3: 'BREAKDOWN' } });
    await expect(s.classify(ME, 'BREAKDOWN')).resolves.toBe('STARVED');
  });

  it('RUN 0 + cannot discharge → BLOCKED', async () => {
    const s = build({ states: { ...allRunning, m3: 'BREAKDOWN', m4: 'BREAKDOWN', m5: 'BREAKDOWN' } });
    await expect(s.classify(ME, 'BREAKDOWN')).resolves.toBe('BLOCKED');
  });

  it('RUN 0 + neighbours fine → BREAKDOWN', async () => {
    // Work was arriving and could be passed on, and it stopped anyway. Its own,
    // and it must be charged to availability rather than excused.
    const s = build({ states: { ...allRunning, m3: 'BREAKDOWN' } });
    await expect(s.classify(ME, 'BREAKDOWN')).resolves.toBe('BREAKDOWN');
  });

  it('prefers STARVED when the line is stopped on both sides', async () => {
    // Nothing arriving AND nowhere to send it. The true constraint is the one
    // starving the line — that is where a fix has to go.
    const s = build({ states: { m1: 'BREAKDOWN', m2: 'BREAKDOWN', m3: 'BREAKDOWN', m4: 'BREAKDOWN', m5: 'BREAKDOWN' } });
    await expect(s.classify(ME, 'BREAKDOWN')).resolves.toBe('STARVED');
  });

  // ── The two symptom-versus-cause rules ────────────────────────────────────
  it('is not starved by an upstream that is merely BLOCKED', async () => {
    // A blocked upstream HAS product and cannot pass it on — usually because this
    // machine stopped taking it. Blaming it would file this machine's own jam as
    // an external loss and remove it from OEE.
    const s = build({ states: { ...allRunning, m1: 'BLOCKED', m2: 'BLOCKED', m3: 'BREAKDOWN' } });
    await expect(s.classify(ME, 'BREAKDOWN')).resolves.toBe('BREAKDOWN');
  });

  it('is not blocked by a downstream that is merely STARVED', async () => {
    // A starved downstream is WAITING for product, which is the opposite of
    // refusing it — and it is usually waiting because of this machine. Reading it
    // as a blockage inverts the line and hides the real constraint.
    const s = build({ states: { ...allRunning, m3: 'BREAKDOWN', m4: 'STARVED', m5: 'STARVED' } });
    await expect(s.classify(ME, 'BREAKDOWN')).resolves.toBe('BREAKDOWN');
  });

  // ── The conservative edges ────────────────────────────────────────────────
  it('leaves a running machine alone when no PROCESSING signal is wired', async () => {
    // Silence is not evidence. Declaring starvation here would move a real loss
    // out of OEE and flatter the equipment.
    const s = build({ states: allRunning, processing: null });
    await expect(s.classify(ME, RUN)).resolves.toBe(RUN);
  });

  it('treats a brief gap between units as still processing', async () => {
    // A wrapper rests between pallets; a filler does not. Only a gap longer than
    // that signal's own slowest normal cycle counts.
    const s = build({ states: { ...allRunning, m1: 'BREAKDOWN', m2: 'BREAKDOWN' }, processing: 0, idleForMs: 30_000 });
    await expect(s.classify(ME, RUN)).resolves.toBe(RUN);
  });

  it('never overrules a machine that reported STARVED or BLOCKED itself', async () => {
    const s = build({ states: allRunning, processing: 1 });
    await expect(s.classify(ME, 'STARVED')).resolves.toBe('STARVED');
    await expect(s.classify(ME, 'BLOCKED')).resolves.toBe('BLOCKED');
  });

  it('never reclassifies a stop that already carries an explanation', async () => {
    // A changeover is a decision somebody made. Turning it into starvation moves
    // a PLANNED stop into an EXTERNAL loss and changes what OEE excludes.
    const s = build({ states: { ...allRunning, m1: 'BREAKDOWN', m2: 'BREAKDOWN' } });
    await expect(s.classify(ME, 'CHANGEOVER')).resolves.toBe('CHANGEOVER');
  });
});
