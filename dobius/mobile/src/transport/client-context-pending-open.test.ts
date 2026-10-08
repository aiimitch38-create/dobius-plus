import { createElement, StrictMode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadHosts } from './host-store'
import { RpcClientProvider, useCloseHost, useHostClient, usePrimeHosts } from './client-context'
import { connect, type RpcClient } from './rpc-client'
import type { HostProfile } from './types'

vi.mock('./rpc-client', () => ({ connect: vi.fn() }))
vi.mock('./host-store', () => ({ loadHosts: vi.fn(), saveHost: vi.fn() }))
vi.mock('./connection-revival-triggers', () => ({
  subscribeConnectionRevivalTriggers: vi.fn(() => () => {})
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | null = null
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  if (!resolve) {
    throw new Error('Deferred resolver was not initialized')
  }
  return { promise, resolve }
}

const originalHost: HostProfile = {
  id: 'host-1',
  name: 'Original',
  endpoint: 'ws://original.example',
  deviceToken: 'token-original',
  publicKeyB64: 'key-original',
  lastConnected: 0
}

const replacementHost: HostProfile = {
  ...originalHost,
  name: 'Replacement',
  endpoint: 'ws://replacement.example',
  deviceToken: 'token-replacement',
  publicKeyB64: 'key-replacement'
}

type HarnessApi = {
  closeHost: (hostId: string) => void
  primeHosts: (hosts: HostProfile[]) => void
  client: RpcClient | null
}

let current: HarnessApi | null = null
let renderer: ReactTestRenderer | null = null

function Consumer({ visible }: { visible: boolean }) {
  const result = useHostClient(visible ? 'host-1' : undefined)
  const closeHost = useCloseHost()
  const primeHosts = usePrimeHosts()
  current = { closeHost, primeHosts, client: result.client }
  return null
}

function Tree({ visible = true, generation = 0 }: { visible?: boolean; generation?: number }) {
  return createElement(
    RpcClientProvider,
    null,
    createElement(Consumer, { key: generation, visible })
  )
}

function createMockClient(): { client: RpcClient; close: ReturnType<typeof vi.fn> } {
  const close = vi.fn()
  const client = {
    close,
    getState: () => 'connecting' as const,
    onStateChange: () => () => {},
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => null,
    notifyForeground: vi.fn()
  } as unknown as RpcClient
  return { client, close }
}

function render(visible = true, strict = false): void {
  current = null
  act(() => {
    const tree = createElement(Tree, { visible })
    renderer = create(strict ? createElement(StrictMode, null, tree) : tree)
  })
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('RpcClientProvider pending host opens', () => {
  beforeEach(() => {
    current = null
    renderer = null
    vi.mocked(connect).mockReset()
    vi.mocked(loadHosts).mockReset().mockResolvedValue([originalHost])
  })

  afterEach(() => {
    if (renderer) {
      act(() => renderer?.unmount())
      renderer = null
    }
  })

  it('does not connect after explicit close invalidates a pending host lookup', async () => {
    const lookup = deferred<HostProfile[]>()
    vi.mocked(loadHosts).mockReturnValue(lookup.promise)
    render()

    act(() => current?.closeHost('host-1'))
    await act(async () => {
      lookup.resolve([originalHost])
      await lookup.promise
    })

    expect(connect).not.toHaveBeenCalled()
  })

  it('keeps a fresh pending acquisition when the invalidated lookup completes', async () => {
    const oldLookup = deferred<HostProfile[]>()
    const freshLookup = deferred<HostProfile[]>()
    vi.mocked(loadHosts)
      .mockReturnValueOnce(oldLookup.promise)
      .mockReturnValueOnce(freshLookup.promise)
    const replacementClient = createMockClient()
    vi.mocked(connect).mockReturnValue(replacementClient.client)
    render()

    act(() => current?.closeHost('host-1'))
    act(() => {
      renderer?.update(createElement(Tree, { generation: 1 }))
    })
    expect(loadHosts).toHaveBeenCalledTimes(2)

    await act(async () => {
      oldLookup.resolve([originalHost])
      await oldLookup.promise
    })
    act(() => {
      renderer?.update(createElement(Tree, { generation: 2 }))
    })
    expect(loadHosts).toHaveBeenCalledTimes(2)

    await act(async () => {
      freshLookup.resolve([replacementHost])
      await freshLookup.promise
    })
    expect(connect).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledWith(
      replacementHost.endpoint,
      replacementHost.deviceToken,
      replacementHost.publicKeyB64,
      expect.any(Object)
    )
  })

  it('does not connect when the provider unmounts during a pending lookup', async () => {
    const lookup = deferred<HostProfile[]>()
    vi.mocked(loadHosts).mockReturnValue(lookup.promise)
    render()

    act(() => renderer?.unmount())
    renderer = null
    await act(async () => {
      lookup.resolve([originalHost])
      await lookup.promise
    })

    expect(connect).not.toHaveBeenCalled()
  })

  it('remains usable after StrictMode replays provider effects', async () => {
    const connected = createMockClient()
    vi.mocked(connect).mockReturnValue(connected.client)
    render(true, true)
    await flushEffects()

    expect(connect).toHaveBeenCalledTimes(1)
    expect(current?.client).toBe(connected.client)
  })

  it('keeps a materialized client open when its last screen releases it', async () => {
    const connected = createMockClient()
    vi.mocked(connect).mockReturnValue(connected.client)
    render()
    await flushEffects()

    expect(connect).toHaveBeenCalledTimes(1)
    act(() => {
      renderer?.update(createElement(Tree, { visible: false }))
    })
    expect(connected.close).not.toHaveBeenCalled()
  })
})
