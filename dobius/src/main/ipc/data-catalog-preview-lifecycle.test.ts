import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  emitCatalogPreviewInvalidated,
  localCatalogPreviewConnection
} from './data-catalog-preview-lifecycle'
import { registerCatalogPreviewInvalidationConnection } from '../runtime/rpc/data-catalog-preview-invalidation'

const contentsInstances = new Set<FakeWebContents>()

afterEach(() => {
  for (const contents of contentsInstances) {
    contents.emit('destroyed')
  }
  contentsInstances.clear()
})

class FakeWebContents extends EventEmitter {
  destroyed = false
  send = vi.fn()

  constructor(readonly id: number) {
    super()
    contentsInstances.add(this)
  }

  isDestroyed(): boolean {
    return this.destroyed
  }
}

describe('local catalog preview document identity', () => {
  it('reuses identity within one document and rotates/aborts on top-frame navigation', () => {
    const contents = new FakeWebContents(71)
    const first = localCatalogPreviewConnection(contents)!
    const sameDocument = localCatalogPreviewConnection(contents)!
    expect(sameDocument.connectionId).toBe(first.connectionId)
    expect(sameDocument.signal).toBe(first.signal)
    const event = {
      rootId: 'root:test',
      generation: 'f2e4d210-8bb5-4c19-886c-3ffb816f81ce',
      reason: 'revoked' as const
    }
    expect(emitCatalogPreviewInvalidated(first.connectionId, event)).toBe(true)
    expect(contents.send).toHaveBeenCalledTimes(1)

    contents.emit('did-start-navigation', {}, 'app://dobius/next', false, true)

    const next = localCatalogPreviewConnection(contents)!
    expect(first.signal.aborted).toBe(true)
    expect(next.connectionId).not.toBe(first.connectionId)
    expect(next.navigationId).toBe(first.navigationId + 1)
    expect(next.signal.aborted).toBe(false)
    expect(emitCatalogPreviewInvalidated(first.connectionId, event)).toBe(false)
    expect(emitCatalogPreviewInvalidated(next.connectionId, event)).toBe(true)
    expect(contents.send).toHaveBeenCalledTimes(2)
  })

  it('ignores subframe and in-place navigation but invalidates on renderer loss', () => {
    const contents = new FakeWebContents(72)
    const first = localCatalogPreviewConnection(contents)!

    contents.emit('did-start-navigation', {}, 'https://untrusted.invalid/frame', false, false)
    contents.emit('did-start-navigation', {}, 'app://dobius/#section', true, true)
    expect(localCatalogPreviewConnection(contents)!.connectionId).toBe(first.connectionId)
    expect(first.signal.aborted).toBe(false)

    contents.emit('render-process-gone')
    expect(first.signal.aborted).toBe(true)
    expect(localCatalogPreviewConnection(contents)!.connectionId).not.toBe(first.connectionId)
  })

  it('aborts and refuses destroyed webContents', () => {
    const contents = new FakeWebContents(73)
    const first = localCatalogPreviewConnection(contents)!
    contents.destroyed = true
    expect(localCatalogPreviewConnection(contents)).toBeNull()
    expect(first.signal.aborted).toBe(true)
  })

  it('does not cache local registration failure and retries when a slot opens', () => {
    const unregisters: (() => void)[] = []
    const controllers: AbortController[] = []
    for (let index = 0; index < 256; index += 1) {
      const controller = new AbortController()
      controllers.push(controller)
      const unregister = registerCatalogPreviewInvalidationConnection(`local-full:${index}`, {
        signal: controller.signal,
        isCurrent: () => true,
        send: () => undefined
      })
      expect(unregister).toEqual(expect.any(Function))
      unregisters.push(unregister!)
    }

    const contents = new FakeWebContents(74)
    const first = localCatalogPreviewConnection(contents)!
    const event = {
      rootId: 'root:test',
      generation: 'f2e4d210-8bb5-4c19-886c-3ffb816f81ce',
      reason: 'revoked' as const
    }
    expect(emitCatalogPreviewInvalidated(first.connectionId, event)).toBe(false)

    unregisters[0]!()
    controllers[0]!.abort()
    const retried = localCatalogPreviewConnection(contents)!
    expect(retried.connectionId).toBe(first.connectionId)
    expect(emitCatalogPreviewInvalidated(retried.connectionId, event)).toBe(true)
    expect(contents.send).toHaveBeenCalledOnce()

    for (const unregister of unregisters.slice(1)) {
      unregister()
    }
    for (const controller of controllers.slice(1)) {
      controller.abort()
    }
  })
})
