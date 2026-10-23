export type PreviewInvalidationListener = (event: unknown) => void
export type PreviewInvalidationSource = (listener: PreviewInvalidationListener) => () => void

/** Guard late queued events after a target, connection, or UI subscription is replaced. */
export function bindPreviewInvalidationSource(
  subscribe: PreviewInvalidationSource,
  handle: PreviewInvalidationListener
): () => void {
  let active = true
  const unsubscribe = subscribe((event) => {
    if (active) {
      handle(event)
    }
  })

  return () => {
    if (!active) {
      return
    }
    active = false
    unsubscribe()
  }
}
