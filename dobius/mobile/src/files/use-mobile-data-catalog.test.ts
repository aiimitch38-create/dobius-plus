import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createElement, useLayoutEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMobileDataCatalog } from './use-mobile-data-catalog'
import { useMobileDataCatalogPreview } from './use-mobile-data-catalog-preview'
import {
  MOBILE_CATALOG_MAX_LOADED_ENTRIES,
  parseMobileCatalogPage
} from './mobile-data-catalog-reader-state'
import type { RpcClient } from '../transport/rpc-client'
import type { PreviewInvalidationSource } from '../../../src/shared/data-catalog-preview-invalidation'
import type { DataCatalogRootView } from '../../../src/shared/data-catalog-roots'

const appState = vi.hoisted(() => ({
  currentState: 'active',
  listeners: new Set<(state: string) => void>()
}))
vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return appState.currentState
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appState.listeners.add(listener)
      return { remove: () => appState.listeners.delete(listener) }
    }
  }
}))
vi.mock('expo-router', async () => {
  const React = await import('react')
  return {
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback])
  }
})

let renderer: ReactTestRenderer | null = null
let current: ReturnType<typeof useMobileDataCatalog>
function Harness({
  hostId,
  client,
  invalidationSource
}: {
  hostId: string
  client: Pick<RpcClient, 'sendRequest'> | null
  invalidationSource?: PreviewInvalidationSource | null
}) {
  current = useMobileDataCatalog(hostId, client, Boolean(client), invalidationSource)
  return null
}
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  appState.currentState = 'active'
  appState.listeners.clear()
})

const root = {
  rootId: 'catalog:phone',
  kind: 'folder-workspace',
  label: 'Work',
  generation: '8de3037a-7171-4399-af40-9e31de2cb59e'
}
const rootB = {
  ...root,
  rootId: 'catalog:phone-b',
  generation: 'fc0b696b-8ecb-41a0-87d0-9b29f2a6207e'
}
const entry = {
  entryId: 'e'.repeat(64),
  rootId: root.rootId,
  relativePath: 'drafts/plan.md',
  name: 'plan.md',
  kind: 'file',
  sizeBytes: 100,
  modifiedAtMs: 12,
  contentDigestSha256: null,
  backupCoverage: 'unknown',
  availability: 'available',
  observedAtMs: 15
}
const success = (result: unknown) => ({
  id: 'rpc',
  ok: true as const,
  result,
  _meta: { runtimeId: 'device' }
})
const rootsResult = (roots: unknown[]) => ({ state: 'ready', roots })
const pageResult = (overrides: Record<string, unknown> = {}) => ({
  state: 'complete',
  rootId: root.rootId,
  entries: [entry],
  cursor: null,
  scannedEntries: 1,
  reason: null,
  ...overrides
})

