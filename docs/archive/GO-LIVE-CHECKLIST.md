# MES360° Platform — Go-Live Checklist & Step-by-Step Guide
**Client:** NCC (National Care Company) — SIDCO PoC Factory (Dammam)  
**Platform Version:** 1.0.0  
**Prepared:** 2026-06-06  
**Document Type:** Pre-Production Readiness & Deployment Guide

---

## HOW TO USE THIS DOCUMENT
- Work through phases **in order** — each phase gates the next
- Every checkbox `[ ]` must be ticked before moving to the next phase
- Items marked 🔴 **BLOCKER** will prevent the system from functioning — do these first
- Items marked 🟡 **HIGH** are important for full feature parity
- Items marked 🟢 **MEDIUM** can be deferred to post-launch sprint
- Cross-reference the **NCC Prerequisites Excel** column for client-confirmed values

---

## PHASE 0 — NCC CLIENT DATA COLLECTION
> *Items still missing from the NCC Prerequisites File (Excel rows with no response)*
> *Must be collected from NCC/SIDCO before configuration begins*

### From Sheet 2 — Production & Shift
| # | Item | NCC Status | Excel Value |
|---|------|-----------|-------------|
| [ ] | **SKU Database** (full list with codes) | ⚠️ No response | 13 SKUs confirmed; full DB not submitted |
| [ ] | **Maintenance Records** (historical failure data) | ⚠️ No response | Not submitted |
| [ ] | **Public holiday / shutdown calendar** | ⚠️ No response | Not submitted |

### From Sheet 3 — Machine & Line
| # | Item | NCC Status | Excel Value |
|---|------|-----------|-------------|
| [ ] | **Full SKU list currently running** on packing line | ⚠️ No response | Not submitted |
| [ ] | **Cycle times per SKU per machine** (complete table) | ✅ Partial | Big Betti: 30/31/35 sc; Cartomac: 30/25/40 sc; Euro-Pack: 7m50/4m50/4m35; Uni-tech: 2m50/2m25/2m30 |
| [ ] | **Ideal cycle time per machine in sec/box** (for OEE Performance) | ⚠️ No response | Only "45 duplex/min" submitted — needs machine-level breakdown |

### From Sheet 4 — IT & Reporting
| # | Item | NCC Status | Action |
|---|------|-----------|--------|
| [ ] | **MQTT port approval** (1883 or 8883) from SIDCO IT | ⚠️ No response | Chase IT manager at SIDCO for firewall rule |
| [ ] | **WhatsApp Business numbers** for Issa, Mohammed B, Mohammed Y | ⚠️ No response | Collect phone numbers for alert configuration |

### Confirmed NCC Values (Already in Seed)
- ✅ 2 shifts/day: Day 07:30→19:30 / Night 19:30→07:30
- ✅ 11h planned production per 12h shift (0.5h break + 0.5h cleaning)
- ✅ Downtime threshold: **1 minute** (need to verify in code config)
- ✅ Production target: 3,000–3,500 boxes/shift
- ✅ Working days: Saturday–Thursday (6 days/week)
- ✅ SPOC: Issa Masadeh / 0539429752 / Issa.Masadeh@sidco.com.sa
- ✅ 5 machines: Big Betti, Cartomac, Checkweigher, Euro-Pack Robot, Uni-tech Wrapping
- ✅ Alert recipients: issa.masadeh@sidco.com.sa, mohammed.brakat@sidco.com.sa, mohammed.yousef@sidco.com.sa

---

## PHASE 1 — CRITICAL BLOCKERS (Week 1)
> *System cannot go live with any of these incomplete*

### 1.1 — Backend API: Missing Endpoints

#### 🔴 Work Order State Machine (Production Module)
- [ ] `PATCH /api/v1/production/work-orders/:id/start` — implement state: PLANNED → IN_PROGRESS, emit `production:work-order:started` WebSocket event, record actual start time
- [ ] `PATCH /api/v1/production/work-orders/:id/complete` — implement state: IN_PROGRESS → COMPLETED, calculate actual qty, emit `production:work-order:completed` event
- [ ] `PATCH /api/v1/production/work-orders/:id/hold` — implement ON_HOLD state, require reason
- [ ] `PATCH /api/v1/production/work-orders/:id/release` — PLANNED → RELEASED state
- [ ] Validate state transitions (cannot complete a non-started WO)
- [ ] Auto-create `ProductionEvent` record on each state change
- [ ] Link OEE calculation trigger to WO completion

**File:** [apps/api/src/modules/production/production.controller.ts](apps/api/src/modules/production/production.controller.ts) | [apps/api/src/modules/production/production.service.ts](apps/api/src/modules/production/production.service.ts)

#### 🔴 Quality Module: CRUD Endpoints Missing
- [ ] `POST /api/v1/quality/inspections` — create inspection result (link to WO + batch)
- [ ] `PATCH /api/v1/quality/inspections/:id` — update inspection (add measurements, change result)
- [ ] `POST /api/v1/quality/ncr` — create NCR (severity, affected batch, root cause)
- [ ] `PATCH /api/v1/quality/ncr/:id/status` — advance NCR status (OPEN → IN_REVIEW → CAPA_PENDING → RESOLVED → CLOSED)
- [ ] `POST /api/v1/quality/capa` — create CAPA linked to NCR
- [ ] `PATCH /api/v1/quality/capa/:id` — update CAPA (assignee, due date, actions, effectiveness)

