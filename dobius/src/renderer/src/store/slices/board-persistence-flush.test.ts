import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand'
import type { AppState } from '../types'
import {
  createBoardPersistence,
  flushBoardPersistence,
  resetBoardPersistenceForTest
} from './board-persistence'

const set = vi.fn(async () => {})
const state = {
  boardsHydrated: true,
  boardsByWorktree: { wt: { cards: [{ id: 'card-1', kind: 'console', tabId: 'new-tab' }] } }
} as unknown as AppState
const api = { subscribe: vi.fn() } as unknown as Pick<StoreApi<AppState>, 'subscribe'>

beforeEach(() => {
  vi.useFakeTimers()
  set.mockClear()
  vi.stubGlobal('window', { api: { ui: { set } } })
  resetBoardPersistenceForTest()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  resetBoardPersistenceForTest()
})

describe('flushBoardPersistence', () => {
  it('writes a pending change now and does not write it again when the debounce ends', async () => {
    const persistence = createBoardPersistence(() => state, api)
    persistence.schedule(300)
    expect(set).not.toHaveBeenCalled()
    await flushBoardPersistence()
    expect(set).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith({ boardsByWorktree: state.boardsByWorktree })
    vi.advanceTimersByTime(1_000)
    expect(set).toHaveBeenCalledTimes(1)
  })

  it('resolves without writing when nothing is pending', async () => {
    createBoardPersistence(() => state, api)
    await flushBoardPersistence()
    expect(set).not.toHaveBeenCalled()
  })

  it('rejects when main refuses the write, keeps the change dirty, and the next flush retries', async () => {
    const listeners: ((s: AppState, prev: AppState) => void)[] = []
    const subscribing = {
      subscribe: (listener: (s: AppState, prev: AppState) => void) => {
        listeners.push(listener)
        return () => {}
      }
    } as unknown as Pick<StoreApi<AppState>, 'subscribe'>
    const persistence = createBoardPersistence(() => state, subscribing)
    // A local change to wt marks it dirty and schedules the write.
    listeners[0](state, { ...state, boardsByWorktree: {} } as AppState)
    expect(persistence.dirtyIds().has('wt')).toBe(true)
    set.mockRejectedValueOnce(new Error('ipc down'))
    await expect(flushBoardPersistence()).rejects.toThrow('ipc down')
    expect(persistence.dirtyIds().has('wt')).toBe(true)
    expect(persistence.isEcho(state.boardsByWorktree)).toBe(false)
    // No timer is pending any more, but the failed change is written again.
    await flushBoardPersistence()
    expect(set).toHaveBeenCalledTimes(2)
    expect(persistence.dirtyIds().has('wt')).toBe(false)
  })

  it('logs (does not throw) when a debounced write fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    set.mockRejectedValueOnce(new Error('ipc down'))
    const persistence = createBoardPersistence(() => state, api)
    persistence.schedule(300)
    await vi.advanceTimersByTimeAsync(300)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
