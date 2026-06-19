# MES360° Platform — User Guide

> Complete guide for running and building the platform in **Development** and **Production** environments.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [First-Time Setup](#2-first-time-setup)
3. [Development Environment](#3-development-environment)
   - [Option A — Local (Recommended for active coding)](#option-a--local-recommended-for-active-coding)
   - [Option B — Full Docker (All services containerized)](#option-b--full-docker-all-services-containerized)
4. [Production Environment](#4-production-environment)
   - [Build Docker Images](#41-build-docker-images)
   - [Configure Production Secrets](#42-configure-production-secrets)
   - [Deploy All Services](#43-deploy-all-services)
5. [Service URLs & Ports](#5-service-urls--ports)
6. [Default Credentials](#6-default-credentials)
7. [Database Management](#7-database-management)
8. [Useful Commands Reference](#8-useful-commands-reference)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Prerequisites

Install the following tools before proceeding.

| Tool | Version | Download |
|------|---------|----------|
| **Node.js** | 20 LTS | https://nodejs.org |
| **pnpm** | 9+ | `npm install -g pnpm@9` |
| **Docker Desktop** | Latest | https://www.docker.com/products/docker-desktop |
| **Git** | Any | https://git-scm.com |

Verify your installations:

```powershell
node --version      # should show v20.x.x
pnpm --version      # should show 9.x.x
docker --version    # should show Docker version 24+
docker compose version  # should show v2.x.x
```

---

## 2. First-Time Setup

Run these steps **once** when setting up the project for the first time.

### Step 1 — Clone / Navigate to the project

```powershell
cd "d:\NEW WORKS\New folder\MES360° PLATFORM"
```

### Step 2 — Install all dependencies

```powershell
pnpm install
```

This installs dependencies for all workspaces: `apps/*`, `packages/*`, and `services/*`.

### Step 3 — Create your environment file

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

The `.env` file is already pre-configured for local development — no changes are needed to run the project locally. For customization see the table below.

**Key variables to review in `.env`:**


| Variable | Default | Notes |
|----------|---------|-------|
| `DATABASE_URL` | `postgresql://mes_user:mes_password@localhost:5432/mes360` | Keep as-is for local dev |
| `REDIS_URL` | `redis://localhost:6379` | Keep as-is for local dev |
| `INFLUX_TOKEN` | `your-influx-token` | Set to `mes-influx-super-secret-token` for local dev |
| `JWT_SECRET` | placeholder | **Change in production** — must be ≥32 chars |
| `JWT_REFRESH_SECRET` | placeholder | **Change in production** — must be ≥32 chars |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | Must match your API port |

---

## 3. Development Environment

### Option A — Local (Recommended for active coding)

This approach runs the databases and services in Docker, but the Next.js frontend and NestJS backend run natively on your machine with **hot reload**.

#### Step 1 — Start infrastructure services

```powershell
docker compose up -d postgres redis influxdb mosquitto minio
```

Wait ~15 seconds for all services to become healthy, then verify:

```powershell
docker compose ps
```

All containers should show `healthy` or `running`.

#### Step 2 — Run database migrations & seed data

```powershell
# Generate the Prisma client
pnpm db:generate

# Apply all migrations to the database
pnpm db:migrate

# Seed the database with initial data (admin user, sample hierarchy, etc.)
pnpm db:seed
```

#### Step 3 — Start all applications in watch mode

```powershell
pnpm dev
```

Turbo will start the NestJS API and Next.js frontend in parallel with hot reload enabled.

**The platform is now running:**

| Service | URL |
|---------|-----|
| Web Application | http://localhost:4000 |
| API | http://localhost:4001/api/v1 |
| Swagger Docs | http://localhost:4001/api/v1/docs |
| InfluxDB UI | http://localhost:8086 |
| MinIO Console | http://localhost:9001 |

> Log in with `admin@mes360.sa` / `Password@123`

To stop the dev servers press `Ctrl+C` in the terminal. To stop infrastructure containers:

```powershell
docker compose down
```

---

### Option B — Full Docker (All services containerized)

Use this when you want to test the project inside containers with no local Node.js processes.

#### Step 1 — Build and start everything

```powershell
docker compose up -d --build
```

Docker will build the `api` and `web` images using the `development` stage (includes hot reload via bind mounts) and start all services: databases, messaging, storage, apps, proxy, and monitoring.

#### Step 2 — Monitor startup logs

```powershell
# Watch all services
docker compose logs -f

# Watch only the API (includes migration output)
docker compose logs -f api

# Watch only the frontend
docker compose logs -f web
```

The API container automatically runs `prisma migrate deploy` and `prisma db seed` on startup.

**The platform is now running:**

| Service | URL |
|---------|-----|
| Web Application | http://localhost:3000 |
| API | http://localhost:3001/api/v1 |
| Swagger Docs | http://localhost:3001/api/v1/docs |
| InfluxDB UI | http://localhost:8086 |
| MinIO Console | http://localhost:9001 |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3003 |

To stop all containers:

```powershell
docker compose down
```

To stop and delete all data volumes (full reset):

```powershell
docker compose down -v
```

---

## 4. Production Environment

### 4.1 Build Docker Images

Build optimized, standalone production images with multi-stage builds:

```powershell
# Build the NestJS API image (production stage)
docker build -t mes-api:latest ./apps/api --target production

# Build the Next.js frontend image (production stage)
docker build -t mes-web:latest ./apps/web --target production
```

To push images to GitHub Container Registry (used by CI/CD):

```powershell
# Tag for GHCR
docker tag mes-api:latest ghcr.io/<your-org>/mes-api:latest
docker tag mes-web:latest ghcr.io/<your-org>/mes-web:latest

# Push
docker push ghcr.io/<your-org>/mes-api:latest
docker push ghcr.io/<your-org>/mes-web:latest
```

---

### 4.2 Configure Production Secrets

Create a **production `.env` file** on your server. Never commit this file to git.

```powershell
Copy-Item .env.example .env.prod
```

Edit `.env.prod` and set all required production values:

```env
NODE_ENV=production

# Strong random secrets (use a password generator, min 32 chars)
JWT_SECRET=<random-64-char-string>
JWT_REFRESH_SECRET=<different-random-64-char-string>
ENCRYPTION_KEY=<random-32-char-string>

# PostgreSQL credentials
POSTGRES_USER=mes_user
POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=mes360

# Redis credentials
REDIS_PASSWORD=<strong-password>

# InfluxDB credentials
INFLUXDB_USERNAME=admin
INFLUXDB_PASSWORD=<strong-password>
INFLUXDB_TOKEN=<random-token>
INFLUXDB_ORG=mes360
INFLUXDB_BUCKET=mes_timeseries

# Docker image registry
REGISTRY=ghcr.io
IMAGE_NAME=<your-org>
TAG=latest

# SMTP (for email notifications)
SMTP_HOST=smtp.yourdomain.com
SMTP_PORT=587
SMTP_USER=noreply@yourdomain.com
SMTP_PASSWORD=<email-password>
```

---

### 4.3 Deploy All Services

Run the production Docker Compose stack:

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

This starts:
- PostgreSQL, Redis, InfluxDB, Mosquitto (infrastructure)
- 2 replicas of the NestJS API (resource-limited: 1 CPU / 512 MB each)
- Next.js frontend
- Nginx reverse proxy with SSL support (mounts `/etc/letsencrypt`)

**Run migrations on production (first deploy only):**

```powershell
# Run inside the running API container
docker exec mes-api-prod npx prisma migrate deploy
docker exec mes-api-prod npx prisma db seed
```

**Check all services are healthy:**

```powershell
docker compose -f docker-compose.prod.yml ps
```

**View production logs:**

```powershell
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f web
```

**Stop production stack:**

```powershell
docker compose -f docker-compose.prod.yml down
```

---

## 5. Service URLs & Ports

### Development (Local — Option A)

| Service | URL | Notes |
|---------|-----|-------|
| Web App | http://localhost:4000 | Next.js with HMR |
| API | http://localhost:4001/api/v1 | NestJS |
| Swagger | http://localhost:4001/api/v1/docs | API documentation |
| PostgreSQL | localhost:5432 | DB: `mes360` |
| Redis | localhost:6379 | No password in dev |
| InfluxDB | http://localhost:8086 | Time-series DB UI |
| MQTT Broker | localhost:1883 | Eclipse Mosquitto |
| MinIO | http://localhost:9001 | Object storage console |

### Development (Full Docker — Option B)

| Service | URL | Notes |
|---------|-----|-------|
| Web App | http://localhost:3000 | Next.js |
| API | http://localhost:3001/api/v1 | NestJS |
| Swagger | http://localhost:3001/api/v1/docs | API documentation |
| InfluxDB | http://localhost:8086 | — |
| MinIO Console | http://localhost:9001 | — |
| Prometheus | http://localhost:9090 | Metrics |
| Grafana | http://localhost:3003 | Dashboards |

### Production

| Service | URL |
|---------|-----|
| Web App | https://yourdomain.com |
| API | https://yourdomain.com/api/v1 |
| Swagger | https://yourdomain.com/api/v1/docs |

---

## 6. Default Credentials

| Service | Username | Password |
|---------|----------|----------|
| MES Platform | `admin@mes360.sa` | `Password@123` |
| InfluxDB (dev) | `admin` | `mes360-admin` |
| MinIO (dev) | `minioadmin` | `minioadmin` |
| Grafana (dev) | `admin` | `mes360` |
| PostgreSQL (dev) | `mes_user` | `mes_password` |

> **Important:** Change all default passwords before any production deployment.

---

## 7. Database Management

All Prisma commands run from the project root.

```powershell
# Generate the Prisma client (after schema changes)
pnpm db:generate

# Create and apply a new migration (development only)
pnpm db:migrate

# Apply existing migrations without creating new ones (production / CI)
cd apps/api && npx prisma migrate deploy

# Seed the database with initial data
pnpm db:seed

# Open Prisma Studio (visual database browser)
cd apps/api && npx prisma studio
```

---

## 8. Useful Commands Reference

### Monorepo (Turbo)

```powershell
pnpm dev              # Start all apps in watch mode
pnpm build            # Build all apps
pnpm lint             # Lint all workspaces
pnpm type-check       # TypeScript check across all workspaces
pnpm test             # Run unit tests
pnpm clean            # Delete all build outputs and node_modules
```

### Individual Apps

```powershell
# Run only the API in watch mode
cd apps/api && pnpm dev

# Run only the frontend in watch mode
cd apps/web && pnpm dev

# Build only the API
cd apps/api && pnpm build

# Build only the frontend
cd apps/web && pnpm build
```

### Docker Compose

```powershell
# Start infrastructure only (dev)
docker compose up -d postgres redis influxdb mosquitto minio

# Start full dev stack with build
docker compose up -d --build

# Stop all containers (keep data)
docker compose down

# Stop and remove all data volumes (full reset)
docker compose down -v

# Rebuild a single service
docker compose build api
docker compose up -d --no-deps api

# View logs for a specific service
docker compose logs -f api
docker compose logs -f web

# Production stack
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml logs -f
```

### Testing

```powershell
# Run all tests
pnpm test

# Run API unit tests
cd apps/api && pnpm test

# Run API tests in watch mode
cd apps/api && pnpm test:watch

# Run E2E tests
pnpm test:e2e
```

---

## 9. Troubleshooting

### `pnpm install` fails with peer dependency errors

```powershell
pnpm install --shamefully-hoist
```

### Port already in use

Find and kill the process using the port:

```powershell
# Find what is using port 4000
netstat -ano | findstr :4000

# Kill the process by PID
taskkill /PID <PID> /F
```

### Docker containers fail to start (unhealthy)

```powershell
# Check detailed container logs
docker compose logs postgres
docker compose logs redis

# Full restart
docker compose down -v
docker compose up -d
```

### API fails with `Cannot find module '@prisma/client'`

The Prisma client needs to be generated after install:

```powershell
pnpm db:generate
# or
cd apps/api && npx prisma generate
```

### Database migration errors

```powershell
# Reset the database and re-run all migrations (dev only — destroys all data)
cd apps/api && npx prisma migrate reset
```

### InfluxDB token not working

The dev token is pre-set in `docker-compose.yml`. Update your `.env`:

```env
INFLUX_TOKEN=mes-influx-super-secret-token
```

### Frontend cannot reach the API (`ECONNREFUSED`)

Ensure `NEXT_PUBLIC_API_URL` in `.env` matches the actual API address:

```env
# Local dev (Option A)
NEXT_PUBLIC_API_URL=http://localhost:4001

# Full Docker (Option B)
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### Windows — Docker volume permission errors

Open Docker Desktop → Settings → Resources → File Sharing and ensure the project drive (`D:\`) is listed as a shared drive.

### Port 5432 conflict (local PostgreSQL already installed)

If you have PostgreSQL installed locally it occupies port 5432 and blocks the Docker container. The project resolves this by mapping the Docker PostgreSQL to port **5433** in `docker-compose.yml`. Make sure both `.env` files use port 5433:

```env
# .env  and  apps/api/.env
DATABASE_URL="postgresql://mes_user:mes_password@localhost:5433/mes360"
```

This is already configured correctly in the project files — no manual action needed.

---

*MES360° Platform — ISA-95 compliant Manufacturing Execution System*
*For support contact: soliman@mes360.sa*
