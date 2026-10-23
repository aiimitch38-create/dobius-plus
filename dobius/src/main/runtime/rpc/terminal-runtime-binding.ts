export const TERMINAL_RUNTIME_BINDING_MISMATCH = 'terminal_guard_runtime_mismatch'

export function assertTerminalRuntimeBinding(
  getRuntimeId: () => string,
  expectedRuntimeId: string
): void {
  if (getRuntimeId() !== expectedRuntimeId) {
    throw new Error(TERMINAL_RUNTIME_BINDING_MISMATCH)
  }
}

export function isTerminalRuntimeBindingMismatch(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes(TERMINAL_RUNTIME_BINDING_MISMATCH)
}
