import type { BoardCardOf } from '@/store/slices/board'
import {
  boardInkCss,
  boardStrokeDashArray,
  boardStrokePx
} from '../board-tool-panels/board-tool-style'
import { strokePathData, strokeViewBox } from './stroke-path'

const LEGACY_STROKE_PX = 2.5

export function StrokeCard({ card }: { card: BoardCardOf<'stroke'> }): React.JSX.Element {
  const style = card.style
  const px = style ? boardStrokePx(style.strokeWidth) : LEGACY_STROKE_PX
  return (
    <svg
      className="size-full overflow-visible"
      viewBox={strokeViewBox(card.points)}
      preserveAspectRatio="none"
      role="img"
      aria-label={card.title}
      style={style ? { opacity: style.opacity / 100 } : undefined}
    >
      <path
        d={strokePathData(card.points)}
        fill="none"
        stroke={style ? boardInkCss(style.stroke) : 'var(--board-text)'}
        strokeWidth={px}
        strokeDasharray={style ? boardStrokeDashArray(style.strokeStyle, px) : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
