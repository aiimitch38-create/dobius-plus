import React, { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import {
  BOARD_ZOOM_STEP,
  dotGridSpacing,
  panViewport,
  screenToWorld,
  wheelDeltaToZoomFactor,
  zoomViewportAtPoint,
  zoomViewportBy,
  type BoardPoint,
  type BoardViewport
} from './board-viewport'
import { BOARD_ZOOM_EVENT } from '../board-zoom-event'
import { BOARD_USER_PAN_EVENT } from './board-pan-event'
import { isBoardShortcutBlockedTarget } from '../board-chrome/board-tools'

type BoardZoomDirection = 'in' | 'out' | 'reset'

const KEY_ZOOM_DIRECTIONS: Readonly<Record<string, BoardZoomDirection>> = {
  '=': 'in',
  '+': 'in',
  '-': 'out',
  '0': 'reset'
}

export type BoardMarqueeRect = { x: number; y: number; w: number; h: number }

export type BoardCanvasProps = {
  viewport: BoardViewport
  onViewportChange: (viewport: BoardViewport) => void
  /** Owned by the parent so it can measure the canvas (fit view, centered zoom). */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Select tool: a primary-button drag on empty space draws the selection box.
   *  When false (pen, shapes…), the press is only reported via onEmptyPointerDown.
   *  Panning is Space+drag or a middle-button drag in every tool. */
  selectOnEmptyDrag?: boolean
  /** Primary pointer-down on empty canvas, in world coordinates. */
  onEmptyPointerDown?: (world: BoardPoint, event: React.PointerEvent<HTMLDivElement>) => void
  /** Pointer hovering (not dragging) over the canvas: world point on empty space,
   *  null over a card or once the pointer leaves. Placing tools preview here. */
  onEmptyPointerMove?: (world: BoardPoint | null) => void
  /** While Space is held, a primary drag pans from anywhere (even over cards), in every tool. */
  spaceHeld?: boolean
  /** Fired when a Space-drag pan starts, so hold-Space push-to-talk can stand down. */
  onSpacePanStart?: () => void
  /** Drag on empty canvas (select tool): the dragged box in world coords.
   *  `additive` is true for Shift+drag (add to the current selection). */
  onMarquee?: (rect: BoardMarqueeRect, additive: boolean) => void
  /** Right-click on empty canvas, in screen (canvas-local) and world coords. */
  onEmptyContextMenu?: (screen: BoardPoint, world: BoardPoint) => void
  /** World-space content (cards). Elements marked `data-board-wheel="native"` keep
   *  plain wheel scrolling (terminals, scroll lists); pinch still zooms the board. */
  children?: React.ReactNode
  className?: string
}

function localPoint(element: HTMLElement, clientX: number, clientY: number): BoardPoint {
  const rect = element.getBoundingClientRect()
  return { x: clientX - rect.left, y: clientY - rect.top }
}

function marqueeBox(a: BoardPoint, b: BoardPoint): BoardMarqueeRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y)
  }
}