**File:** [apps/api/src/modules/quality/quality.controller.ts](apps/api/src/modules/quality/quality.controller.ts) | [apps/api/src/modules/quality/quality.service.ts](apps/api/src/modules/quality/quality.service.ts)

#### 🔴 Maintenance Module: CRUD Endpoints Missing
- [ ] `POST /api/v1/maintenance/work-orders` — create maintenance WO (type, machine, priority, assignee)
- [ ] `PATCH /api/v1/maintenance/work-orders/:id/assign` — assign technician
- [ ] `PATCH /api/v1/maintenance/work-orders/:id/start` — status: OPEN → IN_PROGRESS
- [ ] `PATCH /api/v1/maintenance/work-orders/:id/complete` — status: IN_PROGRESS → COMPLETED, record actual duration + spare parts used
- [ ] `PATCH /api/v1/maintenance/work-orders/:id/hold` — ON_HOLD with reason
- [ ] `GET /api/v1/maintenance/work-orders/:id` — single WO detail with history

**File:** [apps/api/src/modules/maintenance/maintenance.controller.ts](apps/api/src/modules/maintenance/maintenance.controller.ts) | [apps/api/src/modules/maintenance/maintenance.service.ts](apps/api/src/modules/maintenance/maintenance.service.ts)

#### 🔴 Notifications: Rules Management Not Exposed
- [ ] `GET /api/v1/notifications` — list user notifications (paginated, unread first)
- [ ] `PATCH /api/v1/notifications/:id/read` — mark as read
- [ ] `PATCH /api/v1/notifications/read-all` — mark all read
- [ ] `GET /api/v1/notifications/rules` — list notification rules
- [ ] `POST /api/v1/notifications/rules` — create rule (module, event, threshold, channels, recipients)
- [ ] `PATCH /api/v1/notifications/rules/:id` — update rule
- [ ] `DELETE /api/v1/notifications/rules/:id` — delete rule

**File:** [apps/api/src/modules/notifications/notifications.service.ts](apps/api/src/modules/notifications/notifications.service.ts)

#### 🔴 Downtime Management
- [ ] `POST /api/v1/production/downtime` — manually log downtime event (machine, cause, start, duration)
- [ ] `PATCH /api/v1/production/downtime/:id/end` — close downtime event
- [ ] `GET /api/v1/production/downtime` — list downtime events (date range, machine filters)
- [ ] Verify 1-minute downtime threshold is configurable per factory (NCC confirmed: 1 min)
- [ ] Auto-trigger downtime when machine state changes to BREAKDOWN/IDLE beyond threshold

---

### 1.2 — Email Integration (Password Reset + Alerts)

🔴 **Email service not wired** — SMTP credentials exist in `.env` but no `EmailService` implemented

- [ ] Create `apps/api/src/common/services/email.service.ts` using `nodemailer`
- [ ] Implement `sendPasswordResetEmail(to, resetToken)` method
- [ ] Implement `sendNotificationEmail(to, subject, body)` method
- [ ] Wire `sendPasswordResetEmail` into `POST /api/v1/auth/forgot-password` endpoint
- [ ] Wire `sendNotificationEmail` into `NotificationsService.create()` when `emailSent = false` and channel includes EMAIL
- [ ] Test with SIDCO alert recipients:
  - `issa.masadeh@sidco.com.sa`
  - `mohammed.brakat@sidco.com.sa`
  - `mohammed.yousef@sidco.com.sa`

Required `.env` variables (verify set in production):
```
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@mes360.sa
```

---

### 1.3 — Downtime Threshold Configuration

🔴 **1-minute downtime threshold** confirmed by NCC — must be enforced in code

- [ ] Verify `DowntimeEvent` is only created when machine stop duration ≥ 1 minute
- [ ] Add `downtimeThresholdSeconds: 60` to factory configuration (seed for SIDCO)
- [ ] Ensure micro-stoppages (< 60s) are logged as `MachineStateRecord` but NOT as `DowntimeEvent`
- [ ] Verify this threshold appears in the UI settings page (configurable per factory by FACTORY_ADMIN)

---

### 1.4 — Production Target Configuration

🔴 **NCC confirmed 3,000–3,500 boxes/shift** — must be stored and used for OEE Performance

- [ ] Verify `ShiftTemplate` has `targetQty` field populated (3,000–3,500 range)
- [ ] Confirm OEE Performance formula uses this as the denominator: `Actual Output ÷ Target × 100`
- [ ] Expose `PATCH /api/v1/production/shift-templates/:id` endpoint to adjust target per SKU/product run
- [ ] Seed correct target values: Day shift = 3,500 boxes, Night shift = 3,000 boxes (use conservative values)

---

### 1.5 — Cycle Time Data Verification

🔴 **Cycle times from NCC Excel must match seed data exactly**

Verify the following values are correctly seeded in `MachineCycleTime` table:

| Machine | SKU Weight | Unit | Cycle Time |
|---------|-----------|------|-----------|
| Big Betti | 1.5 kg | INNER | 30 sec |
| Big Betti | 2.0 kg | INNER | 31 sec |
| Big Betti | 2.25 kg | INNER | 35 sec |
| Cartomac | 1.5 kg | CARTON | 30 sec |
| Cartomac | 2.0 kg | CARTON | 25 sec |
| Cartomac | 2.25 kg | CARTON | 40 sec |
| Euro-Pack Robot | 1.5 kg | PALLET | 470 sec (7m 50s) |
| Euro-Pack Robot | 2.0 kg | PALLET | 290 sec (4m 50s) |
| Euro-Pack Robot | 2.25 kg | PALLET | 275 sec (4m 35s) |
| Uni-tech Wrapping | 1.5 kg | PALLET | 170 sec (2m 50s) |
| Uni-tech Wrapping | 2.0 kg | PALLET | 145 sec (2m 25s) |
| Uni-tech Wrapping | 2.25 kg | PALLET | 150 sec (2m 30s) |

