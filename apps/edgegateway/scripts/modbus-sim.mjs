// Modbus-TCP / RTU-over-TCP simulator for end-to-end testing of the edge gateway.
//
//  • Coil 0 pulses (false→true→false) ~every 1.5s            → rising edges for a GOOD/TOTAL counter
//  • Holding registers expose a Schneider PM5110 map (Float32 V/I/P/PF/Hz at the
//    template addresses + Int64 active-energy counters)        → drives an energy meter
//
// Usage:  node scripts/modbus-sim.mjs [port]   (default 1502; 502 needs admin on Windows)
import pkg from 'modbus-serial';
const { ServerTCP } = pkg;

const PORT = Number(process.argv[2] || process.env.SIM_PORT || 1502);
const SEED = PORT - 1502;          // per-instance offset so each port looks distinct

let coil0 = false;
let energyWh = 1_000_000 + SEED * 25_000;   // cumulative Wh (template scaleFactor 0.001 → kWh)
let exportWh = 50_000 + SEED * 1_000;

// register address → 16-bit word
const regs = {};
function setFloat(addr, val) {
  const b = Buffer.alloc(4); b.writeFloatBE(val, 0);
  regs[addr] = b.readUInt16BE(0); regs[addr + 1] = b.readUInt16BE(2); // BIG word order
}
function setU64(addr, val) {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(Math.round(val)), 0);
  for (let i = 0; i < 4; i++) regs[addr + i] = b.readUInt16BE(i * 2);
}

function refresh() {
  const jitter = (x, pct) => x * (1 + (Math.sin(Date.now() / 3000 + SEED) * pct));
  const v = jitter(228 + (SEED % 5), 0.02), i = jitter(8 + (SEED * 1.7) % 14, 0.15), pf = 0.90 + (SEED % 6) * 0.015;
  const pPh = (v * i * pf) / 1000; // kW per phase
  // PM5110 (SCHNEIDER_PM5110) Float32 addresses
  setFloat(3000, i); setFloat(3002, i); setFloat(3004, i); setFloat(3010, i);          // currents
  setFloat(3028, v); setFloat(3030, v); setFloat(3032, v); setFloat(3036, v);          // voltages L-N
  setFloat(3060, pPh * 3);                                                              // active power total kW
  setFloat(3068, pPh * 3 * 0.3); setFloat(3076, pPh * 3 / pf);                          // reactive / apparent
  setFloat(3084, pf); setFloat(3110, jitter(50, 0.002));                                // PF / frequency
  energyWh += (pPh * 3) * 1000 * (1.5 / 3600);  // integrate kW over the 1.5s tick → Wh
  setU64(3204, energyWh); setU64(3208, exportWh);                                        // energy import/export (Wh)
  coil0 = !coil0;
}
refresh();
setInterval(refresh, 1500);

const vector = {
  getCoil: (addr, _u, cb) => cb(null, addr === 0 ? coil0 : false),
  getDiscreteInput: (addr, _u, cb) => cb(null, addr === 0 ? coil0 : false),
  getInputRegister: (addr, _u, cb) => cb(null, regs[addr] || 0),
  getHoldingRegister: (addr, _u, cb) => cb(null, regs[addr] || 0),
  setCoil: (_a, _v, _u, cb) => cb(null),
  setRegister: (_a, _v, _u, cb) => cb(null),
};

const server = new ServerTCP(vector, { host: '0.0.0.0', port: PORT, debug: false, unitID: 1 });
server.on('socketError', (e) => console.error('sim socket error:', e?.message));
server.on('serverError', (e) => console.error('sim server error:', e?.message));
console.log(`Modbus simulator on 0.0.0.0:${PORT} — coil0 pulsing + PM5110 register map (V/I/P/PF/Hz + energy)`);
