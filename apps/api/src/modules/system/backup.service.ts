import {
  Injectable, Logger, BadRequestException, NotFoundException,
  InternalServerErrorException, UnauthorizedException,
} from '@nestjs/common';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as bcrypt from 'bcryptjs';

import { PrismaService } from '../../database/prisma.service';

/**
 * Database backup and restore — the Odoo.sh model, run from inside the app.
 *
 * ── Where backups live ──────────────────────────────────────────────────────
 * On a NAMED docker volume mounted at /app/backups, not in the image and not in
 * the container's writable layer. A backup that vanishes on the next `docker
 * compose up --build` is not a backup, and that is exactly what a bind to the
 * container filesystem would give.
 *
 * ── Why the metadata sits beside the file, not in the database ──────────────
 * Each archive carries a small JSON sidecar. Keeping the catalogue in a table
 * would be tidier right up to the first restore: restoring a week-old dump would
 * roll the catalogue back with it, and every backup taken since would vanish from
 * the list while still sitting on disk. The sidecar survives its own restore.
 *
 * ── Format ──────────────────────────────────────────────────────────────────
 * `pg_dump -Fc` (custom). It is compressed, and it restores selectively with
 * pg_restore — a plain SQL file offers neither. The client major version is
 * pinned to the server's in the image; a mismatch fails loudly rather than
 * producing an archive nobody can read back.
 *
 * ── Restore is the dangerous one ────────────────────────────────────────────
 * It drops and recreates every object. Two protections that are not negotiable:
 * the caller re-enters their password and types a confirmation phrase, and a
 * SAFETY BACKUP of the current state is taken first and kept. Restoring the
 * wrong archive is otherwise unrecoverable, and the moment somebody needs that
 * safety copy is the moment they cannot make one.
 */

const BACKUP_DIR = process.env.BACKUP_DIR || '/app/backups';
const CONFIRM_PHRASE = 'RESTORE';

/** Long enough for a large plant database, short enough to surface a hang. */
const DUMP_TIMEOUT_MS = 30 * 60_000;

export interface BackupMeta {
  id: string;
  filename: string;
  label: string;
  createdAt: string;
  sizeBytes: number;
  database: string;
  createdBy: string;
  /** SAFETY backups are taken automatically before a restore. */
  kind: 'MANUAL' | 'SAFETY';
  appVersion?: string;
}

interface ActingUser {
  id: string;
  email: string;
  factoryId: string | null;
  passwordHash: string;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  /** One backup or restore at a time, process-wide. */
  private running: 'backup' | 'restore' | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // ── Connection details ────────────────────────────────────────────────────

