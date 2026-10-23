// Excalidraw export for a drawn diagram. Pure.
import type { DiagramShape } from './diagram-model'

export type ExcalidrawRect = {
  id: string
  x: number
  y: number
  w: number
  h: number
  shape: DiagramShape
  label?: string
}

/** Minimal Excalidraw scene (shapes, their labels, arrows) for the drawn diagram. */
export function toExcalidraw(
  shapes: readonly ExcalidrawRect[],
  arrows: readonly { from: string; to: string; label?: string }[]
): string {
  const base = {
    angle: 0,
    // Why: exported files use Excalidraw's own default ink, not Board theme tokens.
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    seed: 1,
    version: 1,
    isDeleted: false,
    groupIds: [],
    boundElements: null,
    locked: false
  }
  const byId = new Map(shapes.map((s) => [s.id, s]))
  const elements: unknown[] = []
  for (const s of shapes) {
    elements.push({
      ...base,
      id: s.id,
      type: s.shape === 'rect' ? 'rectangle' : s.shape,
      x: s.x,
      y: s.y,
      width: s.w,
      height: s.h
    })
    if (s.label) {
      elements.push({
        ...base,
        id: `${s.id}-label`,
        type: 'text',
        x: s.x + 8,
        y: s.y + s.h / 2 - 10,
        width: s.w - 16,
        height: 20,
        text: s.label,
        fontSize: 16,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle'
      })
    }
  }
  arrows.forEach((a, i) => {
    const from = byId.get(a.from)
    const to = byId.get(a.to)
    if (!from || !to) {
      return
    }
    const x = from.x + from.w
    const y = from.y + from.h / 2
    elements.push({
      ...base,
      id: `arrow-${i}`,
      type: 'arrow',
      x,
      y,
      width: to.x - x,
      height: to.y + to.h / 2 - y,
      points: [
        [0, 0],
        [to.x - x, to.y + to.h / 2 - y]
      ],
      startArrowhead: null,
      endArrowhead: 'arrow'
    })
  })
  return JSON.stringify(
    {
      type: 'excalidraw',
      version: 2,
      source: 'dobius',
      elements,
      appState: { viewBackgroundColor: '#ffffff' },
      files: {}
    },
    null,
    2
  )
}
