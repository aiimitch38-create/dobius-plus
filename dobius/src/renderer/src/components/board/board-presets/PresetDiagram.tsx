import { cn } from '@/lib/utils'
import { swatchEdge, swatchFill } from '../cards/card-swatch'
import { diagramViewBox, type DiagramModel } from './preset-diagram-model'

// Mini map of a preset: the same rects Deploy places, drawn small.
export function PresetDiagram({
  model,
  className
}: {
  model: DiagramModel
  className?: string
}): React.JSX.Element {
  const orch = model.orchestrator
  return (
    <svg
      viewBox={diagramViewBox(model)}
      preserveAspectRatio="xMidYMid meet"
      className={cn('size-full', className)}
      aria-hidden
    >
      {orch &&
        model.frames.map((f, i) => (
          <line
            key={`link-${i}`}
            x1={orch.x + orch.w / 2}
            y1={orch.y + orch.h}
            x2={f.rect.x + f.rect.w / 2}
            y2={f.rect.y}
            stroke="var(--board-text-muted)"
            strokeWidth={2}
            strokeDasharray="6 6"
            vectorEffect="non-scaling-stroke"
            opacity={0.6}
          />
        ))}
      {model.frames.map((f, i) => (
        <rect
          key={`frame-${i}`}
          x={f.rect.x - 24}
          y={f.rect.y - 24}
          width={f.rect.w + 48}
          height={f.rect.h + 48}
          rx={36}
          fill={`color-mix(in oklch, ${swatchFill(f.color)} 40%, transparent)`}
          stroke={swatchEdge(f.color)}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {model.tiles.map((t, i) => (
        <rect
          key={`tile-${i}`}
          x={t.rect.x}
          y={t.rect.y}
          width={t.rect.w}
          height={t.rect.h}
          rx={28}
          fill={
            t.kind === 'orchestrator'
              ? 'var(--board-accent-tint)'
              : t.color
                ? swatchFill(t.color)
                : 'var(--board-panel-2)'
          }
          stroke={
            t.kind === 'orchestrator'
              ? 'var(--board-accent)'
              : t.color
                ? swatchEdge(t.color)
                : 'var(--board-panel-border)'
          }
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}
