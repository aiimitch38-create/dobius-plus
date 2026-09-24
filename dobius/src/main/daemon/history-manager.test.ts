import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  chmodSync,
  mkdirSync,
  writeFileSync
} from 'node:fs'
import { HistoryManager } from './history-manager'
import { readHistoryRetentionQuotaBytes } from './history-retention'
import type { TerminalSnapshot, TerminalModes } from './types'
import { getHistorySessionDirName } from './history-paths'

function createTestDir(): string {
  return mkdtempSync(join(tmpdir(), 'history-mgr-test-'))
}

function sessionPath(baseDir: string, sessionId: string, file: string): string {
  return join(baseDir, getHistorySessionDirName(sessionId), file)
}

const defaultModes: TerminalModes = {
  bracketedPaste: false,
  mouseTracking: false,
  applicationCursor: false,
  alternateScreen: false
}

function makeSnapshot(overrides: Partial<TerminalSnapshot> = {}): TerminalSnapshot {
  return {
    snapshotAnsi: 'hello world\r\n',
    scrollbackAnsi: '',
    rehydrateSequences: '',
    cwd: '/tmp',
    modes: defaultModes,
    cols: 80,
    rows: 24,
    scrollbackLines: 0,
    ...overrides
  }
}

describe('HistoryManager', () => {
  let dir: string
  let mgr: HistoryManager

  beforeEach(() => {
    dir = createTestDir()
    mgr = new HistoryManager(dir)
  })

  afterEach(async () => {
    await mgr.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('openSession', () => {
    it('creates meta.json with session metadata', async () => {
      await mgr.openSession('sess-1', { cwd: '/home/user', cols: 80, rows: 24 })

      const metaPath = sessionPath(dir, 'sess-1', 'meta.json')
      expect(existsSync(metaPath)).toBe(true)

      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      expect(meta.cwd).toBe('/home/user')
      expect(meta.cols).toBe(80)
      expect(meta.rows).toBe(24)
      expect(meta.startedAt).toBeDefined()
      expect(meta.endedAt).toBeNull()
      expect(meta.exitCode).toBeNull()
    })

    it('creates session directory', async () => {
      await mgr.openSession('sess-1', { cwd: '/tmp', cols: 120, rows: 40 })

      const sessionDir = join(dir, getHistorySessionDirName('sess-1'))
      expect(existsSync(sessionDir)).toBe(true)
    })
  })

  describe('checkpoint', () => {
    it('writes checkpoint.json with snapshot data', async () => {
      await mgr.openSession('sess-1', { cwd: '/tmp', cols: 80, rows: 24 })

      const snapshot = makeSnapshot({ snapshotAnsi: 'terminal content\r\n' })
      await mgr.checkpoint('sess-1', snapshot)

      const cpPath = sessionPath(dir, 'sess-1', 'checkpoint.json')
      expect(existsSync(cpPath)).toBe(true)

      const data = JSON.parse(readFileSync(cpPath, 'utf-8'))
      expect(data.snapshotAnsi).toBe('terminal content\r\n')
      expect(data.cols).toBe(80)
      expect(data.rows).toBe(24)
      expect(data.checkpointedAt).toBeDefined()
    })

    it('overwrites previous checkpoint atomically', async () => {
      await mgr.openSession('sess-1', { cwd: '/tmp', cols: 80, rows: 24 })

      await mgr.checkpoint('sess-1', makeSnapshot({ snapshotAnsi: 'first' }))
      await mgr.checkpoint('sess-1', makeSnapshot({ snapshotAnsi: 'second' }))

      const data = JSON.parse(readFileSync(sessionPath(dir, 'sess-1', 'checkpoint.json'), 'utf-8'))
      expect(data.snapshotAnsi).toBe('second')
    })

    it('preserves terminal modes in checkpoint', async () => {
      await mgr.openSession('sess-1', { cwd: '/tmp', cols: 80, rows: 24 })

      const modes: TerminalModes = {
        bracketedPaste: true,
        mouseTracking: false,
        applicationCursor: true,
        alternateScreen: false
      }
      await mgr.checkpoint('sess-1', makeSnapshot({ modes }))

      const data = JSON.parse(readFileSync(sessionPath(dir, 'sess-1', 'checkpoint.json'), 'utf-8'))
      expect(data.modes.bracketedPaste).toBe(true)
      expect(data.modes.applicationCursor).toBe(true)
    })

    it('preserves rehydrateSequences in checkpoint', async () => {
      await mgr.openSession('sess-1', { cwd: '/tmp', cols: 80, rows: 24 })

      await mgr.checkpoint('sess-1', makeSnapshot({ rehydrateSequences: '\x1b[?2004h\x1b[?1h' }))

      const data = JSON.parse(readFileSync(sessionPath(dir, 'sess-1', 'checkpoint.json'), 'utf-8'))
      expect(data.rehydrateSequences).toBe('\x1b[?2004h\x1b[?1h')
    })

    it('preserves OSC link ranges in checkpoint', async () => {
      await mgr.openSession('sess-1', { cwd: '/tmp', cols: 80, rows: 24 })
      const oscLinks = [{ row: 0, startCol: 6, endCol: 11, uri: 'https://example.com/issue/1234' }]

      await mgr.checkpoint('sess-1', makeSnapshot({ oscLinks }))

      const data = JSON.parse(readFileSync(sessionPath(dir, 'sess-1', 'checkpoint.json'), 'utf-8'))
      expect(data.oscLinks).toEqual(oscLinks)
    })

    it('ignores checkpoint for unknown sessions', async () => {
      await mgr.checkpoint('nonexistent', makeSnapshot())
    })

    it.skipIf(process.platform === 'win32')(
      'ignores checkpoint for disabled sessions',
      async () => {
        await mgr.openSession('sess-1', { cwd: '/tmp', cols: 80, rows: 24 })

        const cpPath = sessionPath(dir, 'sess-1', 'checkpoint.json')
        chmodSync(join(dir, getHistorySessionDirName('sess-1')), 0o555)

        await mgr.checkpoint('sess-1', makeSnapshot())

        chmodSync(join(dir, getHistorySessionDirName('sess-1')), 0o755)

        await mgr.checkpoint('sess-1', makeSnapshot({ snapshotAnsi: 'after-error' }))
        expect(existsSync(cpPath)).toBe(false)
      }
    )

    it('does not write scrollback.bin', async () => {
      await mgr.openSession('sess-1', { cwd: '/tmp', cols: 80, rows: 24 })
      await mgr.checkpoint('sess-1', makeSnapshot())

      expect(existsSync(sessionPath(dir, 'sess-1', 'scrollback.bin'))).toBe(false)
    })
  })

  describe('closeSession', () => {
    it('writes endedAt and exitCode to meta.json', async () => {
      await mgr.openSession('sess-1', { cwd: '/tmp', cols: 80, rows: 24 })
      await mgr.closeSession('sess-1', 0)

      const meta = JSON.parse(readFileSync(sessionPath(dir, 'sess-1', 'meta.json'), 'utf-8'))
      expect(meta.endedAt).toBeDefined()
      expect(meta.exitCode).toBe(0)
    })

    it('ignores close for unknown sessions', async () => {
      await mgr.closeSession('nonexistent', 0)
    })
  })

  describe('multiple sessions', () => {
    it('manages independent sessions', async () => {
      await mgr.openSession('a', { cwd: '/a', cols: 80, rows: 24 })
      await mgr.openSession('b', { cwd: '/b', cols: 120, rows: 40 })

      await mgr.checkpoint('a', makeSnapshot({ snapshotAnsi: 'session-a' }))
      await mgr.checkpoint('b', makeSnapshot({ snapshotAnsi: 'session-b' }))

      const dataA = JSON.parse(readFileSync(sessionPath(dir, 'a', 'checkpoint.json'), 'utf-8'))
      const dataB = JSON.parse(readFileSync(sessionPath(dir, 'b', 'checkpoint.json'), 'utf-8'))

      expect(dataA.snapshotAnsi).toBe('session-a')
      expect(dataB.snapshotAnsi).toBe('session-b')
    })
  })

  describe('dispose', () => {
    it('writes endedAt for open sessions to prevent false cold-restore', async () => {
      await mgr.openSession('sess-1', { cwd: '/tmp', cols: 80, rows: 24 })
      await mgr.checkpoint('sess-1', makeSnapshot())
      await mgr.dispose()

      const meta = JSON.parse(readFileSync(sessionPath(dir, 'sess-1', 'meta.json'), 'utf-8'))
      expect(meta.endedAt).not.toBeNull()
      expect(meta.exitCode).toBeNull()
    })
  })

  describe('removeSession', () => {
    it('deletes session directory from disk', async () => {
      await mgr.openSession('sess-1', { cwd: '/tmp', cols: 80, rows: 24 })
      await mgr.checkpoint('sess-1', makeSnapshot())
      await mgr.closeSession('sess-1', 0)

      await mgr.removeSession('sess-1')
      expect(existsSync(join(dir, getHistorySessionDirName('sess-1')))).toBe(false)
    })
  })

  describe('hasHistory', () => {
    it('returns true for sessions with meta.json on disk', async () => {
      await mgr.openSession('sess-1', { cwd: '/tmp', cols: 80, rows: 24 })
      await mgr.closeSession('sess-1', 0)

      expect(mgr.hasHistory('sess-1')).toBe(true)
    })

    it('returns false for unknown sessions', () => {
      expect(mgr.hasHistory('nonexistent')).toBe(false)
    })
  })

  describe('readMeta', () => {
    it('reads meta.json for a session', async () => {
      await mgr.openSession('sess-1', { cwd: '/projects', cols: 100, rows: 30 })
      await mgr.closeSession('sess-1', 42)

      const meta = mgr.readMeta('sess-1')
      expect(meta).not.toBeNull()
      expect(meta!.cwd).toBe('/projects')
      expect(meta!.exitCode).toBe(42)
    })

    it('returns null for missing sessions', () => {
      expect(mgr.readMeta('nonexistent')).toBeNull()
    })
  })

  describe('error handling', () => {
    it.skipIf(process.platform === 'win32')(
      'disables writes after fs error and does not throw',
      async () => {
        await mgr.openSession('disk-full', { cwd: '/tmp', cols: 80, rows: 24 })

        const sessionDir = join(dir, getHistorySessionDirName('disk-full'))
        chmodSync(sessionDir, 0o555)

        await mgr.checkpoint('disk-full', makeSnapshot())

        chmodSync(sessionDir, 0o755)

        await mgr.checkpoint('disk-full', makeSnapshot({ snapshotAnsi: 'after-error' }))
        expect(existsSync(sessionPath(dir, 'disk-full', 'checkpoint.json'))).toBe(false)
      }
    )

    it.skipIf(process.platform === 'win32')(
      'disables writes after fs error on openSession',
      async () => {
        chmodSync(dir, 0o555)

        await mgr.openSession('disk-full-open', { cwd: '/tmp', cols: 80, rows: 24 })

        chmodSync(dir, 0o755)

        await mgr.checkpoint('disk-full-open', makeSnapshot())
      }
    )

    it.skipIf(process.platform === 'win32')(
      'does not throw on closeSession disk error',
      async () => {
        await mgr.openSession('close-err', { cwd: '/tmp', cols: 80, rows: 24 })

        const metaPath = sessionPath(dir, 'close-err', 'meta.json')
        chmodSync(metaPath, 0o444)

        await mgr.closeSession('close-err', 0)

        chmodSync(metaPath, 0o644)
      }
    )

    it.skipIf(process.platform === 'win32')(
      'reports write errors via onWriteError callback',
      async () => {
        const errors: { sessionId: string; error: Error }[] = []
        mgr = new HistoryManager(dir, {
          onWriteError: (sessionId, error) => errors.push({ sessionId, error })
        })

        await mgr.openSession('err-cb', { cwd: '/tmp', cols: 80, rows: 24 })

        const sessionDir = join(dir, getHistorySessionDirName('err-cb'))
        chmodSync(sessionDir, 0o555)

        await mgr.checkpoint('err-cb', makeSnapshot())

        chmodSync(sessionDir, 0o755)

        expect(errors).toHaveLength(1)
        expect(errors[0].sessionId).toBe('err-cb')
      }
    )
  })
})

describe('HistoryManager retention sweep', () => {
  const HOUR = 60 * 60 * 1000
  const NOW = Date.parse('2026-09-24T12:00:00.000Z')
  let dir: string

  beforeEach(() => {
    dir = createTestDir()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function writeSession(
    sessionId: string,
    endedAt: string | null,
    payloadBytes: number,
    metaText?: string
  ): void {
    const sessionDir = join(dir, getHistorySessionDirName(sessionId))
    mkdirSync(sessionDir, { recursive: true })
    const meta = {
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      startedAt: '2026-09-01T00:00:00.000Z',
      endedAt,
      exitCode: endedAt ? 0 : null
    }
    writeFileSync(join(sessionDir, 'meta.json'), metaText ?? JSON.stringify(meta))
    writeFileSync(join(sessionDir, 'checkpoint.json'), 'x'.repeat(payloadBytes))
  }

  function exists(sessionId: string): boolean {
    return existsSync(join(dir, getHistorySessionDirName(sessionId)))
  }

  it('sweeps only ended sessions, oldest first, never active or recoverable ones', () => {
    writeSession('active-old', null, 100_000)
    writeSession('ended-oldest', new Date(NOW - 72 * HOUR).toISOString(), 100_000)
    writeSession('ended-middle', new Date(NOW - 48 * HOUR).toISOString(), 100_000)
    writeSession('ended-newest', new Date(NOW - 24 * HOUR).toISOString(), 100_000)
    writeSession('ended-just-now', new Date(NOW - 60 * 1000).toISOString(), 100_000)
    writeSession('corrupt-meta', null, 100_000, '{"cwd": "/tm')

    // Six dirs of ~100 KB; a 350 KB quota needs three removals: exactly the
    // three ended sessions past the grace period.
    const result = new HistoryManager(dir).sweepEndedSessions(350_000, NOW)

    expect(exists('ended-oldest')).toBe(false)
    expect(exists('ended-middle')).toBe(false)
    expect(exists('ended-newest')).toBe(false)
    expect(exists('active-old')).toBe(true)
    expect(exists('ended-just-now')).toBe(true)
    expect(exists('corrupt-meta')).toBe(true)
    expect(result.removedSessions).toBe(3)
    expect(result.totalBytes - result.freedBytes).toBeLessThanOrEqual(350_000)
  })

  it('stops as soon as the archive fits, keeping newer ended sessions', () => {
    writeSession('ended-oldest', new Date(NOW - 72 * HOUR).toISOString(), 100_000)
    writeSession('ended-newest', new Date(NOW - 24 * HOUR).toISOString(), 100_000)

    new HistoryManager(dir).sweepEndedSessions(150_000, NOW)

    expect(exists('ended-oldest')).toBe(false)
    expect(exists('ended-newest')).toBe(true)
  })

  it('never removes a session this manager is still writing', async () => {
    const mgr = new HistoryManager(dir)
    await mgr.openSession('live', { cwd: '/tmp', cols: 80, rows: 24 })
    // Simulate stale on-disk endedAt for a session id that is open again.
    writeSession('live', new Date(NOW - 72 * HOUR).toISOString(), 100_000)

    expect(mgr.sweepEndedSessions(0, NOW).removedSessions).toBe(0)
    expect(exists('live')).toBe(true)
  })

  it('keeps a session that ended within the grace period even at zero quota', () => {
    writeSession('ended-just-now', new Date(NOW - 60 * 1000).toISOString(), 1_000)
    expect(new HistoryManager(dir).sweepEndedSessions(0, NOW).removedSessions).toBe(0)
    expect(exists('ended-just-now')).toBe(true)
  })

  it('deletes nothing while under quota', () => {
    writeSession('ended', new Date(NOW - 72 * HOUR).toISOString(), 1_000)
    expect(new HistoryManager(dir).sweepEndedSessions(1_000_000, NOW).removedSessions).toBe(0)
    expect(exists('ended')).toBe(true)
  })

  describe('readHistoryRetentionQuotaBytes', () => {
    it('is disabled (null) when no quota file exists', () => {
      expect(readHistoryRetentionQuotaBytes(join(dir, 'missing.json'))).toBeNull()
    })

    it('is disabled for unreadable or invalid quota files', () => {
      const bad = join(dir, 'bad.json')
      const invalid = ['{not json', '{"maxTotalMB": -5}', '{"maxTotalMB": "500"}', '[]', '{}']
      for (const text of invalid) {
        writeFileSync(bad, text)
        expect(readHistoryRetentionQuotaBytes(bad)).toBeNull()
      }
    })

    it('converts maxTotalMB to bytes', () => {
      const file = join(dir, 'quota.json')
      writeFileSync(file, '{"maxTotalMB": 500}')
      expect(readHistoryRetentionQuotaBytes(file)).toBe(500 * 1024 * 1024)
    })
  })
})
