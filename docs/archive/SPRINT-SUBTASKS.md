# MES360° · Sprint Subtasks & Go-Live Checklist
**Sprint:** Jun 8–15 2026 · **Scope:** PoC Proposal v2 · **Target:** 100%

---

## HOW TO USE THIS FILE
- Each module has precise subtasks → one commit per subtask
- ✅ = done · 🔲 = pending · 🔴 = blocker
- Backend tasks first, then frontend, then seed, then test

---

## MODULE 1 — Production Orders (ISA-95) · 92% · Due Mon 8

### Backend
- ✅ PO CRUD (create, list, get, update, delete)
- ✅ Status machine: PLANNED → RELEASED → IN_PROGRESS → COMPLETED / CANCELLED / ON_HOLD
- ✅ `PATCH /:id/release`, `/hold`, `/resume`, `/complete`, `/cancel`
- ✅ `GET /:id/auto-generate-preview`
- ✅ `POST /:id/work-orders` (manual WO from PO)
- ✅ `POST /:id/auto-generate-work-orders`
- 🔲 E2E guard: block release if quantity = 0
- 🔲 E2E guard: block complete if any WO is still IN_PROGRESS

### Frontend
- ✅ POFormDialog (create + edit)
- ✅ ReasonDialog (hold / cancel with required reason text)
- ✅ ConfirmDialog (complete / resume / delete)
- ✅ CreateWODialog (manual WO)
- ✅ AutoGenDialog (preview + confirm generate)
- ✅ POActionMenu per status
- ✅ PODetailSheet
- 🔲 Validate: plannedQty required before release
- 🔲 Toast on every status transition with new status label

### Seed / Test
- 🔲 PO for each status (PLANNED, RELEASED, IN_PROGRESS, COMPLETED, CANCELLED, ON_HOLD) × 1
- 🔲 Manual test: create → release → auto-generate WOs → verify WOs appear in Work Orders view

---

## MODULE 2 — Work Orders · 90% · Due Mon 8

### Backend
- ✅ WO CRUD + status machine
- ✅ OEE record save on WO complete
- ✅ Good/scrap count recording
- ✅ Inspection panel link
- 🔲 `PATCH /:id/hold` → auto-create DowntimeEvent if not already open
- 🔲 WebSocket emit `workOrder:statusChanged` event on any status change

### Frontend
- ✅ WO list with status filter + search
- ✅ Create / edit dialog
- ✅ Status action buttons per WO state
- ✅ Count recording panel (goodQty, scrapQty)
- 🔲 Downtime banner: "Active downtime on this WO" when a downtime event is open
- 🔲 WebSocket listener: auto-refresh list when `workOrder:statusChanged` fires

### Seed / Test
- 🔲 At least 1 WO in each status × 2 machines

---

## MODULE 3 — Production Scheduling · 88% · Due Mon 8

### Frontend (no backend changes needed)
- ✅ Expandable PO row with child WOs
- ✅ StandaloneWORow for WOs without PO
- ✅ 6 summary cards
- 🔲 Gantt timeline bars: render a CSS bar per WO row positioned by `plannedStart` / `plannedEnd`
  - Use 7-day rolling window (today ±3 days)
  - Bar width = `(plannedEnd - plannedStart) / totalWindowMs * 100%`
  - Bar left offset = `(plannedStart - windowStart) / totalWindowMs * 100%`
  - Color by status (PLANNED=blue, IN_PROGRESS=green, ON_HOLD=amber)
- 🔲 "Today" marker line on Gantt

---

## MODULE 4 — Quality Plans & Inspections · 90% · Due Tue 9

### Backend
- ✅ Quality plans CRUD
- ✅ `POST /quality/inspections` from WO
- ✅ SPC chart data endpoint
- 🔲 `PATCH /quality/inspections/:id` (edit result + notes)
- 🔲 `DELETE /quality/inspections/:id` (soft delete, only PENDING status)
- 🔲 `GET /quality/inspections/:id/parameters` — per-parameter pass/fail detail

### Frontend
- ✅ Plans list, create/edit dialog
- ✅ Inspections list
- ✅ Create inspection from WO button
- 🔲 Edit inspection dialog (result, notes, completion date)
- 🔲 Delete inspection confirm dialog
- 🔲 Inspection detail sheet: expandable parameters table with individual Pass/Fail/NA per parameter

