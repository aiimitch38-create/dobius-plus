import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { CloudJob } from '../../shared/cloud-jobs'
import type SyncDatabase from '../sqlite/sync-database'
import { cloudTransaction } from './cloud-jobs/database'

const Count = z.number().int().nonnegative().safe()
const Cursor = z
  .object({
    principal: z.string().max(256),
    generation: z.string().uuid(),
    upperRowId: Count,
    beforeRowId: Count,
    eventCursor: Count,
    expiresAt: Count
  })
  .strict()
export type JobSnapshotCursor = z.infer<typeof Cursor>

/** Opaque cursors keep denied rows and principal identities out of client responses. */
export class JobSnapshotCursors {
  private readonly key = randomBytes(32)
  encode(cursor: JobSnapshotCursor): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const body = Buffer.concat([
      cipher.update(JSON.stringify(Cursor.parse(cursor))),
      cipher.final()
    ])
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
  }
  decode(token: string): JobSnapshotCursor {
    if (!/^[A-Za-z0-9_-]{1,1024}$/.test(token)) {
      throw new Error('Invalid job snapshot cursor; refresh the snapshot.')
    }
    try {
      const bytes = Buffer.from(token, 'base64url')
      const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(12, 28))
      const body = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()])
      return Cursor.parse(JSON.parse(body.toString('utf8')))
    } catch {
      throw new Error('Invalid job snapshot cursor; refresh the snapshot.')
    }
  }
}

export function latestJobEventSequence(db: SyncDatabase): number {
  return Count.parse(
    Number(
      db.prepare('SELECT COALESCE(MAX(sequence),0) AS sequence FROM cloud_events').get()?.sequence
    )
  )
}

export function readJobSnapshotPage(db: SyncDatabase, limit: number, cursor?: JobSnapshotCursor) {
  return cloudTransaction(db, () => {
    const upperRowId =
      cursor?.upperRowId ??
      Count.parse(
        Number(db.prepare('SELECT COALESCE(MAX(rowid),0) AS row_id FROM cloud_jobs').get()?.row_id)
      )
    const eventCursor = cursor?.eventCursor ?? latestJobEventSequence(db)
    const rows = db
      .prepare(
        'SELECT rowid AS row_id,document FROM cloud_jobs WHERE rowid<=? AND (? IS NULL OR rowid<?) ORDER BY rowid DESC LIMIT ?'
      )
      .all(upperRowId, cursor?.beforeRowId ?? null, cursor?.beforeRowId ?? null, limit + 1)
    const page = rows.slice(0, limit)
    return {
      upperRowId,
      eventCursor,
      jobs: page.map((row) => CloudJob.parse(JSON.parse(String(row.document)))),
      beforeRowId: rows.length > limit ? Count.parse(Number(page.at(-1)?.row_id)) : null
    }
  })
}
