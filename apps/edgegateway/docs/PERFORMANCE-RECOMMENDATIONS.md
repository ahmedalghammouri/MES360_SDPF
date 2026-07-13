# Edge Gateway — Recommendations & Solutions

> Companion to [ALGORITHM-ANALYSIS.md](./ALGORITHM-ANALYSIS.md). Fixes are grouped
> by the three symptoms and ordered **most impact / least risk first**. Each item
> lists the concrete code change and the file it touches.

Two guiding principles:

- **Publish/write on *significant change*, not on every poll.** The plant does
  not need 16 float values per second per meter. It needs them when they move
  meaningfully, plus a slow heartbeat.
- **Do not use a slow poll to count fast pulses.** Either count in hardware
  (accumulator register) or poll the DI on a dedicated fast loop. Ideally both.

---

## A. Fix the missed digital-input counts (highest priority — you are losing production data)

### A1. Preferred: read a **hardware counter (accumulator) register**, not the raw DI

Almost every Modbus DI/counter module (WAGO, Advantech ADAM, Moxa ioLogik,
Beckhoff, etc.) exposes a **high-speed hardware counter** that latches every
pulse into a monotonically increasing 16/32-bit holding register. The PLC/IO
card counts the pulse in hardware (microseconds); the gateway just samples the
running total and computes the delta:

```
delta = max(0, currentCount - lastCount)   // handle 16/32-bit rollover
jobOrder.total += delta
```

This is **immune to poll rate** — even a 5 s poll never loses a count, because
the module accumulates between reads. This is the single most reliable fix.

**Change required:**
- Add a `COUNTER` tag with a new counter *mode* = `ACCUMULATOR` (register total)
  vs the existing `EDGE` (rising edge on a bit).
- In [counter.service.ts](../src/acquisition/counter.service.ts), when mode is
  `ACCUMULATOR`, replace the `detectEdge` call with a delta computation:
  `inc = raw - mem.lastRaw` (clamped ≥ 0, with rollover handling). The rest of
  the "apply to Job Order / persist state" logic is unchanged — `mem.lastRaw`
  already persists across restarts, so this is restart-safe by construction.
- Configure the IO device's counter register address in the Tags UI.

> Action item: confirm from the IO module datasheet whether it has pulse-counter
> registers. If yes, use them — stop edge-detecting the discrete input entirely.

### A2. If you must keep edge detection: a dedicated fast DI poll loop + latch

If the hardware has no counter register, the DI must be polled **faster than the
shortest pulse**, and separately from the slow analog/meter reads:

