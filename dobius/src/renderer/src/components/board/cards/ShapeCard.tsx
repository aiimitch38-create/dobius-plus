import { useState } from 'react'
import type { BoardCardOf, BoardCardPatch } from '@/store/slices/board'
import { translate } from '@/i18n/i18n'
import {
  DEFAULT_BOARD_CARD_STYLE,
  boardFillCss,
  boardInkCss,
  boardSloppinessPx,
  boardStrokeDashArray,
  boardStrokePx
} from '../board-tool-panels/board-tool-style'
import { swatchEdge, swatchFill } from './card-swatch'
import { shapeGeometry, shapeSeed } from './shape-geometry'

const LEGACY_STROKE_PX = 1.5

// Why: shapes render bare (drag anywhere), so text goes in through a
// double-click editor laid over the shape, like Excalidraw.
export function ShapeCard({
  card,
  onChange
}: {
  card: BoardCardOf<'shape'>
  onChange?: (patch: BoardCardPatch) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const style = card.style ?? DEFAULT_BOARD_CARD_STYLE
  // Why: shapes made before the tool panels have no style; keep their swatch look.
  const legacy = card.style === undefined
  const px = legacy ? LEGACY_STROKE_PX : boardStrokePx(style.strokeWidth)
  const wobble = legacy ? 0 : boardSloppinessPx(style.sloppiness)
  const stroke = legacy ? swatchEdge(card.fill) : boardInkCss(style.stroke)
  const baseFill = legacy ? swatchFill(card.fill) : boardFillCss(style.fill)
  // Why: hatched fills draw the fill colour as lines (mixed toward ink so pastels stay visible).
  const hatched = !legacy && style.fill !== 'none' && style.fillStyle !== 'solid'
  const patternId = `board-shape-hatch-${card.id}`
  const fill = hatched ? `url(#${patternId})` : baseFill
  const w = Math.max(1, card.w)
  const h = Math.max(1, card.h)
  const geometry = shapeGeometry(card.shape, w, h, px, wobble, shapeSeed(card.id), card.direction)
  const paint = {
    stroke,
    strokeWidth: px,
    strokeDasharray: boardStrokeDashArray(style.strokeStyle, px),
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  }
  const roundRect = card.shape === 'rect' && style.edges === 'round' && wobble === 0
  const canLabel = geometry.closed && onChange !== undefined
  return (
    <div
      className="relative size-full"
      onDoubleClick={canLabel ? () => setEditing(true) : undefined}
    >
      <svg
        className="size-full overflow-visible"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={card.title}
        style={{ opacity: style.opacity / 100 }}
      >
        {hatched ? (
          <defs>
            <pattern id={patternId} width={8} height={8} patternUnits="userSpaceOnUse">
              <path
                d={style.fillStyle === 'cross-hatch' ? 'M0 8 L8 0 M0 0 L8 8' : 'M0 8 L8 0'}
                stroke={`color-mix(in oklch, ${baseFill} 70%, var(--board-text))`}
                strokeWidth={1.25}
              />
            </pattern>
          </defs>
        ) : null}
        {roundRect ? (
          <rect
            x={px / 2}
            y={px / 2}
            width={Math.max(0, w - px)}
            height={Math.max(0, h - px)}
            rx={Math.min(w, h) * 0.12}
            fill={fill}
            {...paint}
          />
        ) : (
          <path d={geometry.d} fill={geometry.closed ? fill : 'none'} {...paint} />
        )}
        {geometry.arrowHead && (
          <path d={geometry.arrowHead} fill="none" {...paint} strokeDasharray={undefined} />
        )}
        {card.label && geometry.closed && !editing ? (
          <foreignObject x={0} y={0} width={w} height={h}>
            <div className="flex size-full items-center justify-center overflow-hidden p-2 text-center text-[13px] leading-tight font-medium break-words text-[var(--board-text)]">
              {card.label}
            </div>
          </foreignObject>
        ) : null}
      </svg>
      {editing && onChange ? (
        <textarea
          autoFocus
          data-board-card-control
          aria-label={translate('board.shape.label', 'Shape text')}
          value={card.label ?? ''}
          onChange={(e) => onChange({ label: e.target.value })}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
          className="absolute inset-0 size-full resize-none overflow-hidden border-0 bg-transparent p-2 text-center text-[13px] leading-tight font-medium text-[var(--board-text)] outline-none"
          style={{ paddingTop: Math.max(8, h / 2 - 10) }}
        />
      ) : null}
    </div>
  )
}
