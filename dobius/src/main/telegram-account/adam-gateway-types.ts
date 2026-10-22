import type { spawn } from 'node:child_process'
import type { AdamBridgeRuntime } from './adam-bridge-runtime'

export type PendingReply = {
  resolve: (text: string) => void
  reject: (error: Error) => void
  cleanup: () => void
}
export type GatewayState = 'unavailable' | 'starting' | 'ready' | 'error'
export type AdamGatewayOptions = {
  runtime: () => AdamBridgeRuntime | null
  accountId: () => string | null
  spawn?: typeof spawn
  startupTimeoutMs?: number
  requestTimeoutMs?: number
  onStateChanged?: (state: GatewayState) => void
}
