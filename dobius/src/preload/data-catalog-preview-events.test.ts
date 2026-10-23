import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { subscribeDataCatalogPreviewInvalidated } from './data-catalog-preview-events'

describe('preload catalog preview invalidation subscription', () => {
  it('delivers only strict content-free events and removes its listener', () => {
    const ipc = new EventEmitter()
    const callback = vi.fn()
    const unsubscribe = subscribeDataCatalogPreviewInvalidated(ipc, callback)
    const event = {
      rootId: 'root:test',
      generation: 'f2e4d210-8bb5-4c19-886c-3ffb816f81ce',
      reason: 'revoked'
    }
    ipc.emit('dataCatalog:previewInvalidated', {}, event)
    ipc.emit('dataCatalog:previewInvalidated', {}, { ...event, content: 'private' })
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(event)

    unsubscribe()
    ipc.emit('dataCatalog:previewInvalidated', {}, event)
    expect(callback).toHaveBeenCalledTimes(1)
  })
})