1. **Split fast vs slow tags per device.** Give `COUNTER`/`DISCRETE` tags a much
   shorter interval (e.g. **50–100 ms**) and run them on their own timer,
   independent of the 1 s (or slower) analog/energy tags. Today all tags on a
   device share one sequential loop
   ([modbus-poller.service.ts:240](../src/acquisition/modbus-poller.service.ts#L240));
   split `dev.tags` into `fastTags` and `slowTags` with two timers so a slow
   meter read can never delay a counter read.
2. **Batch the DI reads.** IO device #2 has 4 DIs — read all 4 in **one**
   `readDiscreteInputs(startAddr, 4)` call instead of 4 separate round-trips,
   then slice the bits. This is a driver addition (a "block read" that maps a
   register window to several tags) and cuts the counter device's cycle time
   ~4×.
3. **Ask the sensor/PLC to stretch the pulse.** A pulse-stretch / minimum-on
   timer in the PLC (e.g. hold the bit HIGH for ≥ 2× the poll interval) makes
   the pulse impossible to miss. Cheapest fix if you own the PLC program.
4. **Add debounce** using the existing `EdgeCounter` (with `debounceMs`) from
   [rising-edge-counter.js](../../../packages/industrial-drivers/src/rising-edge-counter.js#L48)
   instead of the stateless `detectEdge`, to avoid double-counting contact
   bounce once you poll fast.

> Even with A2, edge counting on a polled bit is fundamentally best-effort.
> Prefer A1 wherever the hardware allows it.

---

## B. Stop the PM5110 / analog flood (fixes the MQTT buffer and network load)

### B1. Deadband (change-of-value) filtering — the key change

Publish/historize a tag only when it changed **meaningfully** since the last
sent value, plus a slow keep-alive heartbeat. Add per-tag config:

- `deadband` (absolute or %) — e.g. Voltage ±0.5 V, Current ±0.05 A,
  Power ±0.02 kW, PF ±0.005, Frequency ±0.02 Hz.
- `maxSilenceMs` (heartbeat) — publish at least once every e.g. 30–60 s even if
  unchanged, so dashboards and Influx keep a fresh point.

Implement in [ingest.service.ts](../src/acquisition/ingest.service.ts) with a
small `Map<tagId, {value, ts}>` of last-sent values. Skip the MQTT publish and
the Influx write when `|new - last| < deadband && now - lastTs < maxSilenceMs`.

**Expected effect:** a stable PM5110 drops from ~16 msg/s to a *handful of msgs
per minute*. This alone will collapse the MQTT in-flight buffer, because the
publish rate falls below the broker ACK rate. It is the highest-leverage single
change for symptoms #1 and #2.

### B2. Separate the poll rate from the publish rate for energy

Analog electrical values do not need 1 s resolution for MES/energy purposes.

- Set the PM5110 device `pollIntervalMs` to **2000–5000 ms** (Devices UI). At
  9600 baud with 16 registers this also relieves the RS-485 bus.
- Keep the fast loop only for counters (see A2).
- The `EnergyReading` row is already throttled to 1/10 s per meter
  ([energy-reading.service.ts:32](../src/acquisition/energy-reading.service.ts#L32));
  align the per-tag deadband/heartbeat with that so the whole energy path is
  consistent.

### B3. Batch the meter register reads into block reads

The PM5110 template registers are mostly contiguous
([meter-templates.ts:73-90](../../../packages/industrial-drivers/src/meter-templates.ts#L73-L90)).
Reading them as a few **block reads** (e.g. one read spanning the current/voltage
window, one for the power window) instead of 16 separate transactions cuts the
serial cycle time dramatically and lowers CPU. Add a block-read capability to
[modbus-client.ts](../../../packages/industrial-drivers/src/modbus-client.ts)
and map slices to tags. (Modbus allows up to 125 registers per read.)

---

## C. Fix MQTT back-pressure directly (defense in depth)

Even after B1, harden the publisher so a slow broker can never grow an unbounded
in-memory queue:

### C1. Drop tag telemetry to QoS 0

Per-poll live tag values are ephemeral telemetry — losing one is harmless (the
next poll supersedes it). QoS 1 forces a stored + ACKed round-trip per message,
which is what lets the in-flight store balloon to 1300.

- Publish **tag** values (`ingest.publishTag`) at **QoS 0**
  ([ingest.service.ts:78-87](../src/acquisition/ingest.service.ts#L78-L87) →
  pass `0` to `mqtt.publish`).
- Keep **QoS 1** only for the events that must not be lost: count events and
  energy events
  ([modbus-poller.service.ts:282](../src/acquisition/modbus-poller.service.ts#L282),
  [:291](../src/acquisition/modbus-poller.service.ts#L291)).

### C2. Bound the client queue and shed load when the broker is behind

In [mqtt.service.ts](../src/services/mqtt.service.ts):

- Set mqtt.js options: `{ queueQoSZero: false }` so QoS-0 messages are dropped
  (not queued) while disconnected, and cap the store. Track
  `client.getLastMessageId`/in-flight count and, in `publish()`, if the client
  is connected but the outgoing queue exceeds a threshold (e.g. 500), **return
  `false`** so callers route to the disk buffer instead of piling into RAM.
- Add `retain: true` only for last-known-value topics if a consumer needs it;
  do **not** retain per-poll telemetry.

### C3. Publish `TagCurrentValue` to Postgres less aggressively

`TagCurrentValue` is a *current value* table — it does not need every poll.
Gate the Postgres upsert behind the same deadband/heartbeat as B1 so it is
written on change + heartbeat only. This removes ~20 upserts/s from the DB.

---

## D. Reduce PC resource usage (CPU / disk / memory)

### D1. Parallelize sink writes instead of awaiting in series

Today `ingest()` awaits Postgres, then Influx, then MQTT sequentially per tag
([ingest.service.ts:39-43](../src/acquisition/ingest.service.ts#L39-L43)), and
the poller awaits `ingest()` before reading the next tag. The Modbus read of tag
N+1 is blocked on the DB write of tag N. Decouple them:

- Read all tags for a device first (into an array), then fan out the sink writes
  with `Promise.allSettled`, so Modbus I/O and sink I/O overlap.
- This shortens the poll cycle (helps counting) and smooths CPU.

### D2. Batch Influx writes

Use the Influx client's **write buffering / batching** (points flushed on a size
or time interval) instead of one `write(point)` per tag
([ingest.service.ts:63-76](../src/acquisition/ingest.service.ts#L63-L76)).
One HTTP flush per second beats 22 tiny writes per second.

### D3. Make the disk buffer async and bounded

[buffer.service.ts](../src/acquisition/buffer.service.ts) uses synchronous
`appendFileSync` and rewrites the **whole file** on every drain. Under backlog
this blocks the event loop.

- Switch to async append (`fs.promises.appendFile`) or a write stream.
- Cap file size / line count and rotate; drop oldest telemetry when over cap
  (counts/energy events should have priority to survive).
- Drain in **capped batches** (e.g. 500 lines/tick) rather than the entire file
  at once.

### D4. Right-size intervals

- Counters: fast loop (50–100 ms) — see A2.
- Energy/analog: 2–5 s — see B2.
- `poller-reload` (10 s) and `buffer-drain` (20 s) are fine; leave them.

---

## Suggested rollout order

| Step | Change | Symptom fixed | Effort |
|---|---|---|---|
| 1 | **B1** deadband + heartbeat on tag publish/historize | MQTT buffer, PM flood, PC load | Medium |
| 2 | **C1** QoS 0 for tag telemetry (QoS 1 only for count/energy) | MQTT buffer | Tiny |
| 3 | **A1** hardware accumulator counter *(or A2 if no counter reg)* | Missed counts | Medium |
| 4 | **B2** slow the PM5110 poll to 2–5 s | PM flood, RS-485 load | Tiny (config) |
| 5 | **C2 / D3** bound MQTT queue + async/bounded disk buffer | MQTT buffer, PC load | Medium |
| 6 | **A2.2 / B3 / D1 / D2** block reads + parallel/batched sink writes | Counts + PC load | Larger |

Steps 1, 2 and 4 are quick and together should eliminate the 1300-deep MQTT
buffer and the meter flood almost immediately. Step 3 is the one that stops you
losing production counts and deserves a hardware check on the IO modules first.

---

## Quick wins you can apply today without code changes

- In the **Devices** tab, raise the PM5110's `pollIntervalMs` to `3000` ms.
- In the **Tags** tab, disable historization on the noisiest analog tags you do
  not trend (e.g. per-phase apparent/reactive power) to cut Influx + MQTT load
  (`historizationEnabled = false` already short-circuits the Influx write —
  [ingest.service.ts:64](../src/acquisition/ingest.service.ts#L64)).
- If your IO modules expose pulse-counter registers, reconfigure the counter
  tags to read those registers as `INPUT`/`HOLDING` INT tags now, ahead of the
  `ACCUMULATOR` mode work in A1.
