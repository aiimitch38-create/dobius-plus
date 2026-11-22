// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/store', () => ({ useAppStore: () => null }))
vi.mock('../board-delivery/board-pause', () => ({
  isConsolePaused: () => false,
  onPauseChanged: () => () => {}
}))

import { FOREGROUND_POLL_MS, watchConsoleForeground } from './use-console-runtime'

const getForegroundProcess = vi.fn((_ptyId: string) => Promise.resolve<string | null>('claude'))
let visibility: 'visible' | 'hidden' = 'visible'

beforeEach(() => {
  vi.useFakeTimers()
  getForegroundProcess.mockClear()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { get: () => visibility, configurable: true })
  ;(window as unknown as { api: unknown }).api = { pty: { getForegroundProcess } }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('watchConsoleForeground', () => {
  it('shares one poll per PTY across subscribers and stops with the last one', async () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = watchConsoleForeground('pty-1', a)
    const offB = watchConsoleForeground('pty-1', b)
    await vi.advanceTimersByTimeAsync(0)
    expect(getForegroundProcess).toHaveBeenCalledTimes(1)
    expect(a).toHaveBeenLastCalledWith('agent')
    expect(b).toHaveBeenLastCalledWith('agent')
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS * 3)
    expect(getForegroundProcess).toHaveBeenCalledTimes(4)
    offA()
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS)
    expect(getForegroundProcess).toHaveBeenCalledTimes(5)
    offB()
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS * 3)
    expect(getForegroundProcess).toHaveBeenCalledTimes(5)
  })

  it('skips polls while the document is hidden and checks again when visible', async () => {
    const off = watchConsoleForeground('pty-2', vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    expect(getForegroundProcess).toHaveBeenCalledTimes(1)
    visibility = 'hidden'
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS * 3)
    expect(getForegroundProcess).toHaveBeenCalledTimes(1)
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(getForegroundProcess).toHaveBeenCalledTimes(2)
    off()
  })

  it('notifies only on a change of foreground kind', async () => {
    const listener = vi.fn()
    const off = watchConsoleForeground('pty-3', listener)
    await vi.advanceTimersByTimeAsync(0)
    listener.mockClear()
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS * 2)
    expect(listener).not.toHaveBeenCalled()
    getForegroundProcess.mockResolvedValueOnce('zsh')
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS)
    expect(listener).toHaveBeenCalledWith('shell')
    off()
  })
})

describe('useConsoleForeground after a remount', () => {
  it('reads exited for a tab whose PTY ended under its card, even with a fresh hook', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { useConsoleForeground } = await import('./use-console-runtime')
    const { markBoardConsoleEnded, resetBoardConsoleEndedForTest } = await import(
      './board-console-exit'
    )
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    resetBoardConsoleEndedForTest()
    const seen: unknown[] = []
    function Probe({ tabId }: { tabId: string }): null {
      seen.push(useConsoleForeground(tabId))
      return null
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    markBoardConsoleEnded('tab-ended')
    act(() => root.render(<Probe tabId="tab-ended" />))
    expect(seen.at(-1)).toBe('exited')
    act(() => root.render(<Probe tabId="tab-starting" />))
    expect(seen.at(-1)).toBe(null)
    act(() => root.unmount())
    resetBoardConsoleEndedForTest()
  })
})
