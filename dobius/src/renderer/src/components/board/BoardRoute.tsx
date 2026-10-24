// Why: the Board's own fonts (SIL OFL) load with its lazy chunk, not the Classic shell.
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/jetbrains-mono/wght.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { dispatchDictationControl } from '@/components/dictation/dictation-control-events'
import { voiceOrbLevelSource } from '@/components/dictation/voice-orb-live-level'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { BoardPage } from './BoardPage'
import { boardFreeSpawnCenter, boardSpawnBlockSize } from './board-canvas/board-spawn-placement'
import { screenToWorld, type BoardPoint, type BoardViewport } from './board-canvas/board-viewport'
import { BOARD_CHROME_INSETS } from './board-canvas/board-reveal'
import { BoardAgentPicker, type BoardAgentPickerRequest } from './board-chrome/BoardAgentPicker'
import { spawnTeamOnBoard } from './board-chrome/board-team-spawn'
import { BoardResumePrompt } from './board-resume/BoardResumePrompt'
import type { BoardSideAppId } from './board-chrome/BoardSideApps'
import { isBoardShortcutBlockedTarget } from './board-chrome/board-tools'
import { BoardLoopsObserver } from './board-loops/BoardLoopsObserver'
import { BoardDevServerWatcher } from './board-web/BoardDevServerWatcher'
import { BoardStudioHost } from './board-studios/BoardStudioHost'
import { BoardCanvasMenu } from './board-chrome/BoardCanvasMenu'
import { useBoardCanvasMenu } from './board-route/use-board-canvas-menu'
import { useBoardHistory } from './board-route/use-board-history'
import { useBoardImageInsert } from './board-route/use-board-image-insert'
import { useBoardToolPanel } from './board-route/use-board-tool-panel'
import { useBoardShortcuts } from './board-route/use-board-shortcuts'
import { BoardToolOptionsPanel } from './board-tool-panels/BoardToolOptionsPanel'
import { BoardCardStyleInspector } from './board-tool-panels/BoardCardStyleInspector'
import { useCardStyleEditor } from './board-tool-panels/card-style-editor'
import type { BoardStudioId } from './board-studios/board-studio-ids'
import { BoardCardsLayer } from './board-route/BoardCardsLayer'
import { boardInsertCard, type BoardInsertCardKind } from './board-route/board-insert-cards'
import { useBoardShapeDraw } from './board-route/use-board-shape-draw'
import { clampRectIntoArea } from './cards/card-geometry'
import { useBoardActions } from './board-route/use-board-actions'
import { useBoardCommand } from './board-route/use-board-command'
import { useBoardPlanner } from './board-planner/use-board-planner'
import { resumeAllPausedConsoles } from './board-delivery/pause-consoles'
import { useBoardConductor } from './board-route/use-board-conductor'
import { useBoardPen } from './board-route/use-board-pen'
import { useBoardPushToTalk } from './board-route/use-board-push-to-talk'
import { useBoardRouteData } from './board-route/use-board-route-data'
import { useBoardSelection } from './board-route/use-board-selection'
import { useBoardTopBarProps } from './board-route/use-board-top-bar-props'
import { useBoardAttentionJump } from './board-route/use-board-attention-jump'
import { useBoardFocusMode } from './board-route/use-board-camera-focus'
import { BoardFocusPill } from './board-route/BoardFocusPill'
import { BoardShortcutSheet } from './board-route/BoardShortcutSheet'

// The expanded thread (560x~602, 28px above the bottom, centered) is treated as
// occupied even when collapsed, so a card never lands where the thread opens.
function threadWorldRect(v: BoardViewport): { x: number; y: number; w: number; h: number } {
  const tl = screenToWorld({ x: window.innerWidth / 2 - 280, y: window.innerHeight - 630 }, v)
  const br = screenToWorld({ x: window.innerWidth / 2 + 280, y: window.innerHeight - 28 }, v)
  return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }
}

