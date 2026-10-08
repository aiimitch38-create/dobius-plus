export type TerminalWebViewLifecycleEvent =
  | 'active-state'
  | 'load-start'
  | 'web-ready'
  | 'reload-requested'
  | 'load-error'
  | 'http-error'
  | 'render-process-gone'
  | 'content-process-ended'

export function createTerminalWebViewDiagnosticKey(terminalHandle: string): string {
  // Why: correlate terminal lifecycle events without logging a raw
  // handle that may contain a host-specific identifier.
  let hash = 2166136261
  for (let index = 0; index < terminalHandle.length; index += 1) {
    hash = Math.imul(hash ^ terminalHandle.charCodeAt(index), 16777619)
  }
  return `terminal-${(hash >>> 0).toString(36)}`
}

export type TerminalWebViewLifecycleRecord = {
  readonly terminalKey: string
  readonly event: TerminalWebViewLifecycleEvent
  readonly generation: number
  readonly active: boolean
  readonly atMs: number
}

export function createTerminalWebViewLifecycleRecord(
  record: TerminalWebViewLifecycleRecord
): TerminalWebViewLifecycleRecord {
  return record
}
