import { useEffect, useLayoutEffect, useState } from 'react'
import { BOARD_LOD_SETTLE_MS, nextBoardLod, type BoardLod } from '../board-canvas/board-lod'
import { useSettledValue } from '../console-card/use-settled-value'

export type CardLodState = {
  lod: BoardLod
  settledZoom: number
  /** Unsettled on-screen flag, for pausing work nobody can see. */
  onScreen: boolean
  /** Body size in world px; 0 until measured. */
  size: { w: number; h: number }
}

/**
 * Level of detail for a card body whose live content breaks when scaled
 * (see board-lod.ts). Switches only once zoom has settled, never mid-gesture.
 */
export function useCardLod(
  body: HTMLElement | null,
  zoom: number,
  textPx: number,
  minBody?: { w: number; h: number }
): CardLodState {
  const z = zoom > 0 ? zoom : 1
  const settledZoom = useSettledValue(z, BOARD_LOD_SETTLE_MS)
  const gesturing = settledZoom !== z
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [onScreen, setOnScreen] = useState(true)
  const visible = useSettledValue(onScreen, BOARD_LOD_SETTLE_MS)
  const minW = minBody?.w
  const minH = minBody?.h
  // Why: a board opened already zoomed out starts as a glance, without a live frame first.
  const [lod, setLod] = useState<BoardLod>(() =>
    nextBoardLod({
      prev: 'full',
      settledZoom: z,
      visible: true,
      gesturing: false,
      textPx,
      bodyWidth: 0,
      bodyHeight: 0
    })
  )

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
      setOnScreen(entry?.isIntersecting ?? true)
    )
    intersect.observe(body)
    return () => {
      resize.disconnect()
      intersect.disconnect()
    }
  }, [body])

  useEffect(() => {
    const next = nextBoardLod({
      prev: lod,
      settledZoom,
      visible,
      gesturing,
      textPx,
      bodyWidth: size.w,
      bodyHeight: size.h,
      minBody: minW !== undefined && minH !== undefined ? { w: minW, h: minH } : undefined
    })
    if (next !== lod) {
      setLod(next)
    }
  }, [gesturing, lod, minH, minW, settledZoom, size.h, size.w, textPx, visible])

  return { lod, settledZoom, onScreen, size }
}
