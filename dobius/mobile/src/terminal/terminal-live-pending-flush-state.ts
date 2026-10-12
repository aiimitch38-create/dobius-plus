export type TerminalLivePendingFlushState = {
  current: Promise<boolean> | null
}

export function waitForTerminalLivePendingFlush(
  state: TerminalLivePendingFlushState
): Promise<boolean> {
  return state.current ?? Promise.resolve(true)
}

// Why: mirror payloads are erase/append deltas against the PTY echo. A later
// delta depends on every earlier delta being accepted; after any failure the
// mirror is uncertain, so stop the chain instead of sending bytes against a
// state the PTY may not have. state.current should never reject.
export function queueTerminalLiveMirrorSend(
  state: TerminalLivePendingFlushState,
  sendMirrorPayload: () => Promise<boolean>
): Promise<boolean> {
  const previousSend = state.current
  const sendPromise = (async () => {
    if (previousSend) {
      const previousAccepted = await previousSend.catch(() => false)
      if (!previousAccepted) {
        return false
      }
    }
    return sendMirrorPayload()
  })().catch(() => false)
  state.current = sendPromise
  void sendPromise.then(() => {
    if (state.current === sendPromise) {
      state.current = null
    }
  })
  return sendPromise
}
