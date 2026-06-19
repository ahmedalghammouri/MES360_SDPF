# MES360° Edge Gateway

On-prem service that polls **Modbus** devices, turns register changes into
production counts (rising edge → **Total / Good / Bad**, Bad = Total − Good),
feeds the **in-progress Job Order** of the bound machine, and publishes every
reading to **MQTT** + **InfluxDB** + **Postgres**. It talks to the *same*
Dockerised services as the platform and has its own local dashboard at
`http://localhost:4900`.

There are two ways to use it:

- **A — Run it directly** (no packaging): for development or a quick run on a PC that already has Node 20. ← start here
- **B — Deploy it as a Windows service** (`.exe` + NSSM): for a plant PC that must auto-start on boot and run unattended.

---

## Prerequisites (both modes)

- The platform stack must be running (Postgres, MQTT, InfluxDB). Locally that's:
  ```bash
  docker compose -f docker-compose.prod-local.yml up -d
  ```
  Host ports used by the gateway: Postgres `5433`, MQTT `1883`, InfluxDB `8086`.
- A platform user account (any account that can log into the web app) — used for the dashboard login.
- The gateway's `JWT_SECRET` **must match** the API's (`docker-compose.prod-local.yml` → `JWT_SECRET`).

---

## A — Run directly (no deploy)

From the **monorepo root** (`MES360° PLATFORM/`):

```bash
# 1. Install workspace deps (once, or after dependency changes)
pnpm install

# 2. Build the shared driver lib + generate the Prisma client + compile the gateway
pnpm --filter @mes360/edgegateway build
```

Then configure and run from the gateway folder:

```bash
cd apps/edgegateway

# 3. Create the .env (copy the template and edit)
cp .env.example .env        # Git Bash;  on PowerShell: Copy-Item .env.example .env

# 4. Run it
node dist/main.js
```

Or, for auto-reload while developing (rebuilds on save):

```bash
pnpm --filter @mes360/edgegateway start:dev
```

A successful start logs:

```
[PrismaService] Connected to shared Postgres
[InfluxService] InfluxDB connected → http://localhost:8086 (bucket=mes_timeseries)
[MqttService]   MQTT broker connected → mqtt://localhost:1883
[GatewayContextService] Gateway identity ready: <name> (<id>) @ factory <CODE>
[EdgeGateway]   MES360° Edge Gateway listening on http://0.0.0.0:4900
```

Open **http://localhost:4900** and log in with a platform user.

> Stop it with `Ctrl-C`. This mode does **not** survive a reboot or terminal
> close — use mode **B** for that.

### Minimal `.env` for a local run

```ini
GATEWAY_NAME=Local Dev Gateway
GATEWAY_FACTORY_CODE=SIDCO          # ← the factory you log into (see note below)
GATEWAY_PORT=4900

DATABASE_URL=postgresql://mes_user:mes_password@localhost:5433/mes360?schema=public
MQTT_BROKER_URL=mqtt://localhost:1883
INFLUX_URL=http://localhost:8086
INFLUX_TOKEN=mes-influx-super-secret-token
INFLUX_ORG=mes360
INFLUX_BUCKET=mes_timeseries

JWT_SECRET=mes360-jwt-secret-key-change-in-production-32charss
```

> **⚠ Factory binding matters.** `GATEWAY_FACTORY_CODE` decides which factory the
> gateway registers under. The web app's **IIoT → Edge Gateways** page only shows
> gateways in *your* factory, so this must match the factory you're logged into,
> or the gateway won't appear (it's still running — just scoped elsewhere). Leave
> it blank and the gateway falls back to the first active factory. Valid codes in
> this DB: `SIDCO`, `SDPF`, `NDPF`, `SAF`, `RNTIC`.

---

## B — Deploy as a Windows service (step by step)

Run these on the **plant PC** (or a Windows build machine), Node 20 + pnpm installed.

### 1. Build the standalone executable

From the monorepo root:

```powershell
pnpm install
pnpm --filter @mes360/edgegateway package:win
```

This produces a self-contained **`apps/edgegateway/build/`** folder:

```
build/
  edgegateway.exe            # the service binary
  query_engine-windows.dll.node   # Prisma engine (shipped beside the exe)
  schema.prisma
  public/                    # local dashboard
  .env                       # sample config — EDIT THIS
  install-service.bat
  uninstall-service.bat
  README.md
```

> If you only have Node (no build toolchain) on the plant PC, build `build/` on a
> dev machine and copy the whole folder over.

### 2. Add NSSM

