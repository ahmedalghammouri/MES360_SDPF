# MES Truthful Data + Energy Analytics + Time-based OEE + Live Tags

## Context

The platform's dashboards are already wired to real backend endpoints (no `Math.random`
mocks), but exploration found concrete **truthfulness, completeness and real-time gaps**
that make some views show stale/empty/idealised numbers. This effort makes every
energy + OEE + IIoT view reflect **true data** — live where it should be live, historized
where it should be trended, and correctly linked to the plant hierarchy and PO/WO/JO —
plus the requested device-error visibility, idle-power monitoring, and live Tag Browser.

### Confirmed gaps (from exploration)
- **`EnergySummary` is never computed** → energy MTD/consumption/trend read empty/stale (the energy dashboard's biggest lie). `apps/api/src/modules/energy/energy.service.ts` reads it but nothing writes it.
- **`OEERecord` is unfilled** → `/production/kpi` (reads `/production/oee-records`, limit 365) shows little/nothing real.
- **Synthetic OEE backfill** (`historian.service.ts` `backfill()` + deterministic PRNG) can fabricate 14-day OEE trends.
- **Energy meters can't attach to a ProductionLine** — schema only has `machineId`/`areaId` (no `lineId`).
- **Tag Browser is polled (10s)**, not live; a Socket.io gateway + `iot.tag.value` MQTT feed already exist to make it live.
- **Device `lastError`** isn't surfaced in the MES Devices view or the edge dashboard.
- **No idle/no-JO power monitoring** page; **machineState enrichment** has no fallback when WO resolution fails.

### Confirmed decisions
- **Live tags:** API **Socket.io bridge** — broadcast `iot:tag:updated` to the factory room from the existing `iot.tag.value` feed; web subscribes via `use-websocket`.
- **Energy history:** **scheduled `EnergyReading → EnergySummary` rollup** (hourly/shift/daily) + **on-the-fly fallback** when a bucket isn't ready.
- **Synthetic backfill:** **disabled by default** (dashboards show only real data); kept as a manual admin/demo endpoint behind explicit confirmation.

### Reuse (do not rebuild)
- OEE math + rollup: `apps/api/src/modules/production/oee.service.ts`, `kpi.service.ts` (`oeeAnalytics`, `hierarchyOEE`, `recomputeWorkOrderAndPO`).
- Historian + time-based OEE already in Influx: `apps/api/src/modules/historian/{historian.service,influx.service,historian.scheduler}.ts` — measurement `oee` already has `availabilityTb`/`oeeTb`; `getOeeTrend`/`getProductionTrend` exist. Tag history is measurement `tag`.
- Energy context/enrichment: `apps/api/src/modules/iot/energy-context.service.ts`.
- Realtime: `apps/api/src/gateways/mes.gateway.ts` (factory rooms, `broadcastToFactory`), web `apps/web/src/hooks/{use-websocket,use-live-kpi}.ts`.
- Scope/time filters: `apps/web/src/hooks/{use-scope,use-time-range}.ts`.

---

## Plan (phased, conflict-free — additive to current code)

### Phase 1 — Schema (additive, `prisma db push`)
- `EnergyMeter`: add `lineId String?` + `line ProductionLine?` relation (meter can be scoped to machine **or line or area**). Add back-relation on `ProductionLine`.
- `EnergyReading`: add `lineId String?` and `productionOrderId String?` (richer PO/WO/line correlation; WO/WorkCenter/machine already present). Add indexes `(factoryId, timestamp)` already exist.
- Confirm `OEERecord` fields cover machine+shift+day grain (already exist) — no change expected.

### Phase 2 — Live Tag values (Socket.io bridge)
- **API**: in `gateway-ingest.service.ts` `onMqttMessage`, for tag topics `mes360/<factoryId>/<machine>/<tag>` (i.e. not `/jo/` or `/energy/`), call `mesGateway.broadcastToFactory(factoryId, 'iot:tag:updated', { tagCode, machineId, value, quality, ts })`. Also bridge `iot.energy.reading` → `energy:reading` to the factory room. (factoryId is the 2nd topic segment.)
- **Web**: Tag Browser (`iot-tags-view.tsx`) and Data Streams (`iot-streams-view.tsx`) subscribe via `useRealtimeData('iot:tag:updated')` and live-patch the value/quality/updated cells (flash on change) — mirroring the edge dashboard's `pollTagValues`. Keep the 10s query as backfill.

### Phase 3 — Device error visibility
- **MES** `iot-devices-view.tsx`: surface `lastError` (already on the model; include it in `getDevices`) — show an error badge + tooltip on ERROR rows.
- **Edge dashboard** `public/index.html`: device rows already show status; add the `lastError` text under the status pill (data already returned by `/api/devices`).

### Phase 4 — Energy: hierarchy + rollup + idle monitoring + truthful dashboards
- **Hierarchy scope**: `energy.service.scopeMeterWhere` + meter create/edit accept `lineId` (machine | line | area target). Web Energy Meters + edge meter form: scope selector (Machine / Line / Area). `getOverview`/`getConsumption`/`by-workcenter` honor line scope.
- **Rollup scheduler** (new `energy-rollup.scheduler.ts`, mirrors `historian.scheduler.ts`): every N min, bucket each meter's `EnergyReading` into `EnergySummary` (HOURLY now; SHIFT/DAILY rollups) — consumption = Δ cumulative `value`, cost = consumption × tariff, link `productionQty`/`specificEnergy` from concurrent WO output. `getOverview/getConsumption` compute **on-the-fly from `EnergyReading`** when the summary bucket is absent (no more empty MTD).
- **Idle / no-production power** (the headline new page): endpoint `GET /energy/live?scope=` returning, per machine/line/area: latest `powerKw`, machine `state`, whether a WO/JO is in progress, and a **standby/idle-power** flag (power above a small threshold while `state ∈ {IDLE, PLANNED_STOP, OFFLINE, BREAKDOWN}` or no EXECUTING JO). New MES page **Energy → Live / Standby** (`energy-live-view.tsx`) showing live power tiles per scope, "consuming with no work" alerts, live via the `energy:reading` socket event. Reuses `energy-context` machine-state + WO lookup.
- **PO/WO/JO linkage + filters**: extend `getEnergyTimeseries` to filter by `productionOrderId`/`workOrderId`/`jobOrderId`; energy overview gains time-range + scope + order filters; add per-PO energy rollup (sum its WOs' `EnergyWOSummary`). Enrichment fallback: `enrichEnergyReading` resolves `machineState` via current status → last reading's state → `UNKNOWN`.
- **Visualization** (web `energy-overview.tsx` + new live view): live power (socket), historian trend (Influx/summary), waste breakdown (running/idle/downtime kWh), kWh/unit + cost, peak demand, and a hierarchy heat view (by machine/line/area). Clearly split **Live** (socket/current) vs **Historian** (trend) tiles.

### Phase 5 — OEE truthfulness + time-based
- **Disable auto-synthetic**: ensure nothing calls `backfill()` on boot; keep `POST /historian/backfill` behind an explicit `confirm` flag (admin/demo only). Per-minute `sampleActiveJobOrders()` (real) stays.
- **Fill `OEERecord`** from **real** data: on WO/shift completion (`kpi.service` `recomputeWorkOrderAndPO` / a shift-close hook) write/upsert per-machine-per-shift `OEERecord` (planned/run/uptime min, counts, A/P/Q, classic + time-based). Add a **real** backfill that computes historical `OEERecord` from past JobOrders + DowntimeEvents (not PRNG). This makes `/production/kpi` show true history.
- **Time-based OEE in UI**: `production-oee-view.tsx` / `manufacturing-oee-view.tsx` add a **Classic ↔ Time-based** toggle and a trend sourced from `/historian/oee-trend` (already returns `oeeTb`, `availabilityTb`). OEE gauge/cards can show both.

### Phase 6 — Dashboard truthfulness pass + verification
- Re-verify each dashboard endpoint now returns real, non-empty data with the above fixes (energy summary, OEERecord, enrichment). Ensure scope+time-range params flow on the energy + OEE views (add where missing). Document per-tile **Live / Historian / Current** source.

---

## Critical files
- `apps/api/prisma/schema.prisma` — `EnergyMeter.lineId`, `EnergyReading.lineId/productionOrderId`.
- `apps/api/src/modules/iot/gateway-ingest.service.ts` + `gateways/mes.gateway.ts` — tag/energy → factory-room broadcast.
- `apps/api/src/modules/energy/{energy.service,energy.controller}.ts` + new `energy-rollup.scheduler.ts` — line scope, summary rollup + fallback, `/energy/live`, order filters.
- `apps/api/src/modules/iot/energy-context.service.ts` — machineState fallback; per-PO rollup.
- `apps/api/src/modules/historian/{historian.service,historian.scheduler}.ts` + `production/kpi.service.ts` — disable auto-synthetic, fill real `OEERecord`, real backfill.
- Web: `features/iot/{iot-tags-view,iot-streams-view,iot-devices-view}.tsx`, `features/energy/{energy-overview,energy-meters-view}.tsx` + new `energy-live-view.tsx` (+ route + sidebar), `features/{production,manufacturing}/*oee*`, `hooks/use-websocket.ts`.
- `apps/edgegateway/public/index.html` — device `lastError`.

## Verification (end-to-end)
1. **Live tags**: with the gateway/sim publishing, open Tag Browser → values update live + flash, no manual refresh (socket frame `iot:tag:updated`).
2. **Energy truthful**: ingest readings; confirm `EnergySummary` rows appear and `/energy/overview` MTD/trend are non-zero and match raw `EnergyReading` deltas; switch scope Machine/Line/Area and verify filtering.
3. **Idle power**: with a meter on a machine that has **no EXECUTING JO**, the Energy → Live page flags standby power; when a JO starts, the flag clears and consumption attributes to the WO.
4. **OEE**: disable synthetic; confirm `/historian/oee-trend` + `/production/oee-records` show only real data; time-based toggle renders `oeeTb`; numbers reconcile with JO counts + downtime.
5. **Device errors**: kill a device's source → ERROR + `lastError` visible in both MES Devices and the edge dashboard.
6. **Builds**: api + web Docker type-check; driver tests stay green.

## Notes / risks
- All schema changes are additive/nullable → safe `db push`; no breaking changes to current dashboards (they keep working, just with real data).
- Rollup + OEERecord fills are idempotent upserts; the real backfill is bounded by existing JobOrder/Downtime history.
- Large scope → ship phase-by-phase; each phase is independently testable and conflict-free with current code.
