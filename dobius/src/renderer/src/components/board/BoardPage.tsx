import React, { useEffect, useRef } from 'react'
import { BoardCanvas } from './board-canvas/BoardCanvas'
import { installBoardScrollLock } from './board-canvas/board-scroll-lock'
import {
  BOARD_ZOOM_STEP,
  fitBoardViewport,
  zoomViewportAtPoint,
  zoomViewportBy,
  type BoardPoint,
  type BoardRect,
  type BoardViewport
} from './board-canvas/board-viewport'
import { BoardFoundBugButton } from './board-chrome/BoardFoundBugButton'
import { BoardInsertRail } from './board-chrome/BoardInsertRail'
import { BoardSideApps, type BoardSideAppId } from './board-chrome/BoardSideApps'
import { BoardToolRail } from './board-chrome/BoardToolRail'
import { BoardZoomControl } from './board-chrome/BoardZoomControl'
import { BoardTopBar, type BoardTopBarProps } from './board-chrome/BoardTopBar'
import {
  boardToolPansOnEmptyDrag,
  type BoardInsertKind,
  type BoardTool
} from './board-chrome/board-tools'
import { BoardCommandBar, type BoardCommandBarProps } from './board-command-bar/BoardCommandBar'
import { AgentCursorLayer } from './agent-presence/AgentCursorLayer'
import { AgentPresenceStrip } from './agent-presence/AgentPresenceStrip'

export type { BoardPoint, BoardRect, BoardViewport } from './board-canvas/board-viewport'
export type { BoardInsertKind, BoardTool } from './board-chrome/board-tools'
export type { BoardTopBarProps, BoardWorkspaceTab } from './board-chrome/BoardTopBar'
export type { BoardCommandBarProps } from './board-command-bar/BoardCommandBar'
export type { BoardChipId } from './board-command-bar/board-command-chips'
export type { BoardThreadMessage } from './board-command-bar/BoardThread'

export type BoardPageProps = {
  viewport: BoardViewport
  onViewportChange: (viewport: BoardViewport) => void
  tool: BoardTool
  onToolChange: (tool: BoardTool) => void
  /** World-space rects of every card; used by Fit view. */
  contentRects: readonly BoardRect[]
  /** Primary pointer-down on empty canvas (world coords); drawing tools start here. */
  onEmptyPointerDown?: (world: BoardPoint, event: React.PointerEvent<HTMLDivElement>) => void
  spaceHeld?: boolean
  onSpacePanStart?: () => void
  onMarquee?: (rect: { x: number; y: number; w: number; h: number }) => void
  onEmptyContextMenu?: (screen: BoardPoint, world: BoardPoint) => void
  /** Floating UI above the chrome (agent picker, studios, dialogs). */
  overlay?: React.ReactNode
  /** Options panel for the active rail tool (Shapes/Text/Pen), shown beside the rail. */
  toolOptions?: React.ReactNode
  onInsert: (kind: BoardInsertKind) => void
  onOpenGitHub: () => void
  /** Side apps dock (Agents, Automations, Skills, Kanban, Communications, Settings). */
  onOpenSideApp: (app: BoardSideAppId) => void
  activeSideApp?: BoardSideAppId | null
  topBar: BoardTopBarProps
  commandBar: BoardCommandBarProps
  /** Cards, positioned in world coordinates inside the transformed layer. */
  children?: React.ReactNode
}

export function BoardPage({
  viewport,
  onViewportChange,
  tool,
  onToolChange,
  contentRects,
  onEmptyPointerDown,
  spaceHeld,
  onSpacePanStart,
  onMarquee,
  onEmptyContextMenu,
  overlay,
  toolOptions,
  onInsert,
  onOpenGitHub,
  onOpenSideApp,
  activeSideApp,
  topBar,
  commandBar,
  children
}: BoardPageProps): React.JSX.Element {
  const canvasRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    return root ? installBoardScrollLock(root) : undefined
  }, [])

  const fitView = (): void => {
    const canvas = canvasRef.current
    if (canvas) {
      onViewportChange(
        fitBoardViewport(contentRects, { width: canvas.clientWidth, height: canvas.clientHeight })
      )
    }
  }

  const zoomAtCenter = (zoom: (center: BoardPoint) => BoardViewport): void => {
    const canvas = canvasRef.current
    if (canvas) {
      onViewportChange(zoom({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }))
    }
  }

  return (
    <div
      ref={rootRef}
      data-surface="board"
      data-board-scroll-lock=""
      className="relative h-full w-full overflow-hidden"
    >
      <BoardCanvas
        viewport={viewport}
        onViewportChange={onViewportChange}
        containerRef={canvasRef}
        panOnEmptyDrag={boardToolPansOnEmptyDrag(tool)}
        onEmptyPointerDown={onEmptyPointerDown}
        spaceHeld={spaceHeld}
        onSpacePanStart={onSpacePanStart}
        onMarquee={onMarquee}
        onEmptyContextMenu={onEmptyContextMenu}
      >
        {children}
      </BoardCanvas>
      {/* Agent pointers: one pointer-events-none layer above the cards, below the chrome. */}
      <AgentCursorLayer />
      {/* Chrome floats above the canvas; the overlay ignores pointers so empty
          space between panels still pans the board. */}
      <div className="pointer-events-none absolute inset-0">
        <BoardTopBar {...topBar} />
        <AgentPresenceStrip className="top-[60px] right-5" />
        <BoardToolRail
          tool={tool}
          onToolChange={onToolChange}
          onFitView={fitView}
          onOpenGitHub={onOpenGitHub}
        />
        {toolOptions ? (
          <div className="pointer-events-auto absolute top-1/2 left-[78px] -translate-y-1/2">
            {toolOptions}
          </div>
        ) : null}
        <BoardInsertRail onInsert={onInsert} />
        {/* Why: a vertical dock between the tool rail and GitHub doesn't fit at the
            reference 859px height without moving the rail, so it sits beside GitHub. */}
        <BoardSideApps
          className="pointer-events-auto absolute bottom-[19px] left-16"
          onOpen={onOpenSideApp}
          activeApp={activeSideApp}
        />
        <BoardCommandBar {...commandBar} />
        {/* Measured: 8px left of the 120px zoom control, both 20px from the corner. */}
        <BoardFoundBugButton className="absolute right-[148px] bottom-5" />
        <BoardZoomControl
          zoom={viewport.zoom}
          onZoomOut={() => zoomAtCenter((c) => zoomViewportBy(viewport, 1 / BOARD_ZOOM_STEP, c))}
          onZoomIn={() => zoomAtCenter((c) => zoomViewportBy(viewport, BOARD_ZOOM_STEP, c))}
          onReset={() => zoomAtCenter((c) => zoomViewportAtPoint(viewport, 1, c))}
        />
      </div>
      {overlay}
    </div>
  )
}
