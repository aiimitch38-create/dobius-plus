// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { catalogTargetFromSelection, useDataCatalog } from './use-data-catalog'
import { useDataCatalogPreview } from './use-data-catalog-preview'
import type { DataCatalogRootView } from '../../../../shared/data-catalog-roots'
import {
  DESKTOP_CATALOG_MAX_LOADED_ENTRIES,
  parseDesktopCatalogPage
} from './data-catalog-reader-state'

const runtime = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../../runtime/runtime-rpc-client', () => ({ callRuntimeRpc: runtime.call }))

afterEach(() => {
  cleanup()
  runtime.call.mockReset()
  vi.restoreAllMocks()
})

const ROOT = {
  rootId: 'catalog:root-1',
  kind: 'obsidian-vault',
  label: 'Notes',
  generation: '8de3037a-7171-4399-af40-9e31de2cb59e'
} as const
const ROOT_B = {
  ...ROOT,
  rootId: 'catalog:root-2',
  generation: 'fc0b696b-8ecb-41a0-87d0-9b29f2a6207e'
} as const
const ENTRY = {
  entryId: 'a'.repeat(64),
  rootId: ROOT.rootId,
  relativePath: 'Folder/note.md',
  name: 'note.md',
  kind: 'file',
  sizeBytes: 25,
  modifiedAtMs: null,
  contentDigestSha256: null,
  backupCoverage: 'unknown',
  availability: 'available',
  observedAtMs: 10
} as const
const rootsResponse = (roots: readonly unknown[]) => ({ state: 'ready', roots })
const pageResponse = (overrides: Record<string, unknown> = {}) => ({
  state: 'complete',
  rootId: ROOT.rootId,
  entries: [ENTRY],
  cursor: null,
  scannedEntries: 1,
  reason: null,
  ...overrides
})