type PickerState = { request: BoardAgentPickerRequest; world: BoardPoint; group?: boolean }

const SIDE_APP_STUDIO: Record<BoardSideAppId, BoardStudioId> = {
  agents: 'agents',
  automations: 'loops',
  skills: 'skills',
  kanban: 'kanban',
  communications: 'communications',
  settings: 'settings'
}

// Why: the Board renders as a full-window layer over the Classic shell so the
// shell (and every live TerminalPane in it) stays mounted while the Board is up.
export default function BoardRoute(): React.JSX.Element {
  const data = useBoardRouteData()
  const { worktreeId, board } = data
  const [studio, setStudio] = useState<BoardStudioId | null>(null)
  const [picker, setPicker] = useState<PickerState | null>(null)
  const [draft, setDraft] = useState('')
  const draftRef = useRef(draft)
  draftRef.current = draft
  const inputRef = useRef<HTMLInputElement>(null)
  const listening = useAppStore(
    (s) => s.dictationState === 'listening' || s.dictationState === 'starting'
  )

  const openSettings = useCallback(() => setStudio('settings'), [])
  const conductor = useBoardConductor(openSettings, data.repoId)
  const selection = useBoardSelection(worktreeId, board.tool)
  const pen = useBoardPen(worktreeId, board.viewport)
  // Chrome insets (rails, top bar, collapsed command bar) bound the visible area
  // new consoles may use, so they never land hidden under the composer.
  const freeCenter = useCallback(
    (block: { w: number; h: number }): BoardPoint => {
      const v = board.viewport
      const inset = BOARD_CHROME_INSETS
      const topLeft = screenToWorld({ x: inset.left, y: inset.top }, v)
      const bottomRight = screenToWorld(
        { x: window.innerWidth - inset.right, y: window.innerHeight - inset.bottom },
        v
      )
      return boardFreeSpawnCenter(
        {
          x: topLeft.x,
          y: topLeft.y,
          w: bottomRight.x - topLeft.x,
          h: bottomRight.y - topLeft.y
        },
        block,
        [...board.cards, threadWorldRect(v)]
      )
    },
    [board.cards, board.viewport]
  )
  const closeStudio = useCallback(() => setStudio(null), [])
  const plannerContext = useMemo(
    () => ({ openStudio: setStudio, closeStudio, freeCenter }),
    [closeStudio, freeCenter]
  )
  const planner = useBoardPlanner({ data, conductor, context: plannerContext })
  const onCommand = useBoardCommand(data, conductor, planner)
  // Why: leaving the Board must never leave a paused agent frozen in the background.
  useEffect(
    () => () => {
      void resumeAllPausedConsoles()
    },
    []
  )
  const openPicker = useCallback(
    (count: number, anchor?: DOMRect) =>
      setPicker({
        request: {
          count,
          side: 'top',
          screen: anchor
            ? { x: anchor.left, y: anchor.top }
            : { x: window.innerWidth / 2 - 104, y: window.innerHeight - 160 }
        },
        world: freeCenter(boardSpawnBlockSize(count))
      }),
    [freeCenter]
  )
  const actions = useBoardActions({
    data,
    selectedIds: selection.selectedIds,
    conductor,
    openStudio: setStudio,
    openPicker,
    freeCenter
  })
  const ptt = useBoardPushToTalk(inputRef, () => {
    const text = draftRef.current.trim()
    if (text) {
      onCommand(text)
      setDraft('')
    }
  })
  const topBar = useBoardTopBarProps(data, setStudio)
  const history = useBoardHistory(worktreeId)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const focusMode = useBoardFocusMode({
    worktreeId,
    tool: board.tool,
    selection,
    suspended: picker !== null || studio !== null || shortcutsOpen
  })
  const jumpToNeedsYou = useBoardAttentionJump(worktreeId)
  useBoardShortcuts({
    worktreeId,
    selection,
    undo: history.undo,
    redo: history.redo,
    onChip: actions.onChip,
    openStudio: setStudio,
    openGitHub: topBar.onOpenGitHub,
    focusSelected: focusMode.focusSelected,
    nextNeedsYou: jumpToNeedsYou,
    showShortcuts: () => setShortcutsOpen(true)
  })

  const { toolPanelOpen, setTool } = useBoardToolPanel(worktreeId, board.tool)
  const styleEditorOpen = useCardStyleEditor((s) => s.target?.worktreeId === worktreeId)
  const images = useBoardImageInsert(worktreeId, () => setTool('select'))
  const canvasMenu = useBoardCanvasMenu({
    worktreeId,
    board,
    selection,
    spawnAt: (at, count) => setPicker({ request: { count, screen: at.screen }, world: at.world }),
    spawnGroup: (at) =>
      setPicker({
        request: { count: 4, screen: at.screen },
        world: freeCenter(boardSpawnBlockSize(4)),
        group: true
      }),
    pickImageAt: images.pickAt,
    openMissionMap: () => setStudio('mission-map')
  })

  // Escape closes the agent picker first, then lets studios handle their own Esc.
  useEffect(() => {
    if (!picker) {
      return
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setPicker(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picker])

  // Why: a card placed at the click point must still keep its title bar on
  // screen (a 900x600 web tile clicked near the top sat under the top bar).
  const placeInsertCard = (tool: BoardInsertCardKind, world: BoardPoint): void => {
    if (!worktreeId) {
      return
    }
    const placed = boardInsertCard(tool, world)
    const v = board.viewport
    const inset = BOARD_CHROME_INSETS
    const tl = screenToWorld({ x: inset.left, y: inset.top }, v)
    const br = screenToWorld(
      { x: window.innerWidth - inset.right, y: window.innerHeight - inset.bottom },
      v
    )
    useAppStore.getState().addCard(worktreeId, {
      ...placed,
      ...clampRectIntoArea(placed, { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y })
    })
    setTool('select')
  }

  // A shape-tool drag draws the shape at the dragged size; a click drops the default.
  const shapeDraw = useBoardShapeDraw(board.viewport, (origin, rect) => {
    if (!worktreeId) {
      return
    }
    if (!rect) {
      placeInsertCard('shape', origin)
      return
    }
    useAppStore.getState().addCard(worktreeId, { ...boardInsertCard('shape', origin), ...rect })
    setTool('select')
  })

  const onEmptyPointerDown = (world: BoardPoint, event: React.PointerEvent): void => {
    if (!worktreeId) {
      return
    }
    const tool = board.tool
    // Why: Diagrams draws from its panel (an agent generates it), not from a canvas click.
    if (tool === 'select' || tool === 'eraser' || tool === 'screen') {
      if (!event.shiftKey) {
        selection.clear()
      }
      return
    }
    if (tool === 'spawn') {
      setPicker({ request: { count: 1, screen: { x: event.clientX, y: event.clientY } }, world })
      return
    }
    if (tool === 'pen') {
      pen.start(world)
      return
    }
    if (tool === 'image') {
      images.pickAt(world)
      return
    }
    if (tool === 'shape') {
      shapeDraw.start(world)
      return
    }
    placeInsertCard(tool, world)
  }

  // Delete removes the selection, unless the key is meant for a console or field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        !isBoardShortcutBlockedTarget(event.target)
      ) {
        selection.removeSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection])

  const chatTabId = data.consoles.find((c) => selection.selectedIds.has(c.id))?.tabId ?? null

  return (
    <div
      data-surface="board"
      className={cn(
        'fixed inset-0 z-40 bg-[var(--board-canvas)] [&_[data-board-card]]:transition-opacity [&_[data-board-card]]:duration-200',
        // Focus mode: every card but the focused console sits back at 60%.
        focusMode.focus && '[&_[data-board-card]:not(:has([data-board-focus-target]))]:opacity-60'
      )}
    >
      <BoardPage
        viewport={board.viewport}
        onViewportChange={(viewport) =>
          worktreeId && useAppStore.getState().setViewport(worktreeId, viewport)
        }
        tool={board.tool}
        onToolChange={setTool}
        contentRects={board.cards.map((c) => ({ x: c.x, y: c.y, width: c.w, height: c.h }))}
        onEmptyPointerDown={onEmptyPointerDown}
        onMarquee={canvasMenu.onMarquee}
        onEmptyContextMenu={canvasMenu.open}
        toolOptions={
          styleEditorOpen ? (
            <BoardCardStyleInspector />
          ) : toolPanelOpen ? (
            <BoardToolOptionsPanel key={board.tool} tool={board.tool} worktreeId={worktreeId} />
          ) : null
        }
        spaceHeld={ptt.spaceHeld}
        onSpacePanStart={ptt.cancelForPan}
        onInsert={actions.onInsert}
        onOpenGitHub={topBar.onOpenGitHub}
        onOpenSideApp={(app) => setStudio(SIDE_APP_STUDIO[app])}
        activeSideApp={
          (Object.keys(SIDE_APP_STUDIO) as BoardSideAppId[]).find(
            (app) => SIDE_APP_STUDIO[app] === studio
          ) ?? null
        }
        topBar={topBar.props}
        commandBar={{
          messages: conductor.messages,
          projectName: topBar.projectName,
          languageLabel: translate('board.thread.languageAuto', 'Auto'),
          draft,
          onDraftChange: setDraft,
          inputRef,
          onCommand,
          onChip: actions.onChip,
          getVoiceLevel: () => voiceOrbLevelSource.current(),
          listening,
          onMicToggle: () => {
            inputRef.current?.focus()
            dispatchDictationControl('toggle')
          },
          busy: conductor.busy
        }}
        overlay={
          <>
            {focusMode.focus ? <BoardFocusPill onExit={focusMode.exit} /> : null}
            <BoardShortcutSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
            <BoardCanvasMenu
              at={canvasMenu.at?.screen ?? null}
              hasSelection={selection.selectedIds.size > 0}
              onAction={canvasMenu.onAction}
              onClose={canvasMenu.close}
            />
            <BoardAgentPicker
              request={picker?.request ?? null}
              agents={data.agents}
              onPick={(agent) => {
                if (picker) {
                  actions.spawn(agent, picker.request.count, picker.world, picker.group)
                }
                setPicker(null)
                if (board.tool === 'spawn') {
                  setTool('select')
                }
              }}
              onClose={() => setPicker(null)}
              onSpawnTeam={(slots, name) =>
                spawnTeamOnBoard(
                  worktreeId,
                  slots,
                  freeCenter(boardSpawnBlockSize(slots.length)),
                  name
                )
              }
            />
            {/* On-idle loops only fire while this observer is mounted (once, with the Board). */}
            {worktreeId ? <BoardLoopsObserver key={worktreeId} worktreeId={worktreeId} /> : null}
            {worktreeId ? <BoardDevServerWatcher worktreeId={worktreeId} /> : null}
            {worktreeId ? <BoardResumePrompt key={worktreeId} worktreeId={worktreeId} /> : null}
            <BoardStudioHost
              studio={studio}
              worktreeId={worktreeId}
              chatTabId={chatTabId}
              freeCenter={freeCenter}
              onClose={() => setStudio(null)}
            />
            <input
              ref={images.inputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                images.onPicked(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </>
        }
      >
        {worktreeId ? (
          <BoardCardsLayer
            worktreeId={worktreeId}
            board={board}
            selectedIds={selection.selectedIds}
            onSelect={selection.onSelect}
            onDragBy={selection.onDragBy}
            onDragEnd={selection.onDragEnd}
            guides={selection.guides}
            penPoints={pen.points}
            shapeDraft={shapeDraw.draft}
          />
        ) : null}
      </BoardPage>
    </div>
  )
}
