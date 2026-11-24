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
    // No timer is pending any more, but the failed change is written again.
    await flushBoardPersistence()
    expect(set).toHaveBeenCalledTimes(2)
    expect(persistence.dirtyIds().has('wt')).toBe(false)
    // Only the retry is awaiting its echo; the refused attempt left nothing pending.
    expect(persistence.isEcho(state.boardsByWorktree)).toBe(true)
    expect(persistence.isEcho(state.boardsByWorktree)).toBe(false)
  })

  it('does not resend boards main already holds, so no-op writes leave nothing awaiting an echo', async () => {
    // Why: main drops a ui.set equal to its state without broadcasting, so a
    // resent JSON was never echoed and stayed in the pending set for good: one
    // whole-boards JSON string per board state that was ever rewritten unchanged.
    const CYCLES = 10_000
    const boardsAt = (i: number): AppState['boardsByWorktree'] =>
      ({ wt: { cards: [{ id: 'card-1', kind: 'console', tabId: `tab-${i}` }] } }) as never
    let current = boardsAt(0)
    const persistence = createBoardPersistence(
      () => ({ boardsHydrated: true, boardsByWorktree: current }) as unknown as AppState,
      api
    )
    for (let i = 0; i < CYCLES; i++) {
      current = boardsAt(i)
      persistence.schedule(0)
      await flushBoardPersistence()
      // main applied the change and rebroadcast it
      expect(persistence.isEcho(current)).toBe(true)
      // a later write with identical content (e.g. a card re-set to the same tab)
      persistence.schedule(0)
      await flushBoardPersistence()
    }
    let stillPending = 0
    for (let i = 0; i < CYCLES; i++) {
      if (persistence.isEcho(boardsAt(i))) {
        stillPending++
      }
    }
    expect(stillPending).toBe(0)
    expect(set).toHaveBeenCalledTimes(CYCLES)
  })

  it('writes again once another window has changed the boards main holds', async () => {
    const persistence = createBoardPersistence(() => state, api)
    persistence.schedule(0)
    await flushBoardPersistence()
    expect(persistence.isEcho(state.boardsByWorktree)).toBe(true)
    expect(persistence.isEcho({ wt: { cards: [] } })).toBe(false)
    persistence.schedule(0)
    await flushBoardPersistence()
    expect(set).toHaveBeenCalledTimes(2)
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

describe('board writes in flight', () => {
  it('sends a revert to the confirmed boards after an in-flight write of other boards lands', async () => {
    const boardsA = { wt: { cards: [{ id: 'card-1', kind: 'console', tabId: 'a' }] } }
    const boardsB = { wt: { cards: [{ id: 'card-1', kind: 'console', tabId: 'b' }] } }
    let current: unknown = boardsA
    const persistence = createBoardPersistence(
      () => ({ boardsHydrated: true, boardsByWorktree: current }) as unknown as AppState,
      api
    )
    // main holds A
    persistence.schedule(0)
    await flushBoardPersistence()
    expect(persistence.isEcho(boardsA)).toBe(true)

    // B goes out and stays in flight
    let landB: () => void = () => {}
    set.mockImplementationOnce(() => new Promise<void>((resolve) => (landB = resolve)))
    current = boardsB
    persistence.schedule(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(set).toHaveBeenLastCalledWith({ boardsByWorktree: boardsB })

    // the user reverts to A while B is still in flight
    current = boardsA
    persistence.schedule(0)
    await vi.advanceTimersByTimeAsync(0)

    // B lands and main rebroadcasts it
    expect(persistence.isEcho(boardsB)).toBe(true)
    landB()
    await flushBoardPersistence()

    expect(set).toHaveBeenCalledTimes(3)
    expect(set).toHaveBeenLastCalledWith({ boardsByWorktree: boardsA })
  })
})
