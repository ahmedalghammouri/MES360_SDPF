import { ProductionSnapshotService } from './production-snapshot.service';

/**
 * The fact store's definition of run time — the one production actually reads.
 *
 * `SNAPSHOTS_READ=on` in the deployed compose files, so every dashboard sums these
 * rows. Whatever kpi.joRollupChild does on the live path, THIS is what the plant
 * sees, and the two must agree minute for minute or the same machine reports two
 * availabilities depending on which read path answered.
 *
 * A minute bucket is deliberately the unit under test: it is the smallest place the
 * old definition went wrong (run 1.00 against down 1.00, availability 100%), and a
 * window is only a sum of these.
 */
describe('ProductionSnapshotService — a minute bucket', () => {
  // captureMinute snapshots the CLOSED minute before `at`.
  const at = new Date('2026-08-11T13:49:00.000Z');
  const bucketStart = new Date('2026-08-11T13:48:00.000Z');
  const bucketEnd = new Date('2026-08-11T13:49:00.000Z');

  const jo = {
    id: 'jo-1', factoryId: 'f1', machineId: 'm1', workOrderId: 'wo-1',
    sequenceOrder: 1, operationName: 'Filling', outputUnit: null,
    idealCycleTimeSec: null,
    // Planned window covers the bucket, so PPT does not depend on the fallback.
    plannedStart: new Date('2026-08-11T00:00:00.000Z'),
    plannedEnd: new Date('2026-08-12T00:00:00.000Z'),
    actualStart: new Date('2026-08-11T06:00:00.000Z'),
    actualQtyGood: 100, actualQtyRejected: 0, plannedQtyOut: null,
    machine: { lineId: 'l1', areaId: 'a1' },
    workOrder: { productionOrderId: null, skuId: null, shiftInstanceId: null, sku: null, shiftInstance: null },
  };

  /** A downtime event covering the whole bucket, flagged as the rule would flag it. */
  const covering = (flags: { isPlanned: boolean; affectsOEE: boolean }) => ({
    machineId: 'm1', startTime: bucketStart, endTime: bucketEnd, ...flags,
  });

  /** Runs one capture and returns the row that would be written. */
  async function capture(events: unknown[], states: unknown[] = []) {
    let written: any = null;
    const prisma = {
      productionSnapshot: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        groupBy: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockImplementation(({ create }: any) => { written = create; return Promise.resolve({}); }),
      },
      jobOrder: {
        findMany: jest.fn().mockResolvedValue([jo]),
        groupBy: jest.fn().mockResolvedValue([{ workOrderId: 'wo-1', _max: { sequenceOrder: 1 } }]),
      },
      downtimeEvent: { findMany: jest.fn().mockResolvedValue(events) },
      // No state records: the machine reports no status at all, so there is no
      // measurement to cap run time with and the writer keeps its assumption.
      // The measured path has its own tests below.
      machineStateRecord: { findMany: jest.fn().mockResolvedValue(states) },
      shiftTemplate: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new ProductionSnapshotService(prisma as never);
    await service.captureMinute(at);
    return written as {
      plannedMin: number; runMin: number; downMin: number;
      plannedDownMin: number; externalMin: number; availability: number | null;
    };
  }

  it('counts a clean minute as a full minute of run', async () => {
    const r = await capture([]);
    expect(r.runMin).toBeCloseTo(1, 3);
    expect(r.plannedMin).toBeCloseTo(1, 3);
    expect(r.availability).toBeCloseTo(100, 3);
  });

  it('gives back zero run and zero availability for a minute lost to a breakdown', async () => {
    // This is the exact live row that exposed the old definition: planned 1.00,
    // run 1.00, down 1.00, availability 100%. The stop stays in the denominator.
    const r = await capture([covering({ isPlanned: false, affectsOEE: true })]);
    expect(r.downMin).toBeCloseTo(1, 3);
    expect(r.runMin).toBeCloseTo(0, 3);
    expect(r.plannedMin).toBeCloseTo(1, 3);
    expect(r.availability).toBeCloseTo(0, 3);
  });

  it('removes a planned stop from BOTH sides, so availability is undefined not zero', async () => {
    // Nothing was scheduled to be produced, so there is no ratio to report. Zero
    // would be a lie: the machine did exactly what the plan asked of it.
    const r = await capture([covering({ isPlanned: true, affectsOEE: true })]);
    expect(r.plannedDownMin).toBeCloseTo(1, 3);
    expect(r.runMin).toBeCloseTo(0, 3);
    expect(r.plannedMin).toBeCloseTo(0, 3);
    expect(r.availability).toBeNull();
  });

  it('removes a rule-excluded (external) stop from both sides and records it separately', async () => {
    // affectsOEE=false is stamped on the event by the machine's MachineStateRule —
    // the writer never needs to know the state was called STARVED.
    const r = await capture([covering({ isPlanned: false, affectsOEE: false })]);
    expect(r.externalMin).toBeCloseTo(1, 3);
    expect(r.downMin).toBeCloseTo(0, 3);
    expect(r.runMin).toBeCloseTo(0, 3);
    expect(r.plannedMin).toBeCloseTo(0, 3);
    expect(r.availability).toBeNull();
  });

  it('keeps PPT − run equal to the unplanned downtime — the identity every read surface assumes', async () => {
    // Half the minute down, un-planned. PPT stays whole, run is what is left.
    const half = {
      machineId: 'm1',
      startTime: new Date(bucketStart.getTime() + 30_000),
      endTime: bucketEnd,
      isPlanned: false, affectsOEE: true,
    };
    const r = await capture([half]);
    expect(r.plannedMin - r.runMin).toBeCloseTo(r.downMin, 3);
    expect(r.availability).toBeCloseTo(50, 3);
  });

  // ── Run time measured against what the machine actually reported ──────────
  /**
   * The question that exposed this: how can a machine that recorded no running
   * time at all still show run time?
   *
   * Because run time was `elapsed − known stops`, which credits production unless
   * something proves otherwise. A stop that never became a downtime event — and on
   * this plant none of them did — left the assumption unchallenged.
   */
  describe('when the machine reports its state', () => {
    const seg = (state: string) => ({
      machineId: 'm1', state, startTime: bucketStart, endTime: bucketEnd,
    });

    it('gives no run time to a machine that reported no producing state', async () => {
      // The exact case on the plant: BLOCKED all bucket, and not one downtime
      // event to show for it. It used to read a full minute of run.
      const r = await capture([], [seg('BLOCKED')]);
      expect(r.runMin).toBeCloseTo(0, 3);
    });

    it('charges that unexplained minute as downtime, keeping the identity', async () => {
      // Not producing and not excused is a stop. Folding it into production is
      // what made availability read 97% for machines that never ran.
      const r = await capture([], [seg('BREAKDOWN')]);
      expect(r.downMin).toBeCloseTo(1, 3);
      expect(r.plannedMin - r.runMin).toBeCloseTo(r.downMin, 3);
    });

    it('credits a minute the machine reported RUNNING', async () => {
      const r = await capture([], [seg('RUNNING')]);
      expect(r.runMin).toBeCloseTo(1, 3);
      expect(r.downMin).toBeCloseTo(0, 3);
    });

    it('caps run at the measured producing time, not the elapsed span', async () => {
      // Reported running for half the bucket and nothing for the other half.
      const half = {
        machineId: 'm1', state: 'RUNNING',
        startTime: bucketStart, endTime: new Date(bucketStart.getTime() + 30_000),
      };
      const r = await capture([], [half]);
      expect(r.runMin).toBeCloseTo(0.5, 3);
      expect(r.downMin).toBeCloseTo(0.5, 3);
    });

    it('keeps assuming when the machine has no status signal at all', async () => {
      // A machine with nothing wired — the Checkweigher — reports no states.
      // Silence is not evidence of a stop, so it must not be charged for it.
      const r = await capture([], []);
      expect(r.runMin).toBeCloseTo(1, 3);
    });

    it('does not double-charge a stop that DID produce an event', async () => {
      const r = await capture(
        [covering({ isPlanned: false, affectsOEE: true })],
        [seg('BREAKDOWN')],
      );
      expect(r.downMin).toBeCloseTo(1, 3);
      expect(r.runMin).toBeCloseTo(0, 3);
    });
  });
});
