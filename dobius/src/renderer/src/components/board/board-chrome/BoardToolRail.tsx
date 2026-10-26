import React, { useEffect, useRef } from 'react'
import {
  Asterisk,
  Eraser,
  Github,
  Globe,
  Image,
  Maximize2,
  Monitor,
  MousePointer2,
  PenTool,
  Shapes
} from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { BoardRailButton } from './BoardRailButton'
import { BOARD_FLOATING_PANEL_CLASS } from './board-surface-classes'
import {
  BOARD_TOOL_SHORTCUTS,
  boardToolForKey,
  isBoardShortcutBlockedTarget,
  type BoardTool
} from './board-tools'

export type BoardToolRailProps = {
  tool: BoardTool
  onToolChange: (tool: BoardTool) => void
  /** Hover/focus on a tool (null on leave): the Board ghosts where its card would land. */
  onPreview?: (tool: BoardTool | null) => void
  onFitView: () => void
  onOpenGitHub: () => void
}

type ToolEntry = { tool: BoardTool; label: string; icon: React.ReactNode }

function RailDivider(): React.JSX.Element {
  return <div className="mx-auto my-[0.5px] h-px w-6 bg-[var(--board-panel-border)]" />
}

export function BoardToolRail({
  tool,
  onToolChange,
  onPreview,
  onFitView,
  onOpenGitHub
}: BoardToolRailProps): React.JSX.Element {
  const onToolChangeRef = useRef(onToolChange)
  onToolChangeRef.current = onToolChange

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || isBoardShortcutBlockedTarget(event.target)) {
        return
      }
      const next = boardToolForKey(event)
      if (next) {
        event.preventDefault()
        onToolChangeRef.current(next)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const drawTools: ToolEntry[] = [
    {
      tool: 'select',
      label: translate('board.tools.select', 'Select'),
      icon: <MousePointer2 />
    },
    {
      tool: 'spawn',
      label: translate('board.tools.spawn', 'Spawn agent'),
      // The reference's spawn glyph is a large orange starburst; Asterisk is our nearest icon.
      icon: (
        <Asterisk
          className={cn(
            '!size-[24px]',
            tool === 'spawn' ? undefined : 'text-[var(--board-accent)]'
          )}
        />
      )
    },
    { tool: 'shape', label: translate('board.tools.shape', 'Shapes'), icon: <Shapes /> },
    { tool: 'screen', label: translate('board.tools.screen', 'Diagrams'), icon: <Monitor /> },
    {
      tool: 'text',
      label: translate('board.tools.text', 'Text'),
      icon: (
        <span className="text-[15px] leading-none font-medium">
          {translate('board.tools.textGlyph', 'Aa')}
        </span>
      )
    },
    { tool: 'pen', label: translate('board.tools.pen', 'Pen'), icon: <PenTool /> },
    { tool: 'eraser', label: translate('board.tools.eraser', 'Eraser'), icon: <Eraser /> }
  ]
  const mediaTools: ToolEntry[] = [
    { tool: 'web', label: translate('board.tools.web', 'Web tile'), icon: <Globe /> },
    { tool: 'image', label: translate('board.tools.image', 'Image'), icon: <Image /> }
  ]

  const renderTool = (entry: ToolEntry): React.JSX.Element => (
    <BoardRailButton
      key={entry.tool}
      label={entry.label}
      shortcut={BOARD_TOOL_SHORTCUTS[entry.tool]}
      active={tool === entry.tool}
      tooltipSide="right"
      onClick={() => onToolChange(entry.tool)}
      onPointerEnter={() => onPreview?.(entry.tool)}
      onPointerLeave={() => onPreview?.(null)}
      onFocus={() => onPreview?.(entry.tool)}
      onBlur={() => onPreview?.(null)}
    >
      {entry.icon}
    </BoardRailButton>
  )

  return (
    <>
      <nav
        aria-label={translate('board.tools.railLabel', 'Board tools')}
        className={cn(
          BOARD_FLOATING_PANEL_CLASS,
          // Reference rail glyphs read ~18px, a touch larger than the 16px default.
          'pointer-events-auto absolute top-1/2 left-4 flex -translate-y-1/2 flex-col gap-1.5 rounded-full p-1.5 [&>*]:shrink-0 [&_svg]:size-[18px]'
        )}
      >
        {/* Reference rail: Select stands alone above the creation tools (50px step). */}
        {renderTool(drawTools[0])}
        <RailDivider />
        {drawTools.slice(1).map(renderTool)}
        <RailDivider />
        {mediaTools.map(renderTool)}
        <RailDivider />
        <BoardRailButton
          label={translate('board.tools.fitView', 'Fit view')}
          tooltipSide="right"
          onClick={onFitView}
        >
          <Maximize2 />
        </BoardRailButton>
      </nav>
      <BoardRailButton
        label={translate('board.tools.github', 'GitHub')}
        tooltipSide="right"
        className={cn(
          BOARD_FLOATING_PANEL_CLASS,
          'pointer-events-auto absolute bottom-[19px] left-5'
        )}
        onClick={onOpenGitHub}
      >
        <Github />
      </BoardRailButton>
    </>
  )
}
