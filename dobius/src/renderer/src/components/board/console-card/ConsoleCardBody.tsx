import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { BoardCardOf } from '@/store/slices/board'
import {
  BOARD_GLANCE_FADE_MS,
  BOARD_PAINT_FALLBACK_MS,
  blurBoardTerminalSlot,
  claimBoardTerminalSlot,
  focusBoardTerminalSlot,
  onBoardTerminalSlotPainted,
  onBoardTerminalSlotReleased,
  releaseBoardTerminalSlot,
  requestBoardTerminalFit
} from './board-terminal-slots'
import {
  CONSOLE_SETTLE_MS,
  consoleHostBox,
  nextConsoleMode,
  zoomedFontSize,
  shouldRefit,
  type ConsoleRenderMode
} from './console-render-plan'
import {
  isBoardConsoleFontOverrideSupported,
  setBoardConsoleFontOverride
} from './console-font-override'
import { miniatureWorthDrawing } from '../board-canvas/board-lod'
import { ConsoleGlanceView } from './ConsoleGlance'
import { useConsolePane } from './use-console-pane'
import { useSettledValue } from './use-settled-value'

type ConsoleCardBodyProps = {
  worktreeId: string
  card: BoardCardOf<'console'>
  zoom: number
  focused: boolean
}

/**
 * Glance -> live handoff. 'waiting': the live pane is portaled in but has not
 * painted yet, so the glance stays on top. 'fading': it painted; the glance
 * fades out over BOARD_GLANCE_FADE_MS and then unmounts.
 */
type GlanceHandoff = 'none' | 'waiting' | 'fading'

