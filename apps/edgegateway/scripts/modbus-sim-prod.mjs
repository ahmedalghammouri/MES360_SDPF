// End-to-end simulator that mirrors the CURRENT prod-local DB (mes360) config,
// fetched from devices + tag_definitions. It stands in for the real field
// hardware so the whole edge chain can be exercised on one PC.
//
// Devices reproduced (same protocol / port / register bindings as the DB):
//
//   • EDGECOUNTER01  — Modbus TCP  127.0.0.1:502  unit 1  (poll 100 ms)
//        DI0 = TOTAL, DI1 = GOOD                     → M1 Big Betti  (INNER)
//   • EDGECOUNTER02  — Modbus TCP  127.0.0.1:503  unit 1  (poll 100 ms)
//        DI0 = TOTAL, DI1 = GOOD                     → M3 Cartomac   (CARTON)
//        DI2 = TOTAL, DI3 = GOOD                     → M5 Uni-tech   (PALLET)
//   • pm5110M05      — Modbus RTU  serial  unit 1  19200 8E1
//        16 Float32 holding regs (Schneider PM5110)  → Machine 5 energy meter
//
// The discrete inputs emit SHORT rising-edge pulses (one per simulated part),
// so this exercises the fast 100 ms EdgeCounter poll + block reads. GOOD pulses
// track TOTAL minus a small reject rate, so Bad = Total − Good comes out > 0.
//
// ── Virtual COM (Windows) ────────────────────────────────────────────────────
// The gateway opens the PM5110's COM port (COM2 for device pm5110M05 in the DB);
// a port can't be opened by two processes, so use a com0com virtual pair
// COM1 <-> COM2 and run THIS sim on COM1 (the free end). Anything written to COM1
// appears on COM2.
//   Install com0com → create pair COM1<->COM2.  Gateway device serialPort=COM2.
//
// ── Usage ────────────────────────────────────────────────────────────────────
//   cd apps/edgegateway
//   node scripts/modbus-sim-prod.mjs                     # PM5110 on COM1 @ 19200 even (default)
//   node scripts/modbus-sim-prod.mjs COM5                # PM5110 on a different COM port
//   node scripts/modbus-sim-prod.mjs COM1 9600 none      # override baud/parity to match the gateway
//   SIM_NO_SERIAL=1 node scripts/modbus-sim-prod.mjs     # TCP counters only (skip the serial meter)
//
// Tunables (env): SIM_PULSE_MS (default 200, must be > poll to be caught),
// SIM_CYCLE_MIN / SIM_CYCLE_MAX (ms between parts, default 700..1600),
// SIM_REJECT_PCT (unset by default — each stage uses its own realistic rate;
// setting it forces one rate on every stage).
//
// Note SIM_CYCLE_MIN/MAX set the pace of the SMALLEST unit (the filler). Each
// later stage derives its own, slower pace from the packaging ladder.
import pkg from 'modbus-serial';
import { readFileSync } from 'node:fs';
const { ServerTCP, ServerSerial } = pkg;

// ── PM5110 serial parameters (match the gateway device's serial settings) ──
const PM_COM = process.argv[2] || process.env.SIM_SERIAL_PORT || 'COM1';
const PM_BAUD = Number(process.argv[3] || process.env.SIM_BAUD || 19200);
const PM_PARITY = process.argv[4] || process.env.SIM_PARITY || 'even'; // none | even | odd
const PM_UNIT = Number(process.env.SIM_PM_UNIT || 1);
const NO_SERIAL = process.env.SIM_NO_SERIAL === '1';

const PULSE_MS = Number(process.env.SIM_PULSE_MS || 200);

// ── Pace: set from the LINE'S BOTTLENECK, not picked arbitrarily ────────────
// The routing defines an ideal cycle time per step. Normalised to seconds per
// PIECE those are:
//
//   Filling / Weighing   2.0 s   →  1,800 pcs/hr
//   Cartoning            3.0 s   →  1,200 pcs/hr   ← slowest = the bottleneck
//   Palletizing/Wrapping 1.5 s   →  2,400 pcs/hr
//
// (Those three disagreeing is itself a master-data problem, raised with NCC —
// a serial line cannot have three different design rates.)
//
// The old default of 700-1600 ms ran the line at ~2,900 pcs/hr, FASTER than
// every one of those ideals. Performance is (earned time / run time), so it
// came out at 162%, 248% and 123% per machine and was then clamped to 100% —
// which is why every machine on every screen read a perfect 100% Performance.
// A KPI pinned to its ceiling carries no information.
//
// A real line runs AT its constraint, slightly under the ideal. 3.33 s/piece is
// 90% of the cartoner's 3.0 s ideal, so Performance lands near 90% on the
// bottleneck and lower on the faster machines — which is what makes the
// bottleneck visible and the BOTTLENECK OEE method meaningful.
const CYCLE_MIN = Number(process.env.SIM_CYCLE_MIN || 2800);
const CYCLE_MAX = Number(process.env.SIM_CYCLE_MAX || 3900);
// Unset by default so each stage uses its own realistic rate (see TCP_DEVICES);
// setting SIM_REJECT_PCT forces one rate on every stage.
const REJECT_PCT = process.env.SIM_REJECT_PCT ? Number(process.env.SIM_REJECT_PCT) : undefined;