- [ ] Run seed and verify all above rows exist in `MachineCycleTime` table
- [ ] Add missing rows for 2.5 kg SKUs (Rex brand — 6x2.5 kg)
- [ ] Confirm Checkweigher cycle time is defined (not in Excel — get from NCC)

---

### 1.6 — Security: Production Secrets

🔴 **Default/weak secrets in docker-compose.yml must be replaced before production**

- [ ] Replace `JWT_SECRET: mes360-jwt-secret-key-change-in-production-32chars` with a 64-char random secret
- [ ] Replace `JWT_REFRESH_SECRET: mes360-refresh-secret-key-change-in-prod-32ch` with a 64-char random secret
- [ ] Replace `POSTGRES_PASSWORD: mes_password` with a strong password
- [ ] Replace `MINIO_ROOT_PASSWORD: minioadmin` with a strong password
- [ ] Replace `GF_SECURITY_ADMIN_PASSWORD: mes360` (Grafana) with strong password
- [ ] Replace `INFLUX_TOKEN: mes-influx-super-secret-token` with a strong random token
- [ ] Generate secrets command:
  ```bash
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  ```
- [ ] Store all production secrets in a password manager or secret vault
- [ ] Never commit production `.env` to git (verify `.gitignore` covers `.env.production`)

---

### 1.7 — Password Complexity Validation

🔴 **No password rules enforced — any password accepted**

- [ ] Add Zod/class-validator rule to `LoginDto` and `ChangePasswordDto`:
  - Minimum 8 characters
  - At least 1 uppercase letter
  - At least 1 number
  - At least 1 special character
- [ ] Return clear validation error message on failure
- [ ] Apply same rules to user creation endpoint

---

## PHASE 2 — HIGH PRIORITY (Week 2)

### 2.1 — File Uploads (Inspection Photos, NCR Attachments)

🟡 **MinIO is running but no upload API endpoints exist**

- [ ] Create `apps/api/src/modules/files/files.controller.ts` with:
  - `POST /api/v1/files/upload` — multipart form, returns `fileId` + `url`
  - `DELETE /api/v1/files/:id` — remove file from MinIO
  - `GET /api/v1/files/:id/presigned` — generate short-lived presigned URL for download
- [ ] Install `@nestjs/platform-express` multipart support + `multer`
- [ ] Create MinIO bucket `mes360` on first deploy (seed script or startup hook)
- [ ] Wire `fileId` fields to:
  - `InspectionResult.attachments` (inspection photos)
  - `NCR.attachments` (non-conformance evidence)
  - `CAPA.evidenceFiles` (corrective action evidence)
  - `MaintenanceWO.photos` (maintenance work photos)
- [ ] Add file size limit: 10 MB per file
- [ ] Add allowed types: `image/jpeg`, `image/png`, `application/pdf`

---

### 2.2 — WhatsApp / SMS Notifications

🟡 **NCC preferred alert method is WhatsApp — not currently implemented**

- [ ] Implement `TwilioService` in `apps/api/src/common/services/twilio.service.ts`
- [ ] Implement `sendWhatsAppAlert(to: string, message: string)` using Twilio WhatsApp API
- [ ] Implement `sendSmsAlert(to: string, message: string)` as fallback
- [ ] Wire into `NotificationsService.create()` for channels: WHATSAPP, SMS
- [ ] Configure phone numbers for SIDCO alert recipients:
  - Issa Masadeh: 0539429752
  - Mohammed Brakat: (collect from NCC)
  - Mohammed Yousef: (collect from NCC)
- [ ] Test alert delivery for:
  - Machine BREAKDOWN event
  - OEE drops below threshold
  - NCR created (CRITICAL severity)

Required `.env` variables:
```
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
TWILIO_PHONE_NUMBER=
```

---

### 2.3 — Redis Connection Fix

🟡 **API logs persistent `[ioredis] ECONNREFUSED` errors**

- [ ] Identify root cause: check if `RedisModule` is configured for cluster/sentinel mode
- [ ] Verify `REDIS_URL=redis://redis:6379` resolves correctly inside Docker network
- [ ] If using `ioredis` cluster: switch to single-node config for current deployment
- [ ] Add retry strategy: `retryStrategy: (times) => Math.min(times * 100, 3000)`
- [ ] Verify Redis cache is actually being used for:
  - Session token storage
  - JWT refresh token revocation list
  - Dashboard KPI cache (5-second TTL)
- [ ] Monitor Redis logs: `docker logs mes-redis --tail 50`

---

### 2.4 — Real-Time OEE: Event-Driven Calculation

🟡 **OEE is stored in `OEERecord` but unclear when it is recalculated**

- [ ] Trigger OEE recalculation on:
  - Machine state change (RUNNING → IDLE/BREAKDOWN)
  - Work order completion
  - End of shift (scheduled via cron or shift timer)
- [ ] Push updated OEE via WebSocket: `emit('oee:updated', { machineId, oee, availability, performance, quality })`
- [ ] Ensure `MachineCurrentStatus` table is updated on every state change
- [ ] Add cron job: recalculate + persist `OEERecord` at shift end (19:30 and 07:30 for SIDCO)

