// Whether the What's new popup is on screen. Why module state and not the app
// store: the window-level key handlers (terminal tabs, global shortcuts) run
// in the capture phase, before the popup's own handlers, and need a cheap
// synchronous answer on every key press.
let whatsNewOpen = false

export function setWhatsNewOpen(open: boolean): void {
  whatsNewOpen = open
}

/** True while the popup is open: app shortcuts must not act behind it. */
export function isWhatsNewOpen(): boolean {
  return whatsNewOpen
}
