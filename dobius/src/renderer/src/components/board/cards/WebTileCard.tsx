import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Globe, RotateCw } from 'lucide-react'
import { DOBIUS_BROWSER_GUEST_WEB_PREFERENCES_ATTRIBUTE } from '../../../../../shared/browser-guest-web-preferences'
import {
  DOBIUS_BROWSER_PARTITION,
  DOBIUS_WEB_TILE_PARTITION
} from '../../../../../shared/constants'
import {
  type BoardWebTilePopupEvent,
  WEB_TILE_POPUP_SIBLING_CAP,
  webTileBrowserPageId
} from '../../../../../shared/board-web-tile-popup'
import { toast } from 'sonner'
import { normalizeBrowserNavigationUrl } from '../../../../../shared/browser-url'
import type { CardBodyProps } from './card-body-props'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getBoard, type BoardCardOf } from '@/store/slices/board'
import { boardCardFocusViewport, focusBoardCard } from '../board-canvas/board-camera-focus'
import { duplicateSpot } from '../board-route/board-duplicate-spot'
import { viewportsMatch, webTileFullyVisible } from '../board-web/web-tile-focus'
import { webTileAddressUrl } from '../board-web/web-tile-navigation'
import { isLoopbackUrl } from '../board-web/dev-server-url'
import { deviceFitScale, findWebTileDevice, mobileUserAgent } from '../board-web/web-tile-devices'
import { WebTileExtras } from '../board-web/WebTileExtras'
import { WebTileInspectorDock } from '../board-web/WebTileInspectorDock'
import { captureWebTileThumbnail } from '../board-web/web-tile-thumbnail'
import { useCardLod } from './use-card-lod'
import { WEB_TILE_ID_ATTRIBUTE } from '../agent-presence/agent-cursor-mapping'
import { attachWebTileYield } from '../agent-presence/web-tile-yield'
import { WebTileClaimChip } from '../agent-presence/WebTileClaimChip'
import { useAgentTileLive } from '../agent-presence/use-agent-tile-live'
import { WebTileLinkControls } from '../board-browser-link/BrowserLinkControls'
import { consoleDriverAgentId } from '../board-browser-link/browser-link'
import { resyncConsoleTiles } from '../board-browser-link/console-tile-sync'

// Chromium net error for "connection refused": the dev server is not up yet.
const ERR_CONNECTION_REFUSED = -102
const DEV_SERVER_RETRY_MS = 2_500
const DEV_SERVER_MAX_RETRIES = 48

// Why: typical page body text; below ~6px on screen (zoom < ~0.375) the live
// page is unreadable and a guest swallows the clicks meant for the card.
const WEB_TILE_TEXT_PX = 16

// Why: a click inside the page focuses the guest at once; the camera waits so it
// never moves under a pressed button (pointerdown → focus → pointerup → click).
const FOCUS_FLY_DELAY_MS = 250

/** Where a tile's page browses: the private in-memory session unless the card opted into the signed-in one. */
export function webTilePartition(session: BoardCardOf<'web'>['session']): string {
  return session === 'shared' ? DOBIUS_BROWSER_PARTITION : DOBIUS_WEB_TILE_PARTITION
}

/**
 * A sibling tile for a popup the page opened: same size, device and session,
 * placed beside the source. Returns the new card id, or null when the source
 * already has WEB_TILE_POPUP_SIBLING_CAP popup tiles (a toast says so).
 */
export function openWebTilePopupSibling(
  worktreeId: string,
  source: BoardCardOf<'web'>,
  event: Pick<BoardWebTilePopupEvent, 'url'>
): string | null {
  const state = useAppStore.getState()
  const cards = getBoard(state, worktreeId).cards
  const siblings = cards.filter((c) => c.kind === 'web' && c.popupOf === source.id).length
  if (siblings >= WEB_TILE_POPUP_SIBLING_CAP) {
    toast.warning(
      translate(
        'board.web.popupCap',
        '{{title}} opened too many popups. Close some to allow more.',
        {
          title: source.title
        }
      )
    )
    return null
  }
  const spot = duplicateSpot(
    source,
    cards.map(({ x, y, w, h }) => ({ x, y, w, h }))
  )
  return state.addCard(worktreeId, {
    kind: 'web',
    title: translate('board.web.popupTitle', 'Popup'),
    url: event.url,
    popupOf: source.id,
    x: spot.x,
    y: spot.y,
    w: source.w,
    h: source.h,
    ...(source.device ? { device: source.device } : {}),
    ...(source.session ? { session: source.session } : {})
  })
}

