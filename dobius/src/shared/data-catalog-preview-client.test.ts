import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { DataCatalogPreviewClient } from './data-catalog-preview-client'
import type { DataCatalogPreviewRpc } from './data-catalog-preview-client-errors'
import type { PreviewAssembly } from './data-catalog-preview-assembly'

const rootId = 'root-catalog-0001'
const generation = '11111111-1111-4111-8111-111111111111'
const previewSessionId = '22222222-2222-4222-8222-222222222222'
const entryId = 'a'.repeat(64)
const fileVersion = 'b'.repeat(64)
const utf8 = new TextEncoder().encode('first ☁️\nsecond <script>alert(1)</script>')

describe('DataCatalogPreviewClient', () => {
  afterEach(() => vi.useRealTimers())

  it('fetches complete ordered bytes and reveals inert text only after finish', async () => {
    const rpc = makeRpc(utf8)
    const client = new DataCatalogPreviewClient({
      rpc,
      isForeground: () => true,
      monotonicNow: () => 100
    })
    const seen: string[] = []
    client.subscribe((state) => {
      if (state.phase === 'visible') {
        seen.push(state.text)
      }
    })

    await client.preview({ rootId, generation, entryId })

    expect(rpc.mock.calls.map(([method]) => method)).toEqual([
      'data.catalog.preview.resolve',
      'data.catalog.preview.start',
      'data.catalog.preview.chunk',
      'data.catalog.preview.chunk',
      'data.catalog.preview.finish'
    ])
    expect(rpc.mock.calls[2]?.[1]).toEqual({ previewSessionId, offset: 0 })
    expect(rpc.mock.calls[3]?.[1]).toEqual({ previewSessionId, offset: 13 })
    expect(seen).toEqual(['first ☁️\nsecond <script>alert(1)</script>'])
    expect(client.getState().phase).toBe('visible')
  })

  it.each([
    ['malformed UTF-8', new Uint8Array([...new TextEncoder().encode('a'.repeat(13)), 0xc3])],
    ['NUL', new Uint8Array([...new TextEncoder().encode('a'.repeat(13)), 0x00])],
    ['forbidden C0 control', new Uint8Array([...new TextEncoder().encode('a'.repeat(13)), 0x01])]
  ])(
    'refuses %s before finish, publishes no text, and zeroes the assembled bytes',
    async (_label, bytes) => {
      let releaseSecondChunk!: () => void
      const rpc = makeRpc(bytes, async (method, params) => {
        if (
          method === 'data.catalog.preview.chunk' &&
          typeof params === 'object' &&
          params !== null &&
          'offset' in params &&
          params.offset === 13
        ) {
          return new Promise<void>((resolve) => {
            releaseSecondChunk = resolve
          })
        }
        return undefined
      })
      let client!: DataCatalogPreviewClient
      client = new DataCatalogPreviewClient({
        rpc,
        isForeground: () => true,
        monotonicNow: () => 100
      })
      const visible: string[] = []
      client.subscribe((state) => {
        if (state.phase === 'visible') {
          visible.push(state.text)
        }
      })

      const pending = client.preview({ rootId, generation, entryId })
      await vi.waitFor(() => expect(releaseSecondChunk).toBeTypeOf('function'))
      const assembly = (client as unknown as { inFlightAssembly: PreviewAssembly | null })
        .inFlightAssembly
      const retainedPrefix = assembly?.chunks[0]
      expect(retainedPrefix?.some((byte) => byte !== 0)).toBe(true)
      releaseSecondChunk()
      await pending

      expect(visible).toEqual([])
      expect(client.getState()).toMatchObject({
        phase: 'failed',
        reason: 'This entry cannot be previewed here.'
      })
      expect(rpc.mock.calls.some(([method]) => method === 'data.catalog.preview.finish')).toBe(
        false
      )
      expect(retainedPrefix?.every((byte) => byte === 0)).toBe(true)
      expect(rpc.mock.calls.at(-1)?.[0]).toBe('data.catalog.preview.close')
    }
  )

  it('never exposes partial bytes when a chunk is delayed and the app backgrounds', async () => {
    let releaseChunk!: (value: unknown) => void
    const rpc = makeRpc(utf8, async (method) => {
      if (method === 'data.catalog.preview.chunk') {
        return new Promise<unknown>((resolve) => {
          releaseChunk = resolve
        })
      }
      return undefined
    })
    let foreground = true
    const client = new DataCatalogPreviewClient({
      rpc,
      isForeground: () => foreground,
      monotonicNow: () => 500
    })
    const seen: string[] = []
    client.subscribe((state) => {
      if (state.phase === 'visible') {
        seen.push(state.text)
      }
    })

    const pending = client.preview({ rootId, generation, entryId })
    await vi.waitFor(() => expect(releaseChunk).toBeTypeOf('function'))
    foreground = false
    client.setForeground(false)
    releaseChunk(chunkFrame(utf8, 0, utf8.length, true))
    await pending

    expect(seen).toEqual([])
    expect(client.getState().phase).toBe('idle')
    expect(rpc.mock.calls.some(([method]) => method === 'data.catalog.preview.finish')).toBe(false)
  })

  it('immediately zeroes in-flight bytes on a matching invalidation before a delayed chunk returns', async () => {
    let releaseSecondChunk!: (value: unknown) => void
    const rpc = makeRpc(utf8, (method, params) => {
      const offset =
        typeof params === 'object' && params !== null && 'offset' in params ? params.offset : null
      if (method === 'data.catalog.preview.chunk' && offset === 13) {
        return new Promise<unknown>((resolve) => {
          releaseSecondChunk = resolve
        })
      }
      return undefined
    })
    const client = new DataCatalogPreviewClient({
      rpc,
      isForeground: () => true,
      monotonicNow: () => 100
    })

    const pending = client.preview({ rootId, generation, entryId })
    await vi.waitFor(() => expect(releaseSecondChunk).toBeTypeOf('function'))
    const assembly = (client as unknown as { inFlightAssembly: PreviewAssembly | null })
      .inFlightAssembly
    const firstChunk = assembly?.chunks[0]
    expect(firstChunk?.some((byte) => byte !== 0)).toBe(true)

    client.handleInvalidation({ rootId, generation, reason: 'root_changed' })
    expect(firstChunk?.every((byte) => byte === 0)).toBe(true)
    releaseSecondChunk(chunkFrame(utf8, 13, utf8.length, true))
    await pending

    expect(client.getState()).toMatchObject({ phase: 'failed' })
    expect(rpc.mock.calls.some(([method]) => method === 'data.catalog.preview.finish')).toBe(false)
  })

  it('zeroes entry A assembly and ignores its late chunk while entry B grant is pending', async () => {
    const nextEntryId = 'c'.repeat(64)
    let releaseAChunk!: (value: unknown) => void
    let releaseBGrant!: (value: unknown) => void
    let delayAChunk = true
    const rpc = makeRpc(utf8, (method, params) => {
      if (
        method === 'data.catalog.preview.resolve' &&
        typeof params === 'object' &&
        params !== null &&
        'entryId' in params &&
        params.entryId === nextEntryId
      ) {
        return new Promise<unknown>((resolve) => {
          releaseBGrant = resolve
        })
      }
      const offset =
        typeof params === 'object' && params !== null && 'offset' in params ? params.offset : null
      if (method === 'data.catalog.preview.chunk' && offset === 13 && delayAChunk) {
        delayAChunk = false
        return new Promise<unknown>((resolve) => {
          releaseAChunk = resolve
        })
      }
      return undefined
    })
    const client = new DataCatalogPreviewClient({
      rpc,
      isForeground: () => true,
      monotonicNow: () => 100
    })
    const visible: string[] = []
    client.subscribe((state) => {
      if (state.phase === 'visible') {
        visible.push(state.text)
      }
    })

    const entryA = client.preview({ rootId, generation, entryId })
    await vi.waitFor(() => expect(releaseAChunk).toBeTypeOf('function'))
    const assembly = (client as unknown as { inFlightAssembly: PreviewAssembly | null })
      .inFlightAssembly
    const retainedFirstChunk = assembly?.chunks[0]
    expect(retainedFirstChunk?.some((byte) => byte !== 0)).toBe(true)

    const entryB = client.preview({ rootId, generation, entryId: nextEntryId })
    await vi.waitFor(() => expect(releaseBGrant).toBeTypeOf('function'))
    expect(retainedFirstChunk?.every((byte) => byte === 0)).toBe(true)
    expect(client.getState().phase).toBe('loading')

    releaseAChunk(chunkFrame(utf8, 13, utf8.length, true))
    await entryA
    expect(visible).toEqual([])
    expect(client.getState().phase).toBe('loading')

    releaseBGrant({ state: 'denied' })
    await entryB
    expect(visible).toEqual([])
    expect(client.getState().phase).toBe('failed')
    expect(rpc.mock.calls.some(([method]) => method === 'data.catalog.preview.finish')).toBe(false)
  })

  it('does not automatically resume after returning to foreground', async () => {
    const rpc = makeRpc(utf8)
    let foreground = true
    const client = new DataCatalogPreviewClient({
      rpc,
      isForeground: () => foreground,
      monotonicNow: () => 1000
    })
    await client.preview({ rootId, generation, entryId })
    expect(client.getState().phase).toBe('visible')

    foreground = false
    client.setForeground(false)
    foreground = true
    client.setForeground(true)
    await Promise.resolve()
    expect(client.getState().phase).toBe('idle')
    expect(
      rpc.mock.calls.filter(([method]) => method === 'data.catalog.preview.resolve')
    ).toHaveLength(1)
  })

  it('keeps the 30 second request-start deadline when finish arrives late', async () => {
    let now = 0
    const rpc = makeRpc(utf8, async (method) => {
      if (method === 'data.catalog.preview.finish') {
        now = 30_001
      }
    })
    const client = new DataCatalogPreviewClient({
      rpc,
      isForeground: () => true,
      monotonicNow: () => now
    })

    await client.preview({ rootId, generation, entryId })

    expect(client.getState().phase).toBe('failed')
    expect(rpc.mock.calls.some(([method]) => method === 'data.catalog.preview.renew')).toBe(false)
  })

  it('does not accept a renewal response delivered after the visible lease expires', async () => {
    vi.useFakeTimers()
    let now = 0
    let releaseRenew!: (value: unknown) => void
    const rpc = makeRpc(utf8, async (method) => {
      if (method === 'data.catalog.preview.renew') {
        return new Promise<unknown>((resolve) => {
          releaseRenew = resolve
        })
      }
      return undefined
    })
    const client = new DataCatalogPreviewClient({
      rpc,
      isForeground: () => true,
      monotonicNow: () => now
    })
    await client.preview({ rootId, generation, entryId })
    expect(client.getState().phase).toBe('visible')

    now = 10_000
    await vi.advanceTimersByTimeAsync(10_000)
    expect(releaseRenew).toBeTypeOf('function')
    now = 30_001
    await vi.advanceTimersByTimeAsync(20_000)
    expect(client.getState()).toMatchObject({
      phase: 'failed',
      reason: expect.stringContaining('expired')
    })
    releaseRenew({ state: 'visible', leaseTtlMs: 30_000 })
    await vi.runOnlyPendingTimersAsync()
    expect(client.getState()).toMatchObject({
      phase: 'failed',
      reason: expect.stringContaining('expired')
    })
  })

  it.each(['revoked', 'root_changed', 'connection_ended', 'expired'] as const)(
    'clears a visible preview on a matching %s invalidation event',
    async (reason) => {
      const rpc = makeRpc(utf8)
      const client = new DataCatalogPreviewClient({
        rpc,
        isForeground: () => true,
        monotonicNow: () => 100
      })
      await client.preview({ rootId, generation, entryId })

      client.handleInvalidation({ rootId, generation, reason })
      await vi.waitFor(() => expect(client.getState().phase).toBe('failed'))
      expect(rpc.mock.calls.at(-1)?.[0]).toBe('data.catalog.preview.close')
      expect(client.getState()).toMatchObject({ phase: 'failed' })
    }
  )

  it('ignores malformed or different-root/generation invalidation events', async () => {
    const client = new DataCatalogPreviewClient({
      rpc: makeRpc(utf8),
      isForeground: () => true,
      monotonicNow: () => 100
    })
    await client.preview({ rootId, generation, entryId })

    client.handleInvalidation({ rootId: 'other-root', generation, reason: 'revoked' })
    client.handleInvalidation({
      rootId,
      generation: '33333333-3333-4333-8333-333333333333',
      reason: 'revoked'
    })
    client.handleInvalidation({ rootId, generation, reason: 'unknown-reason' })

    expect(client.getState().phase).toBe('visible')
  })

  it('fails closed on malformed API results without exposing server error text', async () => {
    const rpc = vi.fn<DataCatalogPreviewRpc>(async (method) => {
      if (method === 'data.catalog.preview.resolve') {
        return { state: 'ready', message: 'secret server detail' }
      }
      return {}
    })
    const client = new DataCatalogPreviewClient({
      rpc,
      isForeground: () => true,
      monotonicNow: () => 10
    })
    await client.preview({ rootId, generation, entryId })

    expect(client.getState()).toEqual({
      phase: 'failed',
      reason: 'Preview is unavailable. Try again later.'
    })
    expect(JSON.stringify(client.getState())).not.toContain('secret server detail')
  })
})