// ── TCP EdgeCounter devices (mirror the DB) ──────────────────────────────────
//
// The machine bindings below come from tag_definitions, NOT from guesswork:
//   EDGECOUNTER01 :502  DI0/DI1 → M1 Big Betti        (Filling,    counts INNER)
//   EDGECOUNTER02 :503  DI0/DI1 → M3 Cartomac         (Cartoning,  counts CARTON)
//   EDGECOUNTER02 :503  DI2/DI3 → M5 Uni-tech Wrapping(Wrapping,   counts PALLET)
// M2 (Checkweigher) and M4 (Euro-Pack Robot) have no counter tags.
//
// ── Why each machine needs its OWN rate ──────────────────────────────────────
// A counter pulse means "one unit in THIS machine's packaging unit". For SKU
// 10310027: 1 CARTON = 4 INNER and 1 PALLET = 40 CARTON = 160 INNER. So one M5
// pulse is worth 160 M1 pulses of physical product.
//
// Pulsing all three at the same rate — which this simulator used to do — claims
// the palletiser wraps as many PALLETS per minute as the filler fills INNERS,
// i.e. 160× the material the line actually made. Every downstream number was
// then computed from that: work-order output, scrap, quality, OEE, schedule
// attainment. It produced things like "Wrapping 398 PALLET" fed by a palletiser
// that had made 10, and 95,504 units of scrap on an order of 40,000.
//
// `piecesPerPulse` is the ladder factor. Rates are derived from it, and each
// stage additionally CONSUMES its input from the upstream buffer, so a
// downstream machine can never report more product than was fed to it —
// the invariant the old simulator violated.
//
// `rejectPct` is per stage, and deliberately NOT uniform. A reject costs whatever
// that stage's unit is worth: one rejected pallet writes off 160 pieces. Applying
// one flat 8% at every stage therefore scrapped ~8% of all output at the wrapper
// alone and pushed the quality KPI far below anything a real detergent line sees.
// Losses belong where they actually happen — mostly at the filler.
const TCP_DEVICES = [
  { name: 'EDGECOUNTER01', port: 502, machines: [
    { label: 'M1 Filling',   total: 0, good: 1, piecesPerPulse: 1,   rejectPct: 2.0, feedsFrom: null,       feedsInto: 'filled' },
  ] },
  { name: 'EDGECOUNTER02', port: 503, machines: [
    { label: 'M3 Cartoning', total: 0, good: 1, piecesPerPulse: 4,   rejectPct: 0.5, feedsFrom: 'filled',   feedsInto: 'cartoned' },
    { label: 'M5 Wrapping',  total: 2, good: 3, piecesPerPulse: 160, rejectPct: 0.2, feedsFrom: 'cartoned', feedsInto: null },
  ] },
];

// Work-in-process between stages, in PIECES — the smallest rung, where the
// conversion is exact.
const buffers = { filled: 0, cartoned: 0 };

