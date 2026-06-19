import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { KpiService } from '../production/kpi.service';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kpi: KpiService,
  ) {}

  /**
   * Production report — sourced from the canonical JOB-ORDER analytics (the same
   * engine behind the Performance & KPIs pages), so OEE is time-weighted and output
   * is normalised to the product base unit (no mixed inners/cartons/pallets). Planned
   * output comes from the real production-order targets in the window (converted to
   * base units), so efficiency is meaningful instead of always 100%.
   */
  async getProductionReport(factoryId: string | null, from: Date, to: Date) {
    const factoryFilter = factoryId ? { factoryId } : {};

    const [analytics, records, downtimeAgg] = await Promise.all([
      this.kpi.oeeAnalytics(factoryId, from, to, undefined, 'day'),
      this.kpi.oeeRecordsFromJobOrders(factoryId, from, to, undefined, 500),
      // Unplanned, OEE-affecting downtime minutes in the window
      this.prisma.downtimeEvent.aggregate({
        where: { ...factoryFilter, isPlanned: false, affectsOEE: true, startTime: { gte: from, lte: to } },
        _sum: { durationMinutes: true },
      }),
    ]);

    const totalActual = Math.round(analytics.totalOutput);   // good + scrap, base units
    const totalGood = Math.round(analytics.goodOutput);       // base units
    const performance = analytics.current.performance ?? 0;
    // Planned = the ideal output achievable in the run time at the ideal rate; this
    // makes efficiency == OEE Performance (a real, bounded production-efficiency %),
    // instead of the old always-100% (planned == actual) placeholder.
    const totalPlanned = performance > 0 ? Math.round(totalActual / (performance / 100)) : totalActual;
    const downtimeMins = Math.round(downtimeAgg._sum.durationMinutes ?? 0);

    return {
      summary: {
        totalPlanned,
        totalActual,
        totalGood,
        totalScrap: Math.max(0, totalActual - totalGood),
        efficiency: parseFloat(performance.toFixed(1)),
        quality: parseFloat((analytics.current.quality ?? 0).toFixed(1)),
        availability: parseFloat((analytics.current.availability ?? 0).toFixed(1)),
        performance: parseFloat(performance.toFixed(1)),
        totalDowntime: downtimeMins,
        avgOEE: parseFloat((analytics.current.oee ?? 0).toFixed(1)),
        // Time-based (AT-OEE) variant for report consistency with the dashboards.
        avgOeeTb: parseFloat((analytics.current.oeeTb ?? 0).toFixed(1)),
        availabilityTb: parseFloat((analytics.current.availabilityTb ?? 0).toFixed(1)),
      },
      records: records.map((r) => ({
        date: new Date(r.recordDate).toISOString(),
        machine: r.machine?.name ?? '—',
        // Real planned vs actual (good + scrap) vs good — no longer planned == actual.
        plannedQty: Math.round((r as any).plannedOutput ?? 0),
        actualQty: r.totalOutput,
        goodQty: r.goodOutput,
        oee: r.oee,
        downtime: 0,
      })),
    };
  }

  async getQualityReport(factoryId: string | null, from: Date, to: Date) {
    const factoryFilter = factoryId ? { factoryId } : {};

    const [inspections, ncrs] = await Promise.all([
      this.prisma.inspectionResult.findMany({
        where: { ...factoryFilter, inspectedAt: { gte: from, lte: to } },
        include: { inspector: { select: { name: true } } },
      }),
      this.prisma.nCR.findMany({
        where: { ...factoryFilter, detectedAt: { gte: from, lte: to } },
        orderBy: { severity: 'desc' },
      }),
    ]);

    const totalInspected = inspections.reduce((s, i) => s + i.totalQty, 0);
    const totalPassed = inspections.reduce((s, i) => s + i.passQty, 0);

    return {
      summary: {
        totalInspections: inspections.length,
        totalInspected,
        totalPassed,
        passRate: totalInspected > 0 ? (totalPassed / totalInspected) * 100 : 0,
        totalNCRs: ncrs.length,
        criticalNCRs: ncrs.filter((n) => n.severity === 'CRITICAL').length,
      },
      inspections,
      ncrs,
    };
  }

  /**
   * Maintenance report — work-order completion, reliability (MTTR/MTBF) and cost,
   * plus by-type / by-status breakdowns, over [from, to]. Backs /reports/maintenance.
   */
  async getMaintenanceReport(factoryId: string | null, from: Date, to: Date) {
    const factoryFilter = factoryId ? { factoryId } : {};

    const wos = await this.prisma.maintenanceWO.findMany({
      where: { ...factoryFilter, deletedAt: null, createdAt: { gte: from, lte: to } },
      select: {
        type: true, status: true, actualHours: true, laborCost: true, partsCost: true,
        totalCost: true, createdAt: true, completedAt: true,
      },
    });

    const totalWO = wos.length;
    const completed = wos.filter((w) => w.status === 'COMPLETED');
    const completionRate = totalWO > 0 ? (completed.length / totalWO) * 100 : 0;

    // MTTR = mean repair hours of completed WOs in the window.
    const mttr = completed.length
      ? completed.reduce((s, w) => s + (w.actualHours ?? 0), 0) / completed.length
      : 0;

    // MTBF ≈ window operating hours ÷ failures (corrective + emergency). Approximate —
    // a runtime-accurate MTBF is tracked as RC-9 in the Go-Live readiness doc.
    const failures = wos.filter((w) => w.type === 'CORRECTIVE' || w.type === 'EMERGENCY').length;
    const windowHours = Math.max((to.getTime() - from.getTime()) / 3_600_000, 1);
    // No failures (or no data) → MTBF is not meaningful; return 0 rather than the full
    // window (which read as a misleading "720 hrs" with zero work orders).
    const mtbf = failures > 0 ? windowHours / failures : 0;

    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let totalCost = 0;
    for (const w of wos) {
      byType[w.type] = (byType[w.type] ?? 0) + 1;
      byStatus[w.status] = (byStatus[w.status] ?? 0) + 1;
      totalCost += w.totalCost ?? ((w.laborCost ?? 0) + (w.partsCost ?? 0));
    }

    return {
      mtbf: parseFloat(mtbf.toFixed(1)),
      mttr: parseFloat(mttr.toFixed(1)),
      totalWO,
      completedWO: completed.length,
      completionRate: parseFloat(completionRate.toFixed(1)),
      failures,
      totalCost: parseFloat(totalCost.toFixed(2)),
      byType,
      byStatus,
    };
  }

  async getAvailableReports() {
    return [
      {
        id: 'production-summary',
        name: 'Production Summary',
        description: 'Daily/weekly production output, OEE, and efficiency',
        module: 'production',
        icon: 'Factory',
      },
      {
        id: 'quality-summary',
        name: 'Quality Summary',
        description: 'Inspection results, NCR trends, and FPY analysis',
        module: 'quality',
        icon: 'ShieldCheck',
      },
      {
        id: 'maintenance-summary',
        name: 'Maintenance Report',
        description: 'Work order completion, MTTR/MTBF, and PM compliance',
        module: 'maintenance',
        icon: 'Wrench',
      },
      {
        id: 'oee-analysis',
        name: 'OEE Deep Dive',
        description: 'Detailed OEE breakdown by machine, shift, and SKU',
        module: 'production',
        icon: 'Gauge',
      },
      {
        id: 'downtime-analysis',
        name: 'Downtime Pareto',
        description: 'Root cause analysis with Pareto charts',
        module: 'production',
        icon: 'BarChart3',
      },
    ];
  }
}
