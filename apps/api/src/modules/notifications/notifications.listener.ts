import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  NotificationType,
  NotificationCategory,
  NotificationSeverity,
  UserRole,
} from '@prisma/client';

import { NotificationsService } from './notifications.service';

/**
 * Bridges domain events (emitted by the production / quality / maintenance /
 * downtime / iot services) into persisted, per-user notifications.
 *
 * For each event we build a normalized "base" notification + a sensible default
 * recipient role set. Custom NotificationRules (configured in the UI) take
 * precedence: if any active rule matches the event, only those rules fire;
 * otherwise the built-in defaults are used so the system works out of the box.
 */
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  // Managers/admins that should see most factory-wide operational events.
  private readonly OPS = [
    UserRole.FACTORY_ADMIN,
    UserRole.PLANT_MANAGER,
  ];

  constructor(private readonly notifications: NotificationsService) {}

  private async notify(
    eventType: string,
    factoryId: string | null,
    base: {
      type: NotificationType;
      category: NotificationCategory;
      severity: NotificationSeverity;
      title: string;
      message: string;
      link?: string;
      data?: Record<string, unknown>;
    },
    defaultRoles: UserRole[],
  ): Promise<void> {
    try {
      const matched = await this.notifications.evaluateRules(factoryId, eventType, base.data ?? {}, base);
      if (matched > 0) return; // custom rules handled it

      await this.notifications.dispatch({
        factoryId,
        type: base.type,
        category: base.category,
        severity: base.severity,
        title: base.title,
        message: base.message,
        link: base.link,
        data: base.data,
        roles: [...new Set([...this.OPS, ...defaultRoles])],
      });
    } catch (err) {
      this.logger.error(`Failed to handle ${eventType}`, err as Error);
    }
  }

  // ── PRODUCTION ──────────────────────────────────────────────
  @OnEvent('production.work-order.started')
  onWorkOrderStarted(p: { workOrder: any; factoryId: string }) {
    return this.notify('production.work-order.started', p.factoryId, {
      type: NotificationType.PRODUCTION,
      category: NotificationCategory.PRODUCTION,
      severity: NotificationSeverity.INFO,
      title: 'Work Order Started',
      message: `Work order ${p.workOrder?.orderNumber} started`,
      link: '/production/orders',
      data: { orderNumber: p.workOrder?.orderNumber },
    }, [UserRole.PRODUCTION_MANAGER, UserRole.PRODUCTION_SUPERVISOR]);
  }

  @OnEvent('production.work-order.held')
  onWorkOrderHeld(p: { workOrder: any; factoryId: string }) {
    return this.notify('production.work-order.held', p.factoryId, {
      type: NotificationType.PRODUCTION,
      category: NotificationCategory.PRODUCTION,
      severity: NotificationSeverity.WARNING,
      title: 'Work Order On Hold',
      message: `WO ${p.workOrder?.orderNumber} put on hold: ${p.workOrder?.reason ?? '—'}`,
      link: '/production/orders',
      data: { orderNumber: p.workOrder?.orderNumber, reason: p.workOrder?.reason },
    }, [UserRole.PRODUCTION_MANAGER, UserRole.PRODUCTION_SUPERVISOR]);
  }

  // ── DOWNTIME ────────────────────────────────────────────────
  @OnEvent('downtime.event.created')
  onDowntimeCreated(p: { event: any; factoryId: string; machineName: string }) {
    if (p.event?.isPlanned) return; // only unplanned downtime notifies
    return this.notify('downtime.event.created', p.factoryId, {
      type: NotificationType.DOWNTIME,
      category: NotificationCategory.DOWNTIME,
      severity: NotificationSeverity.WARNING,
      title: 'Unplanned Downtime',
      message: `${p.machineName} stopped — ${p.event?.category}`,
      link: '/production/downtime',
      data: { machineName: p.machineName, category: p.event?.category },
    }, [UserRole.PRODUCTION_MANAGER, UserRole.PRODUCTION_SUPERVISOR, UserRole.MAINTENANCE_MANAGER]);
  }

  @OnEvent('downtime.auto.created')
  onAutoDowntime(p: { machineId: string; machineName: string; factoryId: string }) {
    return this.notify('downtime.auto.created', p.factoryId, {
      type: NotificationType.DOWNTIME,
      category: NotificationCategory.DOWNTIME,
      severity: NotificationSeverity.WARNING,
      title: 'Auto-Detected Downtime',
      message: `${p.machineName} has been idle > 1 minute`,
      link: '/production/downtime',
      data: { machineName: p.machineName },
    }, [UserRole.PRODUCTION_SUPERVISOR, UserRole.MAINTENANCE_MANAGER]);
  }

  // ── QUALITY ─────────────────────────────────────────────────
  @OnEvent('quality.inspection.failed')
  onInspectionFailed(p: { inspection: any; factoryId: string }) {
    return this.notify('quality.inspection.failed', p.factoryId, {
      type: NotificationType.QUALITY,
      category: NotificationCategory.QUALITY,
      severity: NotificationSeverity.ERROR,
      title: 'Inspection Failed',
      message: `Inspection ${p.inspection?.inspectionNumber} failed — ${p.inspection?.failQty} units rejected`,
      link: '/quality/inspections',
      data: { inspectionNumber: p.inspection?.inspectionNumber, failQty: p.inspection?.failQty },
    }, [UserRole.QUALITY_MANAGER, UserRole.QUALITY_ENGINEER]);
  }

  @OnEvent('quality.ncr.created')
  onNcrCreated(p: { ncr: any; factoryId: string }) {
    // Critical NCRs also emit `quality.ncr.critical` — avoid a duplicate notification.
    if (String(p.ncr?.severity).toUpperCase() === 'CRITICAL') return;
    return this.notify('quality.ncr.created', p.factoryId, {
      type: NotificationType.QUALITY,
      category: NotificationCategory.QUALITY,
      severity: NotificationSeverity.WARNING,
      title: 'New NCR Raised',
      message: `NCR ${p.ncr?.ncrNumber}: ${p.ncr?.title}`,
      link: '/quality/ncr',
      data: { ncrNumber: p.ncr?.ncrNumber, title: p.ncr?.title },
    }, [UserRole.QUALITY_MANAGER, UserRole.QUALITY_ENGINEER]);
  }

  @OnEvent('quality.ncr.critical')
  onCriticalNcr(p: { ncr: any; factoryId: string }) {
    return this.notify('quality.ncr.critical', p.factoryId, {
      type: NotificationType.QUALITY,
      category: NotificationCategory.QUALITY,
      severity: NotificationSeverity.CRITICAL,
      title: 'CRITICAL NCR',
      message: `Critical non-conformance: ${p.ncr?.title}`,
      link: '/quality/ncr',
      data: { ncrNumber: p.ncr?.ncrNumber, title: p.ncr?.title },
    }, [UserRole.QUALITY_MANAGER, UserRole.QUALITY_ENGINEER, UserRole.PRODUCTION_MANAGER]);
  }

  // ── MAINTENANCE ─────────────────────────────────────────────
  @OnEvent('maintenance.wo.created')
  onMaintenanceCreated(p: { wo: any; factoryId: string; isEmergency: boolean }) {
    if (!p.isEmergency) return; // only emergency maintenance notifies by default
    return this.notify('maintenance.wo.created', p.factoryId, {
      type: NotificationType.MAINTENANCE,
      category: NotificationCategory.MAINTENANCE,
      severity: NotificationSeverity.ERROR,
      title: 'EMERGENCY Maintenance',
      message: `Emergency WO ${p.wo?.woNumber} — ${p.wo?.title}`,
      link: '/maintenance/work-orders',
      data: { woNumber: p.wo?.woNumber, title: p.wo?.title },
    }, [UserRole.MAINTENANCE_MANAGER, UserRole.MAINTENANCE_TECHNICIAN, UserRole.PRODUCTION_MANAGER]);
  }

  @OnEvent('maintenance.wo.assigned')
  onMaintenanceAssigned(p: { wo: any; technicianId?: string; technicianName: string; factoryId: string }) {
    // Targeted: notify the assigned technician directly.
    if (!p.technicianId) return;
    return this.notifications.dispatch({
      factoryId: p.factoryId,
      type: NotificationType.MAINTENANCE,
      category: NotificationCategory.MAINTENANCE,
      severity: NotificationSeverity.INFO,
      title: 'Maintenance Assigned to You',
      message: `You have been assigned WO ${p.wo?.woNumber}`,
      link: '/maintenance/work-orders',
      data: { woNumber: p.wo?.woNumber },
      userIds: [p.technicianId],
    }).catch((e) => this.logger.error('maintenance.wo.assigned failed', e as Error));
  }

  // ── MACHINE STATE ───────────────────────────────────────────
  @OnEvent('machine.state.changed')
  onMachineStateChanged(p: { machineId: string; machineName: string; factoryId: string; newState: string }) {
    if (p.newState !== 'BREAKDOWN') return;
    return this.notify('machine.state.changed', p.factoryId, {
      type: NotificationType.ALARM,
      category: NotificationCategory.ALARM,
      severity: NotificationSeverity.ERROR,
      title: 'Machine Breakdown',
      message: `${p.machineName} entered BREAKDOWN state`,
      link: '/iot/devices',
      data: { machineName: p.machineName },
    }, [UserRole.PRODUCTION_MANAGER, UserRole.MAINTENANCE_MANAGER, UserRole.MAINTENANCE_TECHNICIAN]);
  }
}
