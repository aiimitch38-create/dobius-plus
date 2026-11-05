import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './migrations.js'

export type AdamDatabase = DatabaseSync

export function openDatabase(path: string): AdamDatabase {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
  }
  migrate(db)
  return db
}

function migrate(db: AdamDatabase): void {
  const current = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) {
      continue
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(migration.sql)
      db.exec(`PRAGMA user_version = ${migration.version}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

export function databaseIntegrity(db: AdamDatabase): string {
  const result = db.prepare('PRAGMA integrity_check').get()
  return String(result?.integrity_check ?? 'unknown')
}
