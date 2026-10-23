import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fake terminal: stopping hands the foreground to the shell, continuing gives it back.
const fg: Record<string, string> = {}
const behaviour = { stopWorks: true }
const signal = vi.fn((ptyId: string, sig: string) => {
  if (sig === 'SIGSTOP_FOREGROUND' && behaviour.stopWorks) {
    fg[ptyId] = 'zsh'
  }
  if (sig === 'SIGCONT_FOREGROUND') {
    fg[ptyId] = 'claude'
  }
})
const state = {
  ptyIdsByTabId: { t1: ['p1'], t2: ['p2'], t3: [] as string[] } as Record<string, string[]>
}
vi.mock('@/store', () => ({ useAppStore: { getState: () => state } }))
Object.assign(globalThis, {
  window: { api: { pty: { signal, getForegroundProcess: async (id: string) => fg[id] ?? null } } }
})

const { isConsolePaused, resetBoardPauseForTest } = await import('./board-pause')
const { pauseResultText, resumeAllPausedConsoles, setConsolesPaused } =
  await import('./pause-consoles')

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)'
const opts = { userAgent: MAC, settleMs: 0 }

describe('setConsolesPaused', () => {
  beforeEach(() => {
    signal.mockClear()
    resetBoardPauseForTest()
    behaviour.stopWorks = true
    fg.p1 = 'claude'
    fg.p2 = 'zsh'
  })

  it('pauses only consoles running an agent, verified by the shell taking the terminal', async () => {
    const r = await setConsolesPaused(
      [
        { tabId: 't1', name: 'A' },
        { tabId: 't2', name: 'B' },
        { tabId: 't3', name: 'C' }
      ],
      true,
      opts
    )
    expect({ ...r, notRunning: [...r.notRunning].sort() }).toEqual({
      changed: ['A'],
      notRunning: ['B', 'C'],
      failed: [],
      unsupported: false
    })
    expect(signal.mock.calls).toEqual([['p1', 'SIGSTOP_FOREGROUND']])
    expect(isConsolePaused('t1')).toBe(true)
  })

  it('does not mark paused when the stop did not take effect', async () => {
    behaviour.stopWorks = false
    const r = await setConsolesPaused([{ tabId: 't1', name: 'A' }], true, opts)
    expect(r.failed).toEqual(['A'])
    expect(isConsolePaused('t1')).toBe(false)
    expect(pauseResultText(r, true)).toMatchObject({ ok: false })
  })

  it('resumes only what it paused and clears the flag once the agent is back', async () => {
    await setConsolesPaused([{ tabId: 't1', name: 'A' }], true, opts)
    const r = await setConsolesPaused(
      [
        { tabId: 't1', name: 'A' },
        { tabId: 't2', name: 'B' }
      ],
      false,
      opts
    )
    expect(r.changed).toEqual(['A'])
    expect(signal).toHaveBeenLastCalledWith('p1', 'SIGCONT_FOREGROUND')
    expect(isConsolePaused('t1')).toBe(false)
  })

  it('resumeAllPausedConsoles continues everything still paused', async () => {
    await setConsolesPaused([{ tabId: 't1', name: 'A' }], true, opts)
    await resumeAllPausedConsoles()
    expect(isConsolePaused('t1')).toBe(false)
  })

  it('refuses on Windows without signalling', async () => {
    const r = await setConsolesPaused([{ tabId: 't1', name: 'A' }], true, {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
      settleMs: 0
    })
    expect(r.unsupported).toBe(true)
    expect(signal).not.toHaveBeenCalled()
  })
})
