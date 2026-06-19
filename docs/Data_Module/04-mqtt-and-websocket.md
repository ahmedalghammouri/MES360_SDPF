# 04 — MQTT & WebSocket Messaging

Two real-time tiers:
1. **MQTT** — pub/sub between **edge gateways** and the **API** (raw telemetry, counters, energy).
2. **WebSocket (Socket.io)** — push from the **API** to **browser** dashboards (processed events).

Flow: `Edge Gateway → Modbus → MQTT broker → API ingest → PostgreSQL/InfluxDB → WebSocket → Frontend`.

---

## 1. MQTT

### 1.1 Broker configuration
API side ([apps/api/src/config/configuration.ts](../../apps/api/src/config/configuration.ts)):
```
brokerUrl: MQTT_BROKER_URL  (default mqtt://localhost:1883)
username:  MQTT_USERNAME     (optional)
password:  MQTT_PASSWORD     (optional)
clientId:  MQTT_CLIENT_ID    (default 'mes360')
```
Edge side ([apps/edgegateway/src/config/configuration.ts](../../apps/edgegateway/src/config/configuration.ts)):
```
brokerUrl:        MQTT_BROKER_URL (default mqtt://localhost:1883)
clientId:         mes360-edge-{gatewayName}-{random}
reconnectPeriod:  5000 ms
connectTimeout:   10000 ms
keepalive:        60 s
```
**QoS 1 (at-least-once)** on all topics; **no RETAIN**. Unauthenticated brokers allowed in dev.

### 1.2 Topic hierarchy
```
mes360/
  {factoryId}/
    {machineKey}/{tagCode}        # per-tag value (machineKey = machine code/id)
    energy/{meterId}              # energy meter reading
    jo/{jobOrderId}/count         # job-order cumulative counts
```

### 1.3 Topics PUBLISHED by the edge gateway
Published from
[ingest.service.ts](../../apps/edgegateway/src/acquisition/ingest.service.ts),
[counter.service.ts](../../apps/edgegateway/src/acquisition/counter.service.ts),
[energy-reading.service.ts](../../apps/edgegateway/src/acquisition/energy-reading.service.ts):

| Topic | Payload | Frequency |
|-------|---------|-----------|
| `mes360/{factoryId}/{machineKey}/{tagCode}` | `{ tagId, value, quality, ts }` | per poll cycle (default ~1 s) |
| `mes360/{factoryId}/jo/{jobOrderId}/count` | `{ jobOrderId, machineId, role, good, rejected, total, ts }` | on rising edge of a GOOD/BAD/TOTAL counter |
| `mes360/{factoryId}/energy/{meterId}` | `{ readingId, meterId, machineId, value, powerKw, ts }` | throttled ≥10 s per meter |

All three sinks (Postgres `TagCurrentValue`, InfluxDB, MQTT publish) are buffered to disk
(`buffer/*.jsonl`) on failure and drained every 20 s.

### 1.4 Topics SUBSCRIBED by the API
[apps/api/src/modules/iot/gateway-ingest.service.ts](../../apps/api/src/modules/iot/gateway-ingest.service.ts):

| Subscription | Processing |
|--------------|-----------|
| `mes360/+/jo/+/count` | Roll up `WorkOrder` actuals from `JobOrder` children → emit `iot.jo.count` / `production.count.updated`. |
| `mes360/+/energy/+` | `EnergyContextService.enrichEnergyReading()` (link WO + WorkCenter + machine state), anomaly detection → emit `iot.energy.reading`. |

The raw tag values reach the WebSocket layer via the internal `iot.tag.value` event (see §2.3).

### 1.5 Tag write commands
The `/iot/tags/read` and write paths use protocol drivers; tag-write commands use the
convention `{tagAddress}/set` via the MQTT driver.

---

## 2. WebSocket (Socket.io)

File: [apps/api/src/gateways/mes.gateway.ts](../../apps/api/src/gateways/mes.gateway.ts)
(module: [websocket.module.ts](../../apps/api/src/gateways/websocket.module.ts)).

### 2.1 Connection & auth
- **Namespace:** `/` (root). **CORS:** `CORS_ORIGINS` (default `http://localhost:3000`), credentials on.
- **Auth on connect:** JWT from `handshake.auth.token` or `Authorization: Bearer`. Verified via
  `JwtService.verify()` → `{ sub: userId, factoryId }`. Invalid/missing → immediate disconnect.
