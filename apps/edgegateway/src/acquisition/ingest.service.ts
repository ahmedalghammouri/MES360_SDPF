import { Injectable, Logger } from '@nestjs/common';
import type { Quality } from '@mes360/industrial-drivers';

import { PrismaService } from '../prisma/prisma.service';
import { InfluxService, Point } from '../services/influx.service';
import { MqttService } from '../services/mqtt.service';
import { BufferService } from './buffer.service';

export interface TagReadingRecord {
  tagId: string;
  factoryId: string;
  code: string;
  machineId: string | null;
  machineCode: string | null;
  deviceId: string | null;
  value: string;
  numeric: number | null;
  quality: Quality;
  timestamp: string; // ISO
  /** Per-tag historian flag — when false the reading is NOT written to InfluxDB. */
  historize?: boolean;
  /** Emit strategy for the live MQTT stream + Postgres current-value. */
  mqttPublishMode?: string; // CHANGE | RATE
  mqttPublishRateSec?: number;
  /** Emit strategy for the InfluxDB historian. */
  historizationMode?: string; // CHANGE | RATE
  historizationRateSec?: number;
  /** Min absolute change for CHANGE mode (null/0 = any change). */
  deadband?: number | null;
}

interface EmitState {
  value: number | string | null;
  ts: number; // ms of last emit
}

