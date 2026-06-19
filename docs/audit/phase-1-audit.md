# Phase 1 Audit — MES360° Platform
**Date:** 2026-06-06  
**Auditor:** Lead Solution Architect  
**Target:** 100% Go-Live Readiness  
**Scope:** Critical Blockers (Production, Quality, Maintenance, Notifications, Downtime, Auth)

---

## Readiness Baseline

| Module | Pre-Audit | Post-Phase-1 Target |
|---|---|---|
| Production | 65% | 90% |
| Quality | 40% | 90% |
| Maintenance | 45% | 90% |
| Notifications | 30% | 80% |
| Auth/Security | 50% | 85% |
| **Overall** | **60%** | **82%** |

---

## 1. Production Module

### Existing Files
- `apps/api/src/modules/production/production.service.ts`
- `apps/api/src/modules/production/production.controller.ts`
- `apps/api/src/modules/production/oee.service.ts`
- `apps/api/src/modules/production/production.module.ts`

### Existing Endpoints
| Method | Path | Status |
|---|---|---|
| GET | /production/kpis | ✅ Exists |
| GET | /production/work-orders | ✅ Exists |
| POST | /production/work-orders | ✅ Exists |
| PATCH | /production/work-orders/:id/start | ✅ Exists — PLANNED→IN_PROGRESS only |
| PATCH | /production/work-orders/:id/complete | ✅ Exists — IN_PROGRESS→COMPLETED only |
| POST | /production/oee/calculate | ✅ Exists — manual input only |

### Missing Endpoints (BLOCKERS)
| Method | Path | Priority |
|---|---|---|
| GET | /production/work-orders/:id | CRITICAL |
| PATCH | /production/work-orders/:id | HIGH |
| DELETE | /production/work-orders/:id | HIGH |
| PATCH | /production/work-orders/:id/hold | CRITICAL — ON_HOLD state missing |
| PATCH | /production/work-orders/:id/release | CRITICAL — ON_HOLD→IN_PROGRESS missing |
| PATCH | /production/work-orders/:id/cancel | HIGH |
| POST | /production/work-orders/:id/count | CRITICAL — no count recording |
| GET | /production/downtime-events | CRITICAL — no downtime REST API |
| POST | /production/downtime-events | CRITICAL |
| PATCH | /production/downtime-events/:id | HIGH |
| GET | /production/downtime-causes | HIGH |
| GET | /production/oee-records | HIGH |

### Missing Services
- `holdWorkOrder()` — state: IN_PROGRESS → ON_HOLD
- `releaseWorkOrder()` — state: ON_HOLD → IN_PROGRESS
- `cancelWorkOrder()` — state: any→CANCELLED
- `recordCount()` — increment actualQty, trigger OEE
- `autoCalculateOEE()` — triggered on WO complete
- `getWorkOrderById()` — single record
- Downtime service — event CRUD + 1-min threshold

### Technical Debt
- OEE calculation is manual-only (POST /oee/calculate); not event-driven
- KPIs use `?? 82.5` fallback hardcoded values — must be live DB data
- No `RELEASED` status support in startWorkOrder (only PLANNED→IN_PROGRESS)
- No operator assignment on WO start

---

## 2. Quality Module

### Existing Files
- `apps/api/src/modules/quality/quality.service.ts`
- `apps/api/src/modules/quality/quality.controller.ts`
- `apps/api/src/modules/quality/quality.module.ts`

### Existing Endpoints
| Method | Path | Status |
|---|---|---|
| GET | /quality/kpis | ✅ Exists |
| GET | /quality/ncr | ✅ Exists — list only |
| GET | /quality/inspections | ✅ Exists — list only |

### Missing Endpoints (BLOCKERS)
| Method | Path | Priority |
|---|---|---|
| POST | /quality/inspections | CRITICAL |
| GET | /quality/inspections/:id | HIGH |
| PATCH | /quality/inspections/:id | HIGH |
| POST | /quality/ncr | CRITICAL |
| GET | /quality/ncr/:id | HIGH |
| PATCH | /quality/ncr/:id | HIGH |
| PATCH | /quality/ncr/:id/status | CRITICAL — workflow state machine |
| GET | /quality/capa | CRITICAL — CAPA completely missing |
| POST | /quality/capa | CRITICAL |
| GET | /quality/capa/:id | HIGH |
| PATCH | /quality/capa/:id | HIGH |
| POST | /quality/capa/:id/actions | HIGH |
| PATCH | /quality/capa/:id/verify | HIGH |
| GET | /quality/downtime-causes | HIGH |

### Missing Services
- `createInspection()` — with auto-number generation
- `getInspectionById()`
- `updateInspection()`
- `createNCR()` — with auto-number, links to WO/batch
- `getNCRById()`
- `updateNCR()`
- `updateNCRStatus()` — OPEN→IN_REVIEW→CAPA_PENDING→RESOLVED→CLOSED
- `createCAPA()` — linked to NCR
- `findCAPAs()`
- `getCAPAById()`
- `updateCAPA()`
- `addCAPAAction()`
- `verifyCAPA()`

