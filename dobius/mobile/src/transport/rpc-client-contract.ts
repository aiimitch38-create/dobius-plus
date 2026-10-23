import type { ConnectionLogSink, ConnectionState, RpcResponse } from './types'
import type { StreamingListener, SubscribeOptions } from './rpc-stream-subscription'
import type { DataCatalogPreviewInvalidatedEvent } from '../../../src/shared/data-catalog-preview-schema'
export type SendRequestOptions = { timeoutMs?: number }
export type ConnectOptions = {
  onStateChange?: (state: ConnectionState) => void
  onLog?: ConnectionLogSink
  onDeviceTokenRotated?: (deviceToken: string) => void
}
export type RpcClient = {
  sendRequest(method: string, params?: unknown, options?: SendRequestOptions): Promise<RpcResponse>
  subscribe(
    method: string,
    params: unknown,
    onData: StreamingListener,
    options?: SubscribeOptions
  ): () => void
  updateTerminalSubscriptionViewport(
    terminal: string,
    viewport: { cols: number; rows: number }
  ): void
  getState(): ConnectionState
  // A single-use QR token rotates to this phone's token after first login.
  getDeviceToken(): string
  getReconnectAttempt(): number
  // Null means this client has never connected successfully.
  getLastConnectedAt(): number | null
  onStateChange(listener: (state: ConnectionState) => void): () => void
  onDataCatalogPreviewInvalidated(
    listener: (event: DataCatalogPreviewInvalidatedEvent) => void
  ): () => void
  // App resume probes half-open connections or unparks transport retries.
  notifyForeground(): void
  close(): void
}
