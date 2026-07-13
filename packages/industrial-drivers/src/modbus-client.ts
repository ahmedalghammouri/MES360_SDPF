import ModbusRTU from 'modbus-serial';
import type {
  ModbusOptions, ReadResult, RegisterType, TagBinding, WordOrder,
} from './types';
import { applyScaling, coerce } from './scaling';
import type { ModbusDataType } from './types';

/** Pack 16-bit registers into a big-endian byte buffer, honouring word order. */
function wordsToBuffer(words: number[], order: WordOrder = 'BIG'): Buffer {
  const ws = order === 'LITTLE' ? [...words].reverse() : words;
  const buf = Buffer.alloc(ws.length * 2);
  ws.forEach((w, i) => buf.writeUInt16BE(w & 0xffff, i * 2));
  return buf;
}

/**
 * Decode register words to a number per data type + width:
 *  - FLOAT: 2 words → IEEE-754 float32, 4 words → float64 (meters use float32)
 *  - INT:   1 word → uint16, 2 → uint32, 4 → uint64 (energy counters)
 */
function decodeNumeric(words: number[], dataType: ModbusDataType, wordCount: number, order: WordOrder): number | null {
  if (!words.length) return null;
  const buf = wordsToBuffer(words, order);
  if (dataType === 'FLOAT') {
    if (wordCount >= 4) return buf.readDoubleBE(0);
    if (wordCount === 2) return buf.readFloatBE(0);
    return words[0];
  }
  // INT (unsigned — matches register-counter semantics)
  if (wordCount >= 4) return Number(buf.readBigUInt64BE(0));
  if (wordCount === 2) return buf.readUInt32BE(0);
  return words[0];
}

/**
 * Reconnecting Modbus client (one per device) over three transports:
 *  - TCP      → connectTCP            (networked PLC/meter)
 *  - RTU      → connectRTUBuffered    (native serial / RS-485 COM port)
 *  - RTU_TCP  → connectTcpRTUBuffered (RTU framing over a serial-to-Ethernet gateway)
 *
 * Register reads + per-tag scaling/coercion are transport-independent.
 */
export class ModbusClient {
  private client = new ModbusRTU();
  private connected = false;
  private connecting: Promise<void> | null = null;

  constructor(private readonly opts: ModbusOptions) {}

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Best-effort close of the current client, releasing its serial/TCP handle.
   * Serial (RS-485) ports are exclusive on Windows: if a prior handle is left
   * open, the next connectRTUBuffered fails with "Access denied". So we must
   * close before reopening. Guarded with a timeout since modbus-serial's close
   * may never invoke its callback when the port isn't actually open.
   */
  private async closeQuietly(): Promise<void> {
    const c = this.client as unknown as { isOpen?: boolean; close?: (cb: () => void) => void };
    if (!c?.isOpen) return; // nothing open — avoid a needless delay on first connect
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      try { c.close!(finish); } catch { finish(); }
      setTimeout(finish, 1500);
    });
  }

  /** Connect (idempotent). Concurrent callers share one in-flight attempt. */
  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      await this.closeQuietly(); // release any leaked handle before reopening (prevents "Access denied")
      this.client = new ModbusRTU();
      this.client.setTimeout(this.opts.timeoutMs ?? 3000);
      const transport = this.opts.transport ?? 'TCP';
      const host = this.opts.host ?? '127.0.0.1';
      const port = this.opts.port ?? 502;
      if (transport === 'RTU') {
        await this.client.connectRTUBuffered(this.opts.serialPort ?? 'COM1', {
          baudRate: this.opts.baudRate ?? 9600,
          parity: this.opts.parity ?? 'none',
          dataBits: this.opts.dataBits ?? 8,
          stopBits: this.opts.stopBits ?? 1,
        });
      } else if (transport === 'RTU_TCP') {
        await this.client.connectTcpRTUBuffered(host, { port });
      } else {
        await this.client.connectTCP(host, { port });
      }
      this.client.setID(this.opts.unitId ?? 1);
      this.connected = true;
    })();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    await this.closeQuietly();
  }

  private async readRaw(registerType: RegisterType, address: number, count: number): Promise<number[] | boolean[]> {
    switch (registerType) {
      case 'HOLDING':  return (await this.client.readHoldingRegisters(address, count)).data;
      case 'INPUT':    return (await this.client.readInputRegisters(address, count)).data;
      case 'COIL':     return (await this.client.readCoils(address, count)).data;
      case 'DISCRETE': return (await this.client.readDiscreteInputs(address, count)).data;
      default:         throw new Error(`Unsupported register type: ${registerType}`);
    }
  }

  /**
   * Read one tag → raw + scaled/coerced value with quality. Never throws — a
   * failed read yields `{ raw: null, value: null, quality: 'BAD' }` and flips
   * the connection to disconnected so the poller reconnects.
   */
  async readTag(tag: TagBinding): Promise<ReadResult> {
    const timestamp = new Date();
    try {
      if (!this.connected) await this.connect();
      const isBit = tag.registerType === 'COIL' || tag.registerType === 'DISCRETE';
      const count = isBit ? 1 : Math.max(1, tag.wordCount ?? 1);
      const data = await this.readRaw(tag.registerType, tag.address, count);

      let raw: number | boolean | null;
      if (isBit) {
        raw = Boolean((data as boolean[])[0]);
      } else {
        raw = decodeNumeric(data as number[], tag.dataType, count, tag.wordOrder ?? 'BIG');
      }

      const scaled = applyScaling(raw, { scaleFactor: tag.scaleFactor, offset: tag.offset });
      const value = coerce(scaled, tag.dataType);
      return { raw, value, quality: 'GOOD', timestamp };
    } catch (err) {
      const e = err as { message?: string; modbusCode?: number };
      const message = e?.message ?? String(err);
      // A Modbus EXCEPTION response (illegal data value/address/function) means the
      // link is healthy but that one register is unsupported — fail just this tag and
      // keep the connection. Only a genuine TRANSPORT error (timeout, port/CRC, closed
      // socket) marks us disconnected so the next read triggers a clean reconnect.
      const isProtocolException = e?.modbusCode != null || /modbus exception/i.test(message);
      if (!isProtocolException) this.connected = false;
      return { raw: null, value: null, quality: 'BAD', timestamp, error: message };
    }
  }
}
