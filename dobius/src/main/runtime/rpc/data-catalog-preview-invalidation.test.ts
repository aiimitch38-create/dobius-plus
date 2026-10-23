import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ensureEncryptedCatalogPreviewInvalidationRegistration,
  emitCatalogPreviewInvalidated,
  registerCatalogPreviewInvalidationConnection,
  registerEncryptedCatalogPreviewInvalidationConnection
} from './data-catalog-preview-invalidation'

const cleanups: (() => void)[] = []
const event = {
  rootId: 'root:one',
  generation: 'f2e4d210-8bb5-4c19-886c-3ffb816f81ce',
  reason: 'revoked' as const
}

function register(id: string, send: (value: typeof event) => void, current = () => true) {
  const controller = new AbortController()
  const dispose = registerCatalogPreviewInvalidationConnection(id, {
    signal: controller.signal,
    isCurrent: current,
    send
  })
  if (dispose) {
    cleanups.push(dispose)
  }
  cleanups.push(() => controller.abort())
  return controller
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup()
  }
})

describe('catalog preview invalidation routing', () => {
  it('delivers only to the exact current connection, even for the same device', () => {
    const first = vi.fn()
    const second = vi.fn()
    register('ws:device:connection-1', first)
    register('ws:device:connection-2', second)

    expect(emitCatalogPreviewInvalidated('ws:device:connection-2', event)).toBe(true)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(event)
  })

  it('serializes only the strict event through the selected connection encryption callback', () => {
    const firstController = new AbortController()
    const secondController = new AbortController()
    const firstEncrypt = vi.fn((frame: string) => `first:${frame}`)
    const secondEncrypt = vi.fn((frame: string) => `second:${frame}`)
    cleanups.push(
      () => firstController.abort(),
      () => secondController.abort()
    )
    registerEncryptedCatalogPreviewInvalidationConnection('ws:device:screen-a', {
      signal: firstController.signal,
      isCurrent: () => true,
      sendEncrypted: firstEncrypt
    })
    registerEncryptedCatalogPreviewInvalidationConnection('ws:device:screen-b', {
      signal: secondController.signal,
      isCurrent: () => true,
      sendEncrypted: secondEncrypt
    })

    expect(emitCatalogPreviewInvalidated('ws:device:screen-b', event)).toBe(true)
    expect(firstEncrypt).not.toHaveBeenCalled()
    expect(secondEncrypt).toHaveBeenCalledWith(JSON.stringify(event))
  })

  it('rejects malformed events and refuses stale or aborted registrations', () => {
    const send = vi.fn()
    const controller = register('local:71:document', send, () => false)
    expect(emitCatalogPreviewInvalidated('local:71:document', { ...event, path: '/private' })).toBe(
      false
    )
    expect(emitCatalogPreviewInvalidated('local:71:document', event)).toBe(false)
    expect(send).not.toHaveBeenCalled()

    controller.abort()
    expect(emitCatalogPreviewInvalidated('local:71:document', event)).toBe(false)
  })

  it('does not replace a live connection id and unregisters on bounded teardown', () => {
    const original = vi.fn()
    const replacement = vi.fn()
    register('local:72:document', original)
    const controller = new AbortController()
    const dispose = registerCatalogPreviewInvalidationConnection('local:72:document', {
      signal: controller.signal,
      isCurrent: () => true,
      send: replacement
    })
    if (dispose) {
      cleanups.push(dispose)
    }
    cleanups.push(() => controller.abort())
    expect(emitCatalogPreviewInvalidated('local:72:document', event)).toBe(true)
    expect(original).toHaveBeenCalledOnce()
    expect(replacement).not.toHaveBeenCalled()
  })

  it('returns capacity failure and permits registration after capacity recovers', () => {
    const unregisters: (() => void)[] = []
    const controllers: AbortController[] = []
    for (let index = 0; index < 256; index += 1) {
      const controller = new AbortController()
      controllers.push(controller)
      const unregister = registerCatalogPreviewInvalidationConnection(`full:${index}`, {
        signal: controller.signal,
        isCurrent: () => true,
        send: () => undefined
      })
      expect(unregister).toEqual(expect.any(Function))
      unregisters.push(unregister!)
    }

    const retryController = new AbortController()
    cleanups.push(() => retryController.abort())
    expect(
      registerCatalogPreviewInvalidationConnection('retry-after-capacity', {
        signal: retryController.signal,
        isCurrent: () => true,
        send: () => undefined
      })
    ).toBeNull()

    unregisters[0]!()
    controllers[0]!.abort()
    const retried = registerCatalogPreviewInvalidationConnection('retry-after-capacity', {
      signal: retryController.signal,
      isCurrent: () => true,
      send: () => undefined
    })
    expect(retried).toEqual(expect.any(Function))
    cleanups.push(retried!)
    expect(emitCatalogPreviewInvalidated('retry-after-capacity', event)).toBe(true)
    cleanups.push(
      ...unregisters.slice(1),
      ...controllers.slice(1).map((item) => () => item.abort())
    )
  })

  it('retries WebSocket registration after capacity recovery and excludes non-mobile scope', () => {
    const owner = {}
    const registrations = new Map<object, () => void>()
    const unregisters: (() => void)[] = []
    const controllers: AbortController[] = []
    for (let index = 0; index < 256; index += 1) {
      const controller = new AbortController()
      controllers.push(controller)
      const unregister = registerCatalogPreviewInvalidationConnection(`occupied:${index}`, {
        signal: controller.signal,
        isCurrent: () => true,
        send: () => undefined
      })
      expect(unregister).toEqual(expect.any(Function))
      unregisters.push(unregister!)
    }
    const socketController = new AbortController()
    cleanups.push(() => socketController.abort())
    const sendEncrypted = vi.fn()
    const connection = {
      signal: socketController.signal,
      isCurrent: () => true,
      sendEncrypted
    }
    const ensure = (scope: string | null) =>
      ensureEncryptedCatalogPreviewInvalidationRegistration(
        registrations,
        owner,
        'ws:mobile:retry',
        scope,
        connection
      )
    expect(ensure('computer')).toBe(false)
    expect(registrations.has(owner)).toBe(false)
    expect(ensure('mobile')).toBe(false)
    expect(registrations.has(owner)).toBe(false)

    unregisters[0]!()
    controllers[0]!.abort()
    expect(ensure('mobile')).toBe(true)
    expect(ensure('mobile')).toBe(true)
    expect(emitCatalogPreviewInvalidated('ws:mobile:retry', event)).toBe(true)
    expect(sendEncrypted).toHaveBeenCalledWith(JSON.stringify(event))
    expect(ensure('computer')).toBe(false)
    expect(registrations.has(owner)).toBe(false)
    expect(emitCatalogPreviewInvalidated('ws:mobile:retry', event)).toBe(false)
    socketController.abort()
    cleanups.push(
      ...unregisters.slice(1),
      ...controllers.slice(1).map((item) => () => item.abort())
    )
  })
})
