import React, { useEffect, useRef, useState } from 'react'
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
import { isBoardShortcutBlockedTarget } from '../board-chrome/board-tools'

type BoardZoomDirection = 'in' | 'out' | 'reset'

const KEY_ZOOM_DIRECTIONS: Readonly<Record<string, BoardZoomDirection>> = {
  '=': 'in',
  '+': 'in',
  '-': 'out',
  '0': 'reset'
}

export type BoardCanvasProps = {
  viewport: BoardViewport
  onViewportChange: (viewport: BoardViewport) => void
  /** Owned by the parent so it can measure the canvas (fit view, centered zoom). */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** When false, a primary-button drag on empty space is reported instead of panning
   *  (pen, shapes…). Middle-button drag always pans. */
  panOnEmptyDrag?: boolean
  /** Primary pointer-down on empty canvas, in world coordinates. */
  onEmptyPointerDown?: (world: BoardPoint, event: React.PointerEvent<HTMLDivElement>) => void
  /** While Space is held, a primary drag pans from anywhere (even over cards), in every tool. */
  spaceHeld?: boolean
  /** Fired when a Space-drag pan starts, so hold-Space push-to-talk can stand down. */
  onSpacePanStart?: () => void
  /** Shift+drag on empty canvas (select tool): the dragged box in world coords. */
  onMarquee?: (rect: { x: number; y: number; w: number; h: number }) => void
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

export function BoardCanvas({
  viewport,
  onViewportChange,
  containerRef,
  panOnEmptyDrag = true,
  onEmptyPointerDown,
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

  const startDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY }
  }

  // Capture phase so the Space-pan wins over the card under the pointer.
  const handlePointerDownCapture = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!spaceHeld || event.button !== 0) {
      return
    }
    event.stopPropagation()
    onSpacePanStart?.()
    startDrag(event)
  }

  // Why: a plain empty-space drag pans (spec), so the selection box is Shift+drag.
  const marqueeRef = useRef<{ pointerId: number; start: BoardPoint } | null>(null)
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null
  )

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const middle = event.button === 1
    if (!middle && (event.button !== 0 || !isEmptyTarget(event.target))) {
      return
    }
    if (!middle) {
      // Why: drags preventDefault, so focus would otherwise stay in the last
      // clicked terminal and swallow board keys (⌘K, ?, tool letters).
      const active = document.activeElement
      if (active instanceof HTMLElement && active !== document.body) {
        active.blur()
      }
      const local = localPoint(event.currentTarget, event.clientX, event.clientY)
      onEmptyPointerDown?.(screenToWorld(local, viewportRef.current), event)
      if (!panOnEmptyDrag) {
        return
      }
      if (event.shiftKey && onMarquee) {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        marqueeRef.current = { pointerId: event.pointerId, start: local }
        setMarquee({ x: local.x, y: local.y, w: 0, h: 0 })
        return
      }
    }
    startDrag(event)
  }

  const marqueeBox = (
    a: BoardPoint,
    b: BoardPoint
  ): { x: number; y: number; w: number; h: number } => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y)
  })

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const box = marqueeRef.current
    if (box && box.pointerId === event.pointerId) {
      setMarquee(
        marqueeBox(box.start, localPoint(event.currentTarget, event.clientX, event.clientY))
      )
      return
    }
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
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
      setMarquee(null)
      const local = localPoint(event.currentTarget, event.clientX, event.clientY)
      const screen = marqueeBox(box.start, local)
      const v = viewportRef.current
      const topLeft = screenToWorld({ x: screen.x, y: screen.y }, v)
      onMarquee?.({ x: topLeft.x, y: topLeft.y, w: screen.w / v.zoom, h: screen.h / v.zoom })
      return
    }
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
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
        'absolute inset-0 touch-none overflow-hidden bg-[var(--board-canvas)] select-none',
        spaceHeld
          ? 'cursor-grab active:cursor-grabbing'
          : panOnEmptyDrag
            ? 'cursor-default active:cursor-grabbing'
            : 'cursor-crosshair',
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
      {marquee ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-[2px] border border-[var(--board-accent)] bg-[var(--board-accent-tint)]/40"
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
        />
      ) : null}
    </div>
  )
}
