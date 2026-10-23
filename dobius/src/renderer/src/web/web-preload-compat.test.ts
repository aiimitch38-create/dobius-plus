import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentResumeOwner } from '../../../shared/agent-resume-owner'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import type { PreloadApi } from '../../../preload/api-types'
import {
  callWebRuntimeWithPreviewUnavailable,
  createWebAgentResumeApi,
  subscribeWebCatalogPreviewInvalidated
} from './web-preload-compat'

const forwardedResponse: RuntimeRpcResponse<unknown> = {
  id: 'remote-call',
  ok: true,
  result: { state: 'ready' },
  _meta: { runtimeId: 'runtime-1' }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('web preload compatibility boundaries', () => {
  it('reports catalog preview policy as unavailable without forwarding to a remote runtime', async () => {
    const forward = vi.fn(async () => forwardedResponse)

    await expect(
      callWebRuntimeWithPreviewUnavailable('data.catalog.preview.policy', forward)
    ).resolves.toEqual({
      id: 'web-preview-policy-unavailable',
      ok: true,
      result: { state: 'unavailable' },
      _meta: { runtimeId: 'web' }
    })
    expect(forward).not.toHaveBeenCalled()
  })

  it('refuses preview transfer and grant methods without forwarding any request', async () => {
    const forward = vi.fn(async () => forwardedResponse)
    const methods = [
      'data.catalog.preview.resolve',
      'data.catalog.preview.start',
      'data.catalog.preview.chunk',
      'data.catalog.preview.finish',
      'data.catalog.preview.renew',
      'data.catalog.preview.close'
    ]

    for (const method of methods) {
      await expect(callWebRuntimeWithPreviewUnavailable(method, forward)).resolves.toMatchObject({
        ok: false,
        error: { code: 'unsupported' }
      })
    }
    await expect(
      callWebRuntimeWithPreviewUnavailable('data.catalog.setPreviewAccess', forward)
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } })
    expect(forward).not.toHaveBeenCalled()
  })

  it('forwards unrelated runtime calls unchanged', async () => {
    const forward = vi.fn(async () => forwardedResponse)

    await expect(callWebRuntimeWithPreviewUnavailable('status.get', forward)).resolves.toBe(
      forwardedResponse
    )
    expect(forward).toHaveBeenCalledOnce()
  })

  it('exposes only a content-free no-op invalidation disposer because web preview is unavailable', () => {
    const callback = vi.fn()
    const dispose = subscribeWebCatalogPreviewInvalidated(callback)

    expect(dispose).toBeTypeOf('function')
    dispose()
    dispose()
    expect(callback).not.toHaveBeenCalled()
  })

  it('refuses native-bound agent resume claims and releases', async () => {
    const api = createWebAgentResumeApi()
    const owner = {} as AgentResumeOwner

    await expect(api.claimAgentResume(owner)).resolves.toBeNull()
    await expect(api.releaseAgentResume('claim-token', owner)).resolves.toBe(false)
  })

  it('wires fail-closed preview, invalidation, and resume surfaces into the installed web API', async () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(() => null),
      length: 0
    }
    const windowStub = {
      localStorage: storage,
      location: { protocol: 'https:', reload: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
      btoa: (value: string) => Buffer.from(value, 'binary').toString('base64')
    } as unknown as Window & typeof globalThis
    vi.stubGlobal('window', windowStub)
    vi.stubGlobal('navigator', { userAgent: 'Linux', hardwareConcurrency: 8 })
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()
    const api = (windowStub as Window & typeof globalThis & { api: PreloadApi }).api
    const callback = vi.fn()
    const dispose = api.runtime.onDataCatalogPreviewInvalidated(callback)
    const owner = {} as AgentResumeOwner

    await expect(
      api.runtime.call({ method: 'data.catalog.preview.policy' })
    ).resolves.toMatchObject({
      ok: true,
      result: { state: 'unavailable' }
    })
    await expect(
      api.runtime.call({ method: 'data.catalog.preview.resolve' })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'unsupported' }
    })
    await expect(
      api.runtimeEnvironments.call({
        selector: 'active',
        method: 'data.catalog.preview.resolve'
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'unsupported' } })
    await expect(api.pty.claimAgentResume(owner)).resolves.toBeNull()
    await expect(api.pty.releaseAgentResume('claim-token', owner)).resolves.toBe(false)
    expect(dispose).toBeTypeOf('function')
    dispose()
    expect(callback).not.toHaveBeenCalled()
    expect(storage.getItem).toHaveBeenCalled()
  })
})