// ── Machine status signals — NCC's actual I/O ───────────────────────────────
// The remote Modbus I/O carries EIGHT DIGITAL INPUTS and nothing else: no status
// word, no integer state code. Every signal below is a discrete input reading
// true or false, at the addresses NCC's mapping specifies.
//
//   Big Betti module   ID 3  Big Betti      Run Mode
//                      ID 4  Cartomac       Run Mode
//                      ID 5  Euro-Pack      Run Mode  (steady/pulsing/off)
//   Uni-Tech module    ID 5  Wrapping Table rotation   (pallet being processed)
//                      ID 6  Uni-Tech       Run Mode
//
// ── Two things this simulator must NOT do ───────────────────────────────────
// 1. It never emits STARVED or BLOCKED. Those are the MES's job to derive; handing
//    them over ready-made would make the feature under test appear to work while
//    having done nothing.
// 2. A starved machine keeps its Run Mode ON. NCC's spec is explicit that Cartomac
//    and Uni-Tech report "running/ready, INCLUDING the condition where the machine
//    is ready but no product is currently being processed". Turning the run signal
//    off when material runs out would simulate a plant that does not exist and
//    hide the exact problem the table-rotation signal was provided to solve.
// NCC numbers their I/O terminals from 1; Modbus addresses count from 0.
// ID 1 -> DI 0, ID 2 -> DI 1, and so on. Kept as the ID here so this table reads
// against NCC's document directly, with the offset applied once.
const diAddress = (ioId) => ioId - 1;
const SIGNALS = [
  { code: 'M1', name: 'Big Betti',         port: 502, ioId: 3, role: 'RUN_MODE' },
  { code: 'M3', name: 'Cartomac',          port: 502, ioId: 4, role: 'RUN_MODE' },
  { code: 'M4', name: 'Euro-Pack Robot',   port: 502, ioId: 5, role: 'RUN_MODE_PULSED' },
  { code: 'M5', name: 'Uni-tech Table',    port: 503, ioId: 5, role: 'PROCESSING' },
  { code: 'M5', name: 'Uni-tech Wrapping', port: 503, ioId: 6, role: 'RUN_MODE' },
].map((s) => ({ ...s, di: diAddress(s.ioId) }));

/**
 * Machines the operator has stopped, for the Starved/Blocked demonstration.
 *
 * Read from a control file that is re-read every second, so a machine can be
 * stopped and restarted WHILE the simulator runs — a demo that needs a restart
 * is not a demo. `SIM_STOP=M1,M3` seeds the same set at startup.
 *
 *   echo '{"stopped":["M1"]}' > sim-control.json     # starve the line
 *   echo '{"stopped":[]}'     > sim-control.json     # resume
 */
const CONTROL_FILE = process.env.SIM_CONTROL || 'sim-control.json';
const stopped = new Set(
  (process.env.SIM_STOP ?? '').split(',').map((s) => s.trim()).filter(Boolean),
);
const isStopped = (code) => stopped.has(code);

function readControl() {
  try {
    const raw = readFileSync(CONTROL_FILE, 'utf8');
    const next = new Set((JSON.parse(raw).stopped ?? []).map(String));
    // Log only on change, so the console stays readable during a long run.
    const changed = next.size !== stopped.size || [...next].some((c) => !stopped.has(c));
    if (changed) {
      stopped.clear();
      next.forEach((c) => stopped.add(c));
      console.log(`[control] stopped machines → ${next.size ? [...next].join(', ') : '(none)'}`);
    }
  } catch {
    // No control file is the normal case — every machine runs.
  }
}
setInterval(readControl, 1000);
readControl();

/** Which production stage tells us whether a machine is actually processing. */
const STAGE_OF = { M1: 'M1', M3: 'M3', M4: 'M5', M5: 'M5' };

/** Last time each stage actually produced a unit. */
const lastProducedAt = { M1: Date.now(), M3: Date.now(), M5: Date.now() };

/**
 * How long after the last unit the PROCESSING signal drops.
 *
 * The wrapping table rotates while a pallet is being wrapped and rests between
 * pallets, so this must exceed one normal cycle — otherwise the table reads
 * "not processing" between every pallet during healthy production.
 */
const PROCESS_HOLD_MS = Number(process.env.SIM_PROCESS_HOLD_MS || 90_000);

/**
 * A Run Mode bit. ON whenever the machine is able to work.
 *
 * It stays ON when the machine is merely starved, exactly as NCC's spec
 * describes — only an operator stop (standing in for alarm / emergency stop)
 * pulls it false.
 */
const runMode = (code) => !isStopped(code);

/**
 * The Euro-Pack Robot's bit, which carries three states rather than two:
 *   steady ON — running with product, or ready with none
 *   PULSING   — stop mode
 *   OFF       — alarm or emergency stop
 *
 * Stop mode is simulated as a 1 Hz square wave so the gateway has a real pulse
 * train to detect rather than a flag that says "pretend this is pulsing".
 */
const PULSE_PERIOD_MS = Number(process.env.SIM_PULSE_PERIOD_MS || 1000);
const runModePulsed = (code) => {
  if (isStopped(code)) return false;                    // alarm / e-stop
  const stage = STAGE_OF[code];
  const stalled = stage && Date.now() - lastProducedAt[stage] > PROCESS_HOLD_MS;
  if (!stalled) return true;                            // steady ON
  return Math.floor(Date.now() / (PULSE_PERIOD_MS / 2)) % 2 === 0; // pulsing
};