export function BoardCanvas({
  viewport,
  onViewportChange,
  containerRef,
  selectOnEmptyDrag = true,
  onEmptyPointerDown,
  onEmptyPointerMove,
  spaceHeld = false,
  onSpacePanStart,
  onMarquee,
  onEmptyContextMenu,
  children,
  className
}: BoardCanvasProps): React.JSX.Element {
  const worldRef = useRef<HTMLDivElement>(null)
  // Why: wheel/key listeners are attached once; refs keep them reading the latest
  // controlled viewport without re-subscribing on every pan frame.
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const onChangeRef = useRef(onViewportChange)
  onChangeRef.current = onViewportChange
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null)

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }
    const onWheel = (event: WheelEvent): void => {
      // Trackpad pinch arrives as ctrl+wheel on every platform.
      if (event.ctrlKey) {
        event.preventDefault()
        const anchor = localPoint(element, event.clientX, event.clientY)
        onChangeRef.current(
          zoomViewportBy(
            viewportRef.current,
            wheelDeltaToZoomFactor(event.deltaY, event.deltaMode),
            anchor
          )
        )
        return
      }
      if (event.target instanceof Element && event.target.closest('[data-board-wheel="native"]')) {
        return
      }
      event.preventDefault()
      onChangeRef.current(panViewport(viewportRef.current, -event.deltaX, -event.deltaY))
    }
    // Non-passive so preventDefault stops Chromium's page zoom/scroll.
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [containerRef])

  useEffect(() => {
    const zoomAtCenter = (direction: BoardZoomDirection): void => {
      const element = containerRef.current
      if (!element) {
        return
      }
      const center = { x: element.clientWidth / 2, y: element.clientHeight / 2 }
      const current = viewportRef.current
      const next =
        direction === 'reset'
          ? zoomViewportAtPoint(current, 1, center)
          : zoomViewportBy(
              current,
              direction === 'in' ? BOARD_ZOOM_STEP : 1 / BOARD_ZOOM_STEP,
              center
            )
      onChangeRef.current(next)
    }
    // Why: the app menu swallows Cmd +/-/0 on mac and re-dispatches it as this
    // event; the keydown path still covers platforms where the key reaches us.
    const onBoardZoom = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail
      if (detail === 'in' || detail === 'out' || detail === 'reset') {
        zoomAtCenter(detail)
      }
    }
    const isMac = navigator.userAgent.includes('Mac')
    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = isMac ? event.metaKey : event.ctrlKey
      // A console, field or studio owns its own Cmd +/- (e.g. terminal font zoom).
      if (!mod || event.altKey || isBoardShortcutBlockedTarget(event.target)) {
        return
      }
      const direction = KEY_ZOOM_DIRECTIONS[event.key]
      if (direction) {
        event.preventDefault()
        zoomAtCenter(direction)
      }
    }
    window.addEventListener(BOARD_ZOOM_EVENT, onBoardZoom)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener(BOARD_ZOOM_EVENT, onBoardZoom)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [containerRef])

  const isEmptyTarget = (target: EventTarget): boolean =>
    target === containerRef.current || target === worldRef.current

  // Why: Space+drag and middle-drag are the pans (Figma). The container flags
  // itself for the grabbing cursor and tells auto-follow the human moved the camera.
  const startPan = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY }
    event.currentTarget.setAttribute('data-board-panning', '')
    event.currentTarget.dispatchEvent(new CustomEvent(BOARD_USER_PAN_EVENT, { bubbles: true }))
  }

  // Capture phase so the Space-pan wins over the card under the pointer.
  const handlePointerDownCapture = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!spaceHeld || event.button !== 0) {
      return
    }
    event.stopPropagation()
    onSpacePanStart?.()
    startPan(event)
  }

  // Why: the selection box is drawn straight into its node (no React state), so
  // a marquee drag never re-renders the canvas or the cards under it.
  const marqueeRef = useRef<{ pointerId: number; start: BoardPoint; additive: boolean } | null>(
    null
  )
  const marqueeElRef = useRef<HTMLDivElement>(null)
  const paintMarquee = (box: BoardMarqueeRect | null): void => {
    const el = marqueeElRef.current
    if (!el) {
      return
    }
    if (!box) {
      el.style.display = 'none'
      return
    }
    el.style.display = 'block'
    el.style.left = `${box.x}px`
    el.style.top = `${box.y}px`
    el.style.width = `${box.w}px`
    el.style.height = `${box.h}px`
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button === 1) {
      startPan(event)
      return
    }
    if (event.button !== 0 || !isEmptyTarget(event.target)) {
      return
    }
    // Why: drags preventDefault, so focus would otherwise stay in the last
    // clicked terminal and swallow board keys (⌘K, ?, tool letters).
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) {
      active.blur()
    }
    const local = localPoint(event.currentTarget, event.clientX, event.clientY)
    onEmptyPointerDown?.(screenToWorld(local, viewportRef.current), event)
    if (!selectOnEmptyDrag || !onMarquee) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    marqueeRef.current = { pointerId: event.pointerId, start: local, additive: event.shiftKey }
    paintMarquee({ x: local.x, y: local.y, w: 0, h: 0 })
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const box = marqueeRef.current
    if (box && box.pointerId === event.pointerId) {
      paintMarquee(
        marqueeBox(box.start, localPoint(event.currentTarget, event.clientX, event.clientY))
      )
      return
    }
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      // Hover only: a pressed button means a shape/pen drag, which draws its own outline.
      if (onEmptyPointerMove && event.buttons === 0) {
        onEmptyPointerMove(
          isEmptyTarget(event.target)
            ? screenToWorld(
                localPoint(event.currentTarget, event.clientX, event.clientY),
                viewportRef.current
              )
            : null
        )
      }
      return
    }
    const dx = event.clientX - drag.lastX
    const dy = event.clientY - drag.lastY
    drag.lastX = event.clientX
    drag.lastY = event.clientY
    onChangeRef.current(panViewport(viewportRef.current, dx, dy))
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const box = marqueeRef.current
    if (box && box.pointerId === event.pointerId) {
      marqueeRef.current = null
      paintMarquee(null)
      const local = localPoint(event.currentTarget, event.clientX, event.clientY)
      const screen = marqueeBox(box.start, local)
      // A plain click (no box) only clears/keeps the selection via onEmptyPointerDown.
      if (screen.w === 0 && screen.h === 0) {
        return
      }
      const v = viewportRef.current
      const topLeft = screenToWorld({ x: screen.x, y: screen.y }, v)
      onMarquee?.(
        { x: topLeft.x, y: topLeft.y, w: screen.w / v.zoom, h: screen.h / v.zoom },
        box.additive
      )
      return
    }
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
      event.currentTarget.removeAttribute('data-board-panning')
    }
  }

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!onEmptyContextMenu || !isEmptyTarget(event.target)) {
      return
    }
    event.preventDefault()
    const local = localPoint(event.currentTarget, event.clientX, event.clientY)
    onEmptyContextMenu(local, screenToWorld(local, viewportRef.current))
  }

  const spacing = dotGridSpacing(viewport.zoom)

  return (
    <div
      ref={containerRef}
      data-board-canvas=""
      className={cn(
        // Why: `overflow-clip`, not hidden — a hidden box still scrolls programmatically
        // (focus reveal), which would shift a web tile under a pressed button.
        'absolute inset-0 touch-none overflow-clip bg-[var(--board-canvas)] select-none',
        'data-[board-panning]:cursor-grabbing',
        spaceHeld ? 'cursor-grab' : selectOnEmptyDrag ? 'cursor-default' : 'cursor-crosshair',
        className
      )}
      style={{
        // Dot grid (pans/zooms) over the fixed top-to-bottom canvas fade.
        backgroundImage:
          'radial-gradient(circle, var(--board-dot) 1px, transparent 1.5px), linear-gradient(var(--board-canvas), var(--board-canvas-bottom))',
        backgroundSize: `${spacing}px ${spacing}px, 100% 100%`,
        backgroundPosition: `${viewport.x - spacing / 2}px ${viewport.y - spacing / 2}px, 0 0`
      }}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={onEmptyPointerMove ? () => onEmptyPointerMove(null) : undefined}
      onContextMenu={handleContextMenu}
    >
      <div
        ref={worldRef}
        data-board-world=""
        className="absolute top-0 left-0 h-0 w-0 origin-top-left"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
        }}
      >
        {children}
      </div>
      {/* Selection box (Finder/Figma marquee); positioned imperatively while dragging. */}
      <div
        ref={marqueeElRef}
        aria-hidden
        data-board-marquee=""
        className="pointer-events-none absolute rounded-[2px] border border-[var(--board-accent)] bg-[var(--board-accent-tint)]/40"
        style={{ display: 'none' }}
      />
    </div>
  )
}