- On success the server emits `connected` `{ message, timestamp }`.

### 2.2 Rooms & subscriptions
Auto-joined on connect:
- `factory:{factoryId}` — everyone in a factory.
- `factory:all` — users with no factory (admins).
- `user:{userId}` — personal notifications.

Client-initiated (`@SubscribeMessage`):
| Incoming message | Joins | Ack |
|------------------|-------|-----|
| `subscribe:machines` (machineIds[]) | `machine:{id}` per id | `{ subscribed: machineIds }` |
| `subscribe:alarms` | `alarms:active` | `{ subscribed: 'alarms' }` |

### 2.3 Tag/energy bridge (`iot.tag.value` → client)
The gateway parses the MQTT topic (`mes360/{factoryId}/{seg2}/{seg3}…`):
- `seg2 === 'jo'` → ignored here (handled by count roll-up).
- `seg2 === 'energy'` → emit **`energy:reading`** `{ meterId, …payload }` to `factory:{factoryId}`.
- otherwise → emit **`iot:tag:updated`** `{ machineKey, tagCode, value, quality, tagId, ts }`.

### 2.4 Emitted events (server → client)
All broadcast to `factory:{factoryId}` unless noted.

**Connection:** `connected`.

**Production:** `production:work-order:created|started|completed|held|cancelled`,
`production:count:updated`, `production:kpi:updated`
(`{ factoryId, workOrderId, productionOrderId, wo:{id,oee,status}, po:{…}|null, timestamp }`).

**Downtime:** `downtime:started`, `downtime:ended`, `downtime:auto-detected`.

**Quality:** `quality:inspection:created|failed`, `quality:ncr:created|critical|status-changed`,
`quality:capa:created|verified`. (`ncr:critical` also broadcasts to `alarms:active`.)

**Maintenance:** `maintenance:wo:created|assigned|started|completed`.

**Machine telemetry/state:** `machine:telemetry`
(`{ machineId, machineName, machineCode, factoryId, state, actualSpeed, goodCount, rejectCount, timestamp }`)
and `machine:state-changed` (`{ previousState, newState, … }`) — both to `factory:{factoryId}`
**and** `machine:{machineId}`. A transition to `BREAKDOWN` also fires a notification.

**IoT/energy:** `iot:tag:updated`, `energy:reading` (see §2.3).

**Dashboard/broadcast:** `dashboard:kpis` (`{ [kpi]: number }`), `machines:status` (array),
`alarm:triggered` (also to `alarms:active`), `notification`
(`{ title, message, severity, category, timestamp }`).

### 2.5 Internal NestJS events → WebSocket
The gateway listens via `@OnEvent(...)` and re-broadcasts. Internal event names include:
```
production.work-order.{created,started,completed,held,cancelled}
production.count.updated
production.kpi.updated
downtime.event.{created,ended}      downtime.auto.created
quality.inspection.{created,failed} quality.ncr.{created,critical,status-changed}
quality.capa.{created,verified}     maintenance.wo.{created,assigned,started,completed}
iot.machine.telemetry  machine.state.changed
iot.tag.value  iot.jo.count  iot.energy.reading  energy.anomaly.detected
workorder.completed
```

---

## 3. End-to-end example (counter → UI)
```
Edge: Modbus reads GOOD counter → rising edge → JobOrder.actualQtyGood++
      → publish mes360/F1/M1/GOOD_COUNT { jobOrderId, role:'GOOD', good:100 }
Broker: queued (QoS 1)
API:  GatewayIngestService matches mes360/+/jo/+/count
      → rolls up WorkOrder actuals → emits production.count.updated
WS:   MesWebSocketGateway broadcasts 'production:count:updated' to factory:F1
UI:   browser updates the live count
```

## 4. Fault tolerance
- **MQTT:** QoS 1, 5 s reconnect, 60 s keepalive, no retain.
- **Edge disk buffers:** `pg-tagvalue`, `influx`, `mqtt` JSONL queues drained every 20 s.
- **Counter state:** `GatewayCounterState` persists `lastRawValue`/`accumulated`/`jobOrderId`
  → survives gateway restarts (no double counting).
- **Energy throttling:** ≥10 s per meter to avoid table bloat.
- **Energy anomaly:** `powerKw > nominalKw × 0.6` while state ≠ RUNNING → `energy.anomaly.detected`.

See [05-oee-and-at-oee.md](05-oee-and-at-oee.md) for how these streams feed KPI calculation.
