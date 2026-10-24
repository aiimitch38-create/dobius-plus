import { APP_MENU_PASTE_EVENT } from '@/lib/app-menu-paste'
import type { TerminalPasteSource } from './terminal-paste-model'

// Every clipboard paste gesture aimed at a terminal pane (paste chord keydown,
// DOM paste event, app-menu / macOS Cmd+V relay) lands here and reaches the
// pane's one gated paste function exactly once. Ownership is decided by focus,
// not by which tab is "active": a Board console card or a visible split pane
// can hold focus while another tab is active, and leaving those panes without
// listeners let xterm (or the text-control fallback) write the clipboard
// straight to the PTY, skipping the paste confirmation.

export type TerminalPaneClipboardSource = Extract<
  TerminalPasteSource,
  'keyboard' | 'paste-event' | 'app-menu'
>

export type TerminalPanePasteListenerDeps = {
  container: HTMLElement
  isMac: boolean
  /** The user's configured terminal paste chord. */
  matchesPasteChord: (event: KeyboardEvent) => boolean
  /** Search boxes and native-chat roots inside the pane own their own paste. */
  isForeignTarget: (target: EventTarget | null) => boolean
  hasPane: () => boolean
  /** Reads the clipboard and pastes through the confirmation gate. */
  paste: (source: TerminalPaneClipboardSource, activeElementAtDispatch: Element | null) => unknown
  win?: Window
  doc?: Document
}

export function installTerminalPanePasteListeners({
  container,
  isMac,
  matchesPasteChord,
  isForeignTarget,
  hasPane,
  paste,
  win = window,
  doc = document
}: TerminalPanePasteListenerDeps): () => void {
  let suppressNextNativePaste = false
  let suppressionTimerId: number | null = null
  // Why: one gesture can surface as keydown + native paste event + menu relay;
  // while a paste is reading the clipboard or awaiting the dialog, later
  // triggers are the same gesture and must not paste again.
  let inFlight = false

  const armNativePasteSuppression = (): void => {
    suppressNextNativePaste = true
    if (suppressionTimerId !== null) {
      win.clearTimeout(suppressionTimerId)
    }
    suppressionTimerId = win.setTimeout(() => {
      suppressionTimerId = null
      suppressNextNativePaste = false
    }, 0)
  }

  const runPaste = (source: TerminalPaneClipboardSource): void => {
    if (inFlight || !hasPane()) {
      return
    }
    inFlight = true
    const activeElementAtDispatch = doc.activeElement
    void Promise.resolve()
      .then(() => paste(source, activeElementAtDispatch))
      .catch((error: unknown) => {
        console.error('[terminal-paste] paste failed', error)
      })
      .finally(() => {
        inFlight = false
      })
  }

  const isNativePasteChord = (e: KeyboardEvent): boolean => {
    const key = e.key.toLowerCase()
    return (
      (isMac && key === 'v' && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) ||
      (!isMac && key === 'v' && e.ctrlKey && !e.metaKey && !e.altKey) ||
      (!isMac && e.key === 'Insert' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey)
    )
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (isForeignTarget(e.target)) {
      return
    }
    if (!matchesPasteChord(e)) {
      if (isNativePasteChord(e)) {
        // Why: bare Ctrl+V is readline's quote-insert on Windows/Linux. If
        // Chromium turns it into a native paste event, suppress that follow-up
        // paste while still letting xterm receive the original keydown.
        armNativePasteSuppression()
      }
      return
    }
    e.preventDefault()
    e.stopPropagation()
    armNativePasteSuppression()
    runPaste('keyboard')
  }

  const onPaste = (e: ClipboardEvent): void => {
    if (isForeignTarget(e.target)) {
      return
    }
    // Why: never let xterm's own paste handler see the event; it writes the
    // clipboard to the PTY without the confirmation gate.
    e.preventDefault()
    e.stopPropagation()
    if (suppressNextNativePaste) {
      suppressNextNativePaste = false
      if (suppressionTimerId !== null) {
        win.clearTimeout(suppressionTimerId)
        suppressionTimerId = null
      }
      return
    }
    runPaste('paste-event')
  }

  const onAppMenuPaste = (event: Event): void => {
    const active = doc.activeElement
    if (!(active instanceof Element) || !container.contains(active) || isForeignTarget(active)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    runPaste('app-menu')
  }

  container.addEventListener('keydown', onKeyDown, { capture: true })
  container.addEventListener('paste', onPaste, { capture: true })
  win.addEventListener(APP_MENU_PASTE_EVENT, onAppMenuPaste)
  return () => {
    if (suppressionTimerId !== null) {
      win.clearTimeout(suppressionTimerId)
    }
    container.removeEventListener('keydown', onKeyDown, { capture: true })
    container.removeEventListener('paste', onPaste, { capture: true })
    win.removeEventListener(APP_MENU_PASTE_EVENT, onAppMenuPaste)
  }
}
