import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand'
import type { AppState } from '../types'
import { createBoardPersistence, resetBoardPersistenceForTest } from './board-persistence'
import { BOARD_CLOSE_FLUSH_TIMEOUT_MS, flushBoardsBeforeClose } from './board-persistence-close-guard'
import {
  dispatchWindowCloseRequest,
  registerWindowCloseGuard
} from '../../components/window-close-request-coordinator'

const set = vi.fn(async (_args: unknown) => {})
const confirmWindowClose = vi.fn()
const api = { subscribe: vi.fn() } as unknown as Pick<StoreApi<AppState>, 'subscribe'>
const boards = (tabId: string): unknown => ({
  wt: { cards: [{ id: 'card-1', kind: 'console', tabId }] }
})
let current: unknown = boards('a')
let unregister: () => void = () => {}

beforeEach(() => {
  vi.useFakeTimers()
  set.mockClear()
  confirmWindowClose.mockClear()
  vi.stubGlobal('window', { api: { ui: { set, confirmWindowClose } } })
  resetBoardPersistenceForTest()
  current = boards('a')
  unregister = registerWindowCloseGuard(() => flushBoardsBeforeClose())
})

afterEach(() => {
  unregister()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  resetBoardPersistenceForTest()
})

function persistence(): ReturnType<typeof createBoardPersistence> {
  return createBoardPersistence(
    () => ({ boardsHydrated: true, boardsByWorktree: current }) as unknown as AppState,
    api
  )
}

describe('board writes on window close', () => {
  it('lands a write queued behind an in-flight one before confirming the close', async () => {
    const p = persistence()
    let landB: () => void = () => {}
    set.mockImplementationOnce(() => new Promise<void>((resolve) => (landB = resolve)))
    current = boards('b')
    p.schedule(0)
    await vi.advanceTimersByTimeAsync(0)
    // C is queued behind the in-flight B
    current = boards('c')
    p.schedule(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(set).toHaveBeenCalledTimes(1)

    const closing = dispatchWindowCloseRequest({ isQuitting: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(confirmWindowClose).not.toHaveBeenCalled()

    landB()
    await closing
    expect(set).toHaveBeenLastCalledWith({ boardsByWorktree: boards('c') })
    expect(confirmWindowClose).toHaveBeenCalledTimes(1)
  })

  it('writes a still-debounced change before confirming the close', async () => {
    const p = persistence()
    current = boards('b')
    p.schedule(300)
    await dispatchWindowCloseRequest({ isQuitting: false })
    expect(set).toHaveBeenCalledWith({ boardsByWorktree: boards('b') })
    expect(confirmWindowClose).toHaveBeenCalledTimes(1)
  })

  it('closes anyway when the write does not land in time or is refused', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = persistence()
    set.mockImplementationOnce(() => new Promise<void>(() => {}))
    current = boards('b')
    p.schedule(0)
    await vi.advanceTimersByTimeAsync(0)
    const closing = dispatchWindowCloseRequest({ isQuitting: true })
    await vi.advanceTimersByTimeAsync(BOARD_CLOSE_FLUSH_TIMEOUT_MS)
    await closing
    expect(confirmWindowClose).toHaveBeenCalledTimes(1)

    set.mockRejectedValueOnce(new Error('ipc down'))
    current = boards('c')
    persistence().schedule(0)
    await expect(flushBoardsBeforeClose()).resolves.toBe(true)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
