// Esc closes the open Board studio and nothing else: embedded pages (e.g. the
// Automations page) treat Esc as "leave this page", which would drop the Board.
// Popups and nested dialogs opened inside the studio still get their own Esc.

/** True when Esc belongs to the studio rather than a menu or dialog stacked on it. */
export function studioOwnsEscape(studioEl: Element | null, doc: Document): boolean {
  if (!studioEl?.isConnected) {
    return false
  }
  if (doc.querySelector('[data-radix-popper-content-wrapper]')) {
    return false
  }
  const dialogs = [...doc.querySelectorAll('[role="dialog"],[role="alertdialog"]')]
  return dialogs.at(-1) === studioEl
}

/**
 * Window capture-phase listener; returns the unsubscribe. Must be registered
 * before the studio body mounts so it runs ahead of the page's own listeners.
 */
export function listenStudioEscape(
  win: Window,
  getStudioEl: () => Element | null,
  onClose: () => void
): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !studioOwnsEscape(getStudioEl(), win.document)) {
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    onClose()
  }
  win.addEventListener('keydown', onKeyDown, { capture: true })
  return () => win.removeEventListener('keydown', onKeyDown, { capture: true })
}
