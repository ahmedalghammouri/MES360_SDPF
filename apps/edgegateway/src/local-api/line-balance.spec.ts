import { LineBalanceService } from './line-balance.service';

/**
 * Balancing counters against the material between them.
 *
 * ── The rule being enforced ─────────────────────────────────────────────────
 * Material is conserved. What left one machine either entered the next, or is
 * still on the conveyor between them. So once the conveyor's capacity is known,
 * the difference physics ALLOWS is a number — and only what exceeds it is a
 * counting error.
 *
 * That makes these tests unusually worth writing, because the failure mode is a
 * plausible-looking number. A balancer that corrects too eagerly invents
 * production; one that corrects in the wrong direction accuses the wrong
 * machine; one that quietly absorbs a large drift hides a broken sensor for
 * months. Each of those renders perfectly on a dashboard.
 */
describe('line balance', () => {
  const NCC = { unitsPerInner: 1, innersPerCarton: 4, cartonsPerPallet: 40, baseUnit: 'CARTON' };

  /** Build a service over a fixed count picture and a fixed config. */
  function build(
    steps: Array<{ code: string; unit: string; good: number; reject?: number }>,
    cfg: Array<Partial<Record<string, unknown>>> = [],
  ) {
    const counts: any = {
      balance: async () => [{
        workOrderId: 'wo-1', orderNumber: 'WO-1',
        skuCode: 'S', skuName: 'S', packaging: NCC,
        ladder: { PIECE: 1, INNER: 1, CARTON: 4, PALLET: 160 },
        commonUnit: 'INNER',
        steps: steps.map((s, i) => {
          const mul = s.unit === 'CARTON' ? 4 : s.unit === 'PALLET' ? 160 : 1;
          const reject = s.reject ?? 0;
          return {
            jobOrderId: `jo-${i}`, sequenceOrder: i + 1, operationName: 'Op',
            machineId: s.code, machineCode: s.code, machineName: s.code,
            unit: s.unit, good: s.good, reject, total: s.good + reject,
            goodCommon: s.good * mul, rejectCommon: reject * mul,
            totalCommon: (s.good + reject) * mul,
            diffFromPrev: null, unconvertible: false,
          };
        }),
      }],
    };
    const prisma: any = {
      lineBalanceConfig: {
        findMany: async () => cfg.map((c) => ({
          machineId: c.machineId, enabled: c.enabled ?? true, isAnchor: c.isAnchor ?? false,
          bufferToNextQty: c.bufferToNextQty ?? null, bufferUnit: c.bufferUnit ?? null, transitSec: null,
          maxCorrectionPct: c.maxCorrectionPct ?? 10, applyAdjustment: false,
        })),
      },
    };
    return new LineBalanceService(prisma, { getFactoryId: () => 'f1' } as any, counts);
  }

  const at = (run: any, code: string) => run.steps.find((s: any) => s.machineCode === code);

  it('leaves a gap the conveyor can hold completely alone', async () => {
    // M2 made 1584 inners, M3 has palletised 1440. The other 144 are on the
    // conveyor. This is the ordinary state of a running line, not an error, and
    // a balancer that "fixed" it would be inventing a fault.
    const svc = build(
      [{ code: 'M2', unit: 'CARTON', good: 396 }, { code: 'M3', unit: 'PALLET', good: 9 }],
      [{ machineId: 'M2', bufferToNextQty: 400 }, { machineId: 'M3', isAnchor: true }],
    );
    const [run] = await svc.balance();

    expect(at(run, 'M2').verdict).toBe('BALANCED');
    expect(at(run, 'M2').correction).toBe(0);
    expect(at(run, 'M2').explainedByBuffer).toBe(144);
    expect(at(run, 'M2').unexplained).toBe(0);
  });

  it('corrects a machine that reports less than the one after it processed', async () => {
    // 1450 inners claimed by the filler; the cartoner turned 1584 into cartons.
    // Material does not appear on a conveyor, so the filler is short by 134 AT
    // LEAST — and 134 is exactly what it is credited with.
    const svc = build(
      [
        { code: 'M1', unit: 'INNER', good: 1450 },
        { code: 'M2', unit: 'CARTON', good: 396 },
        { code: 'M3', unit: 'PALLET', good: 9 },
      ],
      [
        { machineId: 'M1', bufferToNextQty: 200 },
        { machineId: 'M2', bufferToNextQty: 400 },
        { machineId: 'M3', isAnchor: true },
      ],
    );
    const [run] = await svc.balance();

    const m1 = at(run, 'M1');
    expect(m1.verdict).toBe('CORRECTED');
    expect(m1.correction).toBe(134);
    expect(m1.balancedCommon).toBe(1584);
  });

  it('credits the MINIMUM, never the minimum plus an assumed buffer', async () => {
    // The tempting extra step is to add the conveyor's contents on top, since
    // there is probably material there too. That is the fabrication this design
    // exists to refuse: the balance grants only what the line forces to be true.
    const svc = build(
      [{ code: 'M1', unit: 'INNER', good: 900 }, { code: 'M2', unit: 'INNER', good: 1000 }],
      // A generous ceiling: this test is about WHAT is credited, not how much
      // of it survives the cap, which the clamping test covers separately.
      [{ machineId: 'M1', bufferToNextQty: 500, maxCorrectionPct: 100 }, { machineId: 'M2', isAnchor: true }],
    );
    const [run] = await svc.balance();

    expect(at(run, 'M1').balancedCommon).toBe(1000);   // not 1000 + 500
    expect(at(run, 'M1').correction).toBe(100);
  });

  it('never touches the anchor', async () => {
    const svc = build(
      [{ code: 'M1', unit: 'INNER', good: 500 }, { code: 'M2', unit: 'INNER', good: 900 }],
      [{ machineId: 'M1', bufferToNextQty: 50 }, { machineId: 'M2', isAnchor: true }],
    );
    const [run] = await svc.balance();

    expect(at(run, 'M2').verdict).toBe('ANCHOR');
    expect(at(run, 'M2').correction).toBe(0);
    expect(at(run, 'M2').balancedCommon).toBe(900);
  });

  it('clamps a correction at its ceiling and says what it refused', async () => {
    // The whole point of the ceiling: a sensor drifting 22% is a maintenance
    // problem, and a balancer that silently absorbed it would hide the fault it
    // is meant to expose. So it is capped AND the requested figure is reported.
    const svc = build(
      [{ code: 'M1', unit: 'INNER', good: 1000 }, { code: 'M2', unit: 'INNER', good: 1220 }],
      [
        { machineId: 'M1', bufferToNextQty: 100, maxCorrectionPct: 5 },
        { machineId: 'M2', isAnchor: true },
      ],
    );
    const [run] = await svc.balance();

    const m1 = at(run, 'M1');
    expect(m1.verdict).toBe('CLAMPED');
    expect(m1.requestedCorrection).toBe(220);
    expect(m1.correction).toBe(50);                    // 5% of 1000
    expect(m1.balancedCommon).toBe(1050);
    expect(m1.reason).toContain('220');
  });

  it('refuses to balance a link whose buffer is unknown', async () => {
    // An unmeasured conveyor is not an empty one. Guessing it holds nothing
    // would turn every legitimate work-in-progress gap into a false correction.
    const svc = build(
      [{ code: 'M1', unit: 'INNER', good: 800 }, { code: 'M2', unit: 'INNER', good: 1000 }],
      [{ machineId: 'M2', isAnchor: true }],
    );
    const [run] = await svc.balance();

    expect(at(run, 'M1').verdict).toBe('UNCONFIGURED');
    expect(at(run, 'M1').correction).toBe(0);
    expect(at(run, 'M1').balancedCommon).toBe(800);
  });

  it('leaves a machine alone when its balancing is switched off', async () => {
    const svc = build(
      [{ code: 'M1', unit: 'INNER', good: 800 }, { code: 'M2', unit: 'INNER', good: 1000 }],
      [
        { machineId: 'M1', bufferToNextQty: 50, enabled: false },
        { machineId: 'M2', isAnchor: true },
      ],
    );
    const [run] = await svc.balance();

    expect(at(run, 'M1').verdict).toBe('DISABLED');
    expect(at(run, 'M1').correction).toBe(0);
  });

  it('corrects downstream too, and reads the buffer from the link before it', async () => {
    // Propagation runs both ways from the anchor. Going forward, the conveyor
    // that matters is the one BEFORE the machine — configured on its neighbour.
    const svc = build(
      [
        { code: 'M1', unit: 'INNER', good: 1000 },
        { code: 'M2', unit: 'INNER', good: 400 },
      ],
      [
        { machineId: 'M1', isAnchor: true, bufferToNextQty: 100 },
        { machineId: 'M2', bufferToNextQty: null },
      ],
    );
    const [run] = await svc.balance();

    const m2 = at(run, 'M2');
    // 600 short, of which 100 can be on the conveyor → 500 is a miscount, but
    // the 10% ceiling on 400 allows only 40.
    expect(m2.explainedByBuffer).toBe(100);
    expect(m2.unexplained).toBe(500);
    expect(m2.verdict).toBe('CLAMPED');
  });

  it('falls back to the end of the line when no anchor is configured', async () => {
    // The last step counts the biggest, slowest, least missable units, so it is
    // the safest default reference — better than refusing to balance at all.
    const svc = build(
      [{ code: 'M1', unit: 'INNER', good: 900 }, { code: 'M2', unit: 'INNER', good: 1000 }],
      [{ machineId: 'M1', bufferToNextQty: 0, maxCorrectionPct: 100 }],
    );
    const [run] = await svc.balance();

    expect(run.anchorMachineId).toBe('M2');
    expect(at(run, 'M2').verdict).toBe('ANCHOR');
    expect(at(run, 'M1').correction).toBe(100);
  });

  it('reports the line total, so a drifting counter is visible at a glance', async () => {
    const svc = build(
      [
        { code: 'M1', unit: 'INNER', good: 900 },
        { code: 'M2', unit: 'INNER', good: 1000 },
      ],
      [{ machineId: 'M1', bufferToNextQty: 0, maxCorrectionPct: 100 }, { machineId: 'M2', isAnchor: true }],
    );
    const [run] = await svc.balance();
    expect(run.totalCorrection).toBe(100);
  });

  it('caps at ten percent by default, so an unconfigured line is conservative', async () => {
    // A machine with no ceiling set is not a machine with no ceiling. The
    // default has to be tight enough that a badly drifting sensor reaches it
    // and raises its hand, rather than being quietly smoothed over.
    const svc = build(
      [{ code: 'M1', unit: 'INNER', good: 1000 }, { code: 'M2', unit: 'INNER', good: 1500 }],
      [{ machineId: 'M1', bufferToNextQty: 0 }, { machineId: 'M2', isAnchor: true }],
    );
    const [run] = await svc.balance();

    expect(at(run, 'M1').requestedCorrection).toBe(500);
    expect(at(run, 'M1').correction).toBe(100);
    expect(at(run, 'M1').verdict).toBe('CLAMPED');
  });

  it('converts a capacity from the unit it was measured in', async () => {
    // SDPF's real conveyors, as they were counted on the floor:
    //   M1 -> M2   12 inners
    //   M2 -> M3    3 cartons  = 12 inners
    //   M3 -> M4    1 pallet   = 160 inners
    //
    // Typed in those units, not converted by hand. Asking an engineer holding a
    // tape measure to think in the line's common unit is how "3" gets entered
    // where 12 was meant — a wrong number that looks entirely reasonable.
    const svc = build(
      [
        { code: 'M1', unit: 'INNER', good: 1000 },
        { code: 'M2', unit: 'CARTON', good: 247 },
        { code: 'M3', unit: 'PALLET', good: 6 },
        { code: 'M4', unit: 'PALLET', good: 5 },
      ],
      [
        { machineId: 'M1', bufferToNextQty: 12, bufferUnit: 'INNER' },
        { machineId: 'M2', bufferToNextQty: 3, bufferUnit: 'CARTON' },
        { machineId: 'M3', bufferToNextQty: 1, bufferUnit: 'PALLET', isAnchor: true },
      ],
    );
    const [run] = await svc.balance();

    expect(at(run, 'M1').bufferCommon).toBe(12);
    expect(at(run, 'M2').bufferCommon).toBe(12);     // 3 cartons
    expect(at(run, 'M3').bufferCommon).toBe(160);    // 1 pallet
  });

  it('treats a capacity with no unit as already in the common unit', async () => {
    // Rows saved before the unit existed must keep meaning what they meant.
    const svc = build(
      [{ code: 'M1', unit: 'INNER', good: 900 }, { code: 'M2', unit: 'INNER', good: 1000 }],
      [{ machineId: 'M1', bufferToNextQty: 50 }, { machineId: 'M2', isAnchor: true }],
    );
    const [run] = await svc.balance();
    expect(at(run, 'M1').bufferCommon).toBe(50);
  });

  it('chains through the neighbour, so each row is ONE belt and not a running total', async () => {
    // The question this answers: for M1, do you enter the belt to M2, or
    // everything between M1 and the anchor? One belt — because M1 is measured
    // against M2's ALREADY CORRECTED figure, not against the anchor. Summing
    // them would count M2's belt twice.
    //
    // The plant's own numbers: anchor M3 at 108 pallets, M2 with 3 cartons of
    // belt, M1 with 12 inners of belt.
    const svc = build(
      [
        { code: 'M1', unit: 'INNER', good: 17226 },
        { code: 'M2', unit: 'CARTON', good: 4334 },
        { code: 'M3', unit: 'PALLET', good: 108 },
      ],
      [
        { machineId: 'M1', bufferToNextQty: 12, bufferUnit: 'INNER' },
        { machineId: 'M2', bufferToNextQty: 3, bufferUnit: 'CARTON' },
        { machineId: 'M3', isAnchor: true },
      ],
    );
    const [run] = await svc.balance();

    // M2 against the anchor: 17,336 - 17,280 = 56, of which its own 12 is belt.
    expect(at(run, 'M2').goodCommon).toBe(17336);
    expect(at(run, 'M2').explainedByBuffer).toBe(12);
    expect(at(run, 'M2').correction).toBe(-44);
    expect(at(run, 'M2').balancedCommon).toBe(17292);

    // M1 against M2's CORRECTED 17,292 — not against the anchor's 17,280. That
    // is what makes one belt per row the right entry.
    expect(at(run, 'M1').correction).toBe(66);
    expect(at(run, 'M1').balancedCommon).toBe(17292);
  });

  it('lets the head of the line stand above the anchor by ALL the belts between them', async () => {
    // The physical claim, in the plant's words: if M1 -> M2 holds 12 inners and
    // M2 -> M3 holds 40 cartons, then with the anchor at M3 the filler should be
    // allowed to sit 12 + 40x4 = 172 inners ahead of it, and NOT be corrected
    // down for it. That material is real; it is on the belts.
    //
    // Nothing sums the buffers. It falls out of the chain: each machine is
    // measured against its NEIGHBOUR, so an allowance granted at one link is
    // already inside the figure the next link is measured against. Which is
    // also why each row takes one belt and not a running total — entering the
    // sum here would allow 12 + 172 and correct nothing, ever.
    const svc = build(
      [
        { code: 'M1', unit: 'INNER', good: 1612 },   // 172 ahead of the anchor
        { code: 'M2', unit: 'CARTON', good: 400 },   // = 1600, 160 ahead
        { code: 'M3', unit: 'PALLET', good: 9 },     // = 1440, the anchor
      ],
      [
        { machineId: 'M1', bufferToNextQty: 12, bufferUnit: 'INNER' },
        { machineId: 'M2', bufferToNextQty: 40, bufferUnit: 'CARTON' },
        { machineId: 'M3', isAnchor: true },
      ],
    );
    const [run] = await svc.balance();

    expect(at(run, 'M2').verdict).toBe('BALANCED');
    expect(at(run, 'M2').correction).toBe(0);
    expect(at(run, 'M1').verdict).toBe('BALANCED');
    expect(at(run, 'M1').correction).toBe(0);

    // The cumulative allowance, never written down anywhere: 1612 - 1440 = 172.
    expect(at(run, 'M1').balancedCommon - at(run, 'M3').balancedCommon).toBe(172);
  });

  it('still corrects the ONE unit that exceeds the accumulated allowance', async () => {
    // One inner past what every belt between here and the anchor can hold. The
    // chain has to notice that, or the allowance becomes a place to hide drift.
    const svc = build(
      [
        { code: 'M1', unit: 'INNER', good: 1613 },   // 173 ahead — one too many
        { code: 'M2', unit: 'CARTON', good: 400 },
        { code: 'M3', unit: 'PALLET', good: 9 },
      ],
      [
        { machineId: 'M1', bufferToNextQty: 12, bufferUnit: 'INNER' },
        { machineId: 'M2', bufferToNextQty: 40, bufferUnit: 'CARTON' },
        { machineId: 'M3', isAnchor: true },
      ],
    );
    const [run] = await svc.balance();

    expect(at(run, 'M1').correction).toBe(-1);
    expect(at(run, 'M1').balancedCommon - at(run, 'M3').balancedCommon).toBe(172);
  });
});
