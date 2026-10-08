export const TERMINAL_SNAPSHOT_RECOVERY_ATTEMPTS = 1

export function shouldRetryTerminalSnapshot(
  attemptsByTerminal: Map<string, number>,
  terminal: string,
  reason?: string
): boolean {
  if (reason === 'oversized') {
    return false
  }
  const attempts = attemptsByTerminal.get(terminal) ?? 0
  if (attempts >= TERMINAL_SNAPSHOT_RECOVERY_ATTEMPTS) {
    return false
  }
  attemptsByTerminal.set(terminal, attempts + 1)
  return true
}

export function markOversizedSnapshotAwaitingGeometry(
  pendingHandles: Set<string>,
  terminalHandle: string,
  initialized: boolean
): void {
  if (!initialized) {
    pendingHandles.add(terminalHandle)
  }
}

export function initializeTerminalAfterOversizedSnapshot(
  pendingHandles: Set<string>,
  terminalHandle: string,
  terminal:
    | { init: (cols: number, rows: number, initialData?: string, preserveScroll?: boolean) => void }
    | undefined,
  cols: number,
  rows: number
): boolean {
  if (!terminal || !pendingHandles.has(terminalHandle)) {
    return false
  }
  terminal.init(cols, rows, '', false)
  pendingHandles.delete(terminalHandle)
  return true
}