/** The wrapping table: true while a pallet is being processed. */
const processing = (code) => {
  if (isStopped(code)) return false;
  const stage = STAGE_OF[code];
  return !!stage && Date.now() - lastProducedAt[stage] <= PROCESS_HOLD_MS;
};

/** Current level of one signal, evaluated live on every poll. */
const signalLevel = (s) => {
  if (s.role === 'PROCESSING') return processing(s.code);
  if (s.role === 'RUN_MODE_PULSED') return runModePulsed(s.code);
  return runMode(s.code);
};

const rnd = (min, max) => min + Math.random() * (max - min);
const counts = {}; // "DEV/label" → { total, good, bad }

/** Spin up one ServerTCP whose discrete inputs pulse once per simulated part. */
function startTcpDevice(dev) {
  const di = {};                 // discrete-input address → boolean (current level)
  for (const m of dev.machines) {
    di[m.total] = false; di[m.good] = false;
    counts[`${dev.name}/${m.label}`] = { total: 0, good: 0, bad: 0 };
    // One unit of THIS machine's packaging unit takes proportionally longer to
    // make than one unit of the smallest one: a pallet is 160 pieces of work.
    const cycle = () => rnd(CYCLE_MIN, CYCLE_MAX) * m.piecesPerPulse;
    // The machine this production stage belongs to, so a stop really stops it.
    const mCode = m.label.split(' ')[0];
    const producePart = () => {
      // A stopped machine produces nothing. This is what makes the Starved demo
      // physically true rather than cosmetic: stopping the filler drains the
      // buffer, and the stages downstream genuinely run out of material.
      if (isStopped(mCode)) {
        setTimeout(producePart, CYCLE_MIN);
        return;
      }
      // Material gate: a stage can only run if its upstream buffer holds a full
      // unit's worth. Without this the counts drift apart again over time.
      const need = m.piecesPerPulse;
      if (m.feedsFrom && buffers[m.feedsFrom] < need) {
        setTimeout(producePart, CYCLE_MIN); // starved — re-check shortly
        return;
      }
      if (m.feedsFrom) buffers[m.feedsFrom] -= need;
      if (m.feedsInto) buffers[m.feedsInto] += need;

      // This stage produced, so it is demonstrably not stalled.
      lastProducedAt[mCode] = Date.now();

      // Per-stage reject rate; SIM_REJECT_PCT overrides all stages when set.
      const isGood = Math.random() * 100 >= (REJECT_PCT ?? m.rejectPct);
      const c = counts[`${dev.name}/${m.label}`];
      // Raise the pulse(s) — a rising edge the gateway's fast poll will catch.
      di[m.total] = true; if (isGood) di[m.good] = true;
      c.total++; if (isGood) c.good++; else c.bad++;
      setTimeout(() => { di[m.total] = false; di[m.good] = false; }, PULSE_MS); // short high window
      setTimeout(producePart, cycle());                                          // next part
    };
    setTimeout(producePart, rnd(0, CYCLE_MAX)); // stagger machines
  }

  // Status signals share the discrete-input space with the counter pulses — they
  // are all bits on the same eight-input module. Evaluated on every read so a
  // change in the control file, or a pulse edge, appears on the very next poll.
  const statusBits = SIGNALS.filter((s) => s.port === dev.port);
  const bitAt = (addr) => {
    const s = statusBits.find((x) => x.di === addr);
    if (s) return signalLevel(s);
    return !!di[addr]; // counter pulse
  };

  const vector = {
    getDiscreteInput: (addr, _u, cb) => cb(null, bitAt(addr)),
    getCoil: (addr, _u, cb) => cb(null, bitAt(addr)),
    getInputRegister: (_a, _u, cb) => cb(null, 0),
    getHoldingRegister: (_a, _u, cb) => cb(null, 0),
    setCoil: (_a, _v, _u, cb) => cb(null),
    setRegister: (_a, _v, _u, cb) => cb(null),
  };
  const server = new ServerTCP(vector, { host: '0.0.0.0', port: dev.port, debug: false, unitID: 1 });
  server.on('socketError', (e) => console.error(`[${dev.name}] socket error:`, e?.message));
  server.on('serverError', (e) => console.error(`[${dev.name}] server error:`, e?.message));
  const map = dev.machines.map((m) => `${m.label}: DI${m.total}=TOTAL DI${m.good}=GOOD`).join('  |  ');
  console.log(`▶ ${dev.name}  Modbus TCP 0.0.0.0:${dev.port} (unit 1)  ${map}`);
  console.log(`    status DIs → ${statusBits.map((s) => `DI${s.di}=${s.code} ${s.role} (ID ${s.ioId})`).join('  |  ')}`);
}