Download **nssm.exe** from <https://nssm.cc/download> and drop it into the
`build/` folder (next to `edgegateway.exe`), or put it on the system `PATH`.

### 3. Configure `build/.env`

Point it at the server that runs the Docker stack and set the factory:

```ini
GATEWAY_NAME=Plant Edge Gateway 1
GATEWAY_FACTORY_CODE=SIDCO
GATEWAY_PORT=4900

DATABASE_URL=postgresql://mes_user:mes_password@SERVER_HOST:5433/mes360?schema=public
MQTT_BROKER_URL=mqtt://SERVER_HOST:1883
INFLUX_URL=http://SERVER_HOST:8086
INFLUX_TOKEN=<same token as the API>
INFLUX_ORG=mes360
INFLUX_BUCKET=mes_timeseries
JWT_SECRET=<same secret as the API>
```

Replace `SERVER_HOST` with the IP/hostname of the Docker host (use `localhost`
only if the stack runs on the same PC).

### 4. Install & start the service

Open a terminal **as Administrator** in `build/` and run:

```powershell
.\install-service.bat
```

This registers the service **Mes360EdgeGateway** with NSSM, sets it to
auto-start on boot, auto-restart on crash, and writes logs to `build\logs\`.
It then starts the service.

### 5. Verify

- Dashboard: **http://localhost:4900** (log in with a platform user).
- Web app: **IIoT → Edge Gateways** shows the gateway **Online** (log into the
  factory matching `GATEWAY_FACTORY_CODE`).
- Reboot the PC → confirm the service comes back automatically.

### Manage the service

```powershell
nssm restart Mes360EdgeGateway     # after editing .env
nssm stop    Mes360EdgeGateway
nssm status  Mes360EdgeGateway
.\uninstall-service.bat             # remove it (run as Administrator)
```

Logs: `build\logs\out.log` and `build\logs\err.log`.

---

## Dashboard access — two fixed users

The dashboard and **all** configuration (devices, tags, service settings) are
restricted to **exactly two hard-coded users**. They are NOT in the platform
database — they're defined in [`src/local-api/config-users.ts`](src/local-api/config-users.ts)
so the edge admin can always log in even when the database/MES is offline.

| Role | Email | Password |
|---|---|---|
| Edge Administrator | `admin@mes360.sa` | `Password@123` |
| Edge Engineer | `engineer@mes360.sa` | `Password@123` |

> Change the passwords for production via env (`EDGE_ADMIN_PASSWORD`,
> `EDGE_ENGINEER_PASSWORD`) or by editing `config-users.ts`. No other account —
> not even a valid platform user — can access the gateway dashboard.

## The local dashboard (`http://localhost:4900`)

Styled to match the MES360° web app (logo, dark theme, sidebar). Tabbed
management UI, usable on the edge PC without the cloud app:

- **Overview** — live device status, executing Job-Order counts, live tag values.
- **Devices** — add/edit/delete Modbus devices (IP/port, unit id, poll, machine binding; auto-bound to this gateway).
- **Tags** — add/edit/delete tags with register address/type, scaling, and counter role/edge.
- **Settings** — edit service connections (**DB / MQTT / InfluxDB / MES Platform**) + gateway name/factory/poll. Saved to `gateway-config.json` (overrides `.env`); use **Save & Restart** to apply (as a Windows service it auto-restarts; in dev re-run `node dist/main.js`).

## After it's running — configure acquisition

In the web app **or** the gateway's own dashboard (Devices / Tags tabs):

1. **IIoT → Devices → Add Device**: Protocol *Modbus TCP*, IP + Port, **Assigned
   Gateway** = this gateway, **Bound Machine** = the machine to count for, Unit ID.
2. **IIoT → Tag Browser → Add Tag**: Tag Type *Counter*, Source Device, register
   **Address** + **Type** (Holding/Input/Coil/Discrete), **Counter Role**
   (`Total`+`Good`, or `Good`+`Bad`), Edge Trigger *Rising*.

The running gateway reloads config every ~10 s — no restart needed. Each rising
edge increments the bound machine's **EXECUTING** Job Order (Good/Bad/Total) and
publishes to MQTT + InfluxDB.

---

## Local test with the Modbus simulator (no PLC needed)

`scripts/modbus-sim.mjs` is a built-in Modbus-TCP server that pulses a coil
(for counters) and exposes a full **Schneider PM5110** register map (Float32
V/I/P/PF/Hz + Int64 energy) so you can exercise the whole chain on one PC. It
emulates a **single slave at unit id 1**.

