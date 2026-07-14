# Plan: EdgeCounter device type, block reads, per-tag publish/historization modes, scope-bug fix

## Context

On a production line, one edge gateway polls two Modbus-TCP DI modules (8 discrete
inputs, no hardware counter registers) plus a PM5110 power meter. Three problems
were diagnosed (see `apps/edgegateway/docs/ALGORITHM-ANALYSIS.md`):

1. **Missed counts** — counting is software rising-edge detection on a *slow,
   sequential, per-tag* poll; pulses shorter than the poll cycle are invisible.
2. **MQTT buffer → ~1300 & PM flood** — every tag is published (QoS 1) and
   historized on **every poll**, with no change/rate filter; jittery analog
   floats always "differ".
3. **Edit-form scope bug** — a machine-scoped tag/device shows as "line" when
   reopened.

This plan implements the user's requested fixes:

- A new **EdgeCounter** device type: enter per-register-type address blocks
  (DI/Coil/HR/IR start+quantity), default **100 ms** poll, and on save it
  **auto-creates all tags**.
- **Block reads** (one Modbus request per contiguous register window, sliced
  into tags) for **all** Modbus devices — fixes count latency and cuts PM5110
  from 16 reads to ~3.
- **Per-tag publish mode** (by change / by rate + rate) and **per-tag
  historization mode** (by change / by rate + rate), with an optional
  **deadband** so "by change" is meaningful for analog.
- Fix the edit-form scope precedence in web (devices + tags) and the gateway
  dashboard.

Decisions confirmed with the user: auto-created DI/Coil tags default to
`tagType=COUNTER, counterRole=NONE, edgeType=RISING`; add a per-tag `deadband`;
block reads apply to all Modbus devices; **I write the Prisma migration but do
NOT run it** — the user runs `prisma migrate deploy`.

---

## 1. Schema + migration (`apps/api/prisma/schema.prisma`)

Add to `model TagDefinition` (near the existing `historizationEnabled` /
`historizationRateSec` at lines 2072-2073):

```prisma
mqttPublishMode      String  @default("CHANGE")  // CHANGE | RATE
mqttPublishRateSec   Int     @default(0)         // RATE mode; 0 = every poll
historizationMode    String  @default("CHANGE")  // CHANGE | RATE
deadband             Float?                       // min abs delta for "by change" (null/0 = any change)
```

`Device` already has `config Json?` (line 2035) and a free-text `type` (line
2018) — no column change needed. EdgeCounter uses `type = "EDGE_COUNTER"`,
`protocol = "MODBUS"`, and stores its block spec in `config`:
`{ "edgeCounter": { "discrete": {start,qty}, "coil": {...}, "holding": {...}, "input": {...} } }`.

**Migration:** create `apps/api/prisma/migrations/<timestamp>_edgecounter_publish_historize/migration.sql`
with the four `ALTER TABLE "tag_definitions" ADD COLUMN …` statements (defaults
as above; `deadband` nullable). Then run `pnpm --filter @mes360/edgegateway prisma:sync`
so the gateway's generated client (`apps/edgegateway/scripts/sync-schema.mjs`)
picks up the new fields. **Do not run the migration** — hand the user
`npx prisma migrate deploy` (or `migrate dev` locally).

## 2. Shared driver (`packages/industrial-drivers/src`)

**a. EdgeCounter tag generation** — add a pure helper next to
`instantiateMeterTags` in `meter-templates.ts` (or a new `edge-counter.ts`):

```
instantiateEdgeCounterTags(deviceCode, blocks) -> TagSpec[]
```
For each register type present, emit one tag per address in `[start, start+qty)`:
- `DISCRETE`/`COIL` → `dataType: 'BOOL'`, `tagType: 'COUNTER'`, `counterRole: 'NONE'`,
  `edgeType: 'RISING'`, `mqttPublishMode: 'CHANGE'`, `historizationMode: 'CHANGE'`.
- `HOLDING`/`INPUT` → `dataType: 'INT'`, `tagType: 'MEASUREMENT'`, `wordCount: 1`.
- `code = \`${deviceCode}_${RT}${addr}\`` (e.g. `IO1_DI0`), `name` = readable label.
`qty = 0` → no tags for that type. Export from `packages/industrial-drivers/src/index.ts`.

**b. Block reads** — in `modbus-client.ts`:
- Add `readBlock(registerType, start, count)` wrapping the existing `readRaw`
  switch (lines 110-118) to return the raw `number[] | boolean[]` window.
