import { describe, expect, it, vi } from 'vitest'
import { bindPreviewInvalidationSource } from './data-catalog-preview-invalidation'

describe('preview invalidation source binding', () => {
  it('unsubscribes on disposal and ignores an already queued event afterward', () => {
    let emit!: (event: unknown) => void
    const unsubscribe = vi.fn()
    const subscribe = vi.fn((listener: (event: unknown) => void) => {
      emit = listener
      return unsubscribe
    })
    const handle = vi.fn()
    const dispose = bindPreviewInvalidationSource(subscribe, handle)

    dispose()
    emit({ rootId: 'root-a', generation: 'generation-a', reason: 'revoked' })
    dispose()

    expect(subscribe).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(handle).not.toHaveBeenCalled()
  })

  it('binds a replacement source independently after reconnect', () => {
    const queued: ((event: unknown) => void)[] = []
    const subscribe = (listener: (event: unknown) => void) => {
      queued.push(listener)
      return vi.fn()
    }
    const handle = vi.fn()
    const disposeOld = bindPreviewInvalidationSource(subscribe, handle)
    disposeOld()
    const disposeNew = bindPreviewInvalidationSource(subscribe, handle)

    queued[0]?.({ id: 'late-old-connection-event' })
    queued[1]?.({ id: 'current-connection-event' })

    expect(handle).toHaveBeenCalledOnce()
    expect(handle).toHaveBeenCalledWith({ id: 'current-connection-event' })
    disposeNew()
  })
})
