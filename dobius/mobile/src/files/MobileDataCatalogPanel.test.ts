import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { createElement, useLayoutEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mobile = vi.hoisted(() => {
  const invalidationListeners = new Set<(event: unknown) => void>()
  return {
    invalidationListeners,
    client: {
      sendRequest: vi.fn(),
      onDataCatalogPreviewInvalidated: vi.fn((listener: (event: unknown) => void) => {
        invalidationListeners.add(listener)
        return () => invalidationListeners.delete(listener)
      })
    },
    useHostClient: vi.fn(),
    router: { back: vi.fn(), push: vi.fn() },
    appState: { currentState: 'active', listeners: new Set<(state: string) => void>() }
  }
})
vi.mock('../transport/client-context', () => ({ useHostClient: mobile.useHostClient }))
vi.mock('expo-router', async () => {
  const React = await import('react')
  return {
    useRouter: () => mobile.router,
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback])
  }
})
vi.mock('react-native', async () => {
  const React = await import('react')
  const component =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name, props, children as React.ReactNode)
  return {
    AppState: {
      get currentState() {
        return mobile.appState.currentState
      },
      addEventListener: (_event: string, listener: (state: string) => void) => {
        mobile.appState.listeners.add(listener)
        return { remove: () => mobile.appState.listeners.delete(listener) }
      }
    },
    ActivityIndicator: component('ActivityIndicator'),
    Pressable: component('Pressable'),
    ScrollView: component('ScrollView'),
    Text: component('Text'),
    View: component('View')
  }
})
vi.mock('react-native-safe-area-context', async () => {
  const React = await import('react')
  return {
    SafeAreaView: ({ children, ...props }: Record<string, unknown>) =>
      React.createElement('SafeAreaView', props, children as React.ReactNode)
  }
})
vi.mock('lucide-react-native', async () => {
  const React = await import('react')
  const icon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props)
  return { ChevronLeft: icon('ChevronLeft'), RefreshCw: icon('RefreshCw') }
})
import { MobileDataCatalogPanel } from './MobileDataCatalogPanel'
import { useMobileDataCatalogPreview } from './use-mobile-data-catalog-preview'
import type { RpcClient } from '../transport/rpc-client'
import type { DataCatalogRootView } from '../../../src/shared/data-catalog-roots'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  mobile.client.sendRequest.mockReset()
  mobile.client.onDataCatalogPreviewInvalidated.mockClear()
  mobile.useHostClient.mockReset()
  mobile.router.back.mockReset()
  mobile.router.push.mockReset()
  mobile.appState.currentState = 'active'
  mobile.appState.listeners.clear()
  mobile.invalidationListeners.clear()
})

const root = {
  rootId: 'catalog:phone',
  kind: 'obsidian-vault',
  label: 'Notes',
  generation: '8de3037a-7171-4399-af40-9e31de2cb59e'
}
const entry = {
  entryId: '9'.repeat(64),
  rootId: root.rootId,
  relativePath: 'folder/note.md',
  name: 'note.md',
  kind: 'file',
  sizeBytes: 42,
  modifiedAtMs: 1,
  contentDigestSha256: null,
  backupCoverage: 'unknown',
  availability: 'available',
  observedAtMs: 2
}
const nextEntry = {
  ...entry,
  entryId: '8'.repeat(64),
  relativePath: 'folder/second.md',
  name: 'second.md'
}
const success = (result: unknown) => ({
  id: 'rpc',
  ok: true,
  result,
  _meta: { runtimeId: 'phone' }
})

