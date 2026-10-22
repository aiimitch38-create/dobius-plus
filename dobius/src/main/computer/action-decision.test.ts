import { beforeEach, describe, expect, it, vi } from 'vitest'
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
