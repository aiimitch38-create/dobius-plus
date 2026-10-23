import { useCallback, useEffect, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { screenToWorld, type BoardPoint, type BoardViewport } from '../board-canvas/board-viewport'
import { getBoardToolStyle } from '../board-tool-panels/board-tool-style-store'
import { strokeCardFromWorldPoints } from './board-stroke-capture'

/**
 * Pen drags are tracked on window so the stroke keeps going over cards and
 * chrome; the Board fills the window, so client coords are canvas coords.
 */
export function useBoardPen(
  worktreeId: string | null,
  viewport: BoardViewport
): { points: BoardPoint[]; start: (world: BoardPoint) => void } {
  const [points, setPoints] = useState<BoardPoint[]>([])
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  const cleanup = useRef<(() => void) | null>(null)

  useEffect(() => () => cleanup.current?.(), [])

  const start = useCallback(
    (world: BoardPoint) => {
      if (!worktreeId) {
        return
      }
      cleanup.current?.()
      const collected: BoardPoint[] = [world]
      setPoints([world])
      const onMove = (event: PointerEvent): void => {
        collected.push(screenToWorld({ x: event.clientX, y: event.clientY }, viewportRef.current))
        setPoints([...collected])
      }
      const onUp = (): void => {
        cleanup.current?.()
        const stroke = strokeCardFromWorldPoints(collected)
        if (stroke) {
          useAppStore.getState().addCard(worktreeId, {
            kind: 'stroke',
            title: translate('board.tools.pen', 'Pen'),
            ...stroke,
            style: getBoardToolStyle('pen').style
          })
        }
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      cleanup.current = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        cleanup.current = null
        setPoints([])
      }
    },
    [worktreeId]
  )

  return { points, start }
}