describe('phone registered files view', () => {
  it('uses the route host for catalog reads and displays non-clickable metadata entries only', async () => {
    mobile.useHostClient.mockImplementation((hostId: string) => {
      expect(hostId).toBe('host-explicit')
      return { client: mobile.client, state: 'connected' }
    })
    mobile.client.sendRequest.mockImplementation(async (method: string) =>
      method === 'data.catalog.roots'
        ? success({ state: 'ready', roots: [root] })
        : method === 'data.catalog.preview.policy'
          ? success({ state: 'mobile', enabled: false })
          : success({
              state: 'complete',
              rootId: root.rootId,
              entries: [entry],
              cursor: null,
              scannedEntries: 1,
              reason: null
            })
    )
    await act(async () => {
      renderer = create(createElement(MobileDataCatalogPanel, { hostId: 'host-explicit' }))
      await Promise.resolve()
    })
    const rootRow = renderer?.root.findByProps({ accessibilityLabel: 'Notes, obsidian-vault' })
    await act(async () => {
      rootRow?.props.onPress()
      await Promise.resolve()
    })
    const entryName = renderer?.root.findByProps({ children: 'note.md' })
    expect(entryName).toBeTruthy()
    expect(entryName?.parent?.type).not.toBe('Pressable')
    expect(renderer?.root.findByProps({ children: 'folder/note.md' })).toBeTruthy()
    expect(
      renderer?.root.findAll(
        (node: ReactTestInstance) =>
          node.type === 'Pressable' &&
          node.props.accessibilityLabel === 'Refresh registered folders'
      )
    ).toHaveLength(1)
    expect(mobile.client.sendRequest.mock.calls.map(([method]) => method)).toEqual(
      expect.arrayContaining([
        'data.catalog.roots',
        'data.catalog.page',
        'data.catalog.preview.policy'
      ])
    )
    expect(
      mobile.client.sendRequest.mock.calls.every(([method]) =>
        String(method).startsWith('data.catalog.')
      )
    ).toBe(true)
    expect(mobile.client.sendRequest).not.toHaveBeenCalledWith('files.read', expect.anything())
    expect(mobile.client.sendRequest).not.toHaveBeenCalledWith('terminal.focus', expect.anything())
  })

  it('starts a phone preview only from the explicit selected row action', async () => {
    const text = 'phone preview <a href="javascript:alert(1)">text</a>'
    const previewSessionId = '22222222-2222-4222-8222-222222222222'
    mobile.useHostClient.mockReturnValue({ client: mobile.client, state: 'connected' })
    mobile.client.sendRequest.mockImplementation(async (method: string) => {
      if (method === 'data.catalog.roots') {
        return success({ state: 'ready', roots: [root] })
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
          sizeBytes: String(Buffer.byteLength(text)),
          expiresInMs: 30_000
        })
      }
      if (method === 'data.catalog.preview.start') {
        return success({
          state: 'ready',
          previewSessionId,
          rootId: root.rootId,
          generation: root.generation,
          fileVersion: 'b'.repeat(64),
          totalBytes: String(Buffer.byteLength(text)),
          chunkBytes: 16_384,
          expiresInMs: 60_000
        })
      }
      if (method === 'data.catalog.preview.chunk') {
        return success({
          state: 'chunk',
          previewSessionId,
          rootId: root.rootId,
          generation: root.generation,
          fileVersion: 'b'.repeat(64),
          totalBytes: String(Buffer.byteLength(text)),
          offset: 0,
          nextOffset: Buffer.byteLength(text),
          final: true,
          dataBase64: Buffer.from(text).toString('base64')
        })
      }
      if (method === 'data.catalog.preview.finish') {
        return success({ state: 'visible', leaseTtlMs: 30_000 })
      }
      if (method === 'data.catalog.preview.close') {
        return success({ state: 'cancelled' })
      }
      return success({
        state: 'complete',
        rootId: root.rootId,
        entries: [entry],
        cursor: null,
        scannedEntries: 1,
        reason: null
      })
    })
    await act(async () => {
      renderer = create(createElement(MobileDataCatalogPanel, { hostId: 'host-explicit' }))
      await Promise.resolve()
    })
    await act(async () => {
      renderer?.root.findByProps({ accessibilityLabel: 'Notes, obsidian-vault' }).props.onPress()
      await Promise.resolve()
    })
    await act(async () => {
      renderer?.root
        .findAllByType('Pressable')
        .find((node) =>
          node.findAllByType('Text').some((textNode) => textNode.props.children === 'Preview text')
        )
        ?.props.onPress()
      await Promise.resolve()
    })
    expect(renderer?.root.findByProps({ children: text })).toBeTruthy()
    expect(
      mobile.client.sendRequest.mock.calls.some(
        ([method]) => method === 'data.catalog.preview.finish'
      )
    ).toBe(true)
    expect(
      mobile.client.sendRequest.mock.calls.find(
        ([method]) => method === 'data.catalog.preview.resolve'
      )?.[1]
    ).toEqual({ rootId: root.rootId, generation: root.generation, entryId: entry.entryId })
    expect(mobile.client.onDataCatalogPreviewInvalidated).toHaveBeenCalledOnce()
    act(() => {
      for (const listener of mobile.invalidationListeners) {
        listener({ rootId: root.rootId, generation: root.generation, reason: 'revoked' })
      }
    })
    expect(renderer?.root.findAllByProps({ children: text })).toHaveLength(0)
    act(() => renderer?.unmount())
    renderer = null
    expect(mobile.invalidationListeners.size).toBe(0)
  })

  it('clears visible entry A before entry B grant resolves', async () => {
    const textA = 'visible phone entry A'
    let releaseBGrant!: (value: unknown) => void
    let activeText = textA
    mobile.useHostClient.mockReturnValue({ client: mobile.client, state: 'connected' })
    mobile.client.sendRequest.mockImplementation(async (method: string, rawParams?: unknown) => {
      const params = rawParams as { entryId?: string } | undefined
      if (method === 'data.catalog.roots') {
        return success({ state: 'ready', roots: [root] })
      }
      if (method === 'data.catalog.preview.policy') {
        return success({ state: 'mobile', enabled: true })
      }
      if (method === 'data.catalog.preview.resolve') {
        if (params?.entryId === nextEntry.entryId) {
          return new Promise((resolve) => {
            releaseBGrant = (value) => resolve(success(value))
          })
        }
        activeText = textA
        return success({
          state: 'ready',
          entryRef: 'r'.repeat(32),
          rootId: root.rootId,
          generation: root.generation,
          fileVersion: 'b'.repeat(64),
          sizeBytes: String(Buffer.byteLength(textA)),
          expiresInMs: 30_000
        })
      }
      if (method === 'data.catalog.preview.start') {
        return success({
          state: 'ready',
          previewSessionId: '22222222-2222-4222-8222-222222222222',
          rootId: root.rootId,
          generation: root.generation,
          fileVersion: 'b'.repeat(64),
          totalBytes: String(Buffer.byteLength(activeText)),
          chunkBytes: 16_384,
          expiresInMs: 60_000
        })
      }
      if (method === 'data.catalog.preview.chunk') {
        return success({
          state: 'chunk',
          previewSessionId: '22222222-2222-4222-8222-222222222222',
          rootId: root.rootId,
          generation: root.generation,
          fileVersion: 'b'.repeat(64),
          totalBytes: String(Buffer.byteLength(activeText)),
          offset: 0,
          nextOffset: Buffer.byteLength(activeText),
          final: true,
          dataBase64: Buffer.from(activeText).toString('base64')
        })
      }
      if (method === 'data.catalog.preview.finish') {
        return success({ state: 'visible', leaseTtlMs: 30_000 })
      }
      if (method === 'data.catalog.preview.close') {
        return success({ state: 'cancelled' })
      }
      return success({
        state: 'complete',
        rootId: root.rootId,
        entries: [entry, nextEntry],
        cursor: null,
        scannedEntries: 2,
        reason: null
      })
    })
    await act(async () => {
      renderer = create(createElement(MobileDataCatalogPanel, { hostId: 'host-explicit' }))
      await Promise.resolve()
    })
    await act(async () => {
      renderer?.root.findByProps({ accessibilityLabel: 'Notes, obsidian-vault' }).props.onPress()
      await Promise.resolve()
    })
    const listPreviewButtons = () =>
      renderer?.root
        .findAllByType('Pressable')
        .filter((node) =>
          node.findAllByType('Text').some((textNode) => textNode.props.children === 'Preview text')
        )
    await vi.waitFor(() => expect(listPreviewButtons()).toHaveLength(2))
    const previewButtons = listPreviewButtons()
    await act(async () => previewButtons?.[0]?.props.onPress())
    await vi.waitFor(() =>
      expect(renderer?.root.findAllByProps({ children: textA }).length).toBeGreaterThan(0)
    )

    act(() => previewButtons?.[1]?.props.onPress())
    await vi.waitFor(() => expect(releaseBGrant).toBeTypeOf('function'))
    expect(renderer?.root.findAllByProps({ children: textA })).toHaveLength(0)

    await act(async () => {
      releaseBGrant({ state: 'denied' })
      await Promise.resolve()
    })
    expect(renderer?.root.findAllByProps({ children: textA })).toHaveLength(0)
  })

  it('hides prior-generation preview on the first commit and fences a delayed old-generation chunk', async () => {
    const text = 'phone generation A note'
    const bytes = Buffer.from(text)
    const sessionId = '33333333-3333-4333-8333-333333333333'
    const generationB = 'd920de76-f3f7-48f5-9f95-90a00d505bd8'
    const rootGenerationB = { ...root, generation: generationB }
    let sessionGeneration = root.generation
    let delayNextChunk = false
    let releaseChunk!: (value: unknown) => void
    const client: Pick<RpcClient, 'sendRequest'> = {
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
            fileVersion: 'c'.repeat(64),
            sizeBytes: String(bytes.length),
            expiresInMs: 30_000
          })
        }
        if (method === 'data.catalog.preview.start') {
          sessionGeneration = params?.generation ?? root.generation
          return success({
            state: 'ready',
            previewSessionId: sessionId,
            rootId: root.rootId,
            generation: sessionGeneration,
            fileVersion: 'c'.repeat(64),
            totalBytes: String(bytes.length),
            chunkBytes: 16_384,
            expiresInMs: 60_000
          })
        }
        if (method === 'data.catalog.preview.chunk') {
          const chunk = {
            state: 'chunk',
            previewSessionId: sessionId,
            rootId: root.rootId,
            generation: sessionGeneration,
            fileVersion: 'c'.repeat(64),
            totalBytes: String(bytes.length),
            offset: 0,
            nextOffset: bytes.length,
            final: true,
            dataBase64: bytes.toString('base64')
          }
          if (delayNextChunk) {
            delayNextChunk = false
            return new Promise((resolve) => {
              releaseChunk = (value) => resolve(success(value))
            })
          }
          return success(chunk)
        }
        if (method === 'data.catalog.preview.finish') {
          return success({ state: 'visible', leaseTtlMs: 30_000 })
        }
        return success({ state: 'cancelled' })
      })
    }
    const commits: { generation: string; phase: string; text?: string }[] = []
    let preview!: ReturnType<typeof useMobileDataCatalogPreview>
    function PreviewHarness({ selectedRoot }: { selectedRoot: DataCatalogRootView }) {
      preview = useMobileDataCatalogPreview('host-a', client, true, selectedRoot)
      useLayoutEffect(() => {
        commits.push({
          generation: selectedRoot.generation,
          phase: preview.preview.phase,
          text: preview.preview.phase === 'visible' ? preview.preview.text : undefined
        })
      }, [selectedRoot, preview.preview])
      return createElement(
        'span',
        null,
        preview.preview.phase === 'visible' ? preview.preview.text : ''
      )
    }

    await act(async () => {
      renderer = create(createElement(PreviewHarness, { selectedRoot: root }))
      await Promise.resolve()
    })
    await act(async () => preview.previewEntry(entry.entryId))
    expect(preview.preview).toMatchObject({ phase: 'visible', text })

    delayNextChunk = true
    act(() => preview.previewEntry(entry.entryId))
    await vi.waitFor(() => expect(releaseChunk).toBeTypeOf('function'))
    commits.length = 0
    await act(async () => {
      renderer?.update(createElement(PreviewHarness, { selectedRoot: rootGenerationB }))
      await Promise.resolve()
    })
    expect(commits.find((commit) => commit.generation === generationB)).toEqual({
      generation: generationB,
      phase: 'idle',
      text: undefined
    })

    await act(async () => {
      releaseChunk({
        state: 'chunk',
        previewSessionId: sessionId,
        rootId: root.rootId,
        generation: root.generation,
        fileVersion: 'c'.repeat(64),
        totalBytes: String(bytes.length),
        offset: 0,
        nextOffset: bytes.length,
        final: true,
        dataBase64: bytes.toString('base64')
      })
      await Promise.resolve()
    })
    expect(preview.preview.phase).toBe('idle')
    expect(commits.some((commit) => commit.generation === generationB && commit.text)).toBe(false)
  })

  it('hides currently visible text immediately when the same host root advances generation', async () => {
    const text = 'visible phone generation A note'
    const bytes = Buffer.from(text)
    const sessionId = '44444444-4444-4444-8444-444444444444'
    const generationB = 'd920de76-f3f7-48f5-9f95-90a00d505bd8'
    const rootGenerationB: DataCatalogRootView = { ...root, generation: generationB }
    let sessionGeneration: string = root.generation
    const client: Pick<RpcClient, 'sendRequest'> = {
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
            fileVersion: 'd'.repeat(64),
            sizeBytes: String(bytes.length),
            expiresInMs: 30_000
          })
        }
        if (method === 'data.catalog.preview.start') {
          sessionGeneration = params?.generation ?? root.generation
          return success({
            state: 'ready',
            previewSessionId: sessionId,
            rootId: root.rootId,
            generation: sessionGeneration,
            fileVersion: 'd'.repeat(64),
            totalBytes: String(bytes.length),
            chunkBytes: 16_384,
            expiresInMs: 60_000
          })
        }
        if (method === 'data.catalog.preview.chunk') {
          return success({
            state: 'chunk',
            previewSessionId: sessionId,
            rootId: root.rootId,
            generation: sessionGeneration,
            fileVersion: 'd'.repeat(64),
            totalBytes: String(bytes.length),
            offset: 0,
            nextOffset: bytes.length,
            final: true,
            dataBase64: bytes.toString('base64')
          })
        }
        if (method === 'data.catalog.preview.finish') {
          return success({ state: 'visible', leaseTtlMs: 30_000 })
        }
        return success({ state: 'cancelled' })
      })
    }
    const commits: { generation: string; phase: string; text?: string }[] = []
    let preview!: ReturnType<typeof useMobileDataCatalogPreview>
    function PreviewHarness({ selectedRoot }: { selectedRoot: DataCatalogRootView }) {
      preview = useMobileDataCatalogPreview('host-a', client, true, selectedRoot)
      useLayoutEffect(() => {
        commits.push({
          generation: selectedRoot.generation,
          phase: preview.preview.phase,
          text: preview.preview.phase === 'visible' ? preview.preview.text : undefined
        })
      }, [selectedRoot, preview.preview])
      return createElement(
        'span',
        null,
        preview.preview.phase === 'visible' ? preview.preview.text : ''
      )
    }

    await act(async () => {
      renderer = create(createElement(PreviewHarness, { selectedRoot: root }))
      await Promise.resolve()
    })
    await act(async () => preview.previewEntry(entry.entryId))
    expect(preview.preview).toMatchObject({ phase: 'visible', text })
    const commitsBeforeGenerationB = commits.length
    await act(async () => {
      renderer?.update(createElement(PreviewHarness, { selectedRoot: rootGenerationB }))
      await Promise.resolve()
    })
    expect(
      commits.slice(commitsBeforeGenerationB).find((commit) => commit.generation === generationB)
    ).toEqual({
      generation: generationB,
      phase: 'idle',
      text: undefined
    })
  })
})