---

## MODULE 5 — Quality NCR & CAPA · 78% · Due Tue 9 🔴 BLOCKER

### Backend
- ✅ NCR CRUD
- ✅ CAPA CRUD + actions
- 🔲 `POST /quality/ncr/:id/link-capa` — auto-creates CAPA and links bidirectionally when NCR status → UNDER_INVESTIGATION
- 🔲 `POST /quality/capa/:id/effectiveness-review` — records effectiveness result (EFFECTIVE / INEFFECTIVE / PENDING)
- 🔲 `PATCH /quality/capa/:id/close` — sets status CLOSED, requires effectiveness review first (guard)
- 🔲 `GET /quality/ncr/:id/capa` — returns linked CAPA for an NCR

### Frontend
- ✅ NCR list, create/edit, status actions
- ✅ CAPA list, actions UI
- 🔲 NCR detail sheet: "Link to CAPA" button when status is OPEN / UNDER_INVESTIGATION
- 🔲 CAPA effectiveness review dialog: select result + notes
- 🔲 CAPA close button: only enabled when effectiveness review exists
- 🔲 NCR row: show linked CAPA badge with link to CAPA view
- 🔲 Toast: "CAPA created and linked to NCR-XXXX"

### Seed
- 🔲 1 NCR with linked CAPA (EFFECTIVE review, CLOSED)
- 🔲 1 NCR OPEN with no CAPA (demonstrates the link flow)
- 🔲 1 CAPA IN_PROGRESS with pending effectiveness

---

## MODULE 6 — Quality SPC Charts · 82% · Due Tue 9

### Backend
- 🔲 WebSocket emit `spc:newMeasurement` after inspection save that includes SPC parameters
- 🔲 SPC measurement endpoint: accept measurement from inspection save (auto-calculate UCL/LCL on first 20 pts)

### Frontend
- ✅ SPC chart with UCL/LCL, 14 data points, out-of-control flags
- 🔲 Real-time update: listen to `spc:newMeasurement` WebSocket → append point and re-render chart
- 🔲 Western Electric rules: annotate points that violate Rule 1 (beyond 3σ), Rule 2 (9 consecutive same side), Rule 3 (6 consecutive trend)

---

## MODULE 7 — Maintenance Work Orders (CMMS) · 72% · Due Wed 10 🟠 HIGH

### Backend
- ✅ MWCO CRUD + state machine
- 🔲 `POST /maintenance/work-orders/:id/complete` DTO: `{ laborHours, notes, sparePartsUsed: [{ sparePart, qty }] }`
- 🔲 On complete: decrement spare parts inventory for each `sparePartsUsed` item (call inventory service)
- 🔲 `GET /maintenance/work-orders/:id/pdf` — returns JSON suitable for PDF template (title, machine, steps, parts, labor)

### Frontend
- ✅ MWO list, create, state machine buttons
- 🔲 Complete dialog: labor hours input (number, required), notes textarea, spare parts used table (add row: part + qty)
- 🔲 Spare parts used table: dropdown from `/inventory/spare-parts` API
- 🔲 PDF card button: calls `/pdf` endpoint, renders in browser print dialog (use `window.print()` or jspdf)
- 🔲 On complete success: toast "Work order closed — X spare part(s) consumed, Y hours logged"

---

## MODULE 8 — Maintenance PM & Assets · 70% · Due Wed 10

### Backend
- 🔲 PM due-date alert trigger: cron job checks PM plans daily, creates AlarmEvent for plans due in ≤7 days
- 🔲 `GET /maintenance/assets/:id/history` — list of all MWOs for this asset ordered by completedDate desc

### Frontend
- ✅ PM schedule list
- ✅ Assets list
- 🔲 Asset detail sheet: history tab showing past MWOs (date, type, duration, technician)
- 🔲 Next-service countdown badge on asset card: "Due in X days" (amber if <14d, red if <3d)
- 🔲 PM plan card: "Overdue" badge in red if nextDueDate < today

---

## MODULE 9 — Inventory · 85% · Due Wed 10