function makeRpc(
  bytes: Uint8Array,
  beforeReply?: (method: string, params?: unknown) => Promise<unknown> | unknown
): Mock<DataCatalogPreviewRpc> {
  let started = false
  return vi.fn<DataCatalogPreviewRpc>(async (method, params) => {
    const override = await beforeReply?.(method, params)
    if (override !== undefined) {
      return override
    }
    switch (method) {
      case 'data.catalog.preview.resolve':
        return {
          state: 'ready',
          entryRef: 'r'.repeat(32),
          rootId,
          generation,
          fileVersion,
          sizeBytes: String(bytes.length),
          expiresInMs: 30_000
        }
      case 'data.catalog.preview.start':
        started = true
        return {
          state: 'ready',
          previewSessionId,
          rootId,
          generation,
          fileVersion,
          totalBytes: String(bytes.length),
          chunkBytes: 16_384,
          expiresInMs: 60_000
        }
      case 'data.catalog.preview.chunk': {
        if (!started) {
          throw new Error('start required')
        }
        const offset = (params as { offset: number }).offset
        const split = Math.min(13, bytes.length)
        return chunkFrame(
          bytes,
          offset,
          offset === 0 ? split : bytes.length,
          offset !== 0 || bytes.length <= split
        )
      }
      case 'data.catalog.preview.finish':
      case 'data.catalog.preview.renew':
        return { state: 'visible', leaseTtlMs: 30_000 }
      case 'data.catalog.preview.close':
        return { state: 'cancelled' }
      default:
        throw new Error(`Unexpected ${method}`)
    }
  })
}

function chunkFrame(bytes: Uint8Array, offset: number, end: number, final: boolean) {
  return {
    state: 'chunk',
    previewSessionId,
    rootId,
    generation,
    fileVersion,
    totalBytes: String(bytes.length),
    offset,
    nextOffset: end,
    final,
    dataBase64: Buffer.from(bytes.slice(offset, end)).toString('base64')
  }
}
