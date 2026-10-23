import type { PreloadApi } from '../../../preload/api-types'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import type { DataCatalogPreviewInvalidatedEvent } from '../../../shared/data-catalog-preview-schema'

const WEB_RUNTIME_ID = 'web'
const WEB_PREVIEW_UNAVAILABLE_MESSAGE = 'Catalog preview is unavailable in the web client.'

type RuntimeCall = () => Promise<RuntimeRpcResponse<unknown>>
type WebAgentResumeApi = Pick<PreloadApi['pty'], 'claimAgentResume' | 'releaseAgentResume'>

/**
 * Browser-paired runtime calls have no trusted local desktop preview principal
 * or native WebContents incarnation. Refuse all preview operations here so a
 * remote runtime token cannot turn the browser into a generic preview client.
 */
export function callWebRuntimeWithPreviewUnavailable(
  method: string,
  forward: RuntimeCall
): Promise<RuntimeRpcResponse<unknown>> {
  if (method === 'data.catalog.preview.policy') {
    return Promise.resolve({
      id: 'web-preview-policy-unavailable',
      ok: true,
      result: { state: 'unavailable' },
      _meta: { runtimeId: WEB_RUNTIME_ID }
    })
  }
  if (method.startsWith('data.catalog.preview.') || method === 'data.catalog.setPreviewAccess') {
    return Promise.resolve({
      id: 'web-preview-operation-refused',
      ok: false,
      error: {
        code: method === 'data.catalog.setPreviewAccess' ? 'forbidden' : 'unsupported',
        message: WEB_PREVIEW_UNAVAILABLE_MESSAGE
      },
      _meta: { runtimeId: null }
    })
  }
  return forward()
}

/**
 * The web client cannot receive the local-WebContents-bound preview event.
 * Preview policy is always unavailable above, so no web preview can require
 * invalidation delivery or create a session that would outlive this no-op.
 */
export function subscribeWebCatalogPreviewInvalidated(
  _callback: (event: DataCatalogPreviewInvalidatedEvent) => void
): () => void {
  return () => undefined
}

/**
 * Resume claims are issued only by Electron main over the trusted PTY IPC
 * boundary. A browser client has no authority to claim or release ownership.
 */
export function createWebAgentResumeApi(): WebAgentResumeApi {
  return {
    claimAgentResume: async (_owner) => null,
    releaseAgentResume: async (_token, _owner) => false
  }
}
