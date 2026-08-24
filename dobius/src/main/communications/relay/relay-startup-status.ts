import type { CommunicationsRelayStatus } from '../../../shared/communications-relay-status'

export type RelayStartupStatus = CommunicationsRelayStatus

/**
 * Module-level record of why the relay is (not) reachable.
 *
 * Why a standalone Electron-free module: relay-lifecycle.ts imports Electron,
 * so the status transitions are kept here where vitest can exercise them
 * directly. The swallow-don't-throw startup contract lives in
 * relay-lifecycle.ts; this module only remembers what happened.
 */
let status: RelayStartupStatus = { state: 'stopped' }

export function getRelayStartupStatus(): RelayStartupStatus {
  return status
}

export function recordRelayStarting(): void {
  status = { state: 'starting' }
}

export function recordRelayRunning(port: number): void {
  status = { state: 'running', port }
}

export function recordRelayBindFailure(bindError: string, port: number): void {
  status = { state: 'failed', reason: relayBindFailureReason(bindError, port), port }
}

export function recordRelayStartError(message: string): void {
  status = { state: 'failed', reason: `Relay could not start: ${message}` }
}

export function recordRelayStopped(): void {
  status = { state: 'stopped' }
}

/** Maps a raw bind error to one plain-language sentence for the connection card. */
export function relayBindFailureReason(detail: string, port: number): string {
  if (/already in use/i.test(detail)) {
    return `Port ${port} is held by another process`
  }
  return `Relay could not bind port ${port}: ${detail}`
}