### Backend
- 🔲 `POST /inventory/movements` — stock movement: `{ type: 'ISSUE'|'RECEIVE'|'ADJUST', itemType: 'SPARE_PART'|'RAW_MATERIAL', itemId, qty, reference, workOrderId? }`
- 🔲 On ISSUE: validate qty ≤ currentStock, decrement currentStock
- 🔲 On RECEIVE: increment currentStock
- 🔲 `GET /inventory/movements?itemId=&itemType=&page=` — movement history
- 🔲 Low-stock check: field `isLowStock = currentStock <= minStockLevel` on SparePart + RawMaterial

### Frontend
- ✅ SKUs, BOM, spare parts, materials, lots, storage
- 🔲 "Issue to WO" button on spare part row: opens dialog → select WO → qty → calls POST /movements
- 🔲 "Receive Stock" button: opens dialog → qty → reference (PO number) → calls POST /movements
- 🔲 Low-stock badge: red `LOW` chip on any item where `isLowStock = true`
- 🔲 Movement history tab in spare-part detail sheet

---

## MODULE 10 — Downtime Management · 75% · Due Thu 11

### Backend
- ✅ Events list, manual log, causes tree
- 🔲 `PATCH /production/downtime/events/:id/close` — auto-close: set `closedAt = now`, `duration = closedAt - startedAt`
- 🔲 `GET /production/downtime/pareto?machineId=&startDate=&endDate=&shiftId=` — returns top-10 causes with count + total minutes

### Frontend
- ✅ Events list with filter
- 🔲 Auto-close button on open events: calls PATCH close, shows duration toast
- 🔲 Pareto chart component: horizontal bar chart (recharts BarChart horizontal) showing cause vs. total minutes
- 🔲 Filter by shift dropdown on events list
- 🔲 Export CSV button: `window.open('/api/v1/production/downtime/export?format=csv')` with date range params

---

## MODULE 11 — Reports & Analytics · 42% · Due Thu 11 🔴 BLOCKER

### Backend (PoC Executive Report deliverable)
- 🔲 `GET /reports/production?startDate=&endDate=&factoryId=` — aggregated: total WOs, total good qty, total scrap, avg OEE, top-5 downtime causes
- 🔲 `GET /reports/quality?startDate=&endDate=` — total inspections, pass rate %, total NCRs, open CAPAs, avg first-pass yield
- 🔲 `GET /reports/maintenance?startDate=&endDate=` — total MWOs, avg resolution time (h), MTTR, MTBF per machine
- 🔲 `GET /reports/dashboard-summary?startDate=&endDate=` — combined KPI summary for executive PDF
- 🔲 `GET /reports/export?type=production|quality|maintenance&format=pdf|excel&startDate=&endDate=` — triggers generation

### Frontend
- ✅ View shells exist
- 🔲 Production report: date-range picker (from/to), "Run Report" button, summary KPI cards (total WOs, OEE, scrap%), production trend line chart by day
- 🔲 Quality report: inspection pass rate gauge, NCR trend bar chart, open CAPA count card
- 🔲 Maintenance report: MTTR/MTBF cards, WO resolution time histogram
- 🔲 Export button: calls `/reports/export` → `application/pdf` → `window.open(url)` for PDF download
- 🔲 "Executive Summary" PDF button: shows all 3 categories on one page (calls `/reports/dashboard-summary`)

---

## MODULE 12 — Energy Module (EMS) · 60% · Due Thu 11

### Backend
- ✅ Meters list, overview KPIs
- 🔲 `POST /energy/meters/:id/readings` — create reading: `{ value, unit, recordedAt, shiftId? }`
- 🔲 `GET /energy/meters/:id/readings?startDate=&endDate=&groupBy=hour|day|shift` — aggregated readings
- 🔲 Shift-level breakdown: `GET /energy/overview?groupBy=shift` — total kWh per shift for current day

### Frontend
- ✅ Meters list, overview KPIs
- 🔲 "Add Reading" button on meter row: opens dialog → value + unit + timestamp
- 🔲 Consumption trend chart: line chart of kWh over time (date-range filter)
- 🔲 Shift breakdown tab: grouped bar chart by shift (Shift 1 / Shift 2)

---