describe('desktop data catalog reader', () => {
  it('requires an explicit registered target and never derives it from active runtime state', () => {
    expect(catalogTargetFromSelection('', [{ id: 'env-1' }])).toBeNull()
    expect(catalogTargetFromSelection('local', [{ id: 'env-1' }])).toEqual({ kind: 'local' })
    expect(catalogTargetFromSelection('environment:removed', [{ id: 'env-1' }])).toBeNull()
    expect(catalogTargetFromSelection('environment:env-1', [{ id: 'env-1' }])).toEqual({
      kind: 'environment',
      environmentId: 'env-1'
    })
  })

  it('reads roots and metadata from the explicit target, then distinguishes partial pages', async () => {
    runtime.call.mockImplementation(async (_target, method) =>
      method === 'data.catalog.roots'
        ? rootsResponse([ROOT])
        : pageResponse({ state: 'partial', cursor: 'b'.repeat(40), reason: 'scan_limit' })
    )
    const target = { kind: 'environment' as const, environmentId: 'env-1' }
    const { result } = renderHook(() => useDataCatalog(target))
    await waitFor(() => expect(result.current.roots.phase).toBe('ready'))
    expect(runtime.call).toHaveBeenCalledWith(
      target,
      'data.catalog.roots',
      undefined,
      expect.anything()
    )
    act(() => result.current.selectRoot(ROOT.rootId))
    await waitFor(() => expect(result.current.page.phase).toBe('partial'))
    expect(result.current.page.entries).toEqual([ENTRY])
    expect(runtime.call).toHaveBeenLastCalledWith(
      target,
      'data.catalog.page',
      { rootId: ROOT.rootId, pageSize: 100 },
      expect.anything()
    )
  })

  it('clears preview on blur and requires another explicit click after focus returns', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    runtime.call.mockImplementation(async (_target, method) => {
      if (method === 'data.catalog.roots') {
        return rootsResponse([ROOT])
      }
      if (method === 'data.catalog.page') {
        return pageResponse()
      }
      if (method === 'data.catalog.preview.policy') {
        return { state: 'local', desktopPreviewEnabled: true, deviceIds: [], devices: [] }
      }
      if (method === 'data.catalog.preview.resolve') {
        return {
          state: 'ready',
          entryRef: 'r'.repeat(32),
          rootId: ROOT.rootId,
          generation: ROOT.generation,
          fileVersion: 'b'.repeat(64),
          sizeBytes: '2',
          expiresInMs: 30_000
        }
      }
      if (method === 'data.catalog.preview.start') {
        return {
          state: 'ready',
          previewSessionId: '22222222-2222-4222-8222-222222222222',
          rootId: ROOT.rootId,
          generation: ROOT.generation,
          fileVersion: 'b'.repeat(64),
          totalBytes: '2',
          chunkBytes: 16_384,
          expiresInMs: 60_000
        }
      }
      if (method === 'data.catalog.preview.chunk') {
        return {
          state: 'chunk',
          previewSessionId: '22222222-2222-4222-8222-222222222222',
          rootId: ROOT.rootId,
          generation: ROOT.generation,
          fileVersion: 'b'.repeat(64),
          totalBytes: '2',
          offset: 0,
          nextOffset: 2,
          final: true,
          dataBase64: 'b2s='
        }
      }
      if (method === 'data.catalog.preview.finish') {
        return { state: 'visible', leaseTtlMs: 30_000 }
      }
      return { state: 'cancelled' }
    })
    const { result } = renderHook(() => useDataCatalog({ kind: 'local' }))
    await waitFor(() => expect(result.current.roots.phase).toBe('ready'))
    act(() => result.current.selectRoot(ROOT.rootId))
    await waitFor(() => expect(result.current.page.entries).toEqual([ENTRY]))
    await act(async () => result.current.previewEntry(ENTRY.entryId))
    await waitFor(() => expect(result.current.preview.phase).toBe('visible'))
    const resolveCount = runtime.call.mock.calls.filter(
      ([, method]) => method === 'data.catalog.preview.resolve'
    ).length

    act(() => window.dispatchEvent(new Event('blur')))
    await waitFor(() => expect(result.current.preview.phase).toBe('idle'))
    act(() => window.dispatchEvent(new Event('focus')))
    await Promise.resolve()

    expect(
      runtime.call.mock.calls.filter(([, method]) => method === 'data.catalog.preview.resolve')
    ).toHaveLength(resolveCount)
    expect(runtime.call.mock.calls.at(-1)?.[1]).toBe('data.catalog.preview.close')
  })

  it('binds the local invalidation source while foregrounded and clears only the matching root', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    let emit!: (event: unknown) => void
    const unsubscribe = vi.fn()
    const invalidationSource = vi.fn((listener: (event: unknown) => void) => {
      emit = listener
      return unsubscribe
    })
    runtime.call.mockImplementation(async (_target, method) => {
      if (method === 'data.catalog.roots') {
        return rootsResponse([ROOT])
      }
      if (method === 'data.catalog.page') {
        return pageResponse()
      }
      if (method === 'data.catalog.preview.policy') {
        return { state: 'local', desktopPreviewEnabled: true, deviceIds: [], devices: [] }
      }
      if (method === 'data.catalog.preview.resolve') {
        return {
          state: 'ready',
          entryRef: 'r'.repeat(32),
          rootId: ROOT.rootId,
          generation: ROOT.generation,
          fileVersion: 'b'.repeat(64),
          sizeBytes: '2',
          expiresInMs: 30_000
        }
      }
      if (method === 'data.catalog.preview.start') {
        return {
          state: 'ready',
          previewSessionId: '22222222-2222-4222-8222-222222222222',
          rootId: ROOT.rootId,
          generation: ROOT.generation,
          fileVersion: 'b'.repeat(64),
          totalBytes: '2',
          chunkBytes: 16_384,
          expiresInMs: 60_000
        }
      }
      if (method === 'data.catalog.preview.chunk') {
        return {
          state: 'chunk',
          previewSessionId: '22222222-2222-4222-8222-222222222222',
          rootId: ROOT.rootId,
          generation: ROOT.generation,
          fileVersion: 'b'.repeat(64),
          totalBytes: '2',
          offset: 0,
          nextOffset: 2,
          final: true,
          dataBase64: 'b2s='
        }
      }
      if (method === 'data.catalog.preview.finish') {
        return { state: 'visible', leaseTtlMs: 30_000 }
      }
      return { state: 'cancelled' }
    })
    const { result, unmount } = renderHook(() =>
      useDataCatalog({ kind: 'local' }, invalidationSource)
    )
    await waitFor(() => expect(result.current.roots.phase).toBe('ready'))
    act(() => result.current.selectRoot(ROOT.rootId))
    await waitFor(() => expect(result.current.page.entries).toEqual([ENTRY]))
    await act(async () => result.current.previewEntry(ENTRY.entryId))
    await waitFor(() => expect(result.current.preview.phase).toBe('visible'))

    act(() => emit({ rootId: 'catalog:other', generation: ROOT.generation, reason: 'revoked' }))
    expect(result.current.preview.phase).toBe('visible')
    act(() => emit({ rootId: ROOT.rootId, generation: ROOT.generation, reason: 'revoked' }))
    await waitFor(() => expect(result.current.preview.phase).toBe('failed'))
    expect(runtime.call.mock.calls.at(-1)?.[1]).toBe('data.catalog.preview.close')

    const oldListener = emit
    act(() => window.dispatchEvent(new Event('blur')))
    expect(unsubscribe).toHaveBeenCalledOnce()
    act(() => window.dispatchEvent(new Event('focus')))
    expect(invalidationSource).toHaveBeenCalledTimes(2)
    act(() => oldListener({ rootId: ROOT.rootId, generation: ROOT.generation, reason: 'expired' }))
    expect(result.current.preview.phase).toBe('idle')
    expect(
      runtime.call.mock.calls.filter(([, method]) => method === 'data.catalog.preview.resolve')
    ).toHaveLength(1)

    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(2)
  })

  it('discards a late old-host root response after an explicit target switch', async () => {
    let resolveOld!: (value: unknown) => void
    runtime.call.mockImplementation(
      (target: { kind: string; environmentId?: string }, method: string) => {
        if (method !== 'data.catalog.roots') {
          return Promise.resolve(pageResponse())
        }
        if (target.kind === 'environment' && target.environmentId === 'old') {
          return new Promise((resolve) => {
            resolveOld = resolve
          })
        }
        return Promise.resolve(
          rootsResponse([{ ...ROOT, rootId: 'catalog:new', label: 'New host' }])
        )
      }
    )
    const { result, rerender } = renderHook(({ target }) => useDataCatalog(target), {
      initialProps: { target: { kind: 'environment' as const, environmentId: 'old' } }
    })
    rerender({ target: { kind: 'environment' as const, environmentId: 'new' } })
    await waitFor(() => expect(result.current.roots.roots[0]?.label).toBe('New host'))
    await act(async () => {
      resolveOld(rootsResponse([ROOT]))
      await Promise.resolve()
    })
    expect(result.current.roots.roots[0]?.label).toBe('New host')
  })

  it('fails closed on bad schemas and refreshes an expired cursor from the first page', async () => {
    let cursorCalls = 0
    runtime.call.mockImplementation(async (_target, method, params) => {
      if (method === 'data.catalog.roots') {
        return rootsResponse([ROOT])
      }
      if (params && 'cursor' in params) {
        cursorCalls += 1
        return pageResponse({
          state: 'unavailable',
          rootId: null,
          entries: [],
          cursor: null,
          reason: 'expired'
        })
      }
      return pageResponse({ cursor: 'c'.repeat(40) })
    })
    const { result } = renderHook(() => useDataCatalog({ kind: 'local' }))
    await waitFor(() => expect(result.current.roots.phase).toBe('ready'))
    act(() => result.current.selectRoot(ROOT.rootId))
    await waitFor(() => expect(result.current.page.cursor).toBe('c'.repeat(40)))
    await act(async () => result.current.loadMore())
    expect(result.current.page.reason).toBe('expired')
    expect(result.current.page.entries).toEqual([])
    await act(async () => result.current.refreshRoot())
    expect(cursorCalls).toBe(1)
    expect(result.current.page.entries).toEqual([ENTRY])

    runtime.call.mockResolvedValueOnce({
      state: 'ready',
      roots: [{ ...ROOT, unexpected: 'field' }]
    })
    await act(async () => result.current.refreshRoots())
    expect(result.current.roots.phase).toBe('unavailable')
    expect(result.current.roots.roots).toEqual([])
  })

  it('clears loaded rows and preserves denial reason when access is revoked mid-page', async () => {
    runtime.call.mockImplementation(async (_target, method, params) => {
      if (method === 'data.catalog.roots') {
        return rootsResponse([ROOT])
      }
      if (params && 'cursor' in params) {
        return pageResponse({
          state: 'denied',
          rootId: null,
          entries: [],
          cursor: null,
          reason: 'access_denied'
        })
      }
      return pageResponse({ state: 'partial', cursor: 'r'.repeat(40) })
    })
    const { result } = renderHook(() => useDataCatalog({ kind: 'local' }))
    await waitFor(() => expect(result.current.roots.phase).toBe('ready'))
    act(() => result.current.selectRoot(ROOT.rootId))
    await waitFor(() => expect(result.current.page.entries).toEqual([ENTRY]))
    await act(async () => result.current.loadMore())
    expect(result.current.page.phase).toBe('denied')
    expect(result.current.page.reason).toBe('access_denied')
    expect(result.current.page.entries).toEqual([])
    expect(result.current.page.cursor).toBeNull()
  })

  it('ignores a late page from an old host after the same root changes generation', async () => {
    const oldGeneration = ROOT.generation
    const newGeneration = 'a4d8ad86-f1e0-46e4-95d4-d17f24502018'
    let resolveOldPage!: (value: unknown) => void
    runtime.call.mockImplementation((target, method) => {
      if (method === 'data.catalog.roots') {
        const generation = target.environmentId === 'old-host' ? oldGeneration : newGeneration
        return Promise.resolve(rootsResponse([{ ...ROOT, generation }]))
      }
      if (target.environmentId === 'old-host') {
        return new Promise((resolve) => {
          resolveOldPage = resolve
        })
      }
      return Promise.resolve(pageResponse({ entries: [{ ...ENTRY, name: 'new-generation.md' }] }))
    })
    const { result, rerender } = renderHook(({ target }) => useDataCatalog(target), {
      initialProps: {
        target: { kind: 'environment' as const, environmentId: 'old-host' }
      }
    })
    await waitFor(() => expect(result.current.roots.phase).toBe('ready'))
    act(() => result.current.selectRoot(ROOT.rootId))
    await waitFor(() => expect(resolveOldPage).toBeTypeOf('function'))

    rerender({ target: { kind: 'environment' as const, environmentId: 'new-host' } })
    await waitFor(() => expect(result.current.roots.roots[0]?.generation).toBe(newGeneration))
    act(() => result.current.selectRoot(ROOT.rootId))
    await waitFor(() => expect(result.current.page.entries[0]?.name).toBe('new-generation.md'))
    await act(async () => {
      resolveOldPage(pageResponse({ entries: [{ ...ENTRY, name: 'old-generation.md' }] }))
      await Promise.resolve()
    })
    expect(result.current.page.entries[0]?.name).toBe('new-generation.md')
  })

  it('submits a single-use cursor once when load-more is invoked concurrently', async () => {
    let releasePage!: (value: unknown) => void
    runtime.call.mockImplementation((_target, method, params) => {
      if (method === 'data.catalog.roots') {
        return Promise.resolve(rootsResponse([ROOT]))
      }
      if (params && 'cursor' in params) {
        return new Promise((resolve) => {
          releasePage = resolve
        })
      }
      return Promise.resolve(pageResponse({ state: 'partial', cursor: 's'.repeat(40) }))
    })
    const { result } = renderHook(() => useDataCatalog({ kind: 'local' }))
    await waitFor(() => expect(result.current.roots.phase).toBe('ready'))
    act(() => result.current.selectRoot(ROOT.rootId))
    await waitFor(() => expect(result.current.page.cursor).toBe('s'.repeat(40)))

    await act(async () => {
      const first = result.current.loadMore()
      const duplicate = result.current.loadMore()
      expect(
        runtime.call.mock.calls.filter(
          ([, method, params]) => method === 'data.catalog.page' && params && 'cursor' in params
        )
      ).toHaveLength(1)
      releasePage(pageResponse({ state: 'complete' }))
      await Promise.all([first, duplicate])
    })
    expect(result.current.page.entries).toHaveLength(2)
  })

  it('reports capped results as partial with the response-limit reason', () => {
    const previousEntries = Array.from(
      { length: DESKTOP_CATALOG_MAX_LOADED_ENTRIES - 1 },
      () => ENTRY
    )
    const result = parseDesktopCatalogPage(
      pageResponse({ state: 'complete', cursor: 't'.repeat(40) }),
      ROOT.rootId,
      previousEntries
    )
    expect(result.phase).toBe('partial')
    expect(result.reason).toBe('response_limit')
    expect(result.cursor).toBeNull()
    expect(result.entries).toHaveLength(DESKTOP_CATALOG_MAX_LOADED_ENTRIES)
  })

  it('rejects a terminal response that names a different non-null root', () => {
    const result = parseDesktopCatalogPage(
      pageResponse({
        state: 'unavailable',
        rootId: 'catalog:other',
        entries: [],
        cursor: null,
        reason: 'expired'
      }),
      ROOT.rootId
    )
    expect(result.phase).toBe('unavailable')
    expect(result.reason).toBeNull()
    expect(result.error).toContain('different root')
  })

  it('hides prior-root text on the first committed render and fences delayed old-root bytes', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const noteText = 'root A note'
    const noteBytes = Buffer.from(noteText)
    const sessionId = '22222222-2222-4222-8222-222222222222'
    let delayNextChunk = false
    let releaseChunk!: (value: unknown) => void
    runtime.call.mockImplementation(async (_target, method, rawParams) => {
      const params = rawParams as { rootId?: string; generation?: string }
      if (method === 'data.catalog.preview.policy') {
        return { state: 'local', desktopPreviewEnabled: true, deviceIds: [], devices: [] }
      }
      if (method === 'data.catalog.preview.resolve') {
        return {
          state: 'ready',
          entryRef: 'r'.repeat(32),
          rootId: params.rootId,
          generation: params.generation,
          fileVersion: 'b'.repeat(64),
          sizeBytes: String(noteBytes.length),
          expiresInMs: 30_000
        }
      }
      if (method === 'data.catalog.preview.start') {
        return {
          state: 'ready',
          previewSessionId: sessionId,
          rootId: ROOT.rootId,
          generation: ROOT.generation,
          fileVersion: 'b'.repeat(64),
          totalBytes: String(noteBytes.length),
          chunkBytes: 16_384,
          expiresInMs: 60_000
        }
      }
      if (method === 'data.catalog.preview.chunk') {
        const chunk = {
          state: 'chunk',
          previewSessionId: sessionId,
          rootId: ROOT.rootId,
          generation: ROOT.generation,
          fileVersion: 'b'.repeat(64),
          totalBytes: String(noteBytes.length),
          offset: 0,
          nextOffset: noteBytes.length,
          final: true,
          dataBase64: noteBytes.toString('base64')
        }
        if (delayNextChunk) {
          delayNextChunk = false
          return new Promise((resolve) => {
            releaseChunk = resolve
          })
        }
        return chunk
      }
      if (method === 'data.catalog.preview.finish') {
        return { state: 'visible', leaseTtlMs: 30_000 }
      }
      return { state: 'cancelled' }
    })

    const committed: { rootId: string | null; phase: string; text?: string }[] = []
    const localTarget = { kind: 'local' } as const
    const observeCommit = (rootId: string | null, phase: string, text?: string) => {
      committed.push({ rootId, phase, text })
    }
    const { result, rerender } = renderHook<
      ReturnType<typeof useDataCatalogPreview>,
      { selectedRoot: DataCatalogRootView }
    >(
      ({ selectedRoot }: { selectedRoot: DataCatalogRootView }) => {
        const state = useDataCatalogPreview(localTarget, selectedRoot)
        useLayoutEffect(() => {
          observeCommit(
            selectedRoot?.rootId ?? null,
            state.preview.phase,
            state.preview.phase === 'visible' ? state.preview.text : undefined
          )
        }, [selectedRoot, state.preview])
        return state
      },
      { initialProps: { selectedRoot: ROOT } }
    )
    await act(async () => result.current.previewEntry(ENTRY.entryId))
    await waitFor(() => expect(result.current.preview.phase).toBe('visible'))
    expect(result.current.preview).toMatchObject({ phase: 'visible', text: noteText })

    committed.length = 0
    rerender({ selectedRoot: ROOT_B })
    const firstRootBCommit = committed.find((commit) => commit.rootId === ROOT_B.rootId)
    expect(firstRootBCommit).toEqual({ rootId: ROOT_B.rootId, phase: 'idle', text: undefined })
    expect(firstRootBCommit?.text).toBeUndefined()

    rerender({ selectedRoot: ROOT })
    delayNextChunk = true
    act(() => result.current.previewEntry(ENTRY.entryId))
    await waitFor(() => expect(releaseChunk).toBeTypeOf('function'))
    committed.length = 0
    rerender({ selectedRoot: ROOT_B })
    expect(committed.find((commit) => commit.rootId === ROOT_B.rootId)?.phase).toBe('idle')
    await act(async () => {
      releaseChunk({
        state: 'chunk',
        previewSessionId: sessionId,
        rootId: ROOT.rootId,
        generation: ROOT.generation,
        fileVersion: 'b'.repeat(64),
        totalBytes: String(noteBytes.length),
        offset: 0,
        nextOffset: noteBytes.length,
        final: true,
        dataBase64: noteBytes.toString('base64')
      })
      await Promise.resolve()
    })
    expect(result.current.preview.phase).toBe('idle')
    expect(committed.some((commit) => commit.rootId === ROOT_B.rootId && commit.text)).toBe(false)
  })

  it('hides prior-generation text on the first committed render and fences delayed old-generation bytes', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const noteText = 'generation A note'
    const noteBytes = Buffer.from(noteText)
    const sessionId = '33333333-3333-4333-8333-333333333333'
    const generationB = 'd920de76-f3f7-48f5-9f95-90a00d505bd8'
    const rootGenerationB = { ...ROOT, generation: generationB }
    let sessionRootId: string = ROOT.rootId
    let sessionGeneration: string = ROOT.generation
    let delayNextChunk = false
    let releaseChunk!: (value: unknown) => void
    runtime.call.mockImplementation(async (_target, method, rawParams) => {
      const params = rawParams as { rootId?: string; generation?: string }
      if (method === 'data.catalog.preview.policy') {
        return { state: 'local', desktopPreviewEnabled: true, deviceIds: [], devices: [] }
      }
      if (method === 'data.catalog.preview.resolve') {
        return {
          state: 'ready',
          entryRef: 'r'.repeat(32),
          rootId: params.rootId,
          generation: params.generation,
          fileVersion: 'c'.repeat(64),
          sizeBytes: String(noteBytes.length),
          expiresInMs: 30_000
        }
      }
      if (method === 'data.catalog.preview.start') {
        sessionRootId = params.rootId ?? ROOT.rootId
        sessionGeneration = params.generation ?? ROOT.generation
        return {
          state: 'ready',
          previewSessionId: sessionId,
          rootId: sessionRootId,
          generation: sessionGeneration,
          fileVersion: 'c'.repeat(64),
          totalBytes: String(noteBytes.length),
          chunkBytes: 16_384,
          expiresInMs: 60_000
        }
      }
      if (method === 'data.catalog.preview.chunk') {
        const chunk = {
          state: 'chunk',
          previewSessionId: sessionId,
          rootId: sessionRootId,
          generation: sessionGeneration,
          fileVersion: 'c'.repeat(64),
          totalBytes: String(noteBytes.length),
          offset: 0,
          nextOffset: noteBytes.length,
          final: true,
          dataBase64: noteBytes.toString('base64')
        }
        if (delayNextChunk) {
          delayNextChunk = false
          return new Promise((resolve) => {
            releaseChunk = resolve
          })
        }
        return chunk
      }
      if (method === 'data.catalog.preview.finish') {
        return { state: 'visible', leaseTtlMs: 30_000 }
      }
      return { state: 'cancelled' }
    })

    const committed: { generation: string; phase: string; text?: string }[] = []
    const localTarget = { kind: 'local' } as const
    const { result, rerender } = renderHook<
      ReturnType<typeof useDataCatalogPreview>,
      { selectedRoot: DataCatalogRootView }
    >(
      ({ selectedRoot }: { selectedRoot: DataCatalogRootView }) => {
        const state = useDataCatalogPreview(localTarget, selectedRoot)
        useLayoutEffect(() => {
          committed.push({
            generation: selectedRoot.generation,
            phase: state.preview.phase,
            text: state.preview.phase === 'visible' ? state.preview.text : undefined
          })
        }, [selectedRoot, state.preview])
        return state
      },
      { initialProps: { selectedRoot: ROOT } }
    )
    await act(async () => result.current.previewEntry(ENTRY.entryId))
    await waitFor(() => expect(result.current.preview.phase).toBe('visible'))
    expect(result.current.preview).toMatchObject({ phase: 'visible', text: noteText })

    delayNextChunk = true
    act(() => result.current.previewEntry(ENTRY.entryId))
    await waitFor(() => expect(releaseChunk).toBeTypeOf('function'))
    committed.length = 0
    rerender({ selectedRoot: rootGenerationB })
    const firstGenerationBCommit = committed.find((commit) => commit.generation === generationB)
    expect(firstGenerationBCommit).toEqual({
      generation: generationB,
      phase: 'idle',
      text: undefined
    })

    await act(async () => {
      releaseChunk({
        state: 'chunk',
        previewSessionId: sessionId,
        rootId: ROOT.rootId,
        generation: ROOT.generation,
        fileVersion: 'c'.repeat(64),
        totalBytes: String(noteBytes.length),
        offset: 0,
        nextOffset: noteBytes.length,
        final: true,
        dataBase64: noteBytes.toString('base64')
      })
      await Promise.resolve()
    })
    expect(result.current.preview.phase).toBe('idle')
    expect(committed.some((commit) => commit.generation === generationB && commit.text)).toBe(false)
  })

  it('hides currently visible text immediately when the same target root advances generation', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const noteText = 'visible generation A note'
    const noteBytes = Buffer.from(noteText)
    const sessionId = '44444444-4444-4444-8444-444444444444'
    const generationB = 'd920de76-f3f7-48f5-9f95-90a00d505bd8'
    const rootGenerationB: DataCatalogRootView = { ...ROOT, generation: generationB }
    let sessionGeneration: string = ROOT.generation
    runtime.call.mockImplementation(async (_target, method, rawParams) => {
      const params = rawParams as { rootId?: string; generation?: string }
      if (method === 'data.catalog.preview.policy') {
        return { state: 'local', desktopPreviewEnabled: true, deviceIds: [], devices: [] }
      }
      if (method === 'data.catalog.preview.resolve') {
        return {
          state: 'ready',
          entryRef: 'r'.repeat(32),
          rootId: params.rootId,
          generation: params.generation,
          fileVersion: 'd'.repeat(64),
          sizeBytes: String(noteBytes.length),
          expiresInMs: 30_000
        }
      }
      if (method === 'data.catalog.preview.start') {
        sessionGeneration = params.generation ?? ROOT.generation
        return {
          state: 'ready',
          previewSessionId: sessionId,
          rootId: ROOT.rootId,
          generation: sessionGeneration,
          fileVersion: 'd'.repeat(64),
          totalBytes: String(noteBytes.length),
          chunkBytes: 16_384,
          expiresInMs: 60_000
        }
      }
      if (method === 'data.catalog.preview.chunk') {
        return {
          state: 'chunk',
          previewSessionId: sessionId,
          rootId: ROOT.rootId,
          generation: sessionGeneration,
          fileVersion: 'd'.repeat(64),
          totalBytes: String(noteBytes.length),
          offset: 0,
          nextOffset: noteBytes.length,
          final: true,
          dataBase64: noteBytes.toString('base64')
        }
      }
      if (method === 'data.catalog.preview.finish') {
        return { state: 'visible', leaseTtlMs: 30_000 }
      }
      return { state: 'cancelled' }
    })

    const commits: { generation: string; phase: string; text?: string }[] = []
    const localTarget = { kind: 'local' } as const
    const { result, rerender } = renderHook<
      ReturnType<typeof useDataCatalogPreview>,
      { selectedRoot: DataCatalogRootView }
    >(
      ({ selectedRoot }) => {
        const state = useDataCatalogPreview(localTarget, selectedRoot)
        useLayoutEffect(() => {
          commits.push({
            generation: selectedRoot.generation,
            phase: state.preview.phase,
            text: state.preview.phase === 'visible' ? state.preview.text : undefined
          })
        }, [selectedRoot, state.preview])
        return state
      },
      { initialProps: { selectedRoot: ROOT } }
    )
    await act(async () => result.current.previewEntry(ENTRY.entryId))
    expect(result.current.preview).toMatchObject({ phase: 'visible', text: noteText })
    const commitsBeforeGenerationB = commits.length
    rerender({ selectedRoot: rootGenerationB })
    expect(
      commits.slice(commitsBeforeGenerationB).find((commit) => commit.generation === generationB)
    ).toEqual({
      generation: generationB,
      phase: 'idle',
      text: undefined
    })
  })
})
