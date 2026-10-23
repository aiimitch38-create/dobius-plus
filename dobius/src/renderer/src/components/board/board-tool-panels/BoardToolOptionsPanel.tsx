import React, { useState } from 'react'
import {
  Circle,
  Diamond,
  MoveUpRight,
  Slash,
  Square,
  StickyNote,
  type LucideIcon
} from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { BoardTool } from '@/store/slices/board'
import { BOARD_TOOL_SHAPES, type BoardCardStyle, type BoardToolShape } from './board-tool-style'
import { useBoardToolStyle, type BoardStyledTool } from './board-tool-style-store'
import { shapeLabel } from './board-tool-labels'
import { DiagramToolPanel } from './DiagramToolPanel'
import { StrokeSections, TextSections } from './BoardStyleSections'
import { ToolPanelFrame, ToolPanelSection } from './BoardToolPanelControls'

const SHAPE_ICONS: Record<BoardToolShape, LucideIcon> = {
  rect: Square,
  ellipse: Circle,
  diamond: Diamond,
  line: Slash,
  arrow: MoveUpRight,
  sticky: StickyNote
}
function useToolStyle(tool: BoardStyledTool): {
  style: BoardCardStyle
  set: (patch: Partial<BoardCardStyle>) => void
} {
  const style = useBoardToolStyle((s) => s.styles[tool])
  const setStyle = useBoardToolStyle((s) => s.setStyle)
  return { style, set: (patch) => setStyle(tool, patch) }
}

function ShapeGrid({
  value,
  onPick,
  columns
}: {
  value: BoardToolShape | null
  onPick: (shape: BoardToolShape) => void
  columns: 3 | 6
}): React.JSX.Element {
  return (
    <div className={columns === 3 ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-6 gap-1.5'}>
      {BOARD_TOOL_SHAPES.map((shape) => {
        const Icon = SHAPE_ICONS[shape]
        return (
          <button
            key={shape}
            type="button"
            aria-pressed={shape === value}
            aria-label={shapeLabel(shape)}
            title={shapeLabel(shape)}
            onClick={() => onPick(shape)}
            className="flex flex-col items-center justify-center gap-1 rounded-[10px] border border-transparent bg-[var(--board-panel-2)] py-2 text-[var(--board-text)] hover:border-[var(--board-panel-border)] aria-pressed:border-[var(--board-accent)] aria-pressed:bg-[var(--board-accent-tint)] aria-pressed:text-[var(--board-accent)]"
          >
            <Icon aria-hidden className="size-[18px]" />
            {columns === 3 ? <span className="text-[12px]">{shapeLabel(shape)}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

/** Shapes: a picker first, then the style panel (with the shape row on top). */
export function ShapeToolPanel(): React.JSX.Element {
  const shape = useBoardToolStyle((s) => s.shape)
  const setShape = useBoardToolStyle((s) => s.setShape)
  const [picked, setPicked] = useState(false)
  const shapeStyle = useToolStyle('shape')
  const title = translate('board.toolPanel.shapes', 'Shapes')
  if (!picked) {
    return (
      <ToolPanelFrame label={title}>
        <ToolPanelSection title={title}>
          <ShapeGrid
            value={shape}
            columns={3}
            onPick={(next) => {
              setShape(next)
              setPicked(true)
            }}
          />
        </ToolPanelSection>
      </ToolPanelFrame>
    )
  }
  const open = shape === 'line' || shape === 'arrow'
  return (
    <ToolPanelFrame label={title}>
      <ToolPanelSection title={translate('board.toolPanel.shapeLabel', 'Shape')}>
        <ShapeGrid value={shape} columns={6} onPick={setShape} />
      </ToolPanelSection>
      {/* Why: lines and arrows have no inside to fill and no corners to round. */}
      <StrokeSections {...shapeStyle} withFill={!open} withEdges={!open} />
    </ToolPanelFrame>
  )
}

export function PenToolPanel(): React.JSX.Element {
  const penStyle = useToolStyle('pen')
  const title = translate('board.toolPanel.pen', 'Pen')
  return (
    <ToolPanelFrame label={title}>
      <StrokeSections {...penStyle} withFill={false} withEdges={false} />
    </ToolPanelFrame>
  )
}

export function TextToolPanel(): React.JSX.Element {
  const textStyle = useToolStyle('text')
  const title = translate('board.toolPanel.text', 'Text')
  return (
    <ToolPanelFrame label={title}>
      <TextSections {...textStyle} />
    </ToolPanelFrame>
  )
}

/**
 * The option panel for the active left-rail tool, or null for tools without
 * one. Builder 1 positions it beside the rail and decides when it is open;
 * `key={tool}` there restarts the Shapes picker each time the tool is chosen.
 */
export function BoardToolOptionsPanel({
  tool,
  worktreeId = null
}: {
  tool: BoardTool
  /** Needed by the Diagrams panel (it asks a console in this workspace to draw). */
  worktreeId?: string | null
}): React.JSX.Element | null {
  switch (tool) {
    case 'screen':
      return worktreeId ? <DiagramToolPanel worktreeId={worktreeId} /> : null
    case 'shape':
      return <ShapeToolPanel />
    case 'pen':
      return <PenToolPanel />
    case 'text':
      return <TextToolPanel />
    default:
      return null
  }
}
