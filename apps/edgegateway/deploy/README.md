# MES360° Edge Gateway — deployment

On-prem service that polls Modbus devices, counts production (rising-edge →
Total/Good/Bad), feeds the in-progress Job Order, and publishes to MQTT +
InfluxDB + Postgres. Talks to the **same** Dockerised services as the platform.

## Build the .exe (on a Windows build machine with Node 20 + pnpm)

```powershell
# from the monorepo root
pnpm install
pnpm --filter @mes360/edgegateway prisma:generate   # syncs schema + generates client (windows engine)
pnpm --filter @mes360/edgegateway package:win        # -> apps/edgegateway/build/
```

`build/` will contain: `edgegateway.exe`, the Prisma query-engine `.node`,
`schema.prisma`, `public/` (dashboard), `.env` (sample), and the service scripts.

## Configure

Edit `build/.env` and point it at the server running the Docker stack:

```
DATABASE_URL=postgresql://mes_user:mes_password@SERVER_HOST:5433/mes360?schema=public
MQTT_BROKER_URL=mqtt://SERVER_HOST:1883
INFLUX_URL=http://SERVER_HOST:8086
INFLUX_TOKEN=mes-influx-super-secret-token
JWT_SECRET=<same as the API>
GATEWAY_NAME=Plant Edge Gateway 1
GATEWAY_FACTORY_CODE=NCC
GATEWAY_PORT=4900
```

## Install as a Windows service

1. Put `nssm.exe` (https://nssm.cc/download) next to `edgegateway.exe`.
2. Right-click `install-service.bat` → **Run as administrator**.

The service auto-starts on boot and auto-restarts on crash. Local dashboard:
**http://localhost:4900** (log in with any platform user).

To remove: run `uninstall-service.bat` as administrator.

## How counting works

- Bind a device to a **machine** and add **COUNTER** tags with a Modbus
  `address` + `registerType` (HOLDING/INPUT/COIL/DISCRETE) and a `counterRole`.
- Each rising edge (register `0→1`, coil `false→true`) = **+1**.
- Map either **GOOD + BAD**, or **TOTAL + GOOD** (Bad = Total − Good).
- Counts apply to the machine's **EXECUTING** Job Order and roll up to the Work
  Order via the API's MQTT subscriber.
