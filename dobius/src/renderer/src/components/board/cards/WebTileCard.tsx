import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Globe, RotateCw } from 'lucide-react'
import { DOBIUS_BROWSER_GUEST_WEB_PREFERENCES_ATTRIBUTE } from '../../../../../shared/browser-guest-web-preferences'
import { DOBIUS_BROWSER_PARTITION } from '../../../../../shared/constants'
import { normalizeBrowserNavigationUrl } from '../../../../../shared/browser-url'
import type { CardBodyProps } from './card-body-props'
import { translate } from '@/i18n/i18n'
import { isLoopbackUrl } from '../board-web/dev-server-url'
import { deviceFitScale, findWebTileDevice, mobileUserAgent } from '../board-web/web-tile-devices'
import { WebTileExtras } from '../board-web/WebTileExtras'
import { WebTileInspectorDock } from '../board-web/WebTileInspectorDock'

// Chromium net error for "connection refused": the dev server is not up yet.
const ERR_CONNECTION_REFUSED = -102
const DEV_SERVER_RETRY_MS = 2_500
const DEV_SERVER_MAX_RETRIES = 48

const NAV_BUTTON =
  'flex size-7 items-center justify-center rounded-full text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)] disabled:opacity-40'

function toNavigableUrl(input: string): string | null {
  const trimmed = input.trim()
  return (
    normalizeBrowserNavigationUrl(trimmed) ?? normalizeBrowserNavigationUrl(`https://${trimmed}`)
  )
}

