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
  async function capture(events: unknown[]) {
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
});