## MODULE 13 — Notifications & Alert Channels · 70% · Due Fri 12 🟠 HIGH

### Backend
- ✅ In-app notifications, rules seed, bell counter
- 🔲 `GET /notifications/rules` — list alert rules with CRUD
- 🔲 `POST /notifications/rules` — create rule: `{ name, module, condition, threshold, channels: ['IN_APP', 'EMAIL'] }`
- 🔲 `PATCH /notifications/rules/:id` — edit
- 🔲 `DELETE /notifications/rules/:id`
- 🔲 Email channel: add `EmailService` to notifications module using `nodemailer`
  - Config: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` from `.env`
  - Method: `sendAlert(to: string[], subject, body)`
  - Called when rule triggers and channel includes EMAIL
- 🔲 Test email endpoint: `POST /notifications/test-email` (dev only) → sends test to NCC users

### Frontend
- ✅ In-app notifications list, unread badge
- 🔲 Alert Rules page/tab: list all rules with active/inactive toggle
- 🔲 Create rule dialog: name, module selector, condition (above/below), threshold value, channels checkboxes (In-App, Email)
- 🔲 Edit/delete rule actions
- 🔲 "Send Test" button on rule card → calls `/notifications/test-email`

### Seed
- 🔲 5 alert rules covering: OEE below 75%, downtime > 30min, NCR opened, PM due, low stock

---

## MODULE 14 — IIoT & Connectivity · 50% · Due Fri 12 🔴 BLOCKER

### Backend
- ✅ Devices / Tags / Drivers / Streams CRUD
- 🔲 MQTT service: connect to broker at `MQTT_BROKER_URL` (from .env, fallback to `mqtt://localhost:1883`)
- 🔲 On connect: subscribe to topic `factory/{factoryId}/+/+` (machine/tag wildcard)
- 🔲 On message: parse payload → find TagDefinition by topic → create TagReading → emit WebSocket `tag:reading`
- 🔲 Simulate PLC tags: `GET /iot/simulate/start` → starts a setInterval that publishes random values for all active tags every 3s
- 🔲 `GET /iot/simulate/stop` — stops simulation
- 🔲 `GET /iot/devices/:id/status` — returns ONLINE/OFFLINE based on last heartbeat (<2 min = ONLINE)
- 🔲 Device heartbeat: `POST /iot/devices/:id/heartbeat` — updates `lastSeenAt`

### Frontend
- ✅ Devices, tags, drivers, streams lists
- 🔲 Tag Browser live view: WebSocket listener for `tag:reading` → update tag value in place with highlight animation
- 🔲 "Simulate" toggle button: calls `/iot/simulate/start` and `/iot/simulate/stop`
- 🔲 Device status indicator: green dot (ONLINE) / grey dot (OFFLINE) based on `lastSeenAt` < 2 min
- 🔲 Tag reading sparkline: last 20 readings as tiny recharts LineChart in tag row

### Demo Data (NCC SIDCO)
- 🔲 Seed 5 devices: Big Betti, Cartomac, Checkweigher, Euro-Pack Robot, Uni-tech Wrapping
- 🔲 Seed tag per device: `counter` (integer, boxes/min), `status` (enum), `temperature` (float)
- 🔲 MQTT topic convention: `factory/sidco/{machineName}/{tagName}`

---

## MODULE 15 — Traceability · 30% · Due Fri 12 🟠 HIGH

### Backend
- ✅ Basic forward/backward trace endpoint
- 🔲 `GET /traceability/lot/:lotId/genealogy` — returns full tree:
  ```
  { lot, rawMaterials: [...], workOrders: [...], batches: [...], inspections: [...], ncrs: [...] }
  ```
- 🔲 `GET /traceability/sku/:skuId/lots?startDate=&endDate=` — all lots for a product in date range
- 🔲 `GET /traceability/workorder/:woId/trace` — WO-centric trace: materials consumed, output lots, inspections

### Frontend
- ✅ Basic trace view
- 🔲 Lot genealogy tree view: collapsible tree using nested divs with connecting lines (CSS `border-left`)
  - Level 0: Lot → Level 1: WOs consumed → Level 2: Raw material lots used → Level 3: Output batches → Level 4: NCRs/Inspections
