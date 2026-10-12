export type TerminalMeasureResult = { cols: number; rows: number } | null

type PendingMeasure = {
  id: number
  finish: (result: TerminalMeasureResult) => void
}

// Why: bridge replies may arrive after a newer viewport measurement has
// replaced them. Only the active request ID may settle the current promise.
export function createTerminalWebViewMeasureTracker() {
  let pending: PendingMeasure | null = null

  const replace = (id: number, finish: PendingMeasure['finish']) => {
    const previous = pending
    pending = { id, finish }
    previous?.finish(null)
  }

  const resolve = (id: unknown, result: TerminalMeasureResult) => {
    if (typeof id !== 'number' || pending?.id !== id) {
      return false
    }
    const current = pending
    pending = null
    current.finish(result)
    return true
  }

  const cancel = (id: number) => {
    if (pending?.id !== id) {
      return false
    }
    const current = pending
    pending = null
    current.finish(null)
    return true
  }

  const clear = () => {
    const current = pending
    pending = null
    current?.finish(null)
  }

  return { cancel, clear, replace, resolve }
}