`scripts/modbus-sim-farm.mjs` launches N of those, one per port (`1502, 1503,…`),
each in its own process with a slightly different load profile — so every seeded
device (which gets its own port, see below) reads distinct live values.

> **Important:** each device must use `unitId = 1` (the simulator's slave id) and
> its **own port**. A device pointed at a port with a non-matching unit id gets no
> response (reads "Timed out"). The demo seed already sets this up correctly.

### 1. Bring up the platform stack (Postgres / MQTT / InfluxDB / API / web)
```bash
docker compose -f docker-compose.prod-local.yml up -d
```

### 2. Seed demo IIoT + energy data (idempotent)
Adds, for the SIDCO factory: a **Plant Edge Gateway**, a **Modbus PLC + Good/Total
counter tags per machine**, a **PM5110 power meter per machine**, and a
**line-level meter** for the packaging line — all with the full template tag set:
```bash
cd apps/api
DATABASE_URL="postgresql://mes_user:mes_password@localhost:5433/mes360?schema=public" \
  npx tsx prisma/seeds/iot-energy-demo.ts
```
(Also runs automatically as part of `pnpm --filter @mes360/api prisma db seed`.)
The seeded devices each get their **own port** starting at `127.0.0.1:1502`
(unit id 1) and are bound to the **Plant Edge Gateway**, so run the gateway with
that identity (step 4). 5 machines → 11 devices (5 PLCs + 5 meters + 1 line meter),
so ports `1502`–`1512`.

### 3. Start the simulator farm (one instance per device)
```bash
cd apps/edgegateway
# count = number of seeded devices (≥ 11 for the default SIDCO seed)
node scripts/modbus-sim-farm.mjs 1502 12
```
(For a single device you can still use `node scripts/modbus-sim.mjs 1502`.)

### 4. Run the edge gateway against the LOCAL stack
The gateway prefers `gateway-config.json` (which may point at production). For a
local test, bypass it with a non-existent config path so it falls back to `.env`
(localhost), and adopt the seeded gateway by name:
```bash
cd apps/edgegateway
# Windows PowerShell:
$env:GATEWAY_CONFIG_FILE="./_local.json"; $env:GATEWAY_NAME="Plant Edge Gateway"; node dist/main.js
# Git Bash:
GATEWAY_CONFIG_FILE=./_local.json GATEWAY_NAME="Plant Edge Gateway" node dist/main.js
```
Ensure `.env` has `GATEWAY_FACTORY_CODE=SIDCO` and localhost URLs (DB `5433`,
MQTT `1883`, Influx `8086`).

### 5. What you should see (within ~15 s)
- Devices go **CONNECTED**; PM5110 meters auto-provision their ENERGY tags.
- **IIoT → Tag Browser** (`:8080`): live per-phase V/I/P values updating.
- **Energy → Live**: live power per meter; meters on machines with **no EXECUTING
  Job Order** are flagged **Standby** ("consuming with no production").
- **Energy → Meters / dashboard**: consumption populates from the readings.
- The gateway's own dashboard (`:4900`) shows the same live data.

### Stop the demo
Stop the two `node` processes (Ctrl-C), or free the ports:
```powershell
Get-NetTCPConnection -LocalPort 4900,1502 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Gateway not shown in web **Edge Gateways** | `GATEWAY_FACTORY_CODE` ≠ the factory you're viewing. Set it and restart (or view as the matching factory / a SUPER_ADMIN). |
| Dashboard login `401 Invalid credentials` | Use a real platform account; `JWT_SECRET` must match the API. |
| `Can't reach database server at …:5433` | Stack not up, wrong `DATABASE_URL` host, or firewall. Gateway keeps running and buffers to disk; it recovers when the DB returns. |
| Device stays `DISCONNECTED` | Wrong IP/port/unit id, or the PLC isn't reachable from the gateway PC. Check `lastError` on the device. |
| Counts not moving | Tag must be `COUNTER` with a `counterRole`, bound to a machine that has an **EXECUTING** Job Order. |
| `pkg` build fails on Prisma | The engine ships beside the exe via `scripts/copy-runtime-assets.mjs`; keep `query_engine-windows.dll.node` next to `edgegateway.exe`. |
| Build fails with `EPERM … rename query_engine-windows.dll.node` | A **running gateway** has the Prisma engine DLL loaded, so `prisma generate` can't overwrite it. Stop the gateway (Ctrl-C, or `nssm stop Mes360EdgeGateway`) before building, then rebuild. |