- 🔲 SKU search: type SKU code → list lots with date range filter
- 🔲 WO search: type WO number → show full trace for that WO
- 🔲 QR scan input: text input that accepts QR-decoded lot number (for shop floor scanning via phone camera)
- 🔲 NCR cross-link: lot genealogy shows related NCRs as orange nodes with link to NCR detail

---

## MODULE 16 — Users & Roles · 78% · Due Sat 13

### Backend
- ✅ Users list, create, role assign, password reset endpoint
- 🔲 `GET /users/:id/audit-log?page=&limit=` — returns AuditLog entries where `userId = id`
- 🔲 `GET /users/permissions-matrix` — returns all permissions grouped by role

### Frontend
- ✅ List, create, role assign, password reset
- 🔲 Audit log tab in user detail sheet: table of action + resource + timestamp
- 🔲 Permission matrix view: table of roles × permissions with checkmarks (read-only display)

### Seed (NCC Real Users)
- 🔲 `issa.masadeh@sidco.com.sa` → FACTORY_ADMIN role
- 🔲 `mohammed.brakat@sidco.com.sa` → MANAGER role
- 🔲 `mohammed.yousef@sidco.com.sa` → OPERATOR role
- 🔲 Password for all: `SIDCO@2026` (demo password, document in handover)

---

## MODULE 17 — Settings & Configuration · 32% · Due Sat 13

### Backend
- 🔲 `GET /settings/factory` — returns factory config (shiftSchedule, targets, timezone, thresholds)
- 🔲 `PATCH /settings/factory` — update config
- 🔲 Settings schema: `{ shifts: [{ name, startTime, endTime, breakMinutes }], productionTarget, downtimeThresholdSeconds, timezone, currency }`

### Frontend
- ✅ Settings page shell
- 🔲 Factory Configuration card: editable form with:
  - Shift 1: start 07:30, end 19:30, break 30 min
  - Shift 2: start 19:30, end 07:30, break 30 min
  - Production target: 3000–3500 boxes/shift
  - Downtime threshold: 60 seconds
  - Working days: Saturday–Thursday (6 days)
- 🔲 "Save Changes" button with optimistic update + toast
- 🔲 Notification channels card: email addresses for alerts (pre-fill NCC users)

---

## MODULE 18 — Dashboard (OEE Live) · 87% · Due Sun 14

### Backend
- ✅ Dashboard overview endpoint, KPI aggregation
- 🔲 WebSocket gateway: emit `dashboard:kpis` every 30s with latest production counts + OEE
- 🔲 Shift heatmap data: `GET /dashboard/shift-heatmap?days=7` — OEE per shift per day (7×2 grid)
- 🔲 Top-5 downtime: include `topDowntimeCauses: [{ cause, totalMinutes, count }]` in overview response

### Frontend
- ✅ Live KPIs, OEE gauge, WO table, downtime feed
- 🔲 WebSocket push: update KPI cards without full re-fetch when `dashboard:kpis` event fires
- 🔲 Shift heatmap widget: 7-day × 2-shift grid, cell color = OEE% (green >85%, amber 70-85%, red <70%)
- 🔲 Top-5 downtime bar chart: recharts horizontal BarChart on dashboard bottom section

---

## MODULE 19 — Infrastructure & DevOps · 72% · Due Sun 14

### Tasks
- ✅ Docker Compose, CI/CD, Prometheus, Grafana
- 🔲 k6 load test script: `tests/load/k6-smoke.js` — 50 VUs × 30s, test: login + dashboard + WO list
- 🔲 Backup cron: add `pg_dump` service to `docker-compose.prod.yml` → dumps to MinIO every 6h
- 🔲 Health check endpoints: `GET /health/live` (liveness), `GET /health/ready` (readiness with DB + Redis checks)
- 🔲 Verify health checks in `docker-compose.prod.yml` for `mes-api` and `mes-web` services

---

## MODULE 20 — QA + NCC Demo Data + Go-Live · 65% · Due Mon 15

