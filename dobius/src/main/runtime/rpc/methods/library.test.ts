import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { DobiusRuntimeService } from '../../dobius-runtime'
import { AGENT_RPC_METHOD_ALLOWLIST } from '../../agent-rpc-scope'
import type { LibraryStatus } from '../../../library/library-types'
import { buildLibraryMethods, LIBRARY_LOCAL_ONLY, type LibraryMethodDeps } from './library'

const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as DobiusRuntimeService
const hit = {
  source: 'claude' as const,
  project: 'epoxyitright',
  title: 'Quote form',
  path: '/x.jsonl',
  when: '2026-11-22T10:00:00.000Z',
  snippet: 'validates phone numbers'
}
const status: LibraryStatus = {
  fullTextSearch: true,
  sizeBytes: 1024,
  capBytes: 400 * 1024 * 1024,
  refreshing: false,
  lastRefresh: null,
  sources: []
}
const search = vi.fn<LibraryMethodDeps['search']>(() => [hit])
const methods = buildLibraryMethods({ search, status: () => status })

function call(method: string, params: unknown, local = true) {
  const request: RpcRequest = { id: 'req-1', authToken: 'tok', method, params }
  return new RpcDispatcher({ runtime, methods }).dispatch(
    request,
    local ? { authenticatedLocal: true } : undefined
  )
}

describe('library RPC methods', () => {
  it('searches with validated params', async () => {
    const response = await call('library.search', {
      query: '  quote form ',
      project: 'epoxy',
      source: 'claude',
      limit: 5
    })
    expect(response).toMatchObject({ ok: true, result: { results: [hit] } })
    expect(search).toHaveBeenCalledWith({
      query: 'quote form',
      project: 'epoxy',
      source: 'claude',
      limit: 5
    })
  })

  it('refuses bad params', async () => {
    for (const params of [
      { query: '' },
      { query: 'x', limit: 21 },
      { query: 'x', source: 'gmail' },
      { query: 'x', extra: true }
    ]) {
      expect(await call('library.search', params), JSON.stringify(params)).toMatchObject({
        ok: false
      })
    }
  })

  it('is refused to callers that are not on this Mac', async () => {
    const response = await call('library.search', { query: 'x' }, false)
    expect(response).toMatchObject({ ok: false, error: { message: LIBRARY_LOCAL_ONLY } })
    expect(await call('library.status', undefined, false)).toMatchObject({ ok: false })
  })

  it('reports status', async () => {
    expect(await call('library.status', undefined)).toMatchObject({ ok: true, result: status })
  })

  it('is not open to the sandboxed agent key', () => {
    expect(AGENT_RPC_METHOD_ALLOWLIST.has('library.search')).toBe(false)
    expect(AGENT_RPC_METHOD_ALLOWLIST.has('library.status')).toBe(false)
  })
})