/**
 * Fans one tag reading out to all sinks: Postgres current-value, InfluxDB
 * history, and MQTT. Each sink is independent and buffered to disk on failure.
 *
 * Emission is gated per tag so we don't flood the broker/TSDB with unchanged
 * values: CHANGE mode emits only when the value moves by at least the tag's
 * deadband; RATE mode emits at most once per configured window. The MQTT/live
 * stream and the historian are gated independently. Counting is unaffected —
 * edge detection runs in the poller on every poll regardless of this gate.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);
  private readonly lastPublish = new Map<string, EmitState>();
  private readonly lastHistorize = new Map<string, EmitState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly influx: InfluxService,
    private readonly mqtt: MqttService,
    private readonly buffer: BufferService,
  ) {}

  async ingest(rec: TagReadingRecord): Promise<void> {
    const now = Date.parse(rec.timestamp) || Date.now();
    // The live/current sinks (MQTT + Postgres current-value) share one decision.
    if (this.shouldEmit(this.lastPublish, rec, rec.mqttPublishMode, rec.mqttPublishRateSec, now)) {
      await this.writeCurrentValue(rec).catch(() => this.buffer.enqueue('pg-tagvalue', rec));
      if (!this.publishTag(rec)) this.buffer.enqueue('mqtt', rec);
    }
    // The historian is gated independently.
    if (rec.historize !== false && this.shouldEmit(this.lastHistorize, rec, rec.historizationMode, rec.historizationRateSec, now)) {
      if (!(await this.writeInflux(rec))) this.buffer.enqueue('influx', rec);
    }
  }

  /**
   * Decide whether to emit this reading, updating the per-tag state on a yes.
   *  - RATE:   emit when the window since the last emit has elapsed (0 = always).
   *  - CHANGE: emit when the value differs from the last emitted value by at
   *            least `deadband` (numeric) or is different (non-numeric). The
   *            first reading for a tag always emits.
   */
  private shouldEmit(store: Map<string, EmitState>, rec: TagReadingRecord, mode: string | undefined, rateSec: number | undefined, now: number): boolean {
    const key = rec.tagId;
    const prev = store.get(key);
    const curr = rec.numeric ?? rec.value ?? null;

    let emit: boolean;
    if ((mode ?? 'CHANGE') === 'RATE') {
      const windowMs = Math.max(0, (rateSec ?? 0)) * 1000;
      emit = !prev || now - prev.ts >= windowMs;
    } else {
      const deadband = Math.max(0, rec.deadband ?? 0);
      if (!prev) emit = true;
      else if (typeof curr === 'number' && typeof prev.value === 'number') {
        // deadband 0 = emit on any actual change (strict !=); a positive deadband
        // requires the value to move by at least that much. (>= 0 would be always-true.)
        emit = deadband > 0 ? Math.abs(curr - prev.value) >= deadband : curr !== prev.value;
      } else {
        emit = curr !== prev.value;
      }
    }
    if (emit) store.set(key, { value: curr, ts: now });
    return emit;
  }

  /**
   * The live value of a tag, plus the last moment it was known to be ACTIVE.
   *
   * Those are two different facts and they used to be one column. `timestamp`
   * says when the value was last WRITTEN; starvation detection needs to know when
   * the signal was last ON. Under CHANGE publishing a write only happens on a
   * change, so the two agreed and the confusion went unnoticed — until a gateway
   * restart, where the first reading of every tag is written unconditionally and
   * a signal that had been dead for an hour was stamped "now".
   *
   * `lastActiveAt` moves on exactly two occasions: while the signal reads active,
   * and on the edge where it stops being active — that edge is the instant
   * idleness begins. On any other write it is left alone, which is what makes an
   * hour of stillness survive a restart.
   */
  private async writeCurrentValue(rec: TagReadingRecord): Promise<void> {
    const at = new Date(rec.timestamp);
    const active = (rec.numeric ?? 0) >= 1;

    // Read before write so the falling edge can be recognised. This path is
    // change-gated, so it runs on transitions rather than on every poll.
    const prev = await this.prisma.tagCurrentValue
      .findUnique({ where: { tagId: rec.tagId }, select: { value: true, lastActiveAt: true } })
      .catch(() => null);
    const wasActive = prev ? Number(prev.value) >= 1 || prev.value === 'true' : false;

    // Active now, or active until this very reading. Anything else keeps what is
    // already recorded — including the "no change, just restarted" write that
    // caused this.
    const lastActiveAt = active || wasActive ? at : (prev?.lastActiveAt ?? null);

    await this.prisma.tagCurrentValue.upsert({
      where: { tagId: rec.tagId },
      create: {
        tagId: rec.tagId,
        factoryId: rec.factoryId,
        value: rec.value,
        quality: rec.quality as any,
        timestamp: at,
        lastActiveAt,
      },
      update: {
        value: rec.value,
        quality: rec.quality as any,
        timestamp: at,
        lastActiveAt,
      },
    });
  }

  private async writeInflux(rec: TagReadingRecord): Promise<boolean> {
    if (rec.historize === false) return true; // historian disabled for this tag → skip TSDB
    if (!this.influx.isEnabled()) return true; // nothing to buffer when disabled
    const point = new Point('tag')
      .tag('factoryId', rec.factoryId)
      .tag('tagCode', rec.code)
      .tag('quality', rec.quality)
      .timestamp(new Date(rec.timestamp));
    if (rec.machineId) point.tag('machineId', rec.machineId);
    if (rec.deviceId) point.tag('deviceId', rec.deviceId);
    if (rec.numeric !== null) point.floatField('value', rec.numeric);
    else point.stringField('valueStr', rec.value);
    return this.influx.write(point);
  }

  private publishTag(rec: TagReadingRecord): boolean {
    const machineKey = rec.machineCode ?? rec.machineId ?? 'unassigned';
    const topic = `mes360/${rec.factoryId}/${machineKey}/${rec.code}`;
    // QoS 0 for live telemetry: it's ephemeral (the next poll supersedes it), so
    // there's no value in the broker holding un-ACKed copies — which is what let
    // the client's in-flight store balloon. Count/energy events keep QoS 1.
    return this.mqtt.publish(topic, {
      tagId: rec.tagId,
      value: rec.numeric ?? rec.value,
      quality: rec.quality,
      ts: rec.timestamp,
    }, 0);
  }

  /** Replay any buffered records; called on a timer by the poller. */
  async drainBuffers(): Promise<void> {
    await this.buffer.drain('pg-tagvalue', async (p) => {
      try { await this.writeCurrentValue(p as TagReadingRecord); return true; } catch { return false; }
    });
    await this.buffer.drain('influx', (p) => this.writeInflux(p as TagReadingRecord));
    await this.buffer.drain('mqtt', async (p) => this.publishTag(p as TagReadingRecord));
  }
}