// ponytail: a standalone guest on the shared browser partition. BrowserPane
// needs a tab-strip browser tab, which would leak board tiles into Classic tabs.
export function WebTileCard({
  card,
  onChange,
  worktreeId
}: CardBodyProps<'web'> & { worktreeId?: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const [draft, setDraft] = useState(card.url)
  const [nav, setNav] = useState({ back: false, forward: false })
  const [error, setError] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [inspectorDocked, setInspectorDocked] = useState(false)
  // Why: once a guest has docked, Electron keeps the (now closed) dock as its
  // DevTools target, so a detached window is no longer safe for this guest.
  const inspectorEverDocked = useRef(false)
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 })
  const bodyRef = useRef<HTMLDivElement>(null)
  const defaultUserAgent = useRef(navigator.userAgent)
  const userAgentSwitched = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => setDraft(card.url), [card.url])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const webview = document.createElement('webview') as Electron.WebviewTag
    webview.setAttribute('partition', DOBIUS_BROWSER_PARTITION)
    webview.setAttribute('webpreferences', DOBIUS_BROWSER_GUEST_WEB_PREFERENCES_ATTRIBUTE)
    webview.style.width = '100%'
    webview.style.height = '100%'
    container.appendChild(webview)
    webviewRef.current = webview
    let retries = 0
    let retryTimer: number | undefined
    const sync = (): void => {
      setError(null)
      setWaiting(false)
      retries = 0
      const url = webview.getURL()
      if (url) {
        onChangeRef.current({ url })
      }
      try {
        setNav({ back: webview.canGoBack(), forward: webview.canGoForward() })
      } catch {
        setNav({ back: false, forward: false })
      }
    }
    const fail = (event: Event): void => {
      const detail = event as Event & {
        errorDescription?: string
        validatedURL?: string
        isMainFrame?: boolean
      }
      const code = (event as Event & { errorCode?: number }).errorCode
      // Why: an agent often prints the URL before the server accepts connections; keep retrying briefly.
      if (
        detail.isMainFrame !== false &&
        code === ERR_CONNECTION_REFUSED &&
        isLoopbackUrl(detail.validatedURL ?? '') &&
        retries < DEV_SERVER_MAX_RETRIES
      ) {
        retries += 1
        setWaiting(true)
        window.clearTimeout(retryTimer)
        retryTimer = window.setTimeout(() => webview.reload(), DEV_SERVER_RETRY_MS)
        return
      }
      setWaiting(false)
      if (detail.isMainFrame !== false) {
        setError(
          detail.errorDescription ||
            translate('board.web.loadFailed', 'Could not load {{url}}.', {
              url: detail.validatedURL || 'page'
            })
        )
      }
    }
    webview.addEventListener('did-navigate', sync)
    webview.addEventListener('did-navigate-in-page', sync)
    webview.addEventListener('did-fail-load', fail)
    return () => {
      webview.removeEventListener('did-navigate', sync)
      webview.removeEventListener('did-navigate-in-page', sync)
      webview.removeEventListener('did-fail-load', fail)
      window.clearTimeout(retryTimer)
      webviewRef.current = null
      webview.remove()
    }
  }, [])

  useEffect(() => {
    const webview = webviewRef.current
    const target = card.url ? toNavigableUrl(card.url) : null
    if (webview && target && webview.getAttribute('src') !== target) {
      webview.setAttribute('src', target)
    }
  }, [card.url])

  // Why: a phone viewport also needs a phone user agent, or sites serve desktop markup.
  const mobile = findWebTileDevice(card.device)?.mobile ?? false
  useEffect(() => {
    const webview = webviewRef.current
    // Desktop tiles that never switched keep the guest's default user agent untouched.
    if (!webview || (!mobile && !userAgentSwitched.current)) {
      return
    }
    userAgentSwitched.current = true
    const agent = mobile ? mobileUserAgent(defaultUserAgent.current) : defaultUserAgent.current
    try {
      webview.setUserAgent(agent)
      if (webview.getURL()) {
        webview.reload()
      }
    } catch (error) {
      // Not attached yet: the attribute applies on the guest's first load instead.
      if (mobile) {
        webview.setAttribute('useragent', agent)
      } else {
        webview.removeAttribute('useragent')
      }
      console.debug('[board-web] user agent switch deferred', error)
    }
  }, [mobile])

  useEffect(() => {
    const body = bodyRef.current
    if (!body) {
      return
    }
    const observer = new ResizeObserver(([entry]) =>
      setBodySize({ width: entry.contentRect.width, height: entry.contentRect.height })
    )
    observer.observe(body)
    return () => observer.disconnect()
  }, [])

  const device = findWebTileDevice(card.device)
  const scale = device ? deviceFitScale(device, bodySize) : 1
  // Why: the device keeps its real CSS size (so the page lays out as on that screen)
  // and is scaled down to fit; the same element keeps the webview, so no reload.
  const frameStyle: React.CSSProperties = device
    ? {
        width: device.width,
        height: device.height,
        left: Math.max(0, (bodySize.width - device.width * scale) / 2),
        top: Math.max(0, (bodySize.height - device.height * scale) / 2),
        transform: `scale(${scale})`,
        transformOrigin: 'top left'
      }
    : { inset: 0 }

  // Why: detached DevTools stay as the fallback when Electron refuses to dock.
  const openDetachedInspector = (): void => {
    if (inspectorEverDocked.current) {
      setInspectorDocked(true)
      return
    }
    setInspectorDocked(false)
    try {
      webviewRef.current?.openDevTools()
    } catch (error) {
      setError(
        translate('board.web.inspectorUnavailable', 'Load a page before opening the Web Inspector.')
      )
      console.debug('[board-web] inspector unavailable', error)
    }
  }

  const navigate = (): void => {
    const target = toNavigableUrl(draft)
    if (target) {
      onChange({ url: target })
    } else {
      setError(translate('board.web.enterAddress', 'Enter a web address.'))
    }
  }

  return (
    <div className="flex size-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--board-panel-border)] px-2">
        <button
          type="button"
          aria-label={translate('board.web.back', 'Back')}
          className={NAV_BUTTON}
          disabled={!nav.back}
          onClick={() => webviewRef.current?.goBack()}
        >
          <ArrowLeft className="size-4" />
        </button>
        <button
          type="button"
          aria-label={translate('board.web.forward', 'Forward')}
          className={NAV_BUTTON}
          disabled={!nav.forward}
          onClick={() => webviewRef.current?.goForward()}
        >
          <ArrowRight className="size-4" />
        </button>
        <button
          type="button"
          aria-label={translate('board.web.reload', 'Reload')}
          title={translate(
            'board.web.reloadHint',
            'Reload · Shift-click for a hard reload (skip cache)'
          )}
          className={NAV_BUTTON}
          onClick={(e) =>
            e.shiftKey ? webviewRef.current?.reloadIgnoringCache() : webviewRef.current?.reload()
          }
        >
          <RotateCw className="size-4" />
        </button>
        <label className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-full bg-[var(--board-panel-2)] px-3">
          <Globe className="size-3.5 shrink-0 text-[var(--board-text-muted)]" />
          <input
            value={draft}
            aria-label={translate('board.web.address', 'Address')}
            placeholder={translate('board.web.placeholder', 'localhost:3000')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                navigate()
              } else if (e.key === 'Escape') {
                setDraft(card.url)
              }
            }}
            className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[12px] text-[var(--board-text)] outline-none placeholder:text-[var(--board-text-muted)]"
          />
        </label>
        {worktreeId ? (
          <WebTileExtras
            worktreeId={worktreeId}
            deviceId={card.device ?? null}
            onDevice={(id) => onChange({ device: id ?? undefined })}
            onNavigate={(url) => onChange({ url })}
            inspectorOpen={inspectorDocked}
            onOpenInspector={() => setInspectorDocked((open) => !open)}
            onOpenDetachedInspector={openDetachedInspector}
          />
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1">
        <div
          ref={bodyRef}
          className={`relative min-h-0 min-w-0 flex-1 overflow-hidden ${device ? 'bg-[var(--board-panel-2)]' : 'bg-[var(--board-panel)]'}`}
        >
          <div
            ref={containerRef}
            className={
              device
                ? 'absolute overflow-hidden bg-[var(--board-panel)] shadow-(--board-shadow)'
                : 'absolute'
            }
            style={frameStyle}
          />
          {(error || waiting || !card.url) && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--board-panel)]/85 p-4 text-center text-[13px] text-[var(--board-text-muted)]">
              {waiting
                ? translate('board.web.waiting', 'Waiting for the dev server to start…')
                : (error ?? translate('board.web.empty', 'Type an address above to load a page.'))}
            </div>
          )}
        </div>
        {inspectorDocked ? (
          <WebTileInspectorDock
            getGuest={() => webviewRef.current}
            onClose={() => setInspectorDocked(false)}
            onDocked={() => {
              inspectorEverDocked.current = true
            }}
            onDockFailed={openDetachedInspector}
          />
        ) : null}
      </div>
    </div>
  )
}