function boardScreenSize(): { width: number; height: number } {
  const canvas = document.querySelector('[data-board-canvas]')
  if (canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
    return { width: canvas.clientWidth, height: canvas.clientHeight }
  }
  return { width: window.innerWidth, height: window.innerHeight }
}

const NAV_BUTTON =
  'flex size-7 items-center justify-center rounded-full text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)] disabled:opacity-40'

// ponytail: a standalone guest on its own partition. BrowserPane needs a
// tab-strip browser tab, which would leak board tiles into Classic tabs.
export function WebTileCard({
  card,
  onChange,
  worktreeId,
  zoom = 1
}: CardBodyProps<'web'> & { worktreeId?: string; zoom?: number }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
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
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null)
  const setBodyRef = useCallback((node: HTMLDivElement | null) => {
    bodyRef.current = node
    setBodyEl(node)
  }, [])
  const { lod, onScreen, settledZoom } = useCardLod(bodyEl, zoom, WEB_TILE_TEXT_PX)
  // Why: while an agent works in the tile the user must see the real page (and
  // the agent's screenshots need a painted guest), so no glance still even zoomed out.
  const agentLive = useAgentTileLive(card.id)
  const glance = lod === 'glance' && !agentLive
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  // Bumped on every navigation, so the glance re-captures only when the page changed.
  const [navSeq, setNavSeq] = useState(0)
  // Bumped when a load finishes, so a capture that found no frame yet tries again.
  const [loadSeq, setLoadSeq] = useState(0)
  const thumbnailSeq = useRef(-1)
  const defaultUserAgent = useRef(navigator.userAgent)
  const userAgentSwitched = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const cardRef = useRef(card)
  cardRef.current = card
  const guestWebContentsId = useRef<number | null>(null)
  // Why: the camera may not fly while the zoom is still settling (a pinch in flight).
  const gesturing = settledZoom !== (zoom > 0 ? zoom : 1)
  const gesturingRef = useRef(gesturing)
  gesturingRef.current = gesturing
  const partition = webTilePartition(card.session)

  useEffect(() => setDraft(card.url), [card.url])

  // Why: switching sessions recreates the guest — a webview's partition is fixed once attached.
  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const webview = document.createElement('webview') as Electron.WebviewTag
    webview.setAttribute('partition', partition)
    // Why: without it Chromium drops window.open/target=_blank in the guest before
    // main's window-open handler (which turns popups into sibling tiles) ever runs.
    webview.setAttribute('allowpopups', '')
    webview.setAttribute('webpreferences', DOBIUS_BROWSER_GUEST_WEB_PREFERENCES_ATTRIBUTE)
    webview.style.width = '100%'
    webview.style.height = '100%'
    container.appendChild(webview)
    webviewRef.current = webview
    let retries = 0
    let retryTimer: number | undefined
    let focusTimer: number | undefined
    let registeredPageId: string | null = null
    const incognito = partition === DOBIUS_WEB_TILE_PARTITION
    const sync = (): void => {
      setError(null)
      setWaiting(false)
      retries = 0
      setNavSeq((n) => n + 1)
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
          code === -105
            ? translate(
                'board.web.siteNotFound',
                'Could not find this site. Check the full address, such as google.com, then press Enter.'
              )
            : detail.errorDescription ||
                translate('board.web.loadFailed', 'Could not load {{url}}.', {
                  url: detail.validatedURL || 'page'
                })
        )
      }
    }
    const loaded = (): void => setLoadSeq((n) => n + 1)
    // Why: tried on did-attach so a popup fired during the first load can find
    // the guest registered, but Electron only hands out the id once dom-ready
    // has fired (did-attach usually comes first and throws), so dom-ready
    // retries; the same id is never registered twice.
    const register = (): void => {
      let webContentsId: number
      try {
        webContentsId = webview.getWebContentsId()
      } catch (error) {
        console.debug('[board-web] guest not addressable yet', error)
        return
      }
      if (guestWebContentsId.current === webContentsId) {
        return
      }
      guestWebContentsId.current = webContentsId
      // Why: registered under `web-tile:<cardId>` so the agent browser bridge
      // can address the tile like a browser page; a renderer swap re-registers.
      if (worktreeId) {
        const browserPageId = webTileBrowserPageId(cardRef.current.id)
        registeredPageId = browserPageId
        void window.api?.browser
          ?.registerGuest({
            browserPageId,
            workspaceId: browserPageId,
            worktreeId,
            webContentsId
          })
          // Why: main forgot this tile's console binding when the previous guest unregistered.
          .then(() => resyncConsoleTiles())
          .catch((error: unknown) => console.debug('[board-web] guest registration failed', error))
      }
    }
    const ready = (): void => {
      register()
      // Why: guest CSS px must map 1:1 onto the tile's rect for agent cursors.
      // Zoom factors are per origin per session, so only the private session
      // is touched: the shared one would reset the user's Browser-pane zoom.
      if (!incognito) {
        return
      }
      try {
        if (webview.getZoomFactor() !== 1) {
          webview.setZoomFactor(1)
        }
      } catch (error) {
        console.debug('[board-web] zoom factor not applied', error)
      }
    }
    // Why: the host never sees a pointerup that happens inside the guest, so a
    // tile already fully on screen at a readable zoom never flies (the user is
    // working in it, maybe mid-press); only a tile partly off screen or too
    // small flies, and then after the delay, or as soon as the host saw the
    // press end.
    const tryFly = (): void => {
      window.clearTimeout(focusTimer)
      focusTimer = undefined
      const { id, x, y, w, h } = cardRef.current
      if (!worktreeId || gesturingRef.current) {
        return
      }
      const viewport = getBoard(useAppStore.getState(), worktreeId).viewport
      if (webTileFullyVisible({ x, y, w, h }, viewport, boardScreenSize())) {
        return
      }
      // Why: focus mode outlives a pan (only Esc, a canvas click or another
      // focus click ends it), so "this tile is the focus target" does not mean
      // the camera is on it. Only a camera already at the tile's framing (a
      // tile larger than the screen) has nowhere to fly.
      const target = boardCardFocusViewport(worktreeId, id)
      if (target && viewportsMatch(viewport, target)) {
        return
      }
      focusBoardCard(worktreeId, id)
    }
    const pressEnd = (): void => {
      if (focusTimer !== undefined) {
        tryFly()
      }
    }
    const focused = (): void => {
      window.clearTimeout(focusTimer)
      focusTimer = window.setTimeout(tryFly, FOCUS_FLY_DELAY_MS)
    }
    webview.addEventListener('did-navigate', sync)
    webview.addEventListener('did-navigate-in-page', sync)
    webview.addEventListener('did-fail-load', fail)
    webview.addEventListener('did-stop-loading', loaded)
    webview.addEventListener('did-finish-load', loaded)
    webview.addEventListener('did-attach', register)
    webview.addEventListener('dom-ready', ready)
    webview.addEventListener('focus', focused)
    window.addEventListener('pointerup', pressEnd, true)
    window.addEventListener('mouseup', pressEnd, true)
    // Why: Carson acting inside a tile an agent claims makes the agent yield (human always wins).
    const detachYield = attachWebTileYield(cardRef.current.id, webview, rootRef.current)
    return () => {
      detachYield()
      webview.removeEventListener('did-navigate', sync)
      webview.removeEventListener('did-navigate-in-page', sync)
      webview.removeEventListener('did-fail-load', fail)
      webview.removeEventListener('did-stop-loading', loaded)
      webview.removeEventListener('did-finish-load', loaded)
      webview.removeEventListener('did-attach', register)
      webview.removeEventListener('dom-ready', ready)
      webview.removeEventListener('focus', focused)
      window.removeEventListener('pointerup', pressEnd, true)
      window.removeEventListener('mouseup', pressEnd, true)
      window.clearTimeout(retryTimer)
      window.clearTimeout(focusTimer)
      if (registeredPageId) {
        void window.api?.browser
          ?.unregisterGuest({ browserPageId: registeredPageId })
          .catch((error: unknown) => console.debug('[board-web] guest unregister failed', error))
      }
      guestWebContentsId.current = null
      webviewRef.current = null
      webview.remove()
    }
  }, [partition, worktreeId])

  useEffect(() => {
    const webview = webviewRef.current
    const target = card.url ? normalizeBrowserNavigationUrl(card.url) : null
    if (webview && target && webview.getAttribute('src') !== target) {
      webview.setAttribute('src', target)
    }
  }, [card.url, partition])

  // Why: the page's popups (OAuth, target=_blank, window.open) arrive from main
  // as an event for this guest; they open as a sibling tile, never a native window.
  useEffect(() => {
    if (!worktreeId) {
      return
    }
    return window.api?.ui?.onBoardWebTilePopup((event) => {
      if (event.guestWebContentsId === guestWebContentsId.current) {
        openWebTilePopupSibling(worktreeId, cardRef.current, event)
      }
    })
  }, [worktreeId])

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
    // Why: `partition` is a dependency because a session switch recreates the guest.
  }, [mobile, partition])

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

  // Why: the miniature is a still of the page taken as the tile zooms out (the
  // guest is still painted then), and again only after the page navigates or a
  // load finishes (when an earlier capture found no frame yet); no periodic
  // capture, which cost CPU on every glance tile. The webview itself stays
  // mounted and visible underneath, so nothing reloads.
  useEffect(() => {
    if (!glance || !onScreen || thumbnailSeq.current === navSeq) {
      return
    }
    let cancelled = false
    void captureWebTileThumbnail(webviewRef.current).then((still) => {
      if (!cancelled && still) {
        thumbnailSeq.current = navSeq
        setThumbnail(still)
      }
    })
    return () => {
      cancelled = true
    }
  }, [glance, onScreen, navSeq, loadSeq])

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
    const state = useAppStore.getState()
    const target = webTileAddressUrl(draft, state.browserDefaultSearchEngine, {
      kagiSessionLink: state.browserKagiSessionLink
    })
    if (target) {
      onChange({ url: target })
    } else {
      setError(translate('board.web.enterAddress', 'Enter a web address.'))
    }
  }

  return (
    <div ref={rootRef} className="relative flex size-full flex-col">
      <WebTileClaimChip
        cardId={card.id}
        driverAgentId={card.driverCardId ? consoleDriverAgentId(card.driverCardId) : null}
      />
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
        {worktreeId ? <WebTileLinkControls worktreeId={worktreeId} tile={card} /> : null}
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
          ref={setBodyRef}
          // Why: clip, not hidden: a hidden box can still be scrolled by focus reveal, moving the page under a click.
          className={`relative min-h-0 min-w-0 flex-1 overflow-clip ${device ? 'bg-[var(--board-panel-2)]' : 'bg-[var(--board-panel)]'}`}
        >
          <div
            ref={containerRef}
            // Why: the cursor overlay finds this tile's webview by card id to map guest px to the screen.
            {...{ [WEB_TILE_ID_ATTRIBUTE]: card.id }}
            className={
              device
                ? 'absolute overflow-clip bg-[var(--board-panel)] shadow-(--board-shadow)'
                : 'absolute'
            }
            style={frameStyle}
          />
          {glance && (
            // Why: a shield over the guest so a zoomed-out click selects the card
            // instead of landing in the page; shows the still when one exists,
            // otherwise the live page shows through.
            <div
              data-board-card-glance
              data-board-web-glance
              className="absolute cursor-zoom-in overflow-clip select-none"
              style={frameStyle}
            >
              {thumbnail ? (
                <img
                  src={thumbnail}
                  alt=""
                  draggable={false}
                  className="size-full object-cover object-top-left"
                />
              ) : null}
            </div>
          )}
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