describe('phone data catalog host lifecycle', () => {
  it('uses only the explicit host client and discards delayed old-host data', async () => {
    let releaseOld!: (value: unknown) => void
    const oldClient = {
      sendRequest: vi.fn(
        () =>
          new Promise((resolve) => {
            releaseOld = resolve
          })
      )
    }
    const newClient = {
      sendRequest: vi.fn(async (method: string) =>
        method === 'data.catalog.roots'
          ? success(rootsResult([{ ...root, rootId: 'catalog:new', label: 'New host' }]))
          : success(pageResult({ rootId: 'catalog:new' }))
      )
    }
    await act(async () => {
      renderer = create(createElement(Harness, { hostId: 'host-old', client: oldClient }))
      await Promise.resolve()
    })
    await act(async () => {
      renderer?.update(createElement(Harness, { hostId: 'host-new', client: newClient }))
      await Promise.resolve()
    })
    expect(current.roots.roots[0]?.label).toBe('New host')
    await act(async () => {
      releaseOld(success(rootsResult([root])))
      await Promise.resolve()
    })
    expect(current.roots.roots[0]?.label).toBe('New host')
    expect(oldClient.sendRequest).toHaveBeenCalledWith('data.catalog.roots')
    expect(newClient.sendRequest).toHaveBeenCalledWith('data.catalog.roots')
    expect(
      newClient.sendRequest.mock.calls.every(([method]) =>
        String(method).startsWith('data.catalog.')
      )
    ).toBe(true)
  })

  it('handles cursor expiry and refreshes without file reads', async () => {
    let pageCalls = 0
    const client = {
      sendRequest: vi.fn(async (method: string, params?: unknown) => {
        if (method === 'data.catalog.roots') {
          return success(rootsResult([root]))
        }
        if (params && typeof params === 'object' && 'cursor' in params) {
          pageCalls += 1
          return success(
            pageResult({
              state: 'unavailable',
              rootId: null,
              entries: [],
              cursor: null,
              reason: 'expired'
            })
          )
        }
        return success(pageResult({ cursor: 'f'.repeat(40) }))
      })
    }
    await act(async () => {
      renderer = create(createElement(Harness, { hostId: 'host-a', client }))
      await Promise.resolve()
    })
    await act(async () => {
      current.selectRoot(root.rootId)
      await Promise.resolve()
    })
    expect(current.page.entries).toEqual([entry])
    await act(async () => current.loadMore())
    expect(current.page.reason).toBe('expired')
    expect(current.page.entries).toEqual([])
    await act(async () => current.refreshRoot())
    expect(current.page.entries).toEqual([entry])
    expect(pageCalls).toBe(1)
    expect(client.sendRequest.mock.calls.map(([method]) => method)).toEqual([
      'data.catalog.roots',
      'data.catalog.preview.policy',
      'data.catalog.page',
      'data.catalog.page',
      'data.catalog.page'
    ])
  })

  it('clears preview for every non-active AppState and does not resume on active', async () => {
    const sessionId = '22222222-2222-4222-8222-222222222222'
    const client = {
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'data.catalog.roots') {
          return success(rootsResult([root]))
        }
        if (method === 'data.catalog.preview.policy') {
          return success({ state: 'mobile', enabled: true })
        }
        if (method === 'data.catalog.preview.resolve') {
          return success({
            state: 'ready',
            entryRef: 'r'.repeat(32),
            rootId: root.rootId,
            generation: root.generation,
            fileVersion: 'b'.repeat(64),
            sizeBytes: '2',
            expiresInMs: 30_000
          })
        }
        if (method === 'data.catalog.preview.start') {
          return success({
            state: 'ready',
            previewSessionId: sessionId,
            rootId: root.rootId,
            generation: root.generation,
            fileVersion: 'b'.repeat(64),
            totalBytes: '2',
            chunkBytes: 16_384,
            expiresInMs: 60_000
          })
        }
        if (method === 'data.catalog.preview.chunk') {
          return success({
            state: 'chunk',
            previewSessionId: sessionId,
            rootId: root.rootId,
            generation: root.generation,
            fileVersion: 'b'.repeat(64),
            totalBytes: '2',
            offset: 0,
            nextOffset: 2,
            final: true,
            dataBase64: 'b2s='
          })
        }
        if (method === 'data.catalog.preview.finish') {
          return success({ state: 'visible', leaseTtlMs: 30_000 })
        }
        return success({ state: 'cancelled' })
      })
    }
    await act(async () => {
      renderer = create(createElement(Harness, { hostId: 'host-explicit', client }))
      await Promise.resolve()
    })
    await act(async () => {
      current.selectRoot(root.rootId)
      await Promise.resolve()
    })
    await act(async () => current.previewEntry(entry.entryId))
    expect(current.preview.phase).toBe('visible')
    const resolveCount = client.sendRequest.mock.calls.filter(
      ([method]) => method === 'data.catalog.preview.resolve'
    ).length

    await act(async () => {
      appState.currentState = 'unknown'
      for (const listener of appState.listeners) {
        listener('unknown')
      }
      await Promise.resolve()
    })
    expect(current.preview.phase).toBe('idle')
    await act(async () => {
      appState.currentState = 'active'
      for (const listener of appState.listeners) {
        listener('active')
      }
      await Promise.resolve()
    })
    expect(
      client.sendRequest.mock.calls.filter(([method]) => method === 'data.catalog.preview.resolve')
    ).toHaveLength(resolveCount)
    expect(client.sendRequest.mock.calls.at(-1)?.[0]).toBe('data.catalog.preview.close')
  })

  it('subscribes per active host and ignores late old-host invalidations after reconnect', async () => {
    const sessionId = '22222222-2222-4222-8222-222222222222'
    const createClient = () => ({
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'data.catalog.roots') {
          return success(rootsResult([root]))
        }
        if (method === 'data.catalog.preview.policy') {
          return success({ state: 'mobile', enabled: true })
        }
        if (method === 'data.catalog.preview.resolve') {
          return success({
            state: 'ready',
            entryRef: 'r'.repeat(32),
            rootId: root.rootId,
            generation: root.generation,
            fileVersion: 'b'.repeat(64),
            sizeBytes: '2',
            expiresInMs: 30_000
          })
        }
        if (method === 'data.catalog.preview.start') {
          return success({
            state: 'ready',
            previewSessionId: sessionId,
            rootId: root.rootId,
            generation: root.generation,
            fileVersion: 'b'.repeat(64),
            totalBytes: '2',
            chunkBytes: 16_384,
            expiresInMs: 60_000
          })
        }
        if (method === 'data.catalog.preview.chunk') {
          return success({
            state: 'chunk',
            previewSessionId: sessionId,
            rootId: root.rootId,
            generation: root.generation,
            fileVersion: 'b'.repeat(64),
            totalBytes: '2',
            offset: 0,
            nextOffset: 2,
            final: true,
            dataBase64: 'b2s='
          })
        }
        if (method === 'data.catalog.preview.finish') {
          return success({ state: 'visible', leaseTtlMs: 30_000 })
        }
        return success({ state: 'cancelled' })
      })
    })
    let oldEmit!: (event: unknown) => void
    let newEmit!: (event: unknown) => void
    const oldUnsubscribe = vi.fn()
    const newUnsubscribe = vi.fn()
    const oldSource = (listener: (event: unknown) => void) => {
      oldEmit = listener
      return oldUnsubscribe
    }
    const newSource = vi.fn((listener: (event: unknown) => void) => {
      newEmit = listener
      return newUnsubscribe
    })
    const oldClient = createClient()
    const newClient = createClient()
    await act(async () => {
      renderer = create(
        createElement(Harness, {
          hostId: 'host-old',
          client: oldClient,
          invalidationSource: oldSource
        })
      )
      await Promise.resolve()
    })
    expect(oldEmit).toBeTypeOf('function')

    await act(async () => {
      renderer?.update(
        createElement(Harness, {
          hostId: 'host-new',
          client: newClient,
          invalidationSource: newSource
        })
      )
      await Promise.resolve()
    })
    expect(oldUnsubscribe).toHaveBeenCalledOnce()
    await act(async () => {
      current.selectRoot(root.rootId)
      await Promise.resolve()
    })
    await act(async () => current.previewEntry(entry.entryId))
    expect(current.preview.phase).toBe('visible')

    await act(async () => {
      oldEmit({ rootId: root.rootId, generation: root.generation, reason: 'revoked' })
      await Promise.resolve()
    })
    expect(current.preview.phase).toBe('visible')
    await act(async () => {
      newEmit({ rootId: root.rootId, generation: root.generation, reason: 'revoked' })
      await Promise.resolve()
    })
    expect(current.preview.phase).toBe('failed')

    await act(async () => current.previewEntry(entry.entryId))
    expect(current.preview.phase).toBe('visible')
    const resolveCount = newClient.sendRequest.mock.calls.filter(
      ([method]) => method === 'data.catalog.preview.resolve'
    ).length
    await act(async () => {
      appState.currentState = 'background'
      for (const listener of appState.listeners) {
        listener('background')
      }
      await Promise.resolve()
    })
    expect(current.preview.phase).toBe('idle')
    expect(newUnsubscribe).toHaveBeenCalledOnce()
    await act(async () => {
      appState.currentState = 'active'
      for (const listener of appState.listeners) {
        listener('active')
      }
      await Promise.resolve()
    })
    expect(newSource).toHaveBeenCalledTimes(2)
    expect(
      newClient.sendRequest.mock.calls.filter(
        ([method]) => method === 'data.catalog.preview.resolve'
      )
    ).toHaveLength(resolveCount)

    act(() => renderer?.unmount())
    renderer = null
    expect(newUnsubscribe).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed and mismatched responses instead of showing entries', async () => {
    const client = {
      sendRequest: vi.fn(async (method: string) =>
        method === 'data.catalog.roots'
          ? success(rootsResult([{ ...root, unexpected: true }]))
          : success(pageResult({ rootId: 'catalog:other' }))
      )
    }
    await act(async () => {
      renderer = create(createElement(Harness, { hostId: 'host-a', client }))
      await Promise.resolve()
    })
    expect(current.roots.phase).toBe('unavailable')
    expect(current.roots.roots).toEqual([])
    expect(client.sendRequest).not.toHaveBeenCalledWith('files.read', expect.anything())
    expect(client.sendRequest).not.toHaveBeenCalledWith('terminal.focus', expect.anything())
  })

  it('clears loaded rows and preserves access-denied reason after phone access is revoked', async () => {
    const client = {
      sendRequest: vi.fn(async (method: string, params?: unknown) => {
        if (method === 'data.catalog.roots') {
          return success(rootsResult([root]))
        }
        if (params && typeof params === 'object' && 'cursor' in params) {
          return success({
            state: 'denied',
            rootId: null,
            entries: [],
            cursor: null,
            scannedEntries: 0,
            reason: 'access_denied'
          })
        }
        return success(pageResult({ state: 'partial', cursor: 'g'.repeat(40) }))
      })
    }
    await act(async () => {
      renderer = create(createElement(Harness, { hostId: 'host-a', client }))
      await Promise.resolve()
    })
    await act(async () => {
      current.selectRoot(root.rootId)
      await Promise.resolve()
    })
    expect(current.page.entries).toEqual([entry])
    await act(async () => current.loadMore())
    expect(current.page.phase).toBe('denied')
    expect(current.page.reason).toBe('access_denied')
    expect(current.page.entries).toEqual([])
    expect(current.page.cursor).toBeNull()
  })

  it('ignores a late page from an old generation for the same root ID', async () => {
    const oldGeneration = root.generation
    const newGeneration = 'a4d8ad86-f1e0-46e4-95d4-d17f24502018'
    let releaseOldPage!: (value: unknown) => void
    const oldClient = {
      sendRequest: vi.fn((method: string) => {
        if (method === 'data.catalog.roots') {
          return Promise.resolve(success(rootsResult([{ ...root, generation: oldGeneration }])))
        }
        return new Promise((resolve) => {
          releaseOldPage = resolve
        })
      })
    }
    const newClient = {
      sendRequest: vi.fn(async (method: string) =>
        method === 'data.catalog.roots'
          ? success(rootsResult([{ ...root, generation: newGeneration }]))
          : success(pageResult({ entries: [{ ...entry, name: 'new-generation.md' }] }))
      )
    }
    await act(async () => {
      renderer = create(createElement(Harness, { hostId: 'host-old', client: oldClient }))
      await Promise.resolve()
    })
    await act(async () => {
      current.selectRoot(root.rootId)
      await Promise.resolve()
    })
    expect(oldClient.sendRequest).toHaveBeenCalledWith('data.catalog.page', {
      rootId: root.rootId,
      pageSize: 100
    })

    await act(async () => {
      renderer?.update(createElement(Harness, { hostId: 'host-new', client: newClient }))
      await Promise.resolve()
    })
    expect(current.roots.roots[0]?.generation).toBe(newGeneration)
    await act(async () => {
      current.selectRoot(root.rootId)
      await Promise.resolve()
    })
    expect(current.page.entries[0]?.name).toBe('new-generation.md')
    await act(async () => {
      releaseOldPage(success(pageResult({ entries: [{ ...entry, name: 'old-generation.md' }] })))
      await Promise.resolve()
    })
    expect(current.page.entries[0]?.name).toBe('new-generation.md')
  })

  it('submits a single-use cursor once when load-more is invoked concurrently', async () => {
    let releasePage!: (value: unknown) => void
    const client = {
      sendRequest: vi.fn((method: string, params?: unknown) => {
        if (method === 'data.catalog.roots') {
          return Promise.resolve(success(rootsResult([root])))
        }
        if (params && typeof params === 'object' && 'cursor' in params) {
          return new Promise((resolve) => {
            releasePage = resolve
          })
        }
        return Promise.resolve(success(pageResult({ state: 'partial', cursor: 'h'.repeat(40) })))
      })
    }
    await act(async () => {
      renderer = create(createElement(Harness, { hostId: 'host-a', client }))
      await Promise.resolve()
    })
    await act(async () => {
      current.selectRoot(root.rootId)
      await Promise.resolve()
    })
    expect(current.page.cursor).toBe('h'.repeat(40))

    await act(async () => {
      const first = current.loadMore()
      const duplicate = current.loadMore()
      expect(
        client.sendRequest.mock.calls.filter(
          ([method, params]) => method === 'data.catalog.page' && params && 'cursor' in params
        )
      ).toHaveLength(1)
      releasePage(success(pageResult({ state: 'complete' })))
      await Promise.all([first, duplicate])
    })
    expect(current.page.entries).toHaveLength(2)
  })

  it('reports capped results as partial with the response-limit reason', () => {
    const previousEntries = Array.from(
      { length: MOBILE_CATALOG_MAX_LOADED_ENTRIES - 1 },
      () => entry
    )
    const result = parseMobileCatalogPage(
      pageResult({ state: 'complete', cursor: 'i'.repeat(40) }),
      root.rootId,
      previousEntries
    )
    expect(result.phase).toBe('partial')
    expect(result.reason).toBe('response_limit')
    expect(result.cursor).toBeNull()
    expect(result.entries).toHaveLength(MOBILE_CATALOG_MAX_LOADED_ENTRIES)
  })

  it('rejects a terminal response that names a different non-null root', () => {
    const result = parseMobileCatalogPage(
      pageResult({
        state: 'unavailable',
        rootId: 'catalog:other',
        entries: [],
        cursor: null,
        reason: 'expired'
      }),
      root.rootId
    )
    expect(result.phase).toBe('unavailable')
    expect(result.reason).toBeNull()
    expect(result.error).toContain('different folder')
  })

  it('gates root and host changes on the first committed render and fences late old-host preview', async () => {
    const noteText = 'phone root A note'
    const noteBytes = Buffer.from(noteText)
    const sessionId = '22222222-2222-4222-8222-222222222222'
    let delayNextChunk = false
    let releaseChunk!: (value: unknown) => void
    const createPreviewClient = (): Pick<RpcClient, 'sendRequest'> => ({
      sendRequest: vi.fn<RpcClient['sendRequest']>(async (method, rawParams) => {
        const params = rawParams as { rootId?: string; generation?: string } | undefined
        if (method === 'data.catalog.preview.policy') {
          return success({ state: 'mobile', enabled: true })
        }
        if (method === 'data.catalog.preview.resolve') {
          return success({
            state: 'ready',
            entryRef: 'r'.repeat(32),
            rootId: params?.rootId,
            generation: params?.generation,
            fileVersion: 'b'.repeat(64),
            sizeBytes: String(noteBytes.length),
            expiresInMs: 30_000
          })
        }
        if (method === 'data.catalog.preview.start') {
          return success({
            state: 'ready',
            previewSessionId: sessionId,
            rootId: root.rootId,
            generation: root.generation,
            fileVersion: 'b'.repeat(64),
            totalBytes: String(noteBytes.length),
            chunkBytes: 16_384,
            expiresInMs: 60_000
          })
        }
        if (method === 'data.catalog.preview.chunk') {
          const chunk = success({
            state: 'chunk',
            previewSessionId: sessionId,
            rootId: root.rootId,
            generation: root.generation,
            fileVersion: 'b'.repeat(64),
            totalBytes: String(noteBytes.length),
            offset: 0,
            nextOffset: noteBytes.length,
            final: true,
            dataBase64: noteBytes.toString('base64')
          })
          if (delayNextChunk) {
            delayNextChunk = false
            return new Promise((resolve) => {
              releaseChunk = (value) => resolve(success(value))
            })
          }
          return chunk
        }
        if (method === 'data.catalog.preview.finish') {
          return success({ state: 'visible', leaseTtlMs: 30_000 })
        }
        return success({ state: 'cancelled' })
      })
    })
    const hostAClient = createPreviewClient()
    const hostBClient = createPreviewClient()
    const committed: { hostId: string; rootId: string; phase: string; text?: string }[] = []
    let previewResult!: ReturnType<typeof useMobileDataCatalogPreview>
    const observeCommit = (
      hostId: string,
      selectedRoot: DataCatalogRootView,
      phase: string,
      text?: string
    ) => {
      committed.push({ hostId, rootId: selectedRoot.rootId, phase, text })
    }
    function PreviewHarness({
      hostId,
      client,
      selectedRoot
    }: {
      hostId: string
      client: typeof hostAClient
      selectedRoot: DataCatalogRootView
    }) {
      previewResult = useMobileDataCatalogPreview(hostId, client, true, selectedRoot)
      useLayoutEffect(() => {
        observeCommit(
          hostId,
          selectedRoot,
          previewResult.preview.phase,
          previewResult.preview.phase === 'visible' ? previewResult.preview.text : undefined
        )
      }, [hostId, selectedRoot, previewResult.preview])
      return createElement(
        'span',
        null,
        previewResult.preview.phase === 'visible' ? previewResult.preview.text : ''
      )
    }

    await act(async () => {
      renderer = create(
        createElement(PreviewHarness, {
          hostId: 'host-a',
          client: hostAClient,
          selectedRoot: root
        })
      )
      await Promise.resolve()
    })
    await act(async () => previewResult.previewEntry(entry.entryId))
    expect(previewResult.preview).toMatchObject({ phase: 'visible', text: noteText })

    committed.length = 0
    await act(async () => {
      renderer?.update(
        createElement(PreviewHarness, {
          hostId: 'host-a',
          client: hostAClient,
          selectedRoot: rootB
        })
      )
      await Promise.resolve()
    })
    const firstRootBCommit = committed.find(
      (commit) => commit.hostId === 'host-a' && commit.rootId === rootB.rootId
    )
    expect(firstRootBCommit?.phase).toBe('idle')
    expect(firstRootBCommit?.text).toBeUndefined()

    await act(async () => {
      renderer?.update(
        createElement(PreviewHarness, {
          hostId: 'host-a',
          client: hostAClient,
          selectedRoot: root
        })
      )
      await Promise.resolve()
    })
    delayNextChunk = true
    act(() => previewResult.previewEntry(entry.entryId))
    await vi.waitFor(() => expect(releaseChunk).toBeTypeOf('function'))
    committed.length = 0
    await act(async () => {
      renderer?.update(
        createElement(PreviewHarness, {
          hostId: 'host-b',
          client: hostBClient,
          selectedRoot: root
        })
      )
      await Promise.resolve()
    })
    const firstHostBCommit = committed.find((commit) => commit.hostId === 'host-b')
    expect(firstHostBCommit?.phase).toBe('idle')
    expect(firstHostBCommit?.text).toBeUndefined()
    await act(async () => {
      releaseChunk({
        state: 'chunk',
        previewSessionId: sessionId,
        rootId: root.rootId,
        generation: root.generation,
        fileVersion: 'b'.repeat(64),
        totalBytes: String(noteBytes.length),
        offset: 0,
        nextOffset: noteBytes.length,
        final: true,
        dataBase64: noteBytes.toString('base64')
      })
      await Promise.resolve()
    })
    expect(previewResult.preview.phase).toBe('idle')
    expect(committed.some((commit) => commit.hostId === 'host-b' && commit.text)).toBe(false)
  })
})
