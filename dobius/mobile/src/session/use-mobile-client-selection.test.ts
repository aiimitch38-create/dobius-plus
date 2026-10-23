import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mobileClientSelectionKey } from './mobile-client-selection'
import { useMobileClientSelection } from './use-mobile-client-selection'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn() }
}))
const tabs = [
  { id: 'laptop', type: 'terminal', terminal: 'pty-laptop', isActive: true },
  { id: 'phone', type: 'terminal', terminal: 'pty-phone', isActive: false }
]
let renderer: ReactTestRenderer | null = null
let current: ReturnType<typeof useMobileClientSelection>
const hydrated = vi.fn()
function Harness({ hostId = 'host', worktreeId = 'worktree' }) {
  current = useMobileClientSelection(hostId, worktreeId)
  current.onHydratedRef.current = hydrated
  return null
}
async function render(props = {}) {
  await act(async () => {
    renderer = create(createElement(Harness, props))
  })
}

describe('phone selection persistence lifecycle', () => {
  beforeEach(() => {
    vi.mocked(AsyncStorage.getItem).mockReset().mockResolvedValue(null)
    vi.mocked(AsyncStorage.setItem).mockReset().mockResolvedValue()
    hydrated.mockReset()
    const error = console.error
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      if (typeof args[0] !== 'string' || !args[0].includes('react-test-renderer is deprecated')) {
        error(...args)
      }
    })
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })
  it('restores a previous phone choice instead of laptop focus', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(
      JSON.stringify({ tabId: 'phone', terminalHandle: 'pty-phone' })
    )
    await render()
    expect(hydrated).toHaveBeenCalledTimes(1)
    expect(current.controller.reconcile(tabs).tab?.id).toBe('phone')
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(mobileClientSelectionKey('host', 'worktree'))
    expect(AsyncStorage.setItem).not.toHaveBeenCalled()
  })
  it('ignores delayed old-worktree hydration after route reuse', async () => {
    let resolveOld!: (value: string) => void
    vi.mocked(AsyncStorage.getItem)
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveOld = resolve
        })
      )
      .mockResolvedValueOnce(JSON.stringify({ tabId: 'phone', terminalHandle: 'pty-phone' }))
    await render({ worktreeId: 'old' })
    const old = current.controller
    const oldIsCurrent = current.isCurrent
    expect(oldIsCurrent()).toBe(true)
    await act(async () => {
      renderer?.update(createElement(Harness, { worktreeId: 'new' }))
    })
    const next = current.controller
    expect(oldIsCurrent()).toBe(false)
    expect(current.isCurrent()).toBe(true)
    expect(next).not.toBe(old)
    expect(next.reconcile(tabs).tab?.id).toBe('phone')
    await act(async () => {
      resolveOld(JSON.stringify({ tabId: 'laptop', terminalHandle: 'pty-laptop' }))
      await old.hydrate()
    })
    expect(hydrated).toHaveBeenCalledTimes(1)
    expect(current.controller).toBe(next)
    expect(next.reconcile(tabs).tab?.id).toBe('phone')
  })
  it('does not notify an unmounted screen when storage finishes later', async () => {
    let resolve!: (value: null) => void
    vi.mocked(AsyncStorage.getItem).mockReturnValue(
      new Promise<null>((done) => {
        resolve = done
      })
    )
    await render()
    const controller = current.controller
    const isCurrent = current.isCurrent
    act(() => renderer?.unmount())
    renderer = null
    resolve(null)
    await controller.hydrate()
    expect(hydrated).not.toHaveBeenCalled()
    expect(isCurrent()).toBe(false)
  })
  it('retains controller identity and selection on reconnect renders', async () => {
    await render()
    const controller = current.controller
    controller.select('phone', 'pty-phone')
    await controller.settled()
    await act(async () => {
      renderer?.update(createElement(Harness))
    })
    expect(current.controller).toBe(controller)
    expect(current.controller.reconcile(tabs).tab?.id).toBe('phone')
    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1)
  })
  it('rejects delayed snapshot delivery from the old host while the new host hydrates', async () => {
    await render({ hostId: 'old' })
    const oldScope = current
    oldScope.requests.tabs = true
    let deliver!: () => void
    const pending = new Promise<void>((resolve) => {
      deliver = resolve
    })
    const applySnapshot = vi.fn()
    const response = pending.then(() => {
      if (oldScope.isCurrent()) {
        applySnapshot(oldScope.controller.reconcile(tabs))
      }
    })
    await act(async () => {
      renderer?.update(createElement(Harness, { hostId: 'new' }))
    })
    deliver()
    await response
    expect(current.requests.tabs).toBe(false)
    expect(applySnapshot).not.toHaveBeenCalled()
    expect(current.isCurrent()).toBe(true)
    expect(AsyncStorage.getItem).toHaveBeenLastCalledWith(
      mobileClientSelectionKey('new', 'worktree')
    )
  })
})