- Add a pure `planBlocks(tags: TagBinding[])` helper (new file
  `block-planner.ts`): group by `registerType`, sort by address, coalesce into
  windows (max 125 registers, split on large gaps), returning
  `{ registerType, start, count, members: {tag, offset} }[]`. Reuse the existing
  `decodeNumeric` / `wordsToBuffer` (currently module-private in
  `modbus-client.ts` — export them or move to a `decode.ts`) to decode each
  member from its slice; bit types read `data[offset]`. Per-tag scaling/coercion
  stays via existing `applyScaling` / `coerce`.
- Add `readTagsBlocked(tags): Promise<Map<tagId, ReadResult>>` that plans blocks,
  issues one read per block, and slices — falling back to per-block BAD quality
  on error. Keep `readTag` for single reads / fallback.

## 3. Edge gateway poller + ingest (`apps/edgegateway/src/acquisition`)

**`modbus-poller.service.ts`:**
- In `pollDevice` (lines 233-301), replace the per-tag `for … await readTag`
  loop with a single `client.readTagsBlocked(dev.tags.map(t => t.binding))`, then
  iterate results to feed counter/status/ingest/energy exactly as today. Counting
  still sees **every poll** (independent of publish/historize gating).
- Carry the new per-tag fields (`mqttPublishMode`, `mqttPublishRateSec`,
  `historizationMode`, `historizationRateSec`, `deadband`) into `PolledTag` and
  into `TagReadingRecord`; add them to the device `signature` (line 120) so edits
  trigger a rebuild, and to the reload `include`/map (lines 91-187).

**`ingest.service.ts`** — the core change filter. Keep a
`Map<tagId, {value, ts}>` of last **published** and last **historized** values:
- `publishTag`: gated — publish when mode=RATE and `now-lastTs ≥ rateSec`, OR
  mode=CHANGE and value differs by ≥ `deadband` (null/0 = any change). Always
  publish the first sample. Pass **QoS 0** for tag telemetry (leave count/energy
  events at QoS 1 in the poller). Tie the Postgres `writeCurrentValue` upsert to
  the same publish decision (+ a periodic heartbeat) to cut DB load.
- `writeInflux`: gated the same way using `historizationMode` /
  `historizationRateSec` / `deadband`; keep the existing
  `historizationEnabled === false` short-circuit (line 64).
- Buffer-on-failure behaviour (lines 40-42) unchanged.

## 4. API (`apps/api/src/modules/iot`)

**`iot.service.ts`:**
- `createTag` / `updateTag` (lines 491-591): accept and persist
  `mqttPublishMode`, `mqttPublishRateSec`, `historizationMode`,
  `historizationRateSec`, `deadband` (same `dto.x !== undefined` pattern already
  used).
- `createDevice` (line 406): when `dto.type === 'EDGE_COUNTER'`, default
  `pollIntervalMs` to 100, store `config.edgeCounter = dto.edgeCounter`, and after
  creating the device call a new `provisionEdgeCounterTags(device, dto.edgeCounter)`
  that runs `instantiateEdgeCounterTags` and `tagDefinition.create` for each spec
  (skip existing by `factoryId+code`, mirroring `applyTemplateTags`).
- Leave `resolveScope` as-is (auto-deriving line/area is intended for roll-ups);
  the scope bug is purely the **edit-form precedence**, fixed in §5.

**`iot.controller.ts`** — ensure the new tag fields and `edgeCounter`/`type` pass
through the device/tag DTOs (they are permissive `any`, so mainly verify the
allow-lists include the new keys if any explicit list exists).

**Gateway `local-api.controller.ts`:** mirror the same — add the new tag fields
to the `updateTag` `allowed` array (lines 414-417) and `createTag` (lines 377-401),
and add EdgeCounter provisioning to `createDevice` (lines 296-325) reusing
`instantiateEdgeCounterTags`.

## 5. Web app (`apps/web/src/features/iot`)

**`iot-devices-view.tsx`:**
- Add `EDGE_COUNTER` to the Type select (line 312-318). When selected, show a
  block-config section: DI/Coil/HR/IR each with Start + Quantity inputs, and
  default the poll field to `100`. Build `dto.edgeCounter` + `dto.type` in
  `handleSubmit` (line 137).
- **Scope-bug fix** (line 118): change
  `device.lineId ? 'line' : device.areaId ? 'area' : 'machine'` →
  `device.machineId ? 'machine' : device.lineId ? 'line' : device.areaId ? 'area' : 'machine'`.

**`iot-tags-view.tsx`:**
- Add form fields for `mqttPublishMode` (CHANGE/RATE) + `mqttPublishRateSec`,
  `historizationMode` (CHANGE/RATE) + `historizationRateSec`, and `deadband`
  (shown for numeric data types). Extend `emptyForm` (line 43), `handleOpenEdit`
  (line 166), and `handleSubmit` dto (line 202).
- **Scope-bug fix** (line 170): same machine-first precedence as above.

