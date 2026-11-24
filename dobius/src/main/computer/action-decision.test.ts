import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  holdProtectedSelfUi,
  PROTECTED_SELF_UI_REASON,
  resetProtectedSelfUiForTest
} from './protected-self-ui'
import {
  decideComputerAction,
  rememberComputerSnapshot,
  resetComputerDecisionStateForTest,
  riskyElementWord
} from './action-decision'

const windows = (count: number) =>
  vi.fn(async () => ({
    app: { name: 'Chrome' },
    windows: Array.from({ length: count }, (_, index) => ({
      index,
      title: `w${index}`,
      width: 100,
      height: 100
    }))
  })) as never

const tree = (treeText: string) => ({ snapshot: { treeText } }) as never

describe('computer-use action decision point', () => {
  beforeEach(() => resetComputerDecisionStateForTest())

  it('blocks unpinned coordinate clicks when several windows are open', async () => {
    const decision = await decideComputerAction(
      'click',
      { app: 'chrome', x: 10, y: 10 },
      { listWindows: windows(3) }
    )
    expect(decision).toMatchObject({ verdict: 'block', rule: 'pick-window' })
  })

  it('allows coordinates with a window id, with one window, and never lists for element clicks', async () => {
    const list = windows(3)
    await expect(
      decideComputerAction('click', { app: 'c', x: 1, y: 1, windowId: 7 }, { listWindows: list })
    ).resolves.toMatchObject({ verdict: 'allow' })
    await expect(
      decideComputerAction('click', { app: 'c', elementIndex: 2 }, { listWindows: list })
    ).resolves.toMatchObject({ verdict: 'allow' })
    expect(list).not.toHaveBeenCalled()
    await expect(
      decideComputerAction('scroll', { app: 'c', x: 1, y: 1 }, { listWindows: windows(1) })
    ).resolves.toMatchObject({ verdict: 'allow' })
  })

  it('requires --confirm-risky for controls labeled like Delete or Send', async () => {
    rememberComputerSnapshot(
      'mail',
      tree('0 standard window Mail\n\t12 button Send\n\t13 button Bold\n\t14 button Delete draft')
    )
    expect(riskyElementWord('mail', 12)).toBe('send')
    expect(riskyElementWord('mail', 13)).toBeNull()
    const deps = { listWindows: windows(1) }
    await expect(
      decideComputerAction('click', { app: 'mail', elementIndex: 14 }, deps)
    ).resolves.toMatchObject({ verdict: 'block', rule: 'confirm-risky' })
    await expect(
      decideComputerAction('click', { app: 'mail', elementIndex: 14, confirmRisky: true }, deps)
    ).resolves.toMatchObject({ verdict: 'allow' })
    await expect(
      decideComputerAction('click', { app: 'mail', elementIndex: 13 }, deps)
    ).resolves.toMatchObject({ verdict: 'allow' })
  })

  it('does not confuse element 1 with element 12', () => {
    rememberComputerSnapshot('mail', tree('\t1 button Archive\n\t12 button Send'))
    expect(riskyElementWord('mail', 1)).toBeNull()
  })
})

describe('protected Dobius+ approval screens (Codex P1, 7.17)', () => {
  beforeEach(() => resetProtectedSelfUiForTest())

  const self = (pid: number) => vi.fn(async () => ({ app: { name: 'X', bundleId: null, pid }, windows: [] })) as never

  it('allows actions on Dobius+ when no approval screen is open', async () => {
    const decision = await decideComputerAction('click', { app: 'Dobius+', elementIndex: 3 }, { listWindows: self(1), selfPid: 1 })
    expect(decision.verdict).toBe('allow')
  })

  it.each(['click', 'performSecondaryAction', 'typeText', 'pressKey', 'hotkey', 'pasteText', 'setValue', 'scroll', 'drag'])(
    'blocks %s aimed at Dobius+ while one is open, even with --confirm-risky',
    async (method) => {
      holdProtectedSelfUi('t')
      const decision = await decideComputerAction(
        method,
        { app: 'com.example.something', x: 5, y: 5, windowId: 1, confirmRisky: true },
        { listWindows: self(4242), selfPid: 4242 }
      )
      expect(decision).toMatchObject({ verdict: 'block', rule: 'protected-self-ui', reason: PROTECTED_SELF_UI_REASON })
    }
  )

  it('blocks by name when the window list cannot be read, and leaves other apps alone', async () => {
    holdProtectedSelfUi('t')
    const failing = vi.fn(async () => {
      throw new Error('no AX')
    }) as never
    for (const app of ['Dobius+', 'Electron', 'com.statusdigital.dobius-plus']) {
      expect((await decideComputerAction('click', { app, elementIndex: 1 }, { listWindows: failing, selfPid: 9 })).verdict).toBe('block')
    }
    const other = await decideComputerAction('click', { app: 'Safari', elementIndex: 1 }, { listWindows: self(77), selfPid: 9 })
    expect(other.verdict).toBe('allow')
  })
})
