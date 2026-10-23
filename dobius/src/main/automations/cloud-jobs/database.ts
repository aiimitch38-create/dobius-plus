import { backup, DatabaseSync } from 'node:sqlite'
import {
  chmodSync,
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync
} from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import SyncDatabase from '../../sqlite/sync-database'
import { cloudJobAdamOutboxMigrationDDL } from './cloud-job-adam-outbox-schema'

export function openCloudJobsDatabase(file: string): SyncDatabase {
  if (file !== ':memory:') {
    const parent = dirname(file)
    mkdirSync(parent, { recursive: true, mode: 0o700 })
    if (!lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink()) {
      throw new Error('Cloud state directory must be a real directory.')
    }
    try {
      if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) {
        throw new Error('Cloud state database must be a regular file.')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      closeSync(openSync(file, 'wx', 0o600))
    }
    chmodSync(file, 0o600)
  }
  const db = new SyncDatabase(file)
  try {
    db.pragma('busy_timeout = 5000')
    const version = Number(db.pragma('user_version', { simple: true }))
    if (version > 5) {
      throw new Error('Cloud state schema is newer than this application.')
    }
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = FULL')
    db.pragma('foreign_keys = ON')
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(`
      CREATE TABLE IF NOT EXISTS cloud_projects (id TEXT PRIMARY KEY, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cloud_jobs (
        id TEXT PRIMARY KEY, creator TEXT NOT NULL, request_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL, state TEXT NOT NULL, target TEXT NOT NULL,
        created_at INTEGER NOT NULL, document TEXT NOT NULL,
        UNIQUE(creator, request_key)
      );
      CREATE INDEX IF NOT EXISTS cloud_job_dispatch ON cloud_jobs(target, state, created_at);
      CREATE TABLE IF NOT EXISTS cloud_attempts (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES cloud_jobs(id),
        worker TEXT NOT NULL, lease_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
        status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS cloud_job_live_attempt ON cloud_attempts(job_id)
        WHERE status = 'running';
      CREATE UNIQUE INDEX IF NOT EXISTS cloud_worker_live_attempt ON cloud_attempts(worker)
        WHERE status IN ('running', 'stopping', 'interrupted');
      CREATE TABLE IF NOT EXISTS cloud_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES cloud_jobs(id),
        version INTEGER NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL, reason TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cloud_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cloud_capacity_reservations (
        job_id TEXT PRIMARY KEY REFERENCES cloud_jobs(id),
        device_id TEXT NOT NULL,
        bytes INTEGER NOT NULL CHECK(bytes >= 0),
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS cloud_capacity_reservation_device
        ON cloud_capacity_reservations(device_id);
      CREATE TABLE IF NOT EXISTS cloud_external_capacity_revisions (
        device_id TEXT NOT NULL,
        filesystem_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision >= 0 AND revision <= 9007199254740991),
        PRIMARY KEY(device_id, filesystem_id)
      );
      CREATE TABLE IF NOT EXISTS cloud_external_capacity_reservations (
        producer_id TEXT NOT NULL,
        reservation_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        filesystem_id TEXT NOT NULL,
        bytes INTEGER NOT NULL CHECK(bytes >= 0 AND bytes <= 9007199254740991),
        created_at INTEGER NOT NULL CHECK(created_at >= 0 AND created_at <= 9007199254740991),
        created_revision INTEGER NOT NULL CHECK(created_revision > 0 AND created_revision <= 9007199254740991),
        released_at INTEGER CHECK(released_at IS NULL OR (released_at >= 0 AND released_at <= 9007199254740991)),
        released_revision INTEGER CHECK(released_revision IS NULL OR (released_revision > 0 AND released_revision <= 9007199254740991)),
        PRIMARY KEY(producer_id, reservation_id),
        CHECK((released_at IS NULL) = (released_revision IS NULL))
      );
      CREATE INDEX IF NOT EXISTS cloud_external_capacity_active_scope
        ON cloud_external_capacity_reservations(device_id, filesystem_id, released_revision);
      CREATE TABLE IF NOT EXISTS cloud_worker_permits (
        attempt_id TEXT PRIMARY KEY REFERENCES cloud_attempts(id),
        permit_id TEXT NOT NULL UNIQUE,
        worker TEXT NOT NULL,
        device_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        binding_json TEXT NOT NULL,
        binding_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS cloud_worker_starts (
        attempt_id TEXT PRIMARY KEY REFERENCES cloud_worker_permits(attempt_id),
        permit_id TEXT NOT NULL UNIQUE,
        worker TEXT NOT NULL,
        device_id TEXT NOT NULL,
        pid INTEGER NOT NULL,
        process_start TEXT NOT NULL,
        process_group_id INTEGER NOT NULL,
        boot_id TEXT NOT NULL,
        incarnation TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        heartbeat_output_bytes INTEGER NOT NULL DEFAULT 0,
        heartbeat_log_cursor INTEGER NOT NULL DEFAULT 0,
        heartbeat_at INTEGER,
        stop_proof_hash TEXT,
        stop_proof_json TEXT,
        settle_receipt_hash TEXT
      );
      INSERT OR IGNORE INTO cloud_settings VALUES ('dispatch_enabled', 'false');
      `)
      if (version === 1) {
        const active = db
          .prepare(
            `SELECT j.id, j.document FROM cloud_jobs j JOIN cloud_attempts a ON a.job_id=j.id
             WHERE a.status IN ('running', 'stopping', 'interrupted')`
          )
          .all()
        const reserve = db.prepare(
          'INSERT OR IGNORE INTO cloud_capacity_reservations(job_id, device_id, bytes, created_at) VALUES (?, ?, ?, ?)'
        )
        for (const row of active) {
          const job = JSON.parse(String(row.document)) as {
            targetDeviceId?: unknown
            estimatedBytes?: unknown
            createdAt?: unknown
          }
          if (
            typeof job.targetDeviceId !== 'string' ||
            !Number.isSafeInteger(job.estimatedBytes) ||
            Number(job.estimatedBytes) < 0 ||
            !Number.isSafeInteger(job.createdAt)
          ) {
            throw new Error('Cannot migrate active cloud job capacity reservation safely.')
          }
          reserve.run(
            String(row.id),
            job.targetDeviceId,
            Number(job.estimatedBytes),
            Number(job.createdAt)
          )
        }
      }
      // v3 adds durable, fail-closed worker permits and process receipts without
      // rewriting legacy attempts; old active attempts have no trusted start proof.
      db.exec(cloudJobAdamOutboxMigrationDDL())
      db.pragma('user_version = 5')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    if (file !== ':memory:') {
      chmodSync(file, 0o600)
    }
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export function cloudTransaction<T>(db: SyncDatabase, action: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = action()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function exportCloudJobsDatabase(
  sourceFile: string,
  destination: string
): Promise<number> {
  if (
    sourceFile === ':memory:' ||
    !isAbsolute(destination) ||
    resolve(sourceFile) === resolve(destination)
  ) {
    throw new Error('Cloud database export requires a distinct absolute file destination.')
  }
  const target = resolve(destination)
  const parent = dirname(target)
  if (
    lstatSync(parent).isSymbolicLink() ||
    !statSync(parent).isDirectory() ||
    realpathSync(parent) !== parent
  ) {
    throw new Error('Cloud database export directory must be a real directory.')
  }
  try {
    lstatSync(target)
    throw new Error('Cloud database export destination already exists.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  const temporary = `${target}.${randomUUID()}.tmp`
  const source = new DatabaseSync(sourceFile, { readOnly: true, timeout: 5_000 })
  try {
    const pages = await backup(source, temporary)
    chmodSync(temporary, 0o600)
    const backupFd = openSync(temporary, 'r+')
    try {
      fsyncSync(backupFd)
    } finally {
      closeSync(backupFd)
    }
    const check = new DatabaseSync(temporary, { readOnly: true })
    try {
      if (check.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') {
        throw new Error('Cloud database export failed SQLite integrity validation.')
      }
    } finally {
      check.close()
    }
    // Why: link is atomic and refuses to replace an export created concurrently.
    linkSync(temporary, target)
    unlinkSync(temporary)
    return pages
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  } finally {
    source.close()
  }
}
