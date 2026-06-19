# Energy / Power Meters + Modbus Serial — Edge Gateway & MES Platform

## Context

The platform must support **power/energy meters** as first-class IIoT devices acquired by
the edge gateway over **Modbus TCP and serial**, covering standard meters (Schneider
PowerLogic **PM5110**, Siemens **PAC2200 / PAC3200**, and similar) with their electrical
points (per-phase V/I/P/PF, totals, energy, frequency, THD). Today the gateway is **Modbus-TCP
only**, and `EnergyMeter` is an **analytics-only** record fed by manual/REST readings — it has no
device link, no register mapping, and isn't polled. We will evolve the existing energy data
module (not replace it) so meters are configured + polled like PLCs, with **power-meter tags
managed separately from machine/production tags**, driven by reusable **device templates**.

### Confirmed decisions
- **Serial transport:** support **native COM/RS-485** *and* **Modbus-RTU-over-TCP**, alongside existing Modbus-TCP.
- **Metrics depth:** **full per-phase + totals** (per-phase V/I/P/PF, total active/reactive/apparent, kWh import/export, frequency, THD). Templates ship the full register map.
- **Reading flow:** edge gateway **writes `EnergyReading` directly** to Postgres (consistent with how it writes Job-Order counts) and publishes an MQTT energy event the API subscribes to for WO/WorkCenter enrichment + live broadcast.

### What exists and MUST be reused (do not rebuild)
- Data model `apps/api/prisma/schema.prisma`: `EnergyMeter` (1699), `EnergyReading` (1733, has `value` cumulative + `powerKw`), `EnergyWOSummary` (1762), `EnergySummary` (1783), enums `EnergyType`/`EnergyPeriod`; `Device` (1817, has `protocol`/`ipAddress`/`port`/`unitId`/`config`/`gatewayId`), `TagDefinition` (1850, has `tagType=ENERGY`, register fields `address`/`registerType`/`wordCount`/`wordOrder`/`scaleFactor`/`offset`, `meterId`? no).
- Energy analytics: `apps/api/src/modules/iot/energy-context.service.ts` (`enrichEnergyReading`, `detectPowerAnomaly`, `computeWOEnergySummary`, `getEnergyByWorkCenter`) and `iot.service.ts` `ingestEnergyReading`. **Reuse the enrichment + WO-summary logic unchanged** — only the trigger changes (MQTT event instead of REST).
- Energy module/UI: `apps/api/src/modules/energy/{energy.controller,energy.service}.ts`; web `apps/web/src/features/energy/{energy-meters-view,energy-overview}.tsx`, page `apps/web/src/app/(platform)/energy/meters/page.tsx`. Seed `apps/api/prisma/seed.ts` (~1117).
- Edge acquisition: `packages/industrial-drivers/src/modbus-tcp-client.ts` (TCP-only; `modbus-serial` dep already supports `connectRTUBuffered` + `connectTcpRTUBuffered`), `apps/edgegateway/src/acquisition/{modbus-poller,ingest,counter}.service.ts`. The **counter→Job-Order** pattern (`counter.service.ts` + MQTT `…/jo/<id>/count` + API `gateway-ingest.service.ts`) is the exact template for the new **energy→EnergyReading** pattern.
- Edge dashboard `apps/edgegateway/public/index.html` (tabs + CRUD), local API `apps/edgegateway/src/local-api/local-api.controller.ts`.

---

## Design

### Phase 1 — Schema (`apps/api/prisma/schema.prisma`)
Additive, nullable, back-compat (deploy applies via `prisma db push`).
- **`Device`** — serial support: add `serialPort String?`, `baudRate Int?`, `parity String?`, `dataBits Int?`, `stopBits Int?`. Protocol gains `MODBUS_RTU` (native COM) and `MODBUS_RTU_TCP` (RTU framing over TCP); existing `MODBUS` = TCP. (Connection extras may also live in existing `config Json`.)
- **`EnergyMeter`** — make it pollable: add `deviceId String? @unique` (→ `Device`, the comms endpoint), `model String?` (e.g. `METSEPM5110`), `templateKey String?` (e.g. `SCHNEIDER_PM5110`), `manufacturer String?`. Add relation `tags TagDefinition[]`.
- **`TagDefinition`** — separate meter points from machine points: add `meterId String?` (→ `EnergyMeter`) and `energyRole String?` (e.g. `ACTIVE_POWER_TOTAL`, `ENERGY_IMPORT_TOTAL`, `VOLTAGE_L1`, `CURRENT_L1`, `PF_TOTAL`, `FREQUENCY`, `REACTIVE_TOTAL`, `APPARENT_TOTAL`, `THD_V`). Meter tags = `tagType=ENERGY` + `meterId` set; machine tags keep `meterId=null`.

### Phase 2 — Shared driver (`packages/industrial-drivers`)
- Generalize the client to `ModbusClient` with `transport: 'TCP' | 'RTU' | 'RTU_TCP'` and serial opts (`serialPort`, `baudRate`, `parity`, `dataBits`, `stopBits`). `connect()` branches to `connectTCP` / `connectRTUBuffered` / `connectTcpRTUBuffered`; `readTag()` (register read + scaling/coercion) is unchanged. Keep a `ModbusTcpClient` alias for back-compat.
- New **`meter-templates.ts`**: a catalog of standard meters (`SCHNEIDER_PM5110`, `SIEMENS_PAC2200`, `SIEMENS_PAC3200`, `GENERIC_PM`) → array of tag specs `{ code, name, energyRole, registerType, address, wordCount, wordOrder, dataType, scaleFactor, unit }` (real PM5110/PAC register maps). Export `instantiateMeterTags(templateKey, meter)` returning tag-create payloads. Shared by API (“apply template”) and docs.
- Unit tests: RTU/RTU-over-TCP option mapping; template instantiation.