---

### 2.5 — Live IoT Data (Replace Simulated Heartbeat)

🟡 **WebSocket currently sends 5-second simulated heartbeat — not real device data**

- [ ] Wire MQTT subscriber (`mes.gateway.ts`) to actual MQTT topic messages from mosquitto broker
- [ ] On MQTT message received → update `TagCurrentValue` in database → broadcast to subscribed WebSocket clients
- [ ] Implement machine state inference from tag values:
  - Running signal HIGH + count increasing → RUNNING
  - Running signal LOW for > 60 sec → IDLE (then BREAKDOWN if fault bit set)
  - Fault register bit set → BREAKDOWN
- [ ] Test with mosquitto test client:
  ```bash
  docker exec mes-mqtt-broker mosquitto_pub -t "sidco/packing/big-betti/status" -m '{"state":"RUNNING","count":1234}'
  ```
- [ ] Confirm real-time updates appear on the dashboard within 2 seconds of MQTT publish

---

### 2.6 — Report Export (PDF / Excel)

🟡 **No PDF or Excel export — users cannot print reports**

- [ ] Install `exceljs` for Excel export and `pdfkit` or `puppeteer` for PDF
- [ ] Add `GET /api/v1/reports/production/export?format=xlsx&dateFrom=&dateTo=` endpoint
- [ ] Add `GET /api/v1/reports/quality/export?format=pdf`
- [ ] Add `GET /api/v1/reports/maintenance/export?format=xlsx`
- [ ] Wire export buttons in frontend (Production Reports page, Quality Reports page)
- [ ] Add OEE trend chart (PNG capture via `chartjs-node-canvas`) embedded in PDF

---

### 2.7 — Maintenance Reports Endpoint

🟡 **`GET /api/v1/reports/maintenance` missing from controller**

- [ ] Implement endpoint returning:
  - Total maintenance WOs (by type: PREVENTIVE / CORRECTIVE / EMERGENCY)
  - MTBF per machine (hours between failures)
  - MTTR per machine (average repair time)
  - Maintenance cost (labor hours × rate + spare parts cost)
  - Top 5 failure causes by frequency
  - Overdue PM tasks count
- [ ] Add `GET /api/v1/reports/energy` endpoint (EnergyMeter + EnergyReading aggregation)

---

### 2.8 — Hierarchy Management Endpoints

🟡 **Hierarchy is read-only — cannot add/edit machines from UI**

- [ ] `POST /api/v1/hierarchy/machines` — create machine (factoryId, areaId, lineId, type, criticality)
- [ ] `PATCH /api/v1/hierarchy/machines/:id` — edit machine details
- [ ] `POST /api/v1/hierarchy/areas` — create area
- [ ] `POST /api/v1/hierarchy/lines` — create production line
- [ ] Apply `RolesGuard` — only FACTORY_ADMIN and above can modify hierarchy

---

### 2.9 — Audit Log Viewer

🟡 **`AuditLog` model is populated but no UI or API to query it**

- [ ] `GET /api/v1/audit-logs` — paginated (filter by userId, module, action, dateRange)
- [ ] Roles: SUPER_ADMIN + FACTORY_ADMIN only
- [ ] Frontend: add "Audit Log" page under Settings → Security
- [ ] Display: timestamp, user, action, module, before/after values (JSON diff)

---

### 2.10 — MFA Verification Endpoint

🟡 **`mfaSecret` field exists in User model but `/auth/verify-mfa` is not exposed**

- [ ] Install `speakeasy` package for TOTP generation/verification
- [ ] `POST /api/v1/auth/mfa/setup` — generate TOTP secret, return QR code
- [ ] `POST /api/v1/auth/mfa/enable` — verify first TOTP code, save secret to user
- [ ] `POST /api/v1/auth/mfa/verify` — verify code during login flow
- [ ] `POST /api/v1/auth/mfa/disable` — disable MFA (requires current password)
- [ ] Frontend: add MFA setup to Settings → Security page (show QR code for Google Authenticator)

---

## PHASE 3 — INFRASTRUCTURE & DEVOPS (Week 2–3)

### 3.1 — SSL/TLS Certificates

🔴 **nginx-certs volume exists but no certificate provisioning**

