import React, { useLayoutEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { DOBIUS_BROWSER_GUEST_WEB_PREFERENCES_ATTRIBUTE } from '../../../../../shared/browser-guest-web-preferences'
import { DOBIUS_BROWSER_PARTITION } from '../../../../../shared/constants'
import { translate } from '@/i18n/i18n'

const NAV_BUTTON =
  'flex size-6 items-center justify-center rounded-full text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)]'

/**
 * Docked Web Inspector: the tile's DevTools rendered inside a second, blank
 * <webview> beside the page (Electron setDevToolsWebContents, done in main).
 * Calls `onDockFailed` when docking is refused so the tile can detach instead.
 */
export function WebTileInspectorDock({
  getGuest,
  onClose,
  onDocked,
  onDockFailed
}: {
  getGuest: () => Electron.WebviewTag | null
  onClose: () => void
  onDocked: () => void
  onDockFailed: () => void
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const getGuestRef = useRef(getGuest)
  getGuestRef.current = getGuest
  const onDockFailedRef = useRef(onDockFailed)
  onDockFailedRef.current = onDockFailed
  const onDockedRef = useRef(onDocked)
  onDockedRef.current = onDocked

  // Why layout effect: its cleanup runs before React removes the DOM, so the
  // guest's DevTools close (a synchronous webview call) before their host
  // webview is destroyed — never leaving the guest pointing at a dead host.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const host = document.createElement('webview') as Electron.WebviewTag
    host.setAttribute('partition', DOBIUS_BROWSER_PARTITION)
    host.setAttribute('webpreferences', DOBIUS_BROWSER_GUEST_WEB_PREFERENCES_ATTRIBUTE)
    // setDevToolsWebContents requires a host that has not navigated anywhere real.
    host.setAttribute('src', 'about:blank')
    host.style.width = '100%'
    host.style.height = '100%'
    let disposed = false
    const closeGuestDevTools = (): void => {
      const guest = getGuestRef.current()
      try {
        if (guest?.isDevToolsOpened()) {
          guest.closeDevTools()
        }
      } catch (error) {
        console.debug('[board-web] guest already gone while closing the inspector', error)
      }
    }
    const dock = (): void => {
      // Only the first load: the host must never be re-docked after DevTools load into it.
      host.removeEventListener('dom-ready', dock)
      const guest = getGuestRef.current()
      let guestWebContentsId: number
      let devToolsWebContentsId: number
      try {
        guestWebContentsId = guest?.getWebContentsId() ?? Number.NaN
        devToolsWebContentsId = host.getWebContentsId()
      } catch {
        // Either webview is not attached yet (no page loaded in the tile).
        onDockFailedRef.current()
        return
      }
      window.api.browser
        .dockGuestDevTools({ guestWebContentsId, devToolsWebContentsId })
        .then((ok) => {
          if (disposed) {
            // Closed while the dock request was in flight.
            if (ok) {
              closeGuestDevTools()
            }
            return
          }
          if (ok) {
            onDockedRef.current()
          } else {
            onDockFailedRef.current()
          }
        })
        .catch((error: unknown) => {
          console.warn('[board-web] docking the inspector failed', error)
          if (!disposed) {
            onDockFailedRef.current()
          }
        })
    }
    host.addEventListener('dom-ready', dock)
    container.appendChild(host)
    return () => {
      disposed = true
      host.removeEventListener('dom-ready', dock)
      closeGuestDevTools()
      host.remove()
    }
  }, [])

  return (
    <div className="flex h-full min-w-[260px] basis-[45%] flex-col border-l border-[var(--board-panel-border)] bg-[var(--board-panel)]">
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-[var(--board-panel-border)] pr-1 pl-3 text-[11px] font-medium text-[var(--board-text-muted)]">
        {translate('board.web.inspectorTitle', 'Inspector')}
        <button
          type="button"
          aria-label={translate('board.web.closeInspector', 'Close the Web Inspector')}
          className={NAV_BUTTON}
          onClick={onClose}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1" />
    </div>
  )
}
