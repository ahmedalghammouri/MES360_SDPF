# MES360° Platform

> Enterprise Manufacturing Execution System for the Kingdom of Saudi Arabia industrial sector

![Platform](https://img.shields.io/badge/Platform-MES-blue) ![Stack](https://img.shields.io/badge/Stack-Next.js%2015%20%2B%20NestJS%2010-green) ![Docker](https://img.shields.io/badge/Docker-10%20Services-blue) ![License](https://img.shields.io/badge/License-Enterprise-red)

---

## Overview

MES360° is a full-stack, real-time Manufacturing Execution System designed for multi-factory industrial environments. It integrates production monitoring, quality management, predictive maintenance, IIoT connectivity, and AI-driven insights into a single enterprise-grade platform.

The system is currently deployed to serve the **National Care Company (NCC)** manufacturing network across **Dammam** and **Jeddah**, Saudi Arabia — covering 5 industrial facilities.

---

## Quick Start

### Prerequisites

- Docker Desktop ≥ 24
- 8 GB RAM minimum
- Ports available: `3000`, `3001`, `3003`, `5433`, `6379`, `8080`, `8086`, `9000–9001`, `9090`

### Run

```bash
git clone <repo>
cd "MES360° PLATFORM"

# Copy environment file
cp .env.example .env

# Start all 10 services
docker compose up -d

# Wait ~30 s for first-time Next.js compilation, then open:
```

| Service | URL |
|---|---|
| **MES Web App** | http://localhost:3000 |
| **REST API** | http://localhost:3001/api/v1 |
| **API Docs (Swagger)** | http://localhost:3001/api/docs |
| **Grafana Dashboards** | http://localhost:3003 |
| **Prometheus Metrics** | http://localhost:9090 |
| **MinIO Storage** | http://localhost:9001 |
| **Nginx Proxy** | http://localhost:8080 |

### Default Credentials

```
Email:    admin@mes360.sa
Password: Admin@123
Role:     SUPER_ADMIN
```

---

## Technology Stack

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| Next.js | 15.x | React framework, App Router |
| React | 19.x | UI library |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | 3.x | Utility-first styling |
| Framer Motion | 11.x | Animations & transitions |
| Zustand | 5.x | Client state management |
| TanStack Query | 5.x | Server state & caching |
| ECharts | 5.x | Industrial charts & gauges |
| Recharts | 2.x | Statistical & SPC charts |
| Leaflet | 1.9.x | Interactive real-world maps |
| Socket.IO Client | 4.x | Real-time WebSocket |
| React Hook Form | 7.x | Form handling |
| Zod | 3.x | Schema validation |

### Backend
| Technology | Version | Purpose |
|---|---|---|
| NestJS | 10.x | Node.js enterprise framework |
| TypeScript | 5.x | Type safety |
| Prisma ORM | 5.x | Database access layer |
| Passport.js | — | JWT + Local auth strategies |
| Socket.IO | 4.x | WebSocket gateway |
| Helmet | — | HTTP security headers |
| Class-Validator | — | DTO validation |

### Infrastructure
| Service | Technology | Purpose |
|---|---|---|
| Primary DB | PostgreSQL 16 | Relational data storage |
| Cache / Sessions | Redis 7 | Caching, pub/sub, queues |
| Time-Series DB | InfluxDB 2.7 | IoT sensor & telemetry data |
| Message Broker | Eclipse Mosquitto | MQTT IIoT protocol |
| Object Storage | MinIO | Files, reports, media |
| Reverse Proxy | Nginx Alpine | Routing, rate limiting |
| Metrics | Prometheus | System & app monitoring |
| Dashboards | Grafana | Operations visibility |

---

## System Architecture

```
Browser / Mobile
       │
       ▼
 Nginx :8080  ──── /api/* ────────► NestJS API :3001
       │                                  │
       └──── /*   ────────► Next.js :4000  ├── Prisma ──► PostgreSQL :5433
                                           ├──────────►   Redis      :6379
                                           ├──────────►   InfluxDB   :8086
                                           ├── MQTT ───►  Mosquitto  :1883
                                           ├── WS ─────►  Clients (real-time)
                                           └──────────►   MinIO      :9000

Prometheus :9090 ──scrape──► API + DB + Redis + Nginx
Grafana    :3003 ──query────► Prometheus
```

---

## Monorepo Structure

```
MES360° PLATFORM/
├── apps/
│   ├── api/                        # NestJS backend
│   │   ├── src/
│   │   │   ├── modules/            # Feature modules (auth, production, quality…)
│   │   │   ├── gateways/           # Socket.IO WebSocket gateway
│   │   │   ├── common/             # Guards, decorators, interceptors, filters
│   │   │   └── database/           # Prisma service
│   │   └── prisma/                 # Schema, migrations, seed data
│   │
│   └── web/                        # Next.js 15 frontend
│       └── src/
│           ├── app/                # App Router
│           │   ├── page.tsx        # Factory selector landing (root)
│           │   ├── (auth)/         # Login, forgot-password
│           │   └── (platform)/     # All authenticated pages
│           ├── features/           # Feature components
│           │   └── factory-selector/  # KSA real map + factory data
│           ├── components/         # Shared UI (layout, charts, widgets)
│           ├── store/              # Zustand stores
│           ├── services/           # API client + services
│           └── hooks/              # Custom React hooks
│
├── packages/
│   ├── types/                      # Shared TypeScript types
│   └── shared/                     # Shared utilities & constants
│
├── infrastructure/
│   ├── nginx/                      # Reverse proxy config
│   ├── monitoring/                 # Prometheus scrape config
│   └── docker/                     # Mosquitto, PostgreSQL init
│
├── docker-compose.yml              # Full dev environment (10 services)
└── docs/                           # Project documentation
```

---

## Factory Network (NCC Group — KSA)

| Code | Factory Name | City | Coordinates |
|---|---|---|---|
| **SDPF** | Saudi Detergent Powder Factory | Dammam | 26.2584°N, 49.9923°E |
| **SAF** | Saudi Aerosol Factory | Dammam | 26.2547°N, 49.9306°E |
| **NDPF** | National Detergent Powder Factory | Dammam | 26.2541°N, 49.9869°E |
| **SIDCO** | Saudi Industrial Detergent Co. | Dammam | 26.2713°N, 49.9629°E |
| **RNTIC** | Plastic Blow Molding Manufacturing | Jeddah | 21.4311°N, 39.2038°E |

---

## Documentation

| File | Description |
|---|---|
| [docs/FEATURES.md](docs/FEATURES.md) | All implemented features in detail |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flows, modules |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Docker operations & troubleshooting |

---

*© 2026 MES360° — Enterprise Manufacturing Intelligence for Saudi Arabia*
