// End-to-end simulator that mirrors the CURRENT prod-local DB (mes360) config,
// fetched from devices + tag_definitions. It stands in for the real field
// hardware so the whole edge chain can be exercised on one PC.
//
// Devices reproduced (same protocol / port / register bindings as the DB):
//
//   • EDGECOUNTER01  — Modbus TCP  127.0.0.1:502  unit 1  (poll 100 ms)
//        DI0 = TOTAL, DI1 = GOOD                     → Machine 1 counter
//   • EDGECOUNTER02  — Modbus TCP  127.0.0.1:503  unit 1  (poll 100 ms)
//        DI0 = TOTAL, DI1 = GOOD                     → Machine 2 counter
//        DI2 = TOTAL, DI3 = GOOD                     → Machine 3 counter
//   • pm5110M05      — Modbus RTU  serial  unit 1  19200 8E1
//        16 Float32 holding regs (Schneider PM5110)  → Machine 5 energy meter
//
// The discrete inputs emit SHORT rising-edge pulses (one per simulated part),
// so this exercises the fast 100 ms EdgeCounter poll + block reads. GOOD pulses
// track TOTAL minus a small reject rate, so Bad = Total − Good comes out > 0.
//
// ── Virtual COM (Windows) ────────────────────────────────────────────────────
// The gateway opens the PM5110's COM port (COM3 in the DB); a port can't be
// opened by two processes, so use a com0com virtual pair COM1 <-> COM3 and run
// THIS sim on COM1 (the free end). Anything written to COM1 appears on COM3.
//   Install com0com → create pair COM1<->COM3.  Gateway device serialPort=COM3.
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
// SIM_REJECT_PCT (default 8).
import pkg from 'modbus-serial';
const { ServerTCP, ServerSerial } = pkg;

// ── PM5110 serial parameters (match the gateway device's serial settings) ──
const PM_COM = process.argv[2] || process.env.SIM_SERIAL_PORT || 'COM1';
const PM_BAUD = Number(process.argv[3] || process.env.SIM_BAUD || 19200);
const PM_PARITY = process.argv[4] || process.env.SIM_PARITY || 'even'; // none | even | odd
const PM_UNIT = Number(process.env.SIM_PM_UNIT || 1);
const NO_SERIAL = process.env.SIM_NO_SERIAL === '1';

const PULSE_MS = Number(process.env.SIM_PULSE_MS || 200);
const CYCLE_MIN = Number(process.env.SIM_CYCLE_MIN || 700);
const CYCLE_MAX = Number(process.env.SIM_CYCLE_MAX || 1600);
const REJECT_PCT = Number(process.env.SIM_REJECT_PCT || 8);

// ── TCP EdgeCounter devices (mirror the DB) ──────────────────────────────────
const TCP_DEVICES = [
  { name: 'EDGECOUNTER01', port: 502, machines: [{ label: 'M1', total: 0, good: 1 }] },
  { name: 'EDGECOUNTER02', port: 503, machines: [
    { label: 'M2', total: 0, good: 1 },
    { label: 'M3', total: 2, good: 3 },
  ] },
];

const rnd = (min, max) => min + Math.random() * (max - min);
const counts = {}; // "DEV/label" → { total, good, bad }

/** Spin up one ServerTCP whose discrete inputs pulse once per simulated part. */
function startTcpDevice(dev) {
  const di = {};                 // discrete-input address → boolean (current level)
  for (const m of dev.machines) {
    di[m.total] = false; di[m.good] = false;
    counts[`${dev.name}/${m.label}`] = { total: 0, good: 0, bad: 0 };
    const producePart = () => {
      const isGood = Math.random() * 100 >= REJECT_PCT;
      const c = counts[`${dev.name}/${m.label}`];
      // Raise the pulse(s) — a rising edge the gateway's fast poll will catch.
      di[m.total] = true; if (isGood) di[m.good] = true;
      c.total++; if (isGood) c.good++; else c.bad++;
      setTimeout(() => { di[m.total] = false; di[m.good] = false; }, PULSE_MS); // short high window
      setTimeout(producePart, rnd(CYCLE_MIN, CYCLE_MAX));                        // next part
    };
    setTimeout(producePart, rnd(0, CYCLE_MAX)); // stagger machines
  }

  const vector = {
    getDiscreteInput: (addr, _u, cb) => cb(null, !!di[addr]),
    getCoil: (addr, _u, cb) => cb(null, !!di[addr]),
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
setInterval(() => {
  const line = Object.entries(counts).map(([k, c]) => `${k} T:${c.total} G:${c.good} B:${c.bad}`).join('   ');
  if (line) console.log(`[${new Date().toLocaleTimeString()}] parts produced →  ${line}`);
}, 10_000);

process.on('SIGINT', () => { console.log('\nsimulator stopped'); process.exit(0); });
