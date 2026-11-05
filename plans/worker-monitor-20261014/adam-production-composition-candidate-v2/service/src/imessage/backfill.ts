import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { openDatabase, databaseIntegrity } from '../db/database.js'
import { IMessageIngester } from './ingester.js'
import { ChatDatabaseSource } from './source.js'

const projectRoot = resolve(import.meta.dirname, '../../..')
const chatDb = process.env.ADAM_IMESSAGE_DB || join(homedir(), 'Library', 'Messages', 'chat.db')
const adamDb = process.env.ADAM_DATA_DIR
  ? join(process.env.ADAM_DATA_DIR, 'adam.sqlite')
  : join(projectRoot, 'service', 'data', 'adam.sqlite')
const identifiers = (process.env.ADAM_IMESSAGE_AUTHORIZED_CHATS || '+17344784716,cmitch08204@gmail.com')
  .split(',').map((value) => value.trim()).filter(Boolean)

const db = openDatabase(adamDb)
const source = new ChatDatabaseSource(chatDb, identifiers)
try {
  const ingester = new IMessageIngester(db, source)
  if (process.argv.includes('--reconcile-all')) {
    db.prepare("UPDATE imessage_ingestion_cursors SET last_rowid=0, state='reconciling', updated_at=? WHERE source_id='carson-adam-thread'")
      .run(new Date().toISOString())
  }
  const before = ingester.cursor()
  const sourceMax = source.maxAuthorizedRowid()
  const result = ingester.backfill()
  const count = Number(db.prepare('SELECT COUNT(*) AS count FROM imessage_messages').get()?.count ?? 0)
  process.stdout.write(`${JSON.stringify({ ok: result.complete, before, sourceMax, ledgerCount: count, integrity: databaseIntegrity(db), ...result }, null, 2)}\n`)
  if (!result.complete) process.exitCode = 2
} finally {
  source.close()
  db.close()
}
