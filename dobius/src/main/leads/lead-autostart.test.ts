import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  bootLeadAutostart,
  isLeadAutostarted,
  leadAutostartPath,
  readLeadAutostart,
  removeLeadAutostart,
  upsertLeadAutostart
} from './lead-autostart'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'lead-autostart-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('autostart store', () => {
  it('round-trips add, update and remove', () => {
    expect(readLeadAutostart(home)).toEqual([])
    upsertLeadAutostart({ worktreePath: '/w/a', profile: 'lead-a' }, home)
    upsertLeadAutostart({ worktreePath: '/w/b', profile: 'lead-b' }, home)
    expect(readLeadAutostart(home)).toEqual([
      { worktreePath: '/w/a', profile: 'lead-a' },
      { worktreePath: '/w/b', profile: 'lead-b' }
    ])

    upsertLeadAutostart({ worktreePath: '/w/a', profile: 'lead-a2' }, home)
    expect(readLeadAutostart(home)).toHaveLength(2)
    expect(isLeadAutostarted('/w/a', home)).toBe(true)
    expect(readLeadAutostart(home).find((e) => e.worktreePath === '/w/a')?.profile).toBe('lead-a2')

    expect(removeLeadAutostart('/w/a', home)).toBe(true)
    expect(removeLeadAutostart('/w/a', home)).toBe(false)
    expect(isLeadAutostarted('/w/a', home)).toBe(false)
    expect(readLeadAutostart(home)).toEqual([{ worktreePath: '/w/b', profile: 'lead-b' }])

    expect(existsSync(leadAutostartPath(home))).toBe(true)
    // Atomic write leaves no temp file behind.
    expect(readdirSync(join(home, '.dobius', 'leads'))).toEqual(['autostart.json'])
  })

  it('treats a corrupt autostart.json as empty, logs it, and recovers on the next write', () => {
    mkdirSync(join(home, '.dobius', 'leads'), { recursive: true })
    writeFileSync(leadAutostartPath(home), '[{"worktreePath":')
    const logs: string[] = []
    expect(readLeadAutostart(home, (message) => logs.push(message))).toEqual([])
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('ignoring unreadable')
    upsertLeadAutostart({ worktreePath: '/w/a', profile: 'lead-a' }, home)
    expect(readLeadAutostart(home)).toEqual([{ worktreePath: '/w/a', profile: 'lead-a' }])
  })
})

describe('bootLeadAutostart', () => {
  it('starts only entries whose worktree resolves and whose start succeeds', async () => {
    const start = vi.fn(async (selector: string) => {
      if (selector === 'id:bad-config') {
        throw new Error('lead.json: "maxWorkers" must be an integer from 1 to 4')
      }
      return { ok: true }
    })
    const logs: string[] = []
    const result = await bootLeadAutostart({
      entries: [
        { worktreePath: '/w/good', profile: 'lead-good' },
        { worktreePath: '/w/gone', profile: 'lead-gone' },
        { worktreePath: '/w/bad', profile: 'lead-bad' }
      ],
      resolveWorktree: async (worktreePath) => {
        if (worktreePath === '/w/gone') {
          throw new Error('selector_not_found')
        }
        return { id: worktreePath === '/w/bad' ? 'bad-config' : 'good', path: worktreePath }
      },
      start,
      log: (m) => logs.push(m)
    })

    expect(result).toEqual({ started: ['/w/good'], skipped: ['/w/gone', '/w/bad'] })
    expect(start).toHaveBeenCalledTimes(2)
    expect(start).toHaveBeenCalledWith('id:good')
    expect(logs).toHaveLength(2)
    expect(logs[0]).toContain('lead-gone at /w/gone: selector_not_found')
    expect(logs[1]).toContain('lead-bad at /w/bad: lead.json')
  })

  it('resolves with empty results when there are no entries', async () => {
    await expect(
      bootLeadAutostart({
        entries: [],
        resolveWorktree: async () => {
          throw new Error('unreachable')
        },
        start: async () => undefined
      })
    ).resolves.toEqual({ started: [], skipped: [] })
  })
})