// ── PM5110 (Schneider) Float32 register map — mirrors meter-templates.ts ──
function makePm5110() {
  const regs = {};
  let energyWh = 1_000_000, exportWh = 50_000;
  const setFloat = (addr, val) => {
    const b = Buffer.alloc(4); b.writeFloatBE(val, 0);
    regs[addr] = b.readUInt16BE(0); regs[addr + 1] = b.readUInt16BE(2); // BIG word order
  };
  const refresh = () => {
    const jitter = (x, pct) => x * (1 + Math.sin(Date.now() / 3000) * pct);
    const v = jitter(230, 0.02), i = jitter(11, 0.15), pf = 0.94;
    const pPh = (v * i * pf) / 1000; // kW/phase
    setFloat(2999, i); setFloat(3001, i); setFloat(3003, i); setFloat(3009, i);   // currents L1/L2/L3/avg
    setFloat(3025, v * Math.SQRT2 * Math.sqrt(1.5));                              // voltage L-L avg
    setFloat(3027, v); setFloat(3029, v); setFloat(3031, v); setFloat(3035, v);   // voltages L-N + avg
    setFloat(3059, pPh * 3);                                                      // active power total kW
    setFloat(3067, pPh * 3 * 0.3); setFloat(3075, pPh * 3 / pf);                  // reactive / apparent
    setFloat(3109, jitter(50, 0.002));                                           // frequency Hz
    setFloat(3191, pf);                                                          // PF total
    energyWh += pPh * 3 * 1000 * (1.5 / 3600);                                   // integrate → Wh
    setFloat(2699, energyWh / 1000); setFloat(2701, exportWh / 1000);            // energy import/export kWh
  };
  refresh(); setInterval(refresh, 1500);
  return regs;
}

function startPm5110() {
  const regs = makePm5110();
  const word = (addr, u) => (u === PM_UNIT ? (regs[addr] || 0) : 0);
  const vector = {
    getHoldingRegister: (addr, u, cb) => cb(null, word(addr, u)),
    getInputRegister: (addr, u, cb) => cb(null, word(addr, u)),
    getCoil: (_a, _u, cb) => cb(null, false),
    getDiscreteInput: (_a, _u, cb) => cb(null, false),
    setCoil: (_a, _v, _u, cb) => cb(null),
    setRegister: (_a, _v, _u, cb) => cb(null),
  };
  const frame = `8${PM_PARITY === 'none' ? 'N' : PM_PARITY === 'even' ? 'E' : 'O'}1`;
  const server = new ServerSerial(vector, { port: PM_COM, baudRate: PM_BAUD, parity: PM_PARITY, unitID: 255, debug: false });
  server.on('initialized', () => console.log(`▶ pm5110M05  Modbus RTU ${PM_COM} @ ${PM_BAUD} ${frame} (unit ${PM_UNIT})  16 Float32 regs (V/I/P/PF/Hz + energy)`));
  server.on('socketError', (e) => console.error('[pm5110] socket error:', e?.message));
  server.on('error', (e) => console.error(`[pm5110] serial error: ${e?.message}  — is ${PM_COM} a valid free half of a com0com pair? (SIM_NO_SERIAL=1 to skip)`));
}

console.log('MES360 prod-local simulator — mirrors mes360 devices/tags\n');
for (const d of TCP_DEVICES) startTcpDevice(d);
if (!NO_SERIAL) startPm5110();
else console.log('… serial PM5110 skipped (SIM_NO_SERIAL=1)');

// Periodic tally so you can cross-check simulated production against the MES.
// The PIECES column is the point: the three stages count in different packaging
// units, so their raw totals are NOT comparable — only the piece equivalents are,
// and those should stay in step (later stages trailing slightly, by the WIP still
// in the buffers). If they diverge, the ladder is wrong somewhere.
const ppp = Object.fromEntries(
  TCP_DEVICES.flatMap((d) => d.machines.map((m) => [`${d.name}/${m.label}`, m.piecesPerPulse])),
);
setInterval(() => {
  const line = Object.entries(counts)
    .map(([k, c]) => `${k} T:${c.total} G:${c.good} B:${c.bad} (${c.total * ppp[k]} pcs)`)
    .join('   ');
  if (line) {
    console.log(`[${new Date().toLocaleTimeString()}] produced →  ${line}`);
    console.log(`            WIP pieces → filled:${buffers.filled}  cartoned:${buffers.cartoned}`);
  }
}, 10_000);

process.on('SIGINT', () => { console.log('\nsimulator stopped'); process.exit(0); });
