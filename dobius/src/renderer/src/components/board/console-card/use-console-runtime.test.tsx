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
