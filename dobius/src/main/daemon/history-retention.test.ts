import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import {
  readHistoryRetentionQuotaBytes,
  runHistoryRetentionSweep,
  sweepEndedHistory
} from './history-retention'
import { getHistorySessionDirName } from './history-paths'

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-09-24T12:00:00.000Z')
const NO_LIVE = new Set<string>()

describe('terminal history retention', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'history-retention-test-'))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  function writeDir(
    name: string,
    endedAt: string | null,
    payloadBytes: number,
    metaText?: string
  ): void {
    const sessionDir = join(dir, name)
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

  function writeSession(sessionId: string, endedAt: string | null, payloadBytes: number): void {
    writeDir(getHistorySessionDirName(sessionId), endedAt, payloadBytes)
  }

  function exists(sessionId: string): boolean {
    return existsSync(join(dir, getHistorySessionDirName(sessionId)))
  }

  function endedHoursAgo(hours: number): string {
    return new Date(NOW - hours * HOUR).toISOString()
  }

  describe('sweepEndedHistory', () => {
    it('sweeps only ended sessions, oldest first, never active or recoverable ones', () => {
      writeSession('active-old', null, 100_000)
      writeSession('ended-oldest', endedHoursAgo(72), 100_000)
      writeSession('ended-middle', endedHoursAgo(48), 100_000)
      writeSession('ended-newest', endedHoursAgo(24), 100_000)
      writeSession('ended-just-now', new Date(NOW - 60 * 1000).toISOString(), 100_000)
      writeDir('corrupt-meta', null, 100_000, '{"cwd": "/tm')

      // Three ~100 KB dirs are not deletable; a 350 KB quota leaves ~50 KB for
      // ended sessions, so all three eligible ones go, oldest first.
      const result = sweepEndedHistory(dir, 350_000, NO_LIVE, NOW)

      expect(exists('ended-oldest')).toBe(false)
      expect(exists('ended-middle')).toBe(false)
      expect(exists('ended-newest')).toBe(false)
      expect(exists('active-old')).toBe(true)
      expect(exists('ended-just-now')).toBe(true)
      expect(exists('corrupt-meta')).toBe(true)
      expect(result.removedSessions).toBe(3)
    })

    it('stops as soon as the ended sessions fit, keeping newer ones', () => {
      writeSession('ended-oldest', endedHoursAgo(72), 100_000)
      writeSession('ended-newest', endedHoursAgo(24), 100_000)

      sweepEndedHistory(dir, 150_000, NO_LIVE, NOW)

      expect(exists('ended-oldest')).toBe(false)
      expect(exists('ended-newest')).toBe(true)
    })

    it('measures the quota against deletable bytes, not the whole folder', () => {
      writeSession('active', null, 200_000)
      writeSession('ended-oldest', endedHoursAgo(72), 100_000)
      writeSession('ended-newest', endedHoursAgo(24), 100_000)

      // 200 KB is kept regardless; 350 KB quota leaves 150 KB -> one removal.
      const result = sweepEndedHistory(dir, 350_000, NO_LIVE, NOW)

      expect(result.removedSessions).toBe(1)
      expect(exists('ended-oldest')).toBe(false)
      expect(exists('ended-newest')).toBe(true)
    })

    it('deletes nothing when non-deletable history alone exceeds the quota', () => {
      writeSession('active', null, 500_000)
      writeSession('ended', endedHoursAgo(72), 100_000)

      const result = sweepEndedHistory(dir, 300_000, NO_LIVE, NOW)

      expect(result.removedSessions).toBe(0)
      expect(exists('ended')).toBe(true)
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('retention skipped'))
    })

    it('keeps a session that ended within the grace period even at zero quota', () => {
      writeSession('ended-just-now', new Date(NOW - 60 * 1000).toISOString(), 1_000)
      expect(sweepEndedHistory(dir, 0, NO_LIVE, NOW).removedSessions).toBe(0)
      expect(exists('ended-just-now')).toBe(true)
    })

    it('deletes nothing while under quota', () => {
      writeSession('ended', endedHoursAgo(72), 1_000)
      expect(sweepEndedHistory(dir, 1_000_000, NO_LIVE, NOW).removedSessions).toBe(0)
      expect(exists('ended')).toBe(true)
    })

    it('removes ended leftovers of an interrupted sweep and keeps any other leftover', () => {
      writeDir('.deleting-aaaaaaaaaaaa', endedHoursAgo(72), 1_000)
      writeDir('.deleting-bbbbbbbbbbbb', null, 1_000)

      sweepEndedHistory(dir, 1_000_000, NO_LIVE, NOW)

      expect(readdirSync(dir)).toEqual(['.deleting-bbbbbbbbbbbb'])
    })

    it('leaves no .deleting- dir behind after a normal sweep', () => {
      writeSession('ended', endedHoursAgo(72), 1_000)
      sweepEndedHistory(dir, 0, NO_LIVE, NOW)
      expect(readdirSync(dir)).toEqual([])
    })
  })

  describe('runHistoryRetentionSweep (production entry)', () => {
    function writeQuota(maxTotalMB: number): string {
      const quotaPath = join(dir, '..', `${basename(dir)}-quota.json`)
      writeFileSync(quotaPath, JSON.stringify({ maxTotalMB }))
      return quotaPath
    }

    afterEach(() => {
      rmSync(join(dir, '..', `${basename(dir)}-quota.json`), { force: true })
    })

    it('never removes a session the daemon reports live, even with a stale endedAt', async () => {
      writeSession('reused-id', endedHoursAgo(72), 100_000)
      writeSession('ended', endedHoursAgo(48), 100_000)
      const provider = { listProcesses: vi.fn(async () => [{ id: 'reused-id' }]) }

      // ~157 KB quota: the live 100 KB dir is kept, so the ended one must go.
      const result = await runHistoryRetentionSweep(provider, dir, writeQuota(0.15), NOW)

      expect(provider.listProcesses).toHaveBeenCalledTimes(1)
      expect(result?.removedSessions).toBe(1)
      expect(exists('reused-id')).toBe(true)
      expect(exists('ended')).toBe(false)
    })

    it('skips the sweep entirely when the live list cannot be obtained', async () => {
      writeSession('ended', endedHoursAgo(72), 100_000)
      const failing = {
        listProcesses: vi.fn(async (): Promise<{ id: string }[]> => {
          throw new Error('daemon gone')
        })
      }

      expect(await runHistoryRetentionSweep(failing, dir, writeQuota(0.0001), NOW)).toBeNull()
      expect(await runHistoryRetentionSweep(null, dir, writeQuota(0.0001), NOW)).toBeNull()
      expect(exists('ended')).toBe(true)
    })

    it('does nothing (and never asks the daemon) without a quota file', async () => {
      writeSession('ended', endedHoursAgo(72), 100_000)
      const provider = { listProcesses: vi.fn(async () => []) }

      expect(
        await runHistoryRetentionSweep(provider, dir, join(dir, 'missing.json'), NOW)
      ).toBeNull()
      expect(provider.listProcesses).not.toHaveBeenCalled()
      expect(exists('ended')).toBe(true)
    })
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