### NCC Real Data Load (must complete before demo)
- 🔲 **Machines**: Create 5 machines in SIDCO factory: Big Betti, Cartomac, Checkweigher, Euro-Pack Robot, Uni-tech Wrapping
- 🔲 **Cycle times**: Set ideal cycle time per machine per SKU size (30–40s for filling, 4–8 min for palletizing)
- 🔲 **SKUs**: Seed 30 NCC product SKUs (GENTO, Safe, Alwatani, Rex, Miza families with actual codes 10310064–10310298)
- 🔲 **Shifts**: Configure 2 shifts in settings (07:30–19:30 and 19:30–07:30), 11h planned, 3000–3500 target
- 🔲 **Downtime causes**: Seed all causes per machine from prerequisites file (Big Betti: 17 causes, Cartomac: 14 causes, Euro-Pack: 8 causes)
- 🔲 **Users**: Seed 3 NCC users (Issa Admin, Mohammed Manager, Mohammed Yousef Operator)

### QA Regression Checklist
- 🔲 Production: PO → release → auto-generate WOs → start WO → complete WO → verify OEE recorded
- 🔲 Quality: create inspection from WO → fail parameter → create NCR → link CAPA → close CAPA
- 🔲 Maintenance: create MWO → complete with spare parts → verify inventory decremented
- 🔲 Downtime: auto-create on WO hold → close downtime → verify appears in Pareto
- 🔲 IIoT: start simulation → verify tag browser updates live → stop simulation
- 🔲 Reports: generate production report → verify data matches manual count → export PDF
- 🔲 Dashboard: verify all 4 KPI cards update within 30s
- 🔲 Notifications: trigger OEE alert → verify in-app notification appears

### Go-Live Sign-Off
- 🔲 All 20 modules pass DoD checklist (backend + frontend + seed + permissions + no console errors)
- 🔲 Demo script walkthrough completed with NCC data (Issa + Mohammed as demo users)
- 🔲 Architecture Validation Document updated (docs/ARCHITECTURE.md)
- 🔲 Handover package: DEVELOPMENT-PLAN-WEEK.html + GO-LIVE-CHECKLIST.md printed/shared

---

## PERFORMANCE FIXES (Completed Jun 8)

| Fix | File | Impact |
|-----|------|--------|
| ✅ Removed `AnimatePresence mode="wait"` + `key={pathname}` from AppShell | `app-shell.tsx` | **CRITICAL** — was destroying all components on every navigation |
| ✅ Consolidated 4 sidebar queries → 1 `Promise.all` query | `sidebar.tsx` | HIGH — was firing 4 parallel API calls on every app mount |
| ✅ Removed 30+ per-item `motion.span + AnimatePresence` from nav items | `sidebar.tsx` | HIGH — was running 30 simultaneous framer-motion animations |
| ✅ Removed `motion.div` from logo, user profile, BackToMap button | `sidebar.tsx` | MEDIUM |
| ✅ QueryClient moved to `useState(() => new QueryClient())` | `providers.tsx` | MEDIUM — prevents re-creation on re-renders |
| ✅ Increased `staleTime` 30s→60s, added `refetchOnMount: false` | `providers.tsx` | HIGH — halves background refetch frequency |
| ✅ Added Radix UI packages to `optimizePackageImports` | `next.config.ts` | MEDIUM — tree-shakes 13 Radix packages |
| ✅ Added `loading.tsx` skeleton for platform layout | `(platform)/loading.tsx` | MEDIUM — instant feedback on navigation |

---

## REMAINING KNOWN ISSUES (Post-Sprint)

| Issue | Files Affected | Action |
|-------|---------------|--------|
| 5 feature files use raw `fetch()` bypassing React Query | `production-orders-view`, `quality-plans-view`, `storage-locations-view`, `notifications-view`, `dashboard-view` | Replace with `api.get()` + `useQuery` in each file |
| JWT stored in `localStorage` (XSS risk) | `auth-store.ts` | Move to httpOnly cookies post-PoC |
| echarts + recharts both bundled | `package.json` | Remove one; standardize on recharts (already used more) |
| `@monaco-editor/react` in bundle (4MB) | settings-view | Dynamic import: `const Editor = dynamic(() => import('@monaco-editor/react'))` |
| leaflet in bundle (1.5MB) | factory-selector | Dynamic import: `const Map = dynamic(() => import('@/features/factory-selector'))` |

---

*Last updated: 2026-06-08 · Performance fixes applied same day*
