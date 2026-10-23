import { webContents, type WebContents } from 'electron'

export type GuestDevToolsDockArgs = {
  guestWebContentsId: number
  devToolsWebContentsId: number
}

// Why: the renderer only knows webview ids, and both ids come from renderer
// input. Accept a guest only if it is a <webview> embedded by the very window
// asking, so one renderer can never attach DevTools to another window's guest
// (or to an app window, which would expose the preload bridge).
function ownedWebview(sender: WebContents, id: unknown): WebContents | null {
  if (typeof id !== 'number' || !Number.isInteger(id)) {
    return null
  }
  const target = webContents.fromId(id)
  if (!target || target.isDestroyed() || target.getType() !== 'webview') {
    return null
  }
  return target.hostWebContents?.id === sender.id ? target : null
}

/**
 * Show a guest's DevTools inside a second, blank <webview> the same window owns
 * (Electron's setDevToolsWebContents). Returns false when docking is not
 * possible, so the caller can fall back to detached DevTools.
 */
export function dockGuestDevTools(sender: WebContents, args: GuestDevToolsDockArgs): boolean {
  if (args?.guestWebContentsId === args?.devToolsWebContentsId) {
    return false
  }
  const guest = ownedWebview(sender, args?.guestWebContentsId)
  const host = ownedWebview(sender, args?.devToolsWebContentsId)
  if (!guest || !host) {
    return false
  }
  try {
    // Why: setDevToolsWebContents is ignored while DevTools are already open
    // (e.g. a detached window from the fallback path), so close them first.
    if (guest.isDevToolsOpened()) {
      guest.closeDevTools()
    }
    guest.setDevToolsWebContents(host)
    guest.openDevTools()
    return true
  } catch (error) {
    console.warn('[guest-devtools-dock] docking failed', error)
    return false
  }
}