export function ConsoleCardBody({
  worktreeId,
  card,
  zoom,
  focused
}: ConsoleCardBodyProps): React.JSX.Element {
  const { tabExists, leafId, paneKey } = useConsolePane(worktreeId, card.tabId)
  const [body, setBody] = useState<HTMLDivElement | null>(null)
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [ownerSlot, setOwnerSlot] = useState<string | null>(null)
  const [visibleRaw, setVisibleRaw] = useState(true)
  const baseFontSize = useAppStore((s) => s.settings?.terminalFontSize ?? 14)
  const z = zoom > 0 ? zoom : 1
  // Why: a Board opened already zoomed out should start as a glance, not
  // portal every terminal in for one frame and hand it straight back.
  const [mode, setMode] = useState<ConsoleRenderMode>(() =>
    nextConsoleMode({
      prev: 'live',
      settledZoom: z,
      visible: true,
      gesturing: false,
      baseFontSize,
      bodyWidth: 0,
      bodyHeight: 0
    })
  )

  // Why: a zoom that changed in the last 150ms is an active pinch/zoom; hold
  // layout at the settled zoom so the card only scales visually until it stops.
  const settledZoom = useSettledValue(z, CONSOLE_SETTLE_MS)
  const gesturing = settledZoom !== z
  const visible = useSettledValue(visibleRaw, CONSOLE_SETTLE_MS)

  useLayoutEffect(() => {
    if (!body) {
      return
    }
    // offsetWidth/Height are layout (world) units, unaffected by the canvas scale.
    const measure = (): void => setSize({ w: body.offsetWidth, h: body.offsetHeight })
    measure()
    const resize = new ResizeObserver(measure)
    resize.observe(body)
    const intersect = new IntersectionObserver(([entry]) =>
      setVisibleRaw(entry?.isIntersecting ?? true)
    )
    intersect.observe(body)
    return () => {
      resize.disconnect()
      intersect.disconnect()
    }
  }, [body])

  useEffect(() => {
    const next = nextConsoleMode({
      prev: mode,
      settledZoom,
      visible,
      gesturing,
      baseFontSize,
      bodyWidth: size.w,
      bodyHeight: size.h
    })
    if (next !== mode) {
      setMode(next)
    }
  }, [baseFontSize, gesturing, mode, settledZoom, size.h, size.w, visible])

  // Why: glance mode hands the pane back to its ordinary (hidden) host; the
  // PTY and emulator keep running, so no output is lost while it shows text.
  useLayoutEffect(() => {
    if (mode !== 'live' || !target || !paneKey || !tabExists) {
      return
    }
    const slot = { slotId: card.id, target, worktreeId, tabId: card.tabId, paneKey }
    const claim = (): void => setOwnerSlot(claimBoardTerminalSlot(slot))
    claim()
    // Why: if the card that owns this tab is deleted, take the terminal over
    // instead of showing "shown in another card" until a remount.
    const unsubscribe = onBoardTerminalSlotReleased(claim)
    return () => {
      unsubscribe()
      releaseBoardTerminalSlot(card.id)
    }
  }, [card.id, card.tabId, mode, paneKey, tabExists, target, worktreeId])

  useEffect(() => {
    if (!focused || !paneKey || ownerSlot || mode !== 'live') {
      return
    }
    focusBoardTerminalSlot(card.id)
    // Why: focusing a pane in another worktree would retarget the Classic shell.
    if (useAppStore.getState().activeWorktreeId === worktreeId) {
      activateTabAndFocusPane(card.tabId, leafId)
    }
    return () => blurBoardTerminalSlot(card.id)
  }, [card.id, card.tabId, focused, leafId, mode, ownerSlot, paneKey, worktreeId])

  // Why: publish the grid-preserving font only for a settled, live pane;
  // during a pinch the card just scales visually.
  useEffect(() => {
    if (!paneKey || mode !== 'live') {
      return
    }
    setBoardConsoleFontOverride(paneKey, zoomedFontSize(baseFontSize, settledZoom))
    return () => setBoardConsoleFontOverride(paneKey, null)
  }, [baseFontSize, mode, paneKey, settledZoom])

  // Why: entering live mode portals the pane, and TerminalPane's isolation
  // effect fits it once on arrival (then reports the paint). A second,
  // debounced fit from here would resize the PTY twice; only later settled
  // size/zoom changes refit, never per animation frame or mid-gesture.
  const enteredLiveRef = useRef(true)
  useEffect(() => {
    if (mode === 'live') {
      enteredLiveRef.current = true
    }
  }, [mode])
  useEffect(() => {
    if (!target || size.w === 0 || !shouldRefit({ mode, gesturing, changed: true })) {
      return
    }
    if (enteredLiveRef.current) {
      enteredLiveRef.current = false
      return
    }
    requestBoardTerminalFit()
  }, [gesturing, mode, settledZoom, size.w, size.h, target])

  const [handoff, setHandoff] = useState<GlanceHandoff>('none')
  const prevModeRef = useRef<ConsoleRenderMode | null>(null)
  useEffect(() => {
    const prev = prevModeRef.current
    prevModeRef.current = mode
    if (mode === 'glance') {
      setHandoff('none')
      return
    }
    if (prev === 'glance') {
      setHandoff('waiting')
    }
  }, [mode])
  useEffect(() => {
    if (handoff !== 'waiting') {
      return
    }
    // Why: with no live pane of its own to wait for, the card shows its notice.
    if (!paneKey || ownerSlot || !tabExists) {
      setHandoff('none')
      return
    }
    const reveal = (): void => setHandoff('fading')
    const unsubscribe = onBoardTerminalSlotPainted(paneKey, reveal)
    const fallback = window.setTimeout(reveal, BOARD_PAINT_FALLBACK_MS)
    return () => {
      unsubscribe()
      window.clearTimeout(fallback)
    }
  }, [handoff, ownerSlot, paneKey, tabExists])
  useEffect(() => {
    if (handoff !== 'fading') {
      return
    }
    const timer = window.setTimeout(() => setHandoff('none'), BOARD_GLANCE_FADE_MS)
    return () => window.clearTimeout(timer)
  }, [handoff])

  const setTargetRef = useCallback((node: HTMLDivElement | null) => setTarget(node), [])
  const fontOverride = isBoardConsoleFontOverrideSupported()
  const host = consoleHostBox(size.w, size.h, settledZoom, fontOverride)

  const notice = !tabExists
    ? translate('board.console.closed', 'This terminal was closed.')
    : ownerSlot
      ? translate('board.console.elsewhere', 'This terminal is shown in another card.')
      : !paneKey
        ? null
        : undefined

  return (
    <div
      ref={setBody}
      data-board-console
      className="relative size-full overflow-hidden bg-[var(--board-panel)]"
    >
      {/* Why: counter-scale so xterm sees 1:1 pixels; plain CSS scale misaligns mouse selection. */}
      <div
        ref={setTargetRef}
        className="absolute top-0 left-0"
        style={{
          width: host.width,
          height: host.height,
          transform: `scale(${host.scale})`,
          transformOrigin: '0 0',
          visibility: mode === 'live' ? undefined : 'hidden'
        }}
      />
      {(mode === 'glance' || handoff !== 'none') && notice === undefined && (
        // Why: during the handoff the glance sits over the live pane so no
        // blank frame shows; it is inert then so clicks reach the terminal.
        <div
          className="absolute inset-0"
          data-board-glance-handoff={handoff === 'none' ? undefined : handoff}
          style={{
            opacity: handoff === 'fading' ? 0 : 1,
            transition: `opacity ${BOARD_GLANCE_FADE_MS}ms ease-out`,
            pointerEvents: mode === 'live' ? 'none' : undefined
          }}
        >
          <ConsoleGlanceView
            worktreeId={worktreeId}
            tabId={card.tabId}
            leafId={leafId}
            title={card.title}
            onScreen={visibleRaw}
            drawText={miniatureWorthDrawing(size.h, settledZoom)}
            bodyHeight={size.h}
            bodyWidth={size.w}
          />
        </div>
      )}
      {notice !== undefined && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 p-4 text-center text-[13px] text-[var(--board-text-muted)]">
          {notice ?? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {translate('board.console.starting', 'Starting…')}
            </>
          )}
        </div>
      )}
    </div>
  )
}
