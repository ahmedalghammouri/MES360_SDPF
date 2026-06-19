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
}

/**
 * Fans one tag reading out to all sinks: Postgres current-value, InfluxDB
 * history, and MQTT. Each sink is independent and buffered to disk on failure.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly influx: InfluxService,
    private readonly mqtt: MqttService,
    private readonly buffer: BufferService,
  ) {}

  async ingest(rec: TagReadingRecord): Promise<void> {
    await this.writeCurrentValue(rec).catch(() => this.buffer.enqueue('pg-tagvalue', rec));
    if (!(await this.writeInflux(rec))) this.buffer.enqueue('influx', rec);
    if (!this.publishTag(rec)) this.buffer.enqueue('mqtt', rec);
  }

  private async writeCurrentValue(rec: TagReadingRecord): Promise<void> {
    await this.prisma.tagCurrentValue.upsert({
      where: { tagId: rec.tagId },
      create: {
        tagId: rec.tagId,
        factoryId: rec.factoryId,
        value: rec.value,
        quality: rec.quality as any,
        timestamp: new Date(rec.timestamp),
      },
      update: {
        value: rec.value,
        quality: rec.quality as any,
        timestamp: new Date(rec.timestamp),
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
    return this.mqtt.publish(topic, {
      tagId: rec.tagId,
      value: rec.numeric ?? rec.value,
      quality: rec.quality,
      ts: rec.timestamp,
    });
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
