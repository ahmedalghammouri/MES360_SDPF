import { OEEService } from './oee.service';

describe('OEEService', () => {
  let service: OEEService;

  beforeEach(() => {
    service = new OEEService();
  });

  describe('calculate', () => {
    it('should calculate OEE correctly for world-class performance', () => {
      const result = service.calculate({
        plannedProductionTime: 480,
        downtime: 30,
        idealCycleTime: 1,
        totalCount: 400,
        goodCount: 392,
      });

      expect(result.availability).toBeCloseTo(93.75, 0);
      expect(result.quality).toBeCloseTo(98.0, 0);
      expect(result.oee).toBeGreaterThan(0);
      expect(result.oee).toBeLessThanOrEqual(100);
    });

    it('should return 0 OEE when no good parts produced', () => {
      const result = service.calculate({
        plannedProductionTime: 480,
        downtime: 80,
        idealCycleTime: 1,
        totalCount: 100,
        goodCount: 0,
      });

      expect(result.quality).toBe(0);
      expect(result.oee).toBe(0);
    });

    it('should return 100 OEE for perfect conditions', () => {
      const result = service.calculate({
        plannedProductionTime: 480,
        downtime: 0,
        idealCycleTime: 1,
        totalCount: 480,
        goodCount: 480,
      });

      expect(result.availability).toBeCloseTo(100);
      expect(result.performance).toBeCloseTo(100);
      expect(result.quality).toBeCloseTo(100);
      expect(result.oee).toBeCloseTo(100);
    });

    it('should cap values at 100 when performance exceeds theoretical', () => {
      const result = service.calculate({
        plannedProductionTime: 480,
        downtime: 0,
        idealCycleTime: 1,
        totalCount: 600,
        goodCount: 600,
      });

      expect(result.availability).toBeLessThanOrEqual(100);
    });
  });

  describe('calculateDetailed (six-loss)', () => {
    it('excludes planned stops from PPT and counts unplanned as availability loss', () => {
      // PPT already net of planned stops = 660 min; 60 min unplanned breakdown
      const r = service.calculateDetailed({
        plannedProductionTime: 660,
        unplannedDowntime: 60,
        idealCycleTime: 0.2, // min/unit
        totalCount: 2700,
        goodCount: 2670,
      });
      expect(r.runTime).toBe(600);
      expect(r.availability).toBeCloseTo(90.9, 0); // 600/660
      expect(r.performance).toBeCloseTo(90.0, 0);  // (0.2*2700)/600 = 540/600
      expect(r.quality).toBeCloseTo(98.9, 0);      // 2670/2700
      expect(r.oee).toBeGreaterThan(0);
      expect(r.oee).toBeLessThanOrEqual(100);
    });

    it('caps performance at 100 and never exceeds bounds', () => {
      const r = service.calculateDetailed({
        plannedProductionTime: 100, unplannedDowntime: 0,
        idealCycleTime: 1, totalCount: 200, goodCount: 200,
      });
      expect(r.performance).toBeLessThanOrEqual(100);
      expect(r.availability).toBe(100);
    });
  });

  describe('availabilityFromSegments', () => {
    it('computes availability from machine state segments, excluding planned stops', () => {
      const r = service.availabilityFromSegments([
        { state: 'RUNNING', durationMinutes: 600 },
        { state: 'BREAKDOWN', durationMinutes: 40 },
        { state: 'STARVED', durationMinutes: 20 },
        { state: 'PLANNED_STOP', durationMinutes: 60, isPlannedStop: true }, // excluded from PPT
      ]);
      expect(r.ppt).toBe(660);       // 720 scheduled − 60 planned
      expect(r.runTime).toBe(600);
      expect(r.unplannedDowntime).toBe(60);
      expect(r.availability).toBeCloseTo(90.9, 0);
    });
  });

  describe('rollup', () => {
    it('rolls up children by summing quantities, not averaging percentages', () => {
      // One big efficient JO + one small bad JO — naive average would mislead.
      const parent = service.rollup([
        { ppt: 600, runTime: 600, idealRunTime: 600, totalCount: 1000, goodCount: 1000 }, // 100%
        { ppt: 60, runTime: 30, idealRunTime: 15, totalCount: 50, goodCount: 25 },          // poor
      ]);
      // availability = 630/660, performance = 615/630, quality = 1025/1050
      expect(parent.availability).toBeCloseTo(95.5, 0);
      expect(parent.performance).toBeCloseTo(97.6, 0);
      expect(parent.quality).toBeCloseTo(97.6, 0);
      expect(parent.oee).toBeCloseTo(91.0, 0);
    });

    it('returns zeros for empty children', () => {
      const parent = service.rollup([]);
      expect(parent.oee).toBe(0);
      expect(parent.availability).toBe(0);
    });
  });

  describe('getClassification', () => {
    it('should classify world-class OEE correctly', () => {
      expect(service.getClassification(85)).toBe('world-class');
      expect(service.getClassification(95)).toBe('world-class');
    });

    it('should classify good OEE correctly', () => {
      expect(service.getClassification(65)).toBe('good');
      expect(service.getClassification(84)).toBe('good');
    });

    it('should classify poor OEE correctly', () => {
      expect(service.getClassification(30)).toBe('poor');
    });
  });
});
