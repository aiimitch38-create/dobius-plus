import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import type * as NodeFs from 'node:fs'
import { HistoryManager } from './history-manager'
import { HistoryReader } from './history-reader'
import { getHistorySessionDirName } from './history-paths'

// Why: simulate a crash mid-write of meta.json. The mocked writeFileSync puts
// half the bytes on disk and then throws, which is what a killed process or a
// full disk leaves behind for an in-place write.
const { tornWrites, metaReads } = vi.hoisted(() => ({
  tornWrites: { enabled: false },
  // Rewrites meta.json text on its Nth read, to model the daemon reopening a
  // session between the retention scan and the delete.
  metaReads: { count: 0, reopenOnRead: 0 }
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  return {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      const text = actual.readFileSync(...args)
      if (metaReads.reopenOnRead > 0 && String(args[0]).endsWith('meta.json')) {
        metaReads.count++
        if (metaReads.count === metaReads.reopenOnRead) {
          return JSON.stringify({ ...JSON.parse(String(text)), endedAt: null })
        }
      }
      return text
    },
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      const [target, data] = args
      if (tornWrites.enabled && String(target).includes('meta.json')) {
        const text = String(data)
        actual.writeFileSync(target, text.slice(0, Math.floor(text.length / 2)))
        throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
      }
      return actual.writeFileSync(...args)
    }
  }
})

describe('HistoryManager meta.json integrity', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'history-meta-atomic-'))
    tornWrites.enabled = false
  })

  afterEach(() => {
    tornWrites.enabled = false
    metaReads.count = 0
    metaReads.reopenOnRead = 0
    rmSync(dir, { recursive: true, force: true })
  })

  it('an interrupted endedAt update keeps the terminal identity and restore eligibility', async () => {
    const errors: string[] = []
    const mgr = new HistoryManager(dir, { onWriteError: (id) => errors.push(id) })
    await mgr.openSession('sess-1', { cwd: '/home/carson/project', cols: 132, rows: 40 })

    tornWrites.enabled = true
    await mgr.closeSession('sess-1', 0)
    tornWrites.enabled = false

    expect(errors).toEqual(['sess-1'])
    const meta = mgr.readMeta('sess-1')
    expect(meta).toMatchObject({ cwd: '/home/carson/project', cols: 132, rows: 40, endedAt: null })
    // The session never recorded a clean end, so it stays restorable.
    expect(new HistoryReader(dir).hasRestorableHistory('sess-1')).toBe(true)
    // No temp file is left behind next to meta.json.
    expect(readdirSync(join(dir, getHistorySessionDirName('sess-1')))).toEqual(['meta.json'])
  })

  it('an interrupted dispose keeps the previous meta.json intact', async () => {
    const mgr = new HistoryManager(dir)
    await mgr.openSession('sess-2', { cwd: '/srv/app', cols: 80, rows: 24 })

    tornWrites.enabled = true
    await mgr.dispose()
    tornWrites.enabled = false

    expect(mgr.readMeta('sess-2')).toMatchObject({ cwd: '/srv/app', endedAt: null })
  })

  it('retention skips a session reopened between the scan and the delete', async () => {
    const mgr = new HistoryManager(dir)
    await mgr.openSession('reopened', { cwd: '/tmp', cols: 80, rows: 24 })
    await mgr.closeSession('reopened', 0)
    const later = Date.now() + 60 * 60 * 1000

    // Read 1 is the scan (ended), read 2 is the pre-delete re-check (reopened).
    metaReads.reopenOnRead = 2
    expect(new HistoryManager(dir).sweepEndedSessions(0, later).removedSessions).toBe(0)
    expect(mgr.hasHistory('reopened')).toBe(true)
  })
})