---

## 3. Maintenance Module

### Existing Files
- `apps/api/src/modules/maintenance/maintenance.service.ts`
- `apps/api/src/modules/maintenance/maintenance.controller.ts`
- `apps/api/src/modules/maintenance/maintenance.module.ts`

### Existing Endpoints
| Method | Path | Status |
|---|---|---|
| GET | /maintenance/kpis | ✅ Exists |
| GET | /maintenance/work-orders | ✅ Exists — list only |

### Missing Endpoints (BLOCKERS)
| Method | Path | Priority |
|---|---|---|
| POST | /maintenance/work-orders | CRITICAL |
| GET | /maintenance/work-orders/:id | HIGH |
| PATCH | /maintenance/work-orders/:id | HIGH |
| PATCH | /maintenance/work-orders/:id/assign | CRITICAL — assignment workflow |
| PATCH | /maintenance/work-orders/:id/start | CRITICAL |
| PATCH | /maintenance/work-orders/:id/complete | CRITICAL |
| PATCH | /maintenance/work-orders/:id/cancel | HIGH |
| POST | /maintenance/work-orders/:id/spare-parts | HIGH |
| GET | /maintenance/spare-parts | HIGH |
| GET | /maintenance/pm-plans | HIGH |
| GET | /maintenance/pm-tasks | HIGH |

### Missing Services
- `createMaintenanceWO()` — with auto-number
- `getMaintenanceWOById()`
- `updateMaintenanceWO()`
- `assignWO()` — OPEN→ASSIGNED
- `startWO()` — ASSIGNED/OPEN→IN_PROGRESS
- `completeWO()` — IN_PROGRESS→COMPLETED + MTTR calc
- `cancelWO()`
- `addSparePartConsumption()`
- `findSpareParts()`
- `findPMPlans()`
- `findPMTasks()`

---

## 4. Notifications Module

### Existing Files
- `apps/api/src/modules/notifications/notifications.service.ts`
- `apps/api/src/modules/notifications/notifications.module.ts`

### Missing Files
- `notifications.controller.ts` — **DOES NOT EXIST**

### Existing Endpoints
- **NONE** — module has no controller

### Missing Endpoints (BLOCKERS)
| Method | Path | Priority |
|---|---|---|
| GET | /notifications | CRITICAL |
| GET | /notifications/unread-count | CRITICAL |
| PATCH | /notifications/:id/read | CRITICAL |
| PATCH | /notifications/read-all | HIGH |
| DELETE | /notifications/:id | HIGH |
| GET | /notifications/rules | HIGH |
| POST | /notifications/rules | HIGH |
| PATCH | /notifications/rules/:id | HIGH |
| DELETE | /notifications/rules/:id | HIGH |

### Missing Services
- `findForUser()` — paginated, with isRead filter
- `getUnreadCount()`
- `markAsRead()`
- `markAllAsRead()`
- `deleteNotification()`
- `findNotificationRules()`
- `createNotificationRule()`
- `updateNotificationRule()`
- `deleteNotificationRule()`

---

## 5. Auth/Security Module

### Existing Endpoints
| Method | Path | Status |
|---|---|---|
| POST | /auth/login | ✅ |
| POST | /auth/refresh | ✅ |
| POST | /auth/logout | ✅ |
| GET | /auth/me | ✅ |
| PATCH | /auth/change-password | ✅ |
| GET | /auth/factories | ✅ |

### Missing Endpoints
| Method | Path | Priority |
|---|---|---|
| POST | /auth/forgot-password | HIGH |
| POST | /auth/reset-password | HIGH |

### Missing Services
- `forgotPassword()` — generate reset token, send email
- `resetPassword()` — validate token, update password hash
- Password complexity validation (currently no regex on ChangePasswordDto)

---

## 6. Downtime Module (New)

### Existing Files
- Schema models exist: `DowntimeEvent`, `DowntimeCause`, `MachineStateRecord`
- **No service, no controller, no module**

### Required Implementation
- `DowntimeService` — full CRUD + threshold logic
- `DowntimeController` — REST endpoints
- 1-minute threshold: auto-create DowntimeEvent when machine is IDLE > 60s (per NCC requirement)

---

## Missing UI Components (Frontend — noted for Phase 1 completion)
- Work order detail page (getById)
- Quality inspection create form
- NCR create/update form  
- CAPA workflow page
- Maintenance WO create form
- Notifications panel (read/unread)

---

## Implementation Order (Priority)

1. **Production** — holdWO, releaseWO, cancelWO, getById, recordCount, OEE auto
2. **Downtime** — new service + controller
3. **Quality** — createInspection, createNCR, CAPA full CRUD
4. **Maintenance** — createWO, assign, start, complete, spare parts
5. **Notifications** — controller + rules engine
6. **Auth** — forgot/reset password

---

**Estimated files created/modified: 25**  
**Estimated new endpoints: 45**
