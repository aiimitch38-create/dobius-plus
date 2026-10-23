import { describe, expect, it, vi } from 'vitest'
import {
  MobileClientSelectionController,
  mobileClientSelectionKey
} from './mobile-client-selection'

const terminal = (id: string, handle: string | null, isActive = false) => ({
  id,
  type: 'terminal',
  terminal: handle,
  isActive
})
const first = terminal('first', 'pty-1', true)
const second = terminal('second', 'pty-2')

function setup(raw: string | null = null) {
  const storage = {
    getItem: vi.fn().mockResolvedValue(raw),
    setItem: vi.fn().mockResolvedValue(null)
  }
  return {
    storage,
    controller: new MobileClientSelectionController(storage, 'phone:host:worktree')
  }
}

describe('phone client selection', () => {
  it('waits for device storage before choosing or persisting a host default', async () => {
    const { controller, storage } = setup()
    expect(controller.reconcile([first, second])).toEqual({ tab: null, status: 'loading' })
    expect(storage.setItem).not.toHaveBeenCalled()
    await controller.hydrate()
    expect(controller.reconcile([first, second]).tab?.id).toBe('first')
    await controller.settled()
    expect(storage.setItem).toHaveBeenCalledWith(
      'phone:host:worktree',
      JSON.stringify({ tabId: 'first', terminalHandle: 'pty-1' })
    )
  })

  it('ignores laptop focus changes and reorder after the first visit', async () => {
    const { controller } = setup()
    await controller.hydrate()
    controller.reconcile([first, second])
    const laptopSwitched = [
      { ...second, isActive: true },
      { ...first, isActive: false }
    ]
    expect(controller.reconcile(laptopSwitched).tab?.terminal).toBe('pty-1')
    controller.select('second', 'pty-2')
    expect(controller.reconcile([first, second]).tab?.terminal).toBe('pty-2')
    expect(controller.reconcile([{ ...first, isActive: true }, second]).tab?.id).toBe('second')
  })

  it('restores the same phone selection on reconnect and a new controller', async () => {
    const { controller, storage } = setup()
    await controller.hydrate()
    controller.select('second', 'pty-2')
    await controller.settled()
    const saved = storage.setItem.mock.calls.at(-1)![1] as string
    const restored = setup(saved).controller
    await restored.hydrate()
    expect(restored.reconcile([first, second]).tab?.id).toBe('second')
  })

  it('does not switch to another terminal when the chosen one closes', async () => {
    const { controller } = setup()
    await controller.hydrate()
    controller.select('second', 'pty-2')
    expect(controller.reconcile([first])).toEqual({ tab: null, status: 'missing' })
    expect(controller.reconcile([])).toEqual({ tab: null, status: 'missing' })
    expect(controller.reconcile([first])).toEqual({ tab: null, status: 'missing' })
    controller.select('first', 'pty-1')
    expect(controller.reconcile([first]).status).toBe('selected')
  })

  it('refuses a replacement PTY with the old tab ID but a different input target', async () => {
    const { controller } = setup()
    await controller.hydrate()
    controller.select('first', 'pty-1')
    expect(controller.reconcile([terminal('first', 'replacement', true)])).toEqual({
      tab: null,
      status: 'missing'
    })
    expect(controller.reconcile([first]).tab?.terminal).toBe('pty-1')
  })

  it('follows a retained terminal handle when fallback tab IDs stabilize', async () => {
    const { controller } = setup()
    await controller.hydrate()
    controller.select(null, 'pty-1')
    expect(controller.reconcile([first, second]).tab?.id).toBe('first')
    expect(controller.reconcile([terminal('stable-id', 'pty-1'), second]).tab?.id).toBe('stable-id')
  })

  it('hydrates a selected pending terminal without following host focus', async () => {
    const { controller } = setup()
    await controller.hydrate()
    controller.select('pending', null)
    expect(controller.reconcile([first, terminal('pending', null)]).tab?.id).toBe('pending')
    expect(controller.reconcile([first, terminal('pending', 'pty-new')]).tab?.terminal).toBe(
      'pty-new'
    )
    expect(controller.reconcile([first, terminal('pending', 'replacement')]).status).toBe('missing')
  })

  it('keeps a phone-selected markdown draft reachable when the laptop changes tabs', async () => {
    const { controller } = setup()
    await controller.hydrate()
    controller.select('draft', null)
    const draft = { id: 'draft', type: 'markdown', isActive: false }
    expect(controller.reconcile([first, draft]).tab).toBe(draft)
  })

  it('does not overwrite a user tap with a delayed saved selection', async () => {
    const { controller, storage } = setup()
    let resolve!: (raw: string) => void
    storage.getItem.mockReturnValue(
      new Promise<string>((done) => {
        resolve = done
      })
    )
    const loading = controller.hydrate()
    controller.select('second', 'pty-2')
    resolve(JSON.stringify({ tabId: 'first', terminalHandle: 'pty-1' }))
    await loading
    expect(controller.reconcile([first, second]).tab?.id).toBe('second')
  })

  it('serializes writes so slower earlier taps cannot overwrite the latest choice', async () => {
    const { controller, storage } = setup()
    await controller.hydrate()
    let release!: () => void
    storage.setItem.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          release = done
        })
    )
    controller.select('first', 'pty-1')
    controller.select('second', 'pty-2')
    await Promise.resolve()
    await Promise.resolve()
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    release()
    await controller.settled()
    expect(storage.setItem.mock.calls.at(-1)?.[1]).toContain('pty-2')
  })

  it('orders writes across route remounts sharing the same storage key', async () => {
    const { controller, storage } = setup()
    await controller.hydrate()
    let release!: () => void
    const blockedWrite = new Promise<void>((done) => {
      release = done
    })
    storage.setItem.mockImplementationOnce(() => blockedWrite)
    controller.select('first', 'pty-1')
    const remounted = new MobileClientSelectionController(storage, 'phone:host:worktree')
    remounted.select('second', 'pty-2')
    await Promise.resolve()
    await Promise.resolve()
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    release()
    await remounted.settled()
    expect(storage.setItem.mock.calls.at(-1)?.[1]).toContain('pty-2')
  })

  it('requires a fresh choice after storage failure rather than adopting laptop focus', async () => {
    const { controller, storage } = setup()
    storage.getItem.mockRejectedValue(new Error('storage unavailable'))
    await controller.hydrate()
    expect(controller.reconcile([first])).toEqual({ tab: null, status: 'unavailable' })
    expect(storage.setItem).not.toHaveBeenCalled()
    controller.select('first', 'pty-1')
    expect(controller.reconcile([first]).status).toBe('selected')
  })

  it('waits for an old-route write before reading the saved choice on remount', async () => {
    const { controller, storage } = setup()
    await controller.hydrate()
    let release!: () => void
    storage.setItem.mockImplementationOnce(async (_key, value) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      storage.getItem.mockResolvedValue(value)
    })
    controller.select('second', 'pty-2')
    await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalledTimes(1))
    const remounted = new MobileClientSelectionController(storage, 'phone:host:worktree')
    const hydration = remounted.hydrate()
    expect(remounted.reconcile([first, second]).status).toBe('loading')
    expect(storage.getItem).toHaveBeenCalledTimes(1)
    release()
    await hydration
    expect(remounted.reconcile([first, second]).tab?.id).toBe('second')
  })

  it('continues persisting after an earlier write fails', async () => {
    const { controller, storage } = setup()
    await controller.hydrate()
    storage.setItem.mockRejectedValueOnce(new Error('disk unavailable'))
    controller.select('first', 'pty-1')
    await expect(controller.settled()).rejects.toThrow('disk unavailable')
    controller.select('second', 'pty-2')
    await controller.settled()
    expect(storage.setItem).toHaveBeenLastCalledWith(
      'phone:host:worktree',
      JSON.stringify({ tabId: 'second', terminalHandle: 'pty-2' })
    )
    expect(controller.reconcile([first, second]).tab?.id).toBe('second')
  })

  it('preserves a user tap when the pending storage read later fails', async () => {
    const { controller, storage } = setup()
    let reject!: (reason: Error) => void
    storage.getItem.mockReturnValue(
      new Promise((_resolve, fail) => {
        reject = fail
      })
    )
    const hydration = controller.hydrate()
    await vi.waitFor(() => expect(storage.getItem).toHaveBeenCalledTimes(1))
    controller.select('second', 'pty-2')
    reject(new Error('read failed'))
    await hydration
    expect(controller.reconcile([first, second]).tab?.id).toBe('second')
  })

  it('treats malformed saved data as unavailable and preserves its storage value', async () => {
    const { controller, storage } = setup('{"tabId": 42}')
    await controller.hydrate()
    expect(controller.reconcile([first]).status).toBe('unavailable')
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('scopes preferences to the client device, host, and worktree without key collisions', () => {
    expect(mobileClientSelectionKey('host:a', 'b')).not.toBe(
      mobileClientSelectionKey('host', 'a:b')
    )
    expect(mobileClientSelectionKey('host', 'one')).not.toBe(
      mobileClientSelectionKey('host', 'two')
    )
    expect(mobileClientSelectionKey('host/one', 'folder:C:\\repo')).toBe(
      'dobius:clientSelection:v1:host%2Fone:folder%3AC%3A%5Crepo'
    )
  })
})
