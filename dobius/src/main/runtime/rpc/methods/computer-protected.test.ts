// The protected-self-ui recheck when a queued computer action finally runs (Codex round 2, 7.17).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  listWindows: vi.fn(),
  snapshot: vi.fn()
}))

vi.mock('../../../computer/sidecar-client', () => ({
  callComputerSidecarAction: mocks.action,
  callComputerSidecarCapabilities: vi.fn(),
  callComputerSidecarListApps: vi.fn(),
  callComputerSidecarListWindows: mocks.listWindows,
  callComputerSidecarSnapshot: mocks.snapshot,
  resetComputerSidecarForTest: vi.fn()
}))
vi.mock('../../../computer/action-decision-journal', () => ({ journalComputerDecision: vi.fn(async () => undefined) }))

import {
  holdProtectedSelfUi,
  PROTECTED_SELF_UI_REASON,
  resetProtectedSelfUiForTest
} from '../../../computer/protected-self-ui'
import { COMPUTER_METHODS } from './computer'

const method = (name: string) => {
  const found = COMPUTER_METHODS.find((m) => m.name === name)
  if (!found || !('handler' in found)) {
    throw new Error(name)
  }
  return found as unknown as { handler: (params: unknown, ctx: unknown) => Promise<unknown> }
}

beforeEach(() => {
  resetProtectedSelfUiForTest()
  mocks.action.mockReset()
  mocks.listWindows.mockReset()
  mocks.snapshot.mockReset()
  mocks.listWindows.mockResolvedValue({ app: { name: 'X', bundleId: null, pid: -1 }, windows: [] })
})

describe('computer-use recheck at execution time', () => {
  it('refuses a Dobius+ action queued before the approval screen opened', async () => {
    // The sidecar queue runs `beforeRun` just before the action; the screen opens while it waits.
    mocks.action.mockImplementation(async (_method: string, _params: unknown, beforeRun?: () => void) => {
      holdProtectedSelfUi('opened-later')
      beforeRun?.()
      return { ok: true }
    })
    await expect(method('computer.click').handler({ app: 'Dobius+', elementIndex: 1 }, {})).rejects.toThrow(
      PROTECTED_SELF_UI_REASON
    )
  })

  it('lets other apps run, and refuses a snapshot of Dobius+ while protected', async () => {
    mocks.action.mockImplementation(async (_m: string, _p: unknown, beforeRun?: () => void) => {
      holdProtectedSelfUi('open')
      beforeRun?.()
      return { ok: true }
    })
    await expect(method('computer.click').handler({ app: 'Safari', elementIndex: 1 }, {})).resolves.toEqual({ ok: true })
    await expect(method('computer.getAppState').handler({ app: 'Dobius+' }, {})).rejects.toThrow(PROTECTED_SELF_UI_REASON)
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })

  it('refuses a Dobius+ snapshot queued before the review list opened', async () => {
    mocks.snapshot.mockImplementation(async (_params: unknown, beforeRun?: () => void) => {
      holdProtectedSelfUi('opened-later')
      beforeRun?.()
      return { app: 'Dobius+', elements: [] }
    })
    await expect(method('computer.getAppState').handler({ app: 'Dobius+' }, {})).rejects.toThrow(PROTECTED_SELF_UI_REASON)
    resetProtectedSelfUiForTest()
    mocks.snapshot.mockImplementation(async (_params: unknown, beforeRun?: () => void) => {
      holdProtectedSelfUi('opened-later')
      beforeRun?.()
      return { app: 'Finder', elements: [] }
    })
    await expect(method('computer.getAppState').handler({ app: 'Finder' }, {})).resolves.toMatchObject({ app: 'Finder' })
  })

  it('drops a snapshot or action result whose app pid is Dobius+, however it was targeted', async () => {
    const self = { snapshot: { app: { name: 'Dobius+', bundleId: 'com.dobius.plus', pid: process.pid } } }
    mocks.snapshot.mockResolvedValue(self)
    mocks.action.mockResolvedValue(self)
    holdProtectedSelfUi('open')
    await expect(method('computer.getAppState').handler({ app: 'com.dobius.plus' }, {})).rejects.toThrow(PROTECTED_SELF_UI_REASON)
    await expect(method('computer.scroll').handler({ app: 'com.dobius.plus', direction: 'down' }, {})).rejects.toThrow(
      PROTECTED_SELF_UI_REASON
    )
    resetProtectedSelfUiForTest()
    await expect(method('computer.getAppState').handler({ app: 'com.dobius.plus' }, {})).resolves.toBe(self)
    holdProtectedSelfUi('open')
    for (const app of [`pid:${process.pid}`, `PID: ${process.pid}`, String(process.pid), `pid:0${process.pid}`, `pid:+${process.pid}`]) {
      await expect(method('computer.getAppState').handler({ app }, {})).rejects.toThrow(PROTECTED_SELF_UI_REASON)
      await expect(method('computer.click').handler({ app, elementIndex: 1 }, {})).rejects.toThrow(PROTECTED_SELF_UI_REASON)
    }
    resetProtectedSelfUiForTest()
    const other = { snapshot: { app: { name: 'Finder', bundleId: 'com.apple.finder', pid: process.pid + 1 } } }
    mocks.snapshot.mockResolvedValue(other)
    holdProtectedSelfUi('open')
    await expect(method('computer.getAppState').handler({ app: 'com.apple.finder' }, {})).resolves.toBe(other)
  })
})
