import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tiny append-only disk buffer (JSONL) used when a downstream sink is offline.
 * Records are appended on failure and replayed (drained) when connectivity
 * returns, so no counts/history are lost during an outage.
 */
@Injectable()
export class BufferService {
  private readonly logger = new Logger(BufferService.name);
  private readonly dir: string;

  constructor(config: ConfigService) {
    this.dir = config.get<string>('bufferDir') ?? './buffer';
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  private file(kind: string) {
    return join(this.dir, `${kind}.jsonl`);
  }

  enqueue(kind: string, payload: unknown): void {
    try {
      appendFileSync(this.file(kind), JSON.stringify(payload) + '\n');
    } catch (err) {
      this.logger.error(`Buffer write failed for ${kind}`, err as Error);
    }
  }

  size(kind: string): number {
    const f = this.file(kind);
    if (!existsSync(f)) return 0;
    return readFileSync(f, 'utf8').split('\n').filter(Boolean).length;
  }

  /**
   * Replay buffered records. `handler` should return true on success. Records
   * that fail are kept for the next drain; the rest are dropped from the file.
   */
  async drain(kind: string, handler: (payload: unknown) => Promise<boolean>): Promise<number> {
    const f = this.file(kind);
    if (!existsSync(f)) return 0;
    const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean);
    if (!lines.length) return 0;

    const remaining: string[] = [];
    let drained = 0;
    for (const line of lines) {
      let ok = false;
      try {
        ok = await handler(JSON.parse(line));
      } catch {
        ok = false;
      }
      if (ok) drained++;
      else remaining.push(line);
    }
    writeFileSync(f, remaining.length ? remaining.join('\n') + '\n' : '');
    if (drained) this.logger.log(`Drained ${drained} buffered ${kind} record(s)`);
    return drained;
  }
}
