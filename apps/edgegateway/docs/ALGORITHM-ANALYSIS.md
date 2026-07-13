# Edge Gateway — Current Acquisition Algorithm (as-built analysis)

> Scope: analysis of the polling / counting / publishing pipeline as it exists
> today, and *why* it produces the three symptoms you are seeing in the field:
>
> 1. MQTT client back-pressure buffer growing to ~1300 messages.
> 2. The PM5110 power meter flooding the network / broker (publishes every tag,
>    every poll).
> 3. Missed digital-input counts — the Modbus client cannot see a sensor pulse
>    that rises and falls between two polls.

Your field topology (for reference throughout this document):

| Node | Transport | Tags |
|---|---|---|
| IO device #1 | Modbus TCP | 2 DI → Machine 1 (Total + Good) |
| IO device #2 | Modbus TCP | 4 DI → Machine 2 (Total + Good), Machine 3 (Total + Good) |
| PM5110 | Modbus RTU (RS-485) | 16 analog tags → Machine 5 energy |

All three hang off **one** edge gateway.

---

## 1. The polling loop

Source: [modbus-poller.service.ts](../src/acquisition/modbus-poller.service.ts)

- One `DeviceRuntime` per device, each with its **own** `setInterval` timer at
  the device's `pollIntervalMs` (default `1000 ms`, see
  [modbus-poller.service.ts:219](../src/acquisition/modbus-poller.service.ts#L219)
  and `DEFAULT_POLL_INTERVAL_MS`).