  /**
   * Parse DATABASE_URL once, here, so the dump always targets exactly the
   * database the app is talking to. Reading host/user from separate env vars is
   * how a backup ends up being taken from the wrong server.
   */
  private conn() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new InternalServerErrorException('DATABASE_URL is not set');
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new InternalServerErrorException('DATABASE_URL is malformed');
    }
    return {
      host: u.hostname,
      port: u.port || '5432',
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, '').split('?')[0],
    };
  }

  private async ensureDir() {
    await mkdir(BACKUP_DIR, { recursive: true });
  }

  private metaPath(id: string) {
    return join(BACKUP_DIR, `${id}.json`);
  }

  private dumpPath(id: string) {
    return join(BACKUP_DIR, `${id}.dump`);
  }

  /**
   * Ids are generated here and never taken from the caller — they end up in a
   * filesystem path, and a caller-supplied "../../etc/passwd" would otherwise
   * be a path traversal straight out of the backup directory.
   */
  private newId(kind: BackupMeta['kind']) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${kind.toLowerCase()}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Reject anything that is not one of our own generated ids. */
  private assertSafeId(id: string) {
    if (!/^[a-z]+-[\dTZ.:-]+-[a-z0-9]{6}$/i.test(id)) {
      throw new BadRequestException('Invalid backup id');
    }
  }

  // ── Listing ───────────────────────────────────────────────────────────────

  async list(): Promise<BackupMeta[]> {
    await this.ensureDir();
    const files = await readdir(BACKUP_DIR).catch(() => [] as string[]);
    const out: BackupMeta[] = [];

    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const meta = JSON.parse(await readFile(join(BACKUP_DIR, f), 'utf8')) as BackupMeta;
        // A sidecar whose archive has gone is not a restorable backup. Report it
        // rather than hiding it — a silently missing file is how people discover
        // at the worst moment that they have nothing to restore.
        const archive = this.dumpPath(meta.id);
        if (!existsSync(archive)) {
          out.push({ ...meta, sizeBytes: 0, label: `${meta.label} (archive missing)` });
          continue;
        }
        const s = await stat(archive);
        out.push({ ...meta, sizeBytes: s.size });
      } catch {
        // A corrupt sidecar must not take the whole listing down.
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<BackupMeta> {
    this.assertSafeId(id);
    const raw = await readFile(this.metaPath(id), 'utf8').catch(() => null);
    if (!raw) throw new NotFoundException('Backup not found');
    const meta = JSON.parse(raw) as BackupMeta;
    const s = await stat(this.dumpPath(id)).catch(() => null);
    return { ...meta, sizeBytes: s?.size ?? 0 };
  }

  // ── Creating ──────────────────────────────────────────────────────────────

  async create(user: ActingUser, label?: string, kind: BackupMeta['kind'] = 'MANUAL'): Promise<BackupMeta> {
    if (this.running) {
      throw new BadRequestException(`A ${this.running} is already running. Wait for it to finish.`);
    }
    this.running = 'backup';
    try {
      await this.ensureDir();
      const c = this.conn();
      const id = this.newId(kind);
      const file = this.dumpPath(id);

      const started = Date.now();
      await this.run('pg_dump', [
        '-h', c.host, '-p', c.port, '-U', c.user, '-d', c.database,
        '-Fc',            // custom format: compressed and selectively restorable
        '--no-owner',     // restore into whatever role the target uses
        '--no-privileges',
        '-f', file,
      ], c.password);

      const s = await stat(file);
      const meta: BackupMeta = {
        id,
        filename: `${id}.dump`,
        label: label?.trim() || (kind === 'SAFETY' ? 'Automatic pre-restore safety copy' : 'Manual backup'),
        createdAt: new Date().toISOString(),
        sizeBytes: s.size,
        database: c.database,
        createdBy: user.email,
        kind,
        appVersion: process.env.APP_VERSION,
      };
      await writeFile(this.metaPath(id), JSON.stringify(meta, null, 2), 'utf8');

      await this.audit(user, 'BACKUP_CREATE', id, {
        label: meta.label, sizeBytes: meta.sizeBytes, kind, ms: Date.now() - started,
      });
      this.logger.log(`backup ${id} created by ${user.email} — ${(s.size / 1e6).toFixed(1)} MB in ${Date.now() - started}ms`);
      return meta;
    } finally {
      this.running = null;
    }
  }

  // ── Restoring ─────────────────────────────────────────────────────────────

  async restore(
    user: ActingUser,
    id: string,
    dto: { password: string; confirmation: string },
  ) {
    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) throw new UnauthorizedException('Password is incorrect');
    if ((dto.confirmation ?? '').trim() !== CONFIRM_PHRASE) {
      throw new BadRequestException(`Confirmation phrase must be exactly "${CONFIRM_PHRASE}"`);
    }

    const meta = await this.get(id);
    if (!existsSync(this.dumpPath(id))) {
      throw new BadRequestException('The archive for this backup is missing — nothing to restore');
    }
    if (this.running) {
      throw new BadRequestException(`A ${this.running} is already running. Wait for it to finish.`);
    }

    // Safety copy FIRST, and outside the running lock so it can take its own.
    const safety = await this.create(user, `Before restoring "${meta.label}"`, 'SAFETY');

    this.running = 'restore';
    try {
      const c = this.conn();
      const started = Date.now();

      // --clean --if-exists drops each object before recreating it, so restoring
      // onto a populated database is a replacement rather than a merge.
      // Exit code 1 from pg_restore means "completed with warnings" — routine for
      // extensions and roles that already exist — so it is not treated as failure.
      await this.run('pg_restore', [
        '-h', c.host, '-p', c.port, '-U', c.user, '-d', c.database,
        '--clean', '--if-exists', '--no-owner', '--no-privileges',
        '--single-transaction',
        this.dumpPath(id),
      ], c.password, { allowExitCode1: true });

      await this.audit(user, 'BACKUP_RESTORE', id, {
        label: meta.label, safetyBackupId: safety.id, ms: Date.now() - started,
      });
      this.logger.warn(
        `DATABASE RESTORED from ${id} ("${meta.label}") by ${user.email} — safety copy ${safety.id}`,
      );

      return {
        restored: meta,
        safetyBackupId: safety.id,
        // Said plainly because it is the first question anyone asks afterwards.
        note: 'Everyone signed in should reload. Cached pages may still show pre-restore data.',
      };
    } finally {
      this.running = null;
    }
  }

  // ── Deleting & downloading ────────────────────────────────────────────────

  async remove(user: ActingUser, id: string) {
    const meta = await this.get(id);
    await unlink(this.dumpPath(id)).catch(() => undefined);
    await unlink(this.metaPath(id)).catch(() => undefined);
    await this.audit(user, 'BACKUP_DELETE', id, { label: meta.label });
    this.logger.warn(`backup ${id} deleted by ${user.email}`);
  }

  async streamFor(id: string) {
    const meta = await this.get(id);
    const path = this.dumpPath(id);
    if (!existsSync(path)) throw new NotFoundException('Archive not found');
    return { stream: createReadStream(path), meta };
  }

  // ── Process plumbing ──────────────────────────────────────────────────────

  /**
   * Run a Postgres client tool.
   *
   * The password goes through PGPASSWORD in the child's environment, never on
   * the command line where it would be visible to anything that can read the
   * process list.
   */
  private run(
    cmd: string,
    args: string[],
    password: string,
    opts: { allowExitCode1?: boolean } = {},
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        env: { ...process.env, PGPASSWORD: password },
      });

      let stderr = '';
      child.stderr.on('data', (d) => { stderr += String(d).slice(0, 4000); });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new InternalServerErrorException(`${cmd} timed out after ${DUMP_TIMEOUT_MS / 60_000} minutes`));
      }, DUMP_TIMEOUT_MS);

      child.on('error', (err) => {
        clearTimeout(timer);
        // The commonest cause by far, and the least obvious from the raw error.
        const hint = (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? ` — ${cmd} is not installed in this container. The API image must include postgresql16-client.`
          : '';
        reject(new InternalServerErrorException(`${cmd} could not start: ${err.message}${hint}`));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 || (opts.allowExitCode1 && code === 1)) {
          if (code === 1) this.logger.warn(`${cmd} finished with warnings: ${stderr.slice(0, 500)}`);
          resolve();
          return;
        }
        reject(new InternalServerErrorException(`${cmd} failed (exit ${code}): ${stderr.slice(0, 800)}`));
      });
    });
  }

  /** Best-effort audit — never blocks or fails the operation it records. */
  private async audit(user: ActingUser, action: string, entityId: string, metadata: unknown) {
    try {
      await this.prisma.auditLog.create({
        data: {
          factoryId: user.factoryId ?? null,
          userId: user.id,
          action,
          module: 'system',
          entityType: 'DatabaseBackup',
          entityId,
          metadata: metadata as never,
        },
      });
    } catch (err) {
      this.logger.error(`failed to write ${action} audit log`, err as never);
    }
  }
}
