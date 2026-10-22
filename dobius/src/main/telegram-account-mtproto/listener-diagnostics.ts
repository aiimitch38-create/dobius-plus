// Records where an incoming Telegram message stopped, so a silent drop in a packaged
// build can be traced. Only reason codes and ids are written, never message text.
let sink: ((line: string) => void) | null = null

export function setTelegramListenerDiagnosticsSink(next: ((line: string) => void) | null): void {
  sink = next
}

export function telegramListenerDiagnostic(
  event: string,
  detail: Record<string, string | number | boolean | null> = {}
): void {
  if (!sink) {
    return
  }
  try {
    sink(`${JSON.stringify({ at: new Date().toISOString(), event, ...detail })}\n`)
  } catch (error) {
    // Diagnostics must never interrupt message handling.
    void error
  }
}

export function telegramListenerError(error: unknown): void {
  telegramListenerDiagnostic('event-error', {
    error: error instanceof Error ? error.name : typeof error,
    detail: error instanceof Error ? error.message.slice(0, 200) : null
  })
}
