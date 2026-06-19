# MES360° — Deployment & Operations

Docker operations, environment configuration, and troubleshooting guide.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [First-Time Setup](#2-first-time-setup)
3. [Daily Operations](#3-daily-operations)
4. [Service URLs & Credentials](#4-service-urls--credentials)
5. [Environment Variables](#5-environment-variables)
6. [Adding npm Packages](#6-adding-npm-packages)
7. [Rebuilding Services](#7-rebuilding-services)
8. [Docker Volume Management](#8-docker-volume-management)
9. [Logs & Monitoring](#9-logs--monitoring)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisites

| Requirement | Minimum | Notes |
|---|---|---|
| Docker Desktop | 24.x | Enable WSL2 backend on Windows |
| RAM | 8 GB | 12 GB recommended for smooth dev |
| Disk | 10 GB free | Images + volumes |
| Ports free | See list below | Check with `netstat -an` |

**Required free ports:**

```
3000, 3001, 3003, 5433, 6379,
8080, 8086, 9000, 9001, 9002, 9090, 1883
```

> Note: Port **5432** is NOT required — PostgreSQL is remapped to **5433** because a local PostgreSQL installation occupies 5432 on the dev machine.

---

## 2. First-Time Setup

```bash
# 1. Clone the repository
git clone <repo-url>
cd "MES360° PLATFORM"

# 2. Create environment file
cp .env.example .env
# Edit .env if needed (DB passwords, JWT secrets, etc.)

# 3. Build all images and start all 10 services
docker compose up -d --build

# 4. Wait for first-time Next.js compilation (20–35 seconds)
docker compose logs -f web
# Wait until you see: "Ready in Xms"

# 5. Seed the database (first time only)
docker compose exec api npx prisma db push
docker compose exec api npx prisma db seed
```

**Verify everything is running:**

```bash
docker compose ps
```

All 10 services should show `Up (healthy)` or `Up`:
- `mes-postgres`, `mes-redis`, `mes-influxdb`, `mes-mqtt-broker`
- `mes-minio`, `mes-api`, `mes-web`, `mes-nginx`
- `mes-prometheus`, `mes-grafana`

---

## 3. Daily Operations

### Start all services

```bash
docker compose up -d
```

### Stop all services

```bash
docker compose stop
```

### Restart a single service

```bash
docker compose restart web
docker compose restart api
```

### View live logs

```bash
# All services
docker compose logs -f

# Single service
docker compose logs -f web
docker compose logs -f api

# Last 100 lines
docker compose logs --tail=100 api
```

### Open a shell inside a container

```bash
docker compose exec api sh
docker compose exec web sh
docker compose exec postgres psql -U mes_user -d mes_db
```

---

## 4. Service URLs & Credentials

| Service | URL | Default Credentials |
|---|---|---|
| **MES Web App** | http://localhost:3000 | admin@mes360.sa / Admin@123 |
| **REST API** | http://localhost:3001/api/v1 | — |
| **API Docs (Swagger)** | http://localhost:3001/api/docs | — |
| **Grafana** | http://localhost:3003 | admin / admin |
| **Prometheus** | http://localhost:9090 | — |
| **MinIO Console** | http://localhost:9001 | minioadmin / minioadmin |
| **Nginx Proxy** | http://localhost:8080 | — |

**MES Demo Login:**

```
Email:    admin@mes360.sa
Password: Admin@123
Role:     SUPER_ADMIN
```

---

## 5. Environment Variables

Copy `.env.example` to `.env` and configure:

```dotenv
# ── PostgreSQL ──────────────────────────────────
POSTGRES_USER=mes_user
POSTGRES_PASSWORD=mes_password
POSTGRES_DB=mes_db
DATABASE_URL=postgresql://mes_user:mes_password@postgres:5432/mes_db

# ── Redis ────────────────────────────────────────
REDIS_URL=redis://redis:6379

# ── InfluxDB ─────────────────────────────────────
INFLUXDB_URL=http://influxdb:8086
INFLUXDB_TOKEN=my-super-secret-admin-token
INFLUXDB_ORG=mes360
INFLUXDB_BUCKET=mes_iot

# ── JWT ──────────────────────────────────────────
JWT_SECRET=change-this-in-production-min-32-chars
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d

# ── MinIO ────────────────────────────────────────
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin

# ── MQTT ─────────────────────────────────────────
MQTT_BROKER_URL=mqtt://mqtt-broker:1883

# ── App ──────────────────────────────────────────
NODE_ENV=development
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=http://localhost:3001
```

> **Production note:** Change all default passwords and secrets. Use Docker secrets or a secrets manager for production deployments.

---

## 6. Adding npm Packages

Adding a new npm package to either `apps/web` or `apps/api` requires special handling because Docker uses anonymous volumes for `node_modules`.

### The Problem

Docker Compose mounts the source directory as a volume:

```yaml
volumes:
  - ./apps/web:/app          # source files (live-reloaded)
  - /app/node_modules        # anonymous volume — persists across restarts
```

The anonymous volume is created from the image at build time. If you just rebuild the image without removing the old volume, the stale `node_modules` volume **shadows** the new one — the new package will not be available inside the container even if it's in the image.

### The Correct Procedure

**For `apps/web`:**

```bash
# 1. Add the package to apps/web/package.json
#    (edit manually or run locally if pnpm is installed)

# 2. Rebuild the image
docker compose build --no-cache web

# 3. Remove the container AND its anonymous volume
docker compose rm -f -v web

# 4. Start fresh (new container + new node_modules volume from new image)
docker compose up -d web
```

**For `apps/api`:**

```bash
docker compose build --no-cache api
docker compose rm -f -v api
docker compose up -d api
```

**Verify the package is installed:**

```bash
docker compose exec web ls /app/node_modules/<package-name>
```

### Why `-v` matters

`docker compose rm -f` removes the container but **leaves anonymous volumes by default**.  
`docker compose rm -f -v` removes both the container **and its anonymous volumes** — this is the critical flag.

---

## 7. Rebuilding Services

### After changing source code only

No rebuild needed — source code is volume-mounted. Changes are picked up by HMR (Next.js) or nodemon/ts-node-dev (NestJS) automatically.

### After changing `package.json` (adding/removing packages)

Follow the procedure in [Section 6](#6-adding-npm-packages).

### After changing `Dockerfile`

```bash
docker compose build --no-cache <service>
docker compose up -d <service>
```

### After changing `docker-compose.yml`

```bash
docker compose up -d
# Docker Compose will recreate only services that changed
```

### Full clean rebuild (all services)

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

---

## 8. Docker Volume Management

### List all volumes

```bash
docker volume ls
```

### Inspect which volumes a container uses

```bash
docker inspect mes-web --format '{{json .Mounts}}' | python -m json.tool
```

### Remove all unused volumes (careful!)

```bash
docker volume prune
```

### Named volumes in this project

| Volume Name | Service | Content |
|---|---|---|
| `mes_postgres_data` | postgres | PostgreSQL data files |
| `mes_redis_data` | redis | Redis AOF/RDB files |
| `mes_influxdb_data` | influxdb | InfluxDB time-series data |
| `mes_influxdb_config` | influxdb | InfluxDB config |
| `mes_minio_data` | minio | Object storage files |
| `mes_prometheus_data` | prometheus | Metrics history |
| `mes_grafana_data` | grafana | Dashboard configs |

> Anonymous `node_modules` volumes for `web` and `api` are **not named** — they are identified by the container name and removed with `docker compose rm -v`.

---

## 9. Logs & Monitoring

### Application logs

```bash
# Follow API logs (requests, errors, WebSocket events)
docker compose logs -f api

# Follow web logs (Next.js compiler output)
docker compose logs -f web

# Follow Nginx access logs
docker compose logs -f nginx
```

### Prometheus metrics

Open http://localhost:9090 and query:

```promql
# API request rate
rate(http_requests_total[5m])

# PostgreSQL connections
pg_stat_activity_count

# Redis memory usage
redis_memory_used_bytes

# Container CPU
rate(container_cpu_usage_seconds_total[5m])
```

### Grafana dashboards

Open http://localhost:3003 (admin / admin).

Pre-provisioned dashboards:
- **MES Overview** — API latency, error rate, request volume
- **Infrastructure** — CPU, RAM, disk per container
- **PostgreSQL** — query performance, connections, table sizes
- **Redis** — commands/s, memory, keyspace

### Health checks

Each service exposes a health endpoint:

```bash
curl http://localhost:3001/api/v1/health          # API
curl http://localhost:3000/api/health              # Next.js (if configured)
curl -I http://localhost:8080/health               # Nginx
```

---

## 10. Troubleshooting

### Page loads extremely slowly on first visit

**Cause:** Next.js dev mode compiles pages on demand. The first request after container start triggers full compilation.

**Resolution:** Wait 20–35 seconds. All subsequent navigation is instant (compiled & cached). This is normal dev-mode behavior.

---

### `Module not found: Can't resolve '<package>'`

**Cause:** Anonymous `node_modules` volume is stale — it was created from an older image that didn't have this package.

**Fix:**

```bash
docker compose build --no-cache web   # or api
docker compose rm -f -v web           # MUST use -v to drop the old volume
docker compose up -d web
```

---

### Web app shows blank page or React error after code change

**Cause:** Hot Module Replacement (HMR) sometimes fails on complex changes, or the dev server needs a full restart.

**Fix:**

```bash
docker compose restart web
```

---

### Cannot connect to PostgreSQL

**Symptoms:** API startup fails with `ECONNREFUSED 5432` or Prisma errors.

**Check:**

```bash
# Is postgres running?
docker compose ps postgres

# Check postgres logs
docker compose logs postgres

# Test connection from API container
docker compose exec api npx prisma db pull
```

**Common cause:** Database not yet ready when API starts. Docker Compose `healthcheck` on postgres should handle this, but if startup order is wrong:

```bash
docker compose restart api
```

---

### Port already in use

**Symptom:** `bind: address already in use` on container start.

**Find the occupying process (Windows):**

```powershell
netstat -ano | findstr :3000
```

**Resolution options:**
1. Kill the process using the port
2. Change the host port in `docker-compose.yml` (e.g., `"3005:4000"` for web)

> Remember: PostgreSQL is already on `5433` (not `5432`) for this reason.

---

### WebSocket shows "Disconnected" in topbar

**Cause:** Socket.IO cannot reach the API WebSocket endpoint.

**Check:**

```bash
# API running?
docker compose ps api

# API logs for socket errors
docker compose logs api | grep -i socket

# Can browser reach API?
curl http://localhost:3001/api/v1/health
```

---

### InfluxDB has no data / IoT charts empty

**Cause:** MQTT devices not connected, or InfluxDB bucket not initialized.

**Check:**

```bash
# InfluxDB running?
docker compose ps influxdb

# Check bucket exists
docker compose exec influxdb influx bucket list
```

**Re-initialize InfluxDB:**

```bash
docker compose restart influxdb
docker compose restart api   # API reconnects and re-creates bucket if needed
```

---

### MinIO / file uploads not working

```bash
# Check MinIO running
docker compose ps minio

# Check MinIO logs
docker compose logs minio

# Access MinIO console
# http://localhost:9001 → login minioadmin / minioadmin
# Verify bucket "mes-uploads" exists and has correct policy
```

---

### Full reset (nuclear option)

Destroys all data. Use only for development environment resets.

```bash
docker compose down -v    # stops + removes containers AND all named volumes
docker compose up -d --build
```

---

## Quick Reference Card

```bash
# Start everything
docker compose up -d

# Stop everything
docker compose stop

# Restart one service
docker compose restart web

# Follow logs
docker compose logs -f api

# Open shell
docker compose exec api sh

# Add npm package (correct procedure)
docker compose build --no-cache web
docker compose rm -f -v web
docker compose up -d web

# Full clean rebuild
docker compose down
docker compose build --no-cache
docker compose up -d

# Check service health
docker compose ps
```

---

*© 2026 MES360° — Operations Reference*
