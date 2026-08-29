import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cleanTerminalOutput,
  decodeHistoryDirName,
  readRecentTerminalActivity
} from './terminal-history-context'

describe('decodeHistoryDirName', () => {
  it('recovers the worktree path', () => {
    const name = '7da20490::%2FUsers%2Fbayou%2FProjects%20(Code)%2Fdobius-plus@@ef6077ec'
    expect(decodeHistoryDirName(name)).toBe('/Users/bayou/Projects (Code)/dobius-plus')
  })

  it('rejects a name with no separator', () => {
    expect(decodeHistoryDirName('nonsense')).toBeNull()
  })
})

describe('cleanTerminalOutput', () => {
  it('strips ANSI colour codes and blank lines', () => {
    const esc = String.fromCharCode(27)
    const coloured = `${esc}[32mgreen${esc}[0m\n\n\nplain`
    expect(cleanTerminalOutput(coloured)).toBe('green\nplain')
  })
})

describe('readRecentTerminalActivity', () => {
  it('returns terminals newest first with their tail', () => {
    const root = mkdtempSync(join(tmpdir(), 'hist-'))
    const write = (dir: string, body: string, mtimeSeconds: number): void => {
      mkdirSync(join(root, dir), { recursive: true })
      const log = join(root, dir, 'output.log')
      writeFileSync(log, body)
      utimesSync(log, mtimeSeconds, mtimeSeconds)
    }
    write('id1::%2Ftmp%2Fold@@a', 'older work', 1_000)
    write('id2::%2Ftmp%2Fnew@@b', 'newest work', 9_000)

    const activity = readRecentTerminalActivity(root, 5)
    expect(activity.map((entry) => entry.worktreePath)).toEqual(['/tmp/new', '/tmp/old'])
    expect(activity[0].recentOutput).toBe('newest work')
  })

  it('returns nothing when the directory is missing', () => {
    expect(readRecentTerminalActivity('/nope/not/here')).toEqual([])
  })
})