**i18n:** add the new labels to `apps/web/src/locales/{en,ar}/iot.json` (`tform.*`,
`dform.*`).

## 6. Gateway dashboard (`apps/edgegateway/public/index.html`)

Vanilla-JS single file. Mirror the web changes:
- `openDeviceForm` (line 310): add `EDGE_COUNTER` type + block inputs + 100 ms
  default; include `edgeCounter`/`type` in the `dto` (line 329).
- `openTagForm` (~line 359): add publish-mode/rate, historization-mode/rate,
  deadband fields to the `dto` (line 375).
- Fix scope precedence wherever the edit form derives `scopeType` from an existing
  device/tag (machine-first), matching §5.

## Verification

1. **Migration**: user runs `npx prisma migrate deploy`; then
   `pnpm --filter @mes360/edgegateway prisma:sync` + `pnpm --filter @mes360/edgegateway build`.
2. **Unit**: extend `packages/industrial-drivers/src/meter-templates.test.ts`
   with tests for `instantiateEdgeCounterTags` (0..7 DI → 8 BOOL COUNTER tags,
   qty 0 → none) and a `planBlocks` test (contiguous coalescing, gap split,
   correct per-tag offsets/decoding).
3. **End-to-end with the simulator** (README §"Local test"): create an
   EDGE_COUNTER device (DI 0-7) via the gateway dashboard → confirm 8 COUNTER
   tags auto-created; run `scripts/modbus-sim.mjs`, pulse a coil faster than the
   old 1 s poll, confirm counts are no longer missed at 100 ms with block reads.
4. **MQTT/flood**: set a PM tag to `mqttPublishMode=CHANGE` with a deadband and
   watch the gateway dashboard buffer counters stay near 0 (was ~1300); set
   another to `RATE`/`historizationMode=RATE` and confirm cadence.
5. **Scope fix**: create a machine-scoped tag, reopen edit → it shows "Machine"
   (not "Line"). Repeat for a device.
6. `pnpm --filter @mes360/api build` + web typecheck to confirm no type breaks.






That changes my earlier migration guidance — good that you mentioned it. Both stacks apply schema with prisma db push (from a one-shot migrate-seed service), not migrate deploy. So:

Your Docker deployments ignore the migrations/ folder entirely. The migration.sql I wrote is harmless but unused by db push — no need to run it manually.
db push reads schema.prisma (baked into the mes360-api image at build time) and makes the DB match it. My 4 new columns are additive (3 with defaults, 1 nullable), so db push adds them with no data loss.
The key implication: you must rebuild the images so the new schema.prisma (and the web UI) are inside them, then let migrate-seed push the columns.

Local prod Docker (docker-compose.prod-local.yml)

cd "d:/NEW WORKS/New folder/MES360_SDPF"
docker compose -f docker-compose.prod-local.yml build api web migrate-seed
docker compose -f docker-compose.prod-local.yml up -d --no-deps --force-recreate migrate-seed   # runs prisma db push → adds the 4 columns
docker compose -f docker-compose.prod-local.yml up -d                                            # restart api + web on new images
docker compose -f docker-compose.prod-local.yml logs -f migrate-seed                             # confirm push succeeded
VPS / Hostinger (docker-compose.hostinger.yml)
On the VPS (after git pull):


docker compose -f docker-compose.hostinger.yml build api web migrate-seed
docker compose -f docker-compose.hostinger.yml up -d --no-deps --force-recreate migrate-seed
docker compose -f docker-compose.hostinger.yml up -d
Each database is separate, and db push is idempotent, so applying to both is independent and safe. You can verify the columns landed:


docker exec -it mes-postgres-plocal psql -U mes_user -d mes360 -c '\d tag_definitions' | grep -Ei 'mqttPublish|historizationMode|deadband'
(use mes-postgres-prod on the VPS).

The edge gateway is separate (not in either compose)
It runs on the plant PC against whichever DATABASE_URL you point it at. It has its own generated Prisma client, so after pulling the code there:


pnpm --filter @mes360/edgegateway prisma:sync   # copies the updated schema
pnpm --filter @mes360/edgegateway build          # rebuilds (regenerates its client) — includes block reads + gating
# or for the Windows service: pnpm --filter @mes360/edgegateway package:win, then nssm restart Mes360EdgeGateway
The gateway only reads/writes those columns — it doesn't create them, so make sure the db push above ran against the same DB the gateway connects to.

One caution: db push --accept-data-loss is in that command — for our additive columns it won't drop anything, but if either schema.prisma has drifted from that DB in other ways, db push reconciles the whole schema at once. Watch the migrate-seed logs the first time.

Want me to also delete the now-unused migration.sql I created, or keep it for history?