### Phase 3 — Edge gateway (`apps/edgegateway`)
- Poller: build `ModbusClient` per device honoring transport/serial fields; filter `protocol startsWith 'MODBUS'`. Load `device.energyMeter` so ENERGY tags know their `meterId`.
- New **`EnergyReadingService`** (sibling of `CounterService`): per meter, per poll (throttled to `historizationRateSec`), assemble an `EnergyReading` from the meter’s `ENERGY_IMPORT_TOTAL` tag (`value`) + `ACTIVE_POWER_TOTAL` tag (`powerKw`), write it directly to Postgres, and publish MQTT `mes360/<factory>/energy/<meterId>` (payload incl. `readingId`). All ENERGY tags still flow through `IngestService` → `TagCurrentValue` + Influx + MQTT (real-time per-phase metrics).
- Dashboard (`public/index.html`): device form gains protocol + serial fields; new **Energy Meters** tab (list, connection config, **Apply template**, meter-tag CRUD, live values). Local API (`local-api.controller.ts`) gains `/api/meters` CRUD + `/api/meters/:id/apply-template` + meter-scoped tag list.

### Phase 4 — API (`apps/api/src/modules/{energy,iot}`)
- Extend device CRUD (`iot.service.ts`) with serial fields + new protocols.
- Energy endpoints (`energy.controller.ts`/`energy.service.ts`): meter create/edit accepts `deviceId`/`model`/`templateKey` (and can create+link the Device); `GET /energy/meter-templates`; `POST /energy/meters/:id/apply-template`; meter-scoped tag list (or reuse `/iot/tags?meterId=`). Meter list returns device connection status + last reading.
- **MQTT energy subscriber**: extend `gateway-ingest.service.ts` to also subscribe `mes360/+/energy/+`; on message call the existing `energyContext.enrichEnergyReading(readingId, machineId)` + `detectPowerAnomaly` and broadcast — reusing current logic, no duplication.

### Phase 5 — Web (`apps/web/src/features/{energy,iot}`)
- **Energy Meters view**: connection config (TCP host/port | serial COM/baud/parity | RTU-over-TCP), meter model + **Apply template**, and a meter **Tags** section (ENERGY tags filtered by `meterId`, full CRUD, live value/quality). Show online status + last reading. Match the styling already used in `iot-*-view.tsx`.
- **Devices view**: protocol options + serial fields.
- **Tag Browser**: scope out meter tags (filter `meterId=null` for machine tags; meter tags managed under the meter) or add a Meter column.
- Seed one sample `SCHNEIDER_PM5110` meter+device+tags for SIDCO.

---

## Critical files
- `apps/api/prisma/schema.prisma` — Device serial fields/protocols; EnergyMeter `deviceId`/`model`/`templateKey`; TagDefinition `meterId`/`energyRole`.
- `packages/industrial-drivers/src/{modbus-client.ts,meter-templates.ts,index.ts}` — transports + template catalog.
- `apps/edgegateway/src/acquisition/{modbus-poller,energy-reading}.service.ts`, `src/local-api/local-api.controller.ts`, `public/index.html` — serial poll, energy writes, meter UI.
- `apps/api/src/modules/energy/{energy.controller,energy.service}.ts`, `src/modules/iot/{iot.service,iot.controller,gateway-ingest}.service.ts` — meter/device/template endpoints + MQTT energy enrich.
- `apps/web/src/features/energy/energy-meters-view.tsx`, `apps/web/src/features/iot/iot-devices-view.tsx`, `apps/web/src/components/layout/sidebar.tsx`, `apps/api/prisma/seed.ts`.

## Reused utilities (do not duplicate)
- Energy enrichment/WO-summary: `energy-context.service.ts` (call from the MQTT subscriber).
- Counter→JO pattern as the template for energy→reading: `counter.service.ts`, `gateway-ingest.service.ts`.
- Modbus read/scale/coerce: `industrial-drivers` `readTag`, `applyScaling`, `coerce`.
- Ingest fan-out (PG/Influx/MQTT + disk buffer): `ingest.service.ts`.

## Verification (end-to-end)
1. Driver unit tests: transport option mapping (TCP/RTU/RTU-TCP) + `instantiateMeterTags` for PM5110/PAC3200.
2. **Modbus-RTU-over-TCP simulator** exposing PM5110 register map (extend `scripts/modbus-sim.mjs` with holding registers for V/I/P/PF/kWh). For native COM, document a `com0com` virtual pair.
3. Create an EnergyMeter, link a Device (RTU-over-TCP → sim), **Apply PM5110 template** → ENERGY tags created (separate from machine tags). Confirm: per-phase tag values update live (Tag values + InfluxDB), `EnergyReading` rows written with `value`+`powerKw`, MQTT `…/energy/<id>` published, API enrichment fills WO/WorkCenter/state, and the **Energy dashboard** (meters table, trend, WO analysis) reflects it.
4. Verify both edge dashboard and web app can configure the meter, its connection, and its tags.

## Risks / notes
- **Native serial in the packaged `.exe`**: `serialport` (used by `modbus-serial` RTU) is a native addon — `pkg` can't snapshot it. RTU-over-TCP and TCP are pure-JS (no addon). Mitigation: ship the `serialport` prebuilt `.node` beside the exe (same approach as the Prisma engine in `scripts/copy-runtime-assets.mjs`), or run the gateway on a Node runtime where serial is needed; document this. RTU-over-TCP works with zero native deps.
- Keep `EnergyReading` focused on energy accounting (`value` kWh + `powerKw`); rich per-phase metrics live as ENERGY tag time-series (Influx) — avoids bloating the relational model while still historizing everything.
- Large scope → ship in the phase order above; each phase is independently testable.
