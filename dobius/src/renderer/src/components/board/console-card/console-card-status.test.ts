import { describe, expect, it } from 'vitest'
import {
  consoleCardStatus,
  foregroundWithoutPty,
  isShellProcessName,
  resolveConsoleLeafId
} from './console-card-status'

const base = {
  tabExists: true,
  paused: false,
  foreground: 'agent' as const,
  entry: undefined,
  now: 1000,
  staleAfterMs: 100
}

describe('consoleCardStatus', () => {
  it('gone tab, ended process, paused, at its shell, idle', () => {
    expect(consoleCardStatus({ ...base, tabExists: false })).toBe('gone')
    expect(consoleCardStatus({ ...base, foreground: 'exited' })).toBe('done')
    expect(consoleCardStatus({ ...base, paused: true })).toBe('paused')
    expect(consoleCardStatus({ ...base, foreground: 'shell' })).toBe('shell')
    expect(consoleCardStatus(base)).toBe('idle')
  })
  it('maps fresh feed states; a finished turn is idle, not done', () => {
    const at = (state: 'working' | 'blocked' | 'waiting' | 'done') =>
      consoleCardStatus({ ...base, entry: { state, updatedAt: 950 } })
    expect(at('working')).toBe('working')
    expect(at('blocked')).toBe('waiting')
    expect(at('waiting')).toBe('waiting')
    expect(at('done')).toBe('idle')
  })
  it('stale entries fall back to idle', () => {
    expect(consoleCardStatus({ ...base, entry: { state: 'working', updatedAt: 1 } })).toBe('idle')
  })
})

describe('isShellProcessName', () => {
  it('recognises shells, not agents', () => {
    expect(isShellProcessName('zsh')).toBe(true)
    expect(isShellProcessName('-bash')).toBe(true)
    expect(isShellProcessName('/bin/fish')).toBe(true)
    expect(isShellProcessName('C:\\Windows\\pwsh.exe')).toBe(true)
    expect(isShellProcessName('claude')).toBe(false)
    expect(isShellProcessName(null)).toBe(false)
  })
})

describe('resolveConsoleLeafId', () => {
  it('prefers the active leaf, else the first leaf, else null', () => {
    const root = {
      type: 'split' as const,
      first: { type: 'leaf' as const, leafId: 'L1' },
      second: { type: 'leaf' as const, leafId: 'L2' }
    }
    expect(resolveConsoleLeafId({ activeLeafId: 'L2', root })).toBe('L2')
    expect(resolveConsoleLeafId({ activeLeafId: null, root })).toBe('L1')
    expect(resolveConsoleLeafId({ activeLeafId: null, root: null })).toBeNull()
    expect(resolveConsoleLeafId(undefined)).toBeNull()
  })
})

describe('foregroundWithoutPty', () => {
  it('reads a vanished PTY as exited, so the card shows done', () => {
    expect(foregroundWithoutPty(true)).toBe('exited')
    expect(consoleCardStatus({ ...base, foreground: foregroundWithoutPty(true) })).toBe('done')
  })
  it('stays unknown before the tab ever had a PTY (still launching)', () => {
    expect(foregroundWithoutPty(false)).toBeNull()
  })
})
