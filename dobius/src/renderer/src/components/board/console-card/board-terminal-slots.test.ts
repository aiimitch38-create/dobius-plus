import { beforeEach, describe, expect, it, vi } from 'vitest'

const setPortals = vi.fn()
vi.mock('@/components/activity/activity-terminal-portal', () => ({
  setActivityTerminalPortals: (targets: unknown) => setPortals(targets)
}))

const {
  blurBoardTerminalSlot,
  claimBoardTerminalSlot,
  focusBoardTerminalSlot,
  markBoardTerminalSlotPainted,
  onBoardTerminalSlotPainted,
  onBoardTerminalSlotReleased,
  releaseBoardTerminalSlot,
  requestBoardTerminalFit,
  resetBoardTerminalSlotsForTest
} = await import('./board-terminal-slots')

const target = {} as HTMLElement
const slot = (slotId: string, tabId: string) => ({
  slotId,
  target,
  worktreeId: 'wt',
  tabId,
  paneKey: `${tabId}:leaf`
})
const last = () =>
  setPortals.mock.calls.at(-1)?.[0] as { slotId: string; active: boolean; requestToken: string }[]

describe('board terminal slots', () => {
  beforeEach(() => {
    resetBoardTerminalSlotsForTest()
    setPortals.mockClear()
  })

  it('publishes every claimed slot together', () => {
    claimBoardTerminalSlot(slot('a', 't1'))
    claimBoardTerminalSlot(slot('b', 't2'))
    expect(last().map((s) => s.slotId)).toEqual(['a', 'b'])
    expect(last()[0].requestToken).toBe('a:t1:leaf')
  })

  it('refuses a second card for the same tab', () => {
    claimBoardTerminalSlot(slot('a', 't1'))
    expect(claimBoardTerminalSlot(slot('b', 't1'))).toBe('a')
    expect(last().map((s) => s.slotId)).toEqual(['a'])
  })

  it('marks only the focused slot active', () => {
    claimBoardTerminalSlot(slot('a', 't1'))
    claimBoardTerminalSlot(slot('b', 't2'))
    focusBoardTerminalSlot('b')
    expect(last().map((s) => s.active)).toEqual([false, true])
  })

  it('does not republish identical state', () => {
    claimBoardTerminalSlot(slot('a', 't1'))
    const calls = setPortals.mock.calls.length
    claimBoardTerminalSlot(slot('a', 't1'))
    focusBoardTerminalSlot(null)
    expect(setPortals.mock.calls.length).toBe(calls)
  })

  it('release removes the slot and clears focus; last release publishes empty', () => {
    claimBoardTerminalSlot(slot('a', 't1'))
    focusBoardTerminalSlot('a')
    releaseBoardTerminalSlot('a')
    expect(last()).toEqual([])
    releaseBoardTerminalSlot('a')
    expect(claimBoardTerminalSlot(slot('b', 't1'))).toBeNull()
  })
  it('blur only clears focus held by that slot', () => {
    claimBoardTerminalSlot(slot('a', 't1'))
    claimBoardTerminalSlot(slot('b', 't2'))
    focusBoardTerminalSlot('b')
    blurBoardTerminalSlot('a')
    expect(last().map((s) => s.active)).toEqual([false, true])
    blurBoardTerminalSlot('b')
    expect(last().map((s) => s.active)).toEqual([false, false])
  })

  it('a losing card can re-claim once the owner releases', () => {
    claimBoardTerminalSlot(slot('a', 't1'))
    let owner: string | null = claimBoardTerminalSlot(slot('b', 't1'))
    const stop = onBoardTerminalSlotReleased(() => {
      owner = claimBoardTerminalSlot(slot('b', 't1'))
    })
    expect(owner).toBe('a')
    releaseBoardTerminalSlot('a')
    expect(owner).toBeNull()
    expect(last().map((s) => s.slotId)).toEqual(['b'])
    stop()
  })

  it('many fit requests become one SYNC_FIT_PANES_EVENT', () => {
    vi.useFakeTimers()
    const dispatch = vi.fn()
    // @ts-expect-error -- minimal window shim
    globalThis.window = { dispatchEvent: dispatch }
    for (let i = 0; i < 10; i += 1) {
      requestBoardTerminalFit()
    }
    vi.runAllTimers()
    expect(dispatch).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})

describe('board terminal slot painted signal', () => {
  beforeEach(() => {
    resetBoardTerminalSlotsForTest()
  })

  it('notifies only the listeners of the painted token, and stops after unsubscribe', () => {
    const a = vi.fn()
    const b = vi.fn()
    const off = onBoardTerminalSlotPainted('tab-a:leaf', a)
    onBoardTerminalSlotPainted('tab-b:leaf', b)

    markBoardTerminalSlotPainted('tab-a:leaf')
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()

    off()
    markBoardTerminalSlotPainted('tab-a:leaf')
    expect(a).toHaveBeenCalledTimes(1)
    // An unknown token is a no-op (TerminalPane may paint before any card waits).
    expect(() => markBoardTerminalSlotPainted('nobody')).not.toThrow()
  })

  it('a listener that unsubscribes while being notified does not break the others', () => {
    const calls: string[] = []
    const off = onBoardTerminalSlotPainted('t', () => {
      calls.push('first')
      off()
    })
    onBoardTerminalSlotPainted('t', () => calls.push('second'))
    markBoardTerminalSlotPainted('t')
    expect(calls).toEqual(['first', 'second'])
  })
})