- A `busy` guard skips a tick if the previous cycle for that device has not
  finished ([modbus-poller.service.ts:234](../src/acquisition/modbus-poller.service.ts#L234)).
- Config is reconciled against the DB **every 10 s** and the runtime is rebuilt
  only when a device's `signature` changes.

### The critical detail — tags are read **sequentially**, one round-trip each

```
for (const tag of dev.tags) {
  const res = await dev.client.readTag(tag.binding);   // ← one Modbus transaction, awaited
  ...
  await this.ingest.ingest(record);                    // ← 3 sink writes, awaited (see §3)
}
```
[modbus-poller.service.ts:240-286](../src/acquisition/modbus-poller.service.ts#L240-L286)

So the real revisit time for **any single tag** is not `pollIntervalMs`; it is:

```
cycle_time ≈ Σ (modbus_read_latency + ingest_latency) over all tags on the device
```

For the PM5110 (16 tags on RS-485 at 9600 baud) each read is a full request →
response frame. At 9600 baud + turnaround, one holding-register read of 2 words
is roughly 15–40 ms on the wire, plus the `await ingest` (Postgres upsert +
Influx write + MQTT publish) after every tag. A 16-tag serial meter can easily
take **300–700 ms per full cycle** before the next `setInterval` tick even
matters. Reads are **never batched** into a single multi-register request.

---

## 2. Counting algorithm (the missed-pulse problem)

Source: [counter.service.ts](../src/acquisition/counter.service.ts) +
`detectEdge` in [rising-edge-counter.js](../../../packages/industrial-drivers/src/rising-edge-counter.js)

The counter is a **software edge detector on a polled boolean/coil**:

1. Each poll reads the DI (`COIL`/`DISCRETE`) → `raw` = `true`/`false`.
2. `detectEdge(prevRaw, currRaw, 'RISING')` returns `1` only on a
   `false → true` transition between **two consecutive polls**
   ([rising-edge-counter.js:25-42](../../../packages/industrial-drivers/src/rising-edge-counter.js#L25-L42)).
3. On a detected edge, while the machine is `RUNNING` and a Job Order is
   `EXECUTING`, it increments the JO quantity and persists state.

### Why counts are missed

Edge detection compares **snapshot N** against **snapshot N-1**. It can only
see a pulse if the input is still HIGH at the exact moment of a poll. A part
sensor typically emits a **short pulse** (tens of ms). The timeline that loses a
count:

```
DI signal:   ___/‾‾‾\_______________/‾‾‾\____________
                pulse (80 ms)          pulse (80 ms)
Polls:       X                 X                 X
             read=0            read=0            read=0     → 0 counts, 2 parts lost
```

Between two polls (which, per §1, may be **hundreds of ms** apart because reads
are sequential and each poll awaits three sink writes) the pulse has already
risen and fallen. The client reads `0` both times → no edge → **the count is
silently lost**. This is exactly the "responds by very very small rate of
polling so the client cannot detect the rising / change" symptom.

There is an `EdgeCounter` debounce helper in the driver package, **but the
gateway does not use it** — `CounterService` calls the stateless `detectEdge`
directly, so there is also no de-bounce against contact bounce (the opposite
failure: one physical part double-counted). The core problem, though, is
**sub-poll pulses being invisible to a polling reader.**

---

## 3. Fan-out to sinks — the resource & MQTT-buffer problem

Source: [ingest.service.ts](../src/acquisition/ingest.service.ts)

**Every tag, every poll**, `ingest()` does three independent writes:

```
await writeCurrentValue(rec)   // Postgres upsert on TagCurrentValue   (1 DB round-trip)
writeInflux(rec)               // InfluxDB point                        (1 TSDB write)
publishTag(rec)                // MQTT publish at QoS 1                  (1 broker msg + PUBACK)
```
[ingest.service.ts:39-43](../src/acquisition/ingest.service.ts#L39-L43)

There is **no change detection / deadband anywhere.** A tag is written to all
three sinks on every single poll *even when its value has not changed.*

### Message-rate math for your site

| Source | Tags | Poll | MQTT msgs/s | PG upserts/s | Influx pts/s |
|---|---|---|---|---|---|
| IO #1 | 2 | 1 s | 2 | 2 | 2 |
| IO #2 | 4 | 1 s | 4 | 4 | 4 |
| PM5110 | 16 | 1 s | **16** | 16 | 16 |
| **Total** | 22 | | **~22 msg/s** | ~22/s | ~22/s |

Plus the count events and energy events on top. 22 msg/s is not huge *on paper*,
but three things turn it into the 1300-deep buffer you observe:

1. **QoS 1 publishing** — [mqtt.service.ts:75](../src/services/mqtt.service.ts#L75)
   defaults `qos = 1`. Every QoS-1 message is held in the mqtt.js **outgoing
   in-flight store** until the broker returns a `PUBACK`. If the broker or
   network is even slightly slow (or the broker throttles), the publish rate
   exceeds the ACK rate and the in-flight store grows without bound. **That
   growing store is the "buffer = 1300" you are seeing** — it is the MQTT
   client's own queue of un-ACKed messages, not the disk buffer.

2. **The PM5110 analog values change on every poll.** Voltage, current, PF and
   frequency are floating-point measurements — the last digits jitter
   constantly. With no deadband, all 16 float tags are "new" every poll, so the
   meter alone contributes a steady 16 msg/s of *mostly meaningless* traffic —
   this is the "PM publishes by change, heavy load on network and broker"
   symptom. (It is not really publishing "on change"; it is publishing
   *unconditionally*, and the values happen to always differ.)

3. **Synchronous disk buffering on failure.** When a publish returns `false` (or
   a DB/Influx write throws), the record is appended to a JSONL file with the
   **synchronous** `appendFileSync`
   ([buffer.service.ts:25-31](../src/acquisition/buffer.service.ts#L25-L31)),
   and `drainBuffers` re-reads and rewrites the **entire file** every 20 s
   ([ingest.service.ts:90-96](../src/acquisition/ingest.service.ts#L90-L96),
   [buffer.service.ts:43-64](../src/acquisition/buffer.service.ts#L43-L64)).
   Once a backlog forms, every drain does an O(n) read-all + write-all on the
   main thread, which competes with polling for CPU/disk and makes the backlog
   worse.

### Energy readings are already throttled — tag history is not

[energy-reading.service.ts:32](../src/acquisition/energy-reading.service.ts#L32)
throttles the `EnergyReading` **table row** to 1 per 10 s per meter. But that
throttle only protects the `EnergyReading` Postgres table. The 16 raw per-phase
tags still go to MQTT + Influx + `TagCurrentValue` **every poll** via `ingest()`
(the code comment even says so). So the throttle does not help the MQTT buffer
at all.

---

## 4. Summary — root causes mapped to symptoms

| Symptom you reported | Root cause in code |
|---|---|
| MQTT buffer climbs to ~1300 | QoS-1 in-flight store grows because publish rate (every tag, every poll) outruns broker ACK rate; no batching, no throttle on tag publishes |
| PM5110 heavy load on network/broker | 16 analog tags published + historized **unconditionally every poll**; no deadband / change filter; jittery floats always "differ" |
| Digital-input counts missed | Software rising-edge detection on a **slow, sequential poll** cannot observe pulses shorter than the poll cycle; cycle time inflated by sequential reads + 3 awaited sink writes per tag; no hardware-counter register used |
| PC resources heavy | Per-tag, per-poll: 1 PG upsert + 1 Influx write + 1 MQTT publish, all awaited in series; synchronous disk buffer read-all/write-all every 20 s |

See [PERFORMANCE-RECOMMENDATIONS.md](./PERFORMANCE-RECOMMENDATIONS.md) for the
fixes, ordered by impact and effort.
