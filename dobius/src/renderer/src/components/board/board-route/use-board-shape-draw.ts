import { useCallback, useEffect, useRef, useState } from 'react'
import { screenToWorld, type BoardPoint, type BoardViewport } from '../board-canvas/board-viewport'
import { boardDraggedShapeRect } from './board-insert-cards'

export type BoardShapeDraft = { x: number; y: number; w: number; h: number }

/**
 * Shape-tool drags: tracked on window (the Board fills it, so client coords are
 * canvas coords) with a live draft rect; on release `onDone` gets the dragged
 * world rect, or null for a plain click.
 */
export function useBoardShapeDraw(
  viewport: BoardViewport,
  onDone: (start: BoardPoint, rect: BoardShapeDraft | null) => void
): { draft: BoardShapeDraft | null; start: (world: BoardPoint) => void } {
  const [draft, setDraft] = useState<BoardShapeDraft | null>(null)
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const cleanup = useRef<(() => void) | null>(null)

  useEffect(() => () => cleanup.current?.(), [])

  const start = useCallback((origin: BoardPoint) => {
    cleanup.current?.()
    let rect: BoardShapeDraft | null = null
    const onMove = (event: PointerEvent): void => {
      const v = viewportRef.current
      rect = boardDraggedShapeRect(
        origin,
        screenToWorld({ x: event.clientX, y: event.clientY }, v),
        v.zoom
      )
      setDraft(rect)
    }
    const onUp = (): void => {
      cleanup.current?.()
      onDoneRef.current(origin, rect)
    }
    const onCancel = (): void => {
      cleanup.current?.()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    cleanup.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      cleanup.current = null
      setDraft(null)
    }
  }, [])

  return { draft, start }
}