- [ ] Obtain SSL certificate for production domain (Let's Encrypt or purchased)
- [ ] Option A — Let's Encrypt (auto-renew): integrate `certbot` container into `docker-compose.prod.yml`
- [ ] Option B — Manual: copy `.crt` and `.key` files to `nginx-certs` volume
- [ ] Update nginx config: listen on 443, redirect 80 → 443
- [ ] Test: `curl -v https://your-domain.com/health`
- [ ] Verify certificate validity date and auto-renewal timer

---

### 3.2 — Database Backup Strategy

🔴 **No automated backup — single point of data failure**

- [ ] Add `backup` service to `docker-compose.prod.yml`:
  ```yaml
  backup:
    image: postgres:16-alpine
    environment:
      PGPASSWORD: ${POSTGRES_PASSWORD}
    command: >
      sh -c "while true; do
        pg_dump -h postgres -U mes_user mes360 | gzip > /backups/backup_$(date +%Y%m%d_%H%M%S).sql.gz
        find /backups -mtime +7 -delete
        sleep 86400
      done"
    volumes:
      - ./backups:/backups
  ```
- [ ] Test backup restore:
  ```bash
  gunzip < backup_YYYYMMDD.sql.gz | psql -h localhost -p 5433 -U mes_user mes360
  ```
- [ ] Configure off-site backup: copy daily backup to S3/MinIO external bucket
- [ ] Document RTO (Recovery Time Objective) and RPO (Recovery Point Objective) targets
- [ ] Schedule weekly restore drill before go-live

---

### 3.3 — Log Aggregation

🟡 **Logs written to container stdout and `apps/api/logs/` — no centralized viewer**

- [ ] Add log rotation to API Winston config:
  ```typescript
  new winston.transports.File({ filename: 'logs/error.log', level: 'error', maxsize: 10485760, maxFiles: 5 })
  ```
- [ ] Option A: Add Loki + Grafana log viewer (lightweight)
- [ ] Option B: Forward logs to external service (Datadog, Papertrail)
- [ ] Minimum: ensure `docker logs mes-api --tail 200` is accessible to operations team
- [ ] Configure log level via `LOG_LEVEL` env var (production: `warn`, staging: `info`)

---

### 3.4 — Monitoring Alerts (Prometheus + Grafana)

🟡 **Prometheus and Grafana are running but no alerts configured**

- [ ] Add `@willsoto/nestjs-prometheus` to API for application metrics
- [ ] Expose metrics: request rate, error rate, response time, active WebSocket connections
- [ ] Create Grafana dashboards:
  - API health (latency P95, error rate, active connections)
  - Database (connection pool, query time)
  - Redis (cache hit rate, memory usage)
  - System (CPU, memory, disk)
- [ ] Configure Grafana alerts:
  - API error rate > 5% → alert email to `soliman@mes360.sa`
  - Disk > 80% full → alert
  - Database connections > 80 → alert
  - Container restart detected → alert

---

### 3.5 — Production Environment Variables

🔴 **All production `.env` values must be set before deploy**

Create `.env.production` with these confirmed values for SIDCO:

```bash
# Application
NODE_ENV=production
API_PORT=3001
CORS_ORIGINS=https://your-production-domain.com

# Database
DATABASE_URL=postgresql://mes_user:STRONG_PASSWORD@postgres:5432/mes360
POSTGRES_DB=mes360
POSTGRES_USER=mes_user
POSTGRES_PASSWORD=STRONG_PASSWORD

# Cache
REDIS_URL=redis://redis:6379

# JWT (generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
JWT_SECRET=GENERATE_64_CHAR_RANDOM
JWT_REFRESH_SECRET=GENERATE_DIFFERENT_64_CHAR_RANDOM
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# InfluxDB
INFLUX_URL=http://influxdb:8086
INFLUX_TOKEN=GENERATE_STRONG_TOKEN
INFLUX_ORG=mes360
INFLUX_BUCKET=mes_timeseries

# MQTT (verify SIDCO IT has opened port 1883 or 8883)
MQTT_BROKER_URL=mqtt://mosquitto:1883

# MinIO / Object Storage
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=STRONG_ACCESS_KEY
MINIO_SECRET_KEY=STRONG_SECRET_KEY
MINIO_BUCKET=mes360

# Email (SMTP — fill with real credentials)
SMTP_HOST=smtp.yourdomain.com
SMTP_PORT=587
SMTP_USER=noreply@mes360.sa
SMTP_PASSWORD=SMTP_PASSWORD
SMTP_FROM=noreply@mes360.sa

# SMS / WhatsApp (Twilio)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# Frontend (production domain)
NEXT_PUBLIC_API_URL=https://your-production-domain.com
NEXT_PUBLIC_WS_URL=wss://your-production-domain.com
NEXT_PUBLIC_APP_URL=https://your-production-domain.com

# Monitoring
GRAFANA_ADMIN_PASSWORD=STRONG_GRAFANA_PASSWORD
```

- [ ] All above variables filled in
- [ ] File saved as `.env.production` (NOT committed to git)
- [ ] Copy to production server: `scp .env.production user@server:/app/.env`

---

### 3.6 — CI/CD Pipeline Secrets

🟡 **GitHub Actions requires secrets to be configured**

- [ ] Go to GitHub repo → Settings → Secrets & Variables → Actions → New secret:
  - `STAGING_HOST` — staging server IP
  - `STAGING_USER` — SSH username
  - `STAGING_SSH_KEY` — private SSH key for staging
  - `PRODUCTION_HOST` — production server IP
  - `PRODUCTION_USER` — SSH username
  - `PRODUCTION_SSH_KEY` — private SSH key for production
  - `REGISTRY` — `ghcr.io`
  - `IMAGE_NAME` — `your-org/mes360`
  - `CODECOV_TOKEN` — from codecov.io
  - `NEXT_PUBLIC_API_URL` — production API URL
  - `NEXT_PUBLIC_WS_URL` — production WebSocket URL
- [ ] Add smoke-test step to CI after deploy:
  ```yaml
  - name: Smoke test
    run: curl -f https://your-domain.com/health || exit 1
  ```
- [ ] Add post-deploy health check to GitHub Actions `deploy-production` job

---

### 3.7 — MQTT Firewall (SIDCO IT Coordination)

🟡 **IoT gateway must reach MQTT broker — SIDCO IT has not confirmed firewall rule**

- [ ] Contact SIDCO IT (SPOC: Issa Masadeh / 0539429752)
- [ ] Request outbound rule: allow TCP port 1883 (or 8883 for TLS) from packing line network to cloud server IP
- [ ] If blocked: configure MQTT-over-WebSocket (port 9002 which is already mapped in docker-compose)
- [ ] Test from SIDCO factory floor: `telnet your-server-ip 1883`
- [ ] Document the confirmed port in deployment notes

---

## PHASE 4 — DATA CONFIGURATION (Week 3)

### 4.1 — Verify Seed Data Integrity

- [ ] Run `pnpm db:seed` on staging and verify:
  ```bash
  docker exec mes-postgres psql -U mes_user -d mes360 -c "SELECT COUNT(*) FROM \"MachineCycleTime\";"
  docker exec mes-postgres psql -U mes_user -d mes360 -c "SELECT COUNT(*) FROM \"SKU\";"
  docker exec mes-postgres psql -U mes_user -d mes360 -c "SELECT COUNT(*) FROM \"DowntimeCause\";"
  docker exec mes-postgres psql -U mes_user -d mes360 -c "SELECT COUNT(*) FROM \"User\";"
  ```
- [ ] Expected counts: MachineCycleTime ≥ 12, SKU = 32, DowntimeCause = 45, User ≥ 9

### 4.2 — Create SIDCO User Accounts

- [ ] Login as `admin@mes360.sa` (seed default password: `Admin@123456`)
- [ ] Change admin password to something secure
- [ ] Verify these users exist (seeded):
  - `issa.masadeh@sidco.com.sa` — FACTORY_ADMIN
  - `mohammed.brakat@sidco.com.sa` — PLANT_MANAGER
  - `mohammed.yousef@sidco.com.sa` — PRODUCTION_SUPERVISOR
- [ ] Send login credentials securely to each user (not via email in plain text)
- [ ] Instruct each user to change password on first login

### 4.3 — Configure Notification Rules for SIDCO

- [ ] Create notification rule: Machine BREAKDOWN > 5 min → WhatsApp alert to Issa, Mohammed B, Mohammed Y
- [ ] Create notification rule: OEE < 65% per shift → Email alert to Mohammed Brakat
- [ ] Create notification rule: NCR created with CRITICAL severity → Email + WhatsApp to Issa Masadeh
- [ ] Create notification rule: Maintenance WO overdue > 24h → Email to Maintenance Manager

### 4.4 — Configure Shift Schedule

- [ ] Verify `ShiftTemplate` for SIDCO in database:
  - Day Shift: start 07:30, end 19:30, plannedMinutes = 660 (11h)
  - Night Shift: start 19:30, end 07:30, plannedMinutes = 660 (11h)
- [ ] Verify break times recorded: 0.5h break + 0.5h cleaning = 1h excluded per shift
- [ ] Add `ShiftInstance` generation: auto-create instances for next 30 days on seed/first run

### 4.5 — Add Working Calendar (Saudi)

- [ ] Verify `workingDays: [SAT, SUN, MON, TUE, WED, THU]` (Friday = off)
- [ ] Add Saudi public holidays 2026 to factory calendar:
  - Founding Day: Feb 22
  - Eid Al-Fitr: ~late March 2026 (3 days)
  - Eid Al-Adha: ~late May/June 2026 (4 days)
  - National Day: Sep 23
- [ ] Confirm holiday dates with Issa Masadeh (NCC Excel item #9 — no response received)

---

## PHASE 5 — TESTING (Week 3–4)

### 5.1 — Backend Unit Tests (Minimum 50% coverage)

🔴 **Only 2 test files exist for 12+ modules**

- [ ] `auth.service.spec.ts` — ✅ exists; verify it passes
- [ ] `oee.service.spec.ts` — ✅ exists; verify it passes
- [ ] Write tests for:
  - [ ] `production.service.spec.ts` — WO create, start, complete, OEE trigger
  - [ ] `quality.service.spec.ts` — inspection create, NCR lifecycle, CAPA creation
  - [ ] `maintenance.service.spec.ts` — WO create, assign, start, complete, MTBF/MTTR
  - [ ] `notifications.service.spec.ts` — rule evaluation, email/WhatsApp dispatch
  - [ ] `hierarchy.service.spec.ts` — factory scoping, machine CRUD
- [ ] Run: `pnpm test` → verify all pass
- [ ] Run: `pnpm test --coverage` → verify coverage ≥ 50% for `apps/api/src`

### 5.2 — Integration Tests (API Smoke Suite)

- [ ] Test complete login flow:
  ```bash
  # 1. Get factories
  curl http://localhost:3001/api/v1/auth/factories
  # 2. Login as SIDCO user
  curl -X POST http://localhost:3001/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"issa.masadeh@sidco.com.sa","password":"your-password","factoryCode":"SIDCO"}'
  # Save access token from response
  ```
- [ ] Test production flow:
  ```bash
  # Create WO
  curl -X POST http://localhost:3001/api/v1/production/work-orders \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"factoryId":"...","machineId":"...","skuId":"...","plannedQty":500,"plannedStart":"2026-06-07T07:30:00Z"}'
  # Start WO
  curl -X PATCH http://localhost:3001/api/v1/production/work-orders/$WO_ID/start \
    -H "Authorization: Bearer $TOKEN"
  # Complete WO
  curl -X PATCH http://localhost:3001/api/v1/production/work-orders/$WO_ID/complete \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"actualQty":490}'
  ```
- [ ] Test quality flow: create inspection → link to WO → add measurement → pass/fail
- [ ] Test maintenance flow: create corrective WO → assign → start → complete → verify MTTR updated
- [ ] Test notification: trigger BREAKDOWN → verify WebSocket event received → verify email sent

### 5.3 — Frontend UAT Checklist

- [ ] **Factory Selector Map** — verify all 5 NCC factory pins appear correctly on map
- [ ] **Login** — test with each SIDCO user account; verify factory scope enforced
- [ ] **Dashboard** — verify KPI widgets populate; verify machine status cards reflect seed state
- [ ] **Production → Create WO** — fill form, save, verify appears in list
- [ ] **Production → Start WO** — click Start, verify status changes to IN_PROGRESS in real-time
- [ ] **Production → OEE** — verify gauges display correctly; test date filter
- [ ] **Quality → Inspections** — create inspection, add measurement, mark Pass
- [ ] **Quality → NCR** — create NCR with CRITICAL severity, verify alert triggered
- [ ] **Quality → CAPA** — link CAPA to NCR, set due date, complete action, mark effective
- [ ] **Maintenance → Create WO** — create CORRECTIVE WO for Big Betti, assign to technician
- [ ] **Reports → Production** — select date range, verify data loads; test export button
- [ ] **Notifications** — verify unread count badge updates; mark as read
- [ ] **Settings → Profile** — change password; verify new password works
- [ ] **Logout** — verify session cleared; refresh token rejected

### 5.4 — Browser Compatibility

- [ ] Chrome 120+ — primary browser (SIDCO team uses Chrome)
- [ ] Edge 120+ — test on Windows (SIDCO machines)
- [ ] Mobile (optional): verify login page is usable on phone for alerts

### 5.5 — Load Testing

🟡 **No load test has been run — unknown capacity**

- [ ] Install k6: `winget install k6`
- [ ] Run basic load test against staging:
  ```bash
  k6 run --vus 20 --duration 60s loadtest.js
  ```
- [ ] Verify API handles 20 concurrent users without errors or > 500ms P95 latency
- [ ] Identify bottlenecks (database connection pool, Redis, API memory)
- [ ] Document results and adjust if needed (increase Docker resource limits)

---

## PHASE 6 — STAGING DEPLOYMENT & UAT (Week 4)

### 6.1 — Deploy to Staging Server

- [ ] Provision staging server (Ubuntu 22.04 LTS, min 4 vCPU, 8 GB RAM, 100 GB SSD)
- [ ] Install Docker Engine + Docker Compose:
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  ```
- [ ] Clone repo: `git clone https://github.com/your-org/mes360.git`
- [ ] Copy `.env.staging` to server as `.env`
- [ ] Run: `docker compose -f docker-compose.prod.yml up -d`
- [ ] Verify all containers healthy: `docker ps`
- [ ] Run seed: `docker exec mes-api npx prisma db seed`
- [ ] Verify health: `curl https://staging.your-domain.com/health`

### 6.2 — UAT Session with NCC

- [ ] Schedule 4-hour UAT session with:
  - Issa Masadeh (FACTORY_ADMIN)
  - Mohammed Brakat (PLANT_MANAGER)
  - Mohammed Yousef (PRODUCTION_SUPERVISOR)
- [ ] Walkthrough checklist:
  - [ ] Login and factory selection
  - [ ] Dashboard overview
  - [ ] Create and manage work orders
  - [ ] Log downtime with cause
  - [ ] Create quality inspection
  - [ ] Create NCR and CAPA
  - [ ] Create maintenance WO
  - [ ] View OEE trends
  - [ ] View and export reports
  - [ ] Receive test notification (WhatsApp + email)
- [ ] Collect feedback and create issue list
- [ ] Fix blocking UAT issues before go-live

---

## PHASE 7 — PRODUCTION GO-LIVE (Week 5)

### 7.1 — Production Server Setup

- [ ] Provision production server (min 8 vCPU, 16 GB RAM, 200 GB SSD — expandable)
- [ ] Install Docker Engine + Docker Compose
- [ ] Configure firewall:
  - Allow inbound 80, 443 (nginx)
  - Allow inbound 22 (SSH — restrict to office IP)
  - Deny all other inbound
  - Allow outbound 1883 or 8883 (MQTT to IoT gateway)
  - Allow outbound 587 (SMTP email)
  - Allow outbound 443 (Twilio API, WhatsApp)
- [ ] Configure domain DNS: `A record: your-domain.com → production server IP`
- [ ] Install and configure SSL certificate
- [ ] Set up SSH key authentication (disable password auth)
- [ ] Configure `fail2ban` for SSH brute-force protection

### 7.2 — Production Deployment Steps

```bash
# Step 1: SSH to production server
ssh user@your-production-server-ip

# Step 2: Clone repository
git clone https://github.com/your-org/mes360.git /app/mes360
cd /app/mes360

# Step 3: Set production environment
cp .env.production .env

# Step 4: Build and start all services
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

# Step 5: Wait for database to be healthy
docker compose wait postgres redis

# Step 6: Run database migrations
docker exec mes-api npx prisma db push

# Step 7: Run seed data (NCC data)
docker exec mes-api npx prisma db seed

# Step 8: Verify all services
docker ps
curl -f https://your-production-domain.com/health

# Step 9: Smoke test login
curl -X POST https://your-production-domain.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@mes360.sa","password":"ADMIN_PASSWORD"}'
```

### 7.3 — Go-Live Day Checklist

- [ ] Confirm all Phase 1–6 items completed
- [ ] Final backup of staging database (for rollback reference)
- [ ] Announce maintenance window to SIDCO team (recommend: Sunday 22:00–02:00)
- [ ] Deploy to production (steps above)
- [ ] Verify health endpoint responds: `200 OK`
- [ ] Verify WebSocket connection from browser: open browser console, check Socket.IO connected
- [ ] Verify login with all 3 SIDCO accounts
- [ ] Verify MQTT connectivity: publish test message from IoT gateway
- [ ] Verify notification: trigger test notification → confirm WhatsApp/email received
- [ ] Verify OEE dashboard loads with seeded machine data
- [ ] Confirm Grafana dashboards are operational: `https://your-domain.com:3003`
- [ ] Document go-live time and sign-off with Issa Masadeh

### 7.4 — Rollback Plan

If critical issues found after go-live:

```bash
# Option A: Roll back to previous image tag
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d --scale api=0 web=0
# Edit docker-compose.prod.yml: change image tags to previous version
docker compose -f docker-compose.prod.yml up -d

# Option B: Restore database backup
gunzip < backups/backup_YYYYMMDD.sql.gz | \
  docker exec -i mes-postgres psql -U mes_user mes360

# Notify NCC team immediately if rollback executed
# Contact: Issa Masadeh / 0539429752
```

---

## PHASE 8 — POST-LAUNCH MONITORING (Week 5–8)

### 8.1 — Week 1 Hyper-Care

- [ ] Monitor application logs daily: `docker logs mes-api --tail 200 --since 24h`
- [ ] Check Grafana error rate dashboard every morning
- [ ] Review unhandled exceptions from logs
- [ ] Daily check-in call with Issa Masadeh (30 min)
- [ ] Response SLA: Critical issues → 2 hours; High → 8 hours; Medium → 48 hours

### 8.2 — Ongoing Operations

- [ ] Weekly database backup verification (test restore to separate volume)
- [ ] Monthly security review (update base Docker images for patches)
- [ ] Quarterly: rotate JWT secrets + Twilio credentials
- [ ] Monitor disk usage: alert if > 70% (`df -h` on server)

---

## MEDIUM PRIORITY — POST-LAUNCH SPRINT (Month 2)

These items do not block go-live but should be delivered within 4–6 weeks of launch:

| # | Feature | Effort | Notes |
|---|---------|--------|-------|
| 🟢 | **Batch Genealogy API** (`GET /production/batches/:id/genealogy`) | 2 days | GenealogyLink model ready |
| 🟢 | **Energy Management Dashboard** | 3 days | EnergyMeter/EnergyReading models ready |
| 🟢 | **Audit Log Viewer (UI)** | 1 day | API endpoint in Phase 2 |
| 🟢 | **SPC Rule Violation Highlighting** | 2 days | Data present, UI missing |
| 🟢 | **Bulk Import (CSV)** | 3 days | Users, machines, SKUs |
| 🟢 | **Dashboard Widget Personalization** | 3 days | Drag-and-drop widget layout |
| 🟢 | **Arabic Language (i18n)** | 5 days | Schema has `nameAr` fields; need i18next |
| 🟢 | **SAP Integration** | 5–10 days | Credentials in `.env`; full OData connector needed |
| 🟢 | **Predictive Maintenance (AI)** | 2–4 weeks | FailureMode RPN data ready; ML model needed |

---

## SUMMARY: GO-LIVE READINESS SCORECARD

| Category | Status | Remaining Items | ETA |
|----------|--------|-----------------|-----|
| **Database & Schema** | ✅ 95% Ready | Cycle time gap for Checkweigher | 1 day |
| **Authentication & RBAC** | ✅ 90% Ready | MFA endpoint, password complexity | 2 days |
| **Production Module** | 🟡 65% Ready | WO state machine, downtime CRUD | 2 days |
| **Quality Module** | 🔴 40% Ready | Missing all CRUD endpoints | 3 days |
| **Maintenance Module** | 🔴 45% Ready | Missing WO CRUD endpoints | 2 days |
| **IIoT / Real-Time** | 🟡 60% Ready | Real device data not wired | 3 days |
| **Dashboard** | ✅ 85% Ready | Real-time push improvement | 1 day |
| **Reports** | 🟡 55% Ready | Missing export + maintenance/energy endpoints | 2 days |
| **Notifications** | 🔴 30% Ready | Email wired, WhatsApp not implemented | 2 days |
| **Infrastructure** | 🟡 70% Ready | SSL, backup, secrets, MQTT firewall | 2 days |
| **Testing** | 🔴 15% Ready | Only 2 tests exist, need 50% coverage | 5 days |
| **Security (Production)** | 🔴 50% Ready | All default secrets must be replaced | 1 day |
| **NCC Data Collection** | 🟡 70% Complete | Missing cycle times for Checkweigher, IT firewall approval | Client |
| **OVERALL** | **~60% Ready** | **~25 engineering days remaining** | **~5 weeks** |

---

## CONTACT REFERENCE

| Person | Role | Contact |
|--------|------|---------|
| Issa Masadeh | SIDCO SPOC / Factory Admin | 0539429752 / Issa.Masadeh@sidco.com.sa |
| Mohammed Brakat | Plant Manager | mohammed.brakat@sidco.com.sa |
| Mohammed Yousef | Production Supervisor | mohammed.yousef@sidco.com.sa |
| soliman@mes360.sa | Platform Manager (MES360°) | soliman@mes360.sa |

---

*Document auto-generated from code audit + NCC Prerequisites File (docs/NCC - Prerequisites File.xlsx)*  
*Last updated: 2026-06-06*
