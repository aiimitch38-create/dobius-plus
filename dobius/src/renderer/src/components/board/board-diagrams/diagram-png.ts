// PNG export for a drawn diagram, pure part: bounds and an SVG scene that the
// renderer rasterizes onto a canvas. Shapes, labels and arrows mirror the
// Excalidraw export so both files show the same picture.
import type { ExcalidrawRect } from './diagram-excalidraw'

export type DiagramBounds = { x: number; y: number; w: number; h: number }

export const DIAGRAM_PNG_PADDING = 32
// Why: canvases cap out; a runaway diagram is scaled down to fit, not clipped.
export const DIAGRAM_PNG_MAX_SIDE = 8192

// Why: exported files are paper-like (white page, dark ink), not Board theme tokens.
const INK = '#1e1e1e'
const PAPER = '#ffffff'

/** Union box of every shape, or null when there is nothing to draw. */
export function diagramBounds(shapes: readonly ExcalidrawRect[]): DiagramBounds | null {
  if (shapes.length === 0) {
    return null
  }
  const minX = Math.min(...shapes.map((s) => s.x))
  const minY = Math.min(...shapes.map((s) => s.y))
  const maxX = Math.max(...shapes.map((s) => s.x + s.w))
  const maxY = Math.max(...shapes.map((s) => s.y + s.h))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const n = (value: number): string => String(Math.round(value * 100) / 100)

function shapeSvg(s: ExcalidrawRect, ox: number, oy: number): string {
  const x = s.x - ox
  const y = s.y - oy
  const common = `fill="${PAPER}" stroke="${INK}" stroke-width="2"`
  if (s.shape === 'ellipse') {
    return `<ellipse cx="${n(x + s.w / 2)}" cy="${n(y + s.h / 2)}" rx="${n(s.w / 2)}" ry="${n(s.h / 2)}" ${common}/>`
  }
  if (s.shape === 'diamond') {
    const pts = [
      [x + s.w / 2, y],
      [x + s.w, y + s.h / 2],
      [x + s.w / 2, y + s.h],
      [x, y + s.h / 2]
    ]
    return `<polygon points="${pts.map(([px, py]) => `${n(px)},${n(py)}`).join(' ')}" ${common}/>`
  }
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(s.w)}" height="${n(s.h)}" rx="10" ${common}/>`
}

/** Self-contained SVG of the diagram, shifted so the padded bounds start at 0,0. */
export function diagramToSvg(
  shapes: readonly ExcalidrawRect[],
  arrows: readonly { from: string; to: string; label?: string }[],
  padding = DIAGRAM_PNG_PADDING
): { svg: string; width: number; height: number } | null {
  const bounds = diagramBounds(shapes)
  if (!bounds) {
    return null
  }
  const ox = bounds.x - padding
  const oy = bounds.y - padding
  const width = Math.ceil(bounds.w + padding * 2)
  const height = Math.ceil(bounds.h + padding * 2)
  const byId = new Map(shapes.map((s) => [s.id, s]))
  const parts: string[] = []
  for (const a of arrows) {
    const from = byId.get(a.from)
    const to = byId.get(a.to)
    if (!from || !to) {
      continue
    }
    // Same anchors as the Excalidraw export: right-middle to left-middle.
    const x1 = from.x + from.w - ox
    const y1 = from.y + from.h / 2 - oy
    const x2 = to.x - ox
    const y2 = to.y + to.h / 2 - oy
    parts.push(
      `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${INK}" stroke-width="2" marker-end="url(#arrow)"/>`
    )
    if (a.label) {
      parts.push(
        `<text x="${n((x1 + x2) / 2)}" y="${n((y1 + y2) / 2 - 6)}" text-anchor="middle" font-size="12">${escapeXml(a.label)}</text>`
      )
    }
  }
  for (const s of shapes) {
    parts.push(shapeSvg(s, ox, oy))
    if (s.label) {
      parts.push(
        `<text x="${n(s.x - ox + s.w / 2)}" y="${n(s.y - oy + s.h / 2)}" text-anchor="middle" dominant-baseline="middle" font-size="16">${escapeXml(s.label)}</text>`
      )
    }
  }
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system, Helvetica, Arial, sans-serif" fill="${INK}">`
  const defs = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${INK}"/></marker></defs>`
  const svg = `${open}${defs}<rect width="100%" height="100%" fill="${PAPER}"/>${parts.join('')}</svg>`
  return { svg, width, height }
}

/** Canvas scale for a crisp PNG that still respects the max side. */
export function diagramPngScale(width: number, height: number, preferred = 2): number {
  const largest = Math.max(width, height, 1)
  return Math.max(0.1, Math.min(preferred, DIAGRAM_PNG_MAX_SIDE / largest))
}
