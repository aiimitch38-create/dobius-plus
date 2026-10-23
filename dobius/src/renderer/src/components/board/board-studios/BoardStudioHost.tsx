import React, { Suspense, useEffect, useRef } from 'react'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { RecoverableRenderErrorBoundary } from '@/components/error-boundaries/RecoverableRenderErrorBoundary'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  BOARD_FLOATING_PANEL_CLASS,
  BOARD_ICON_BUTTON_CLASS
} from '../board-chrome/board-surface-classes'
import type { BoardStudioId } from './board-studio-ids'
import { boardStudioIcon, boardStudioSubtitle } from './board-studio-header'
import { listenStudioEscape } from './studio-escape-guard'
import { AgentsPage, BuzzPage } from './board-studio-lazy-pages'
import { ChatStudio } from './ChatStudio'
import { CodeStudio } from './CodeStudio'
import { MemoryStudio } from './MemoryStudio'
import { MissionMapStudio } from './MissionMapStudio'
import { RepoDocumentsStudio } from './RepoDocumentsStudio'
import { LoopsStudio } from './LoopsStudio'
import { SettingsStudio } from './SettingsStudio'
import { SkillsStudio } from './SkillsStudio'
import { StudioEmptyState } from './StudioEmptyState'
import type { BoardPoint } from '../board-canvas/board-viewport'
import { PresetsStudio } from '../board-presets/PresetsStudio'

export type BoardStudioHostProps = {
  studio: BoardStudioId | null
  worktreeId: string | null
  onClose: () => void
  /** Free spot in view for a block of this size (Presets deploy lands there). */
  freeCenter: (block: { w: number; h: number }) => BoardPoint
  chatTabId?: string | null
}

export function boardStudioTitle(studio: BoardStudioId): string {
  switch (studio) {
    case 'skills':
      return translate('board.studio.title.skills', 'Skills')
    case 'settings':
      return translate('board.studio.title.settings', 'Settings')
    case 'memory':
      return translate('board.studio.title.memory', 'Memory')
    case 'code':
      return translate('board.studio.title.code', 'Code')
    case 'markdown':
      return translate('board.studio.title.markdown', 'Markdown docs')
    case 'chat':
      return translate('board.studio.title.chat', 'Chat')
    case 'docs':
      return translate('board.studio.title.docs', 'Documents')
    case 'generate-doc':
      return translate('board.insert.generateDoc', 'Generate document')
    case 'loops':
      return translate('board.studio.title.loops', 'Loops')
    case 'mission-map':
      return translate('board.studio.title.missionMap', 'Mission Map')
    case 'agents':
      return translate('auto.components.sidebar.SidebarNav.9c95e1ce91', 'Agents')
    case 'kanban':
      return translate('board.sideApps.kanban', 'Kanban')
    case 'communications':
      return translate('board.sideApps.communications', 'Communications')
    case 'presets':
      return translate('board.studio.title.presets', 'Presets')
  }
}

function StudioBody({
  studio,
  worktreeId,
  chatTabId,
  freeCenter,
  onClose
}: {
  studio: BoardStudioId
  worktreeId: string | null
  chatTabId: string | null
  freeCenter: BoardStudioHostProps['freeCenter']
  onClose: () => void
}): React.JSX.Element {
  switch (studio) {
    case 'skills':
      return <SkillsStudio worktreeId={worktreeId} onClose={onClose} />
    case 'settings':
      return <SettingsStudio onClose={onClose} />
    case 'loops':
      return <LoopsStudio worktreeId={worktreeId} onClose={onClose} />
    case 'memory':
      return <MemoryStudio worktreeId={worktreeId} />
    case 'code':
      return <CodeStudio worktreeId={worktreeId} onClose={onClose} />
    case 'markdown':
      return <RepoDocumentsStudio worktreeId={worktreeId} scope="markdown" onClose={onClose} />
    case 'docs':
      return <RepoDocumentsStudio worktreeId={worktreeId} scope="documents" onClose={onClose} />
    case 'generate-doc':
      return (
        <RepoDocumentsStudio
          worktreeId={worktreeId}
          scope="documents"
          initialPane="generate"
          onClose={onClose}
        />
      )
    case 'chat':
      return <ChatStudio worktreeId={worktreeId} chatTabId={chatTabId} />
    case 'mission-map':
      return <MissionMapStudio worktreeId={worktreeId} onClose={onClose} />
    case 'agents':
      return <AgentsPage />
    case 'communications':
      return <BuzzPage />
    case 'presets':
      return worktreeId ? (
        <PresetsStudio worktreeId={worktreeId} freeCenter={freeCenter} onDone={onClose} />
      ) : (
        <StudioEmptyState
          title={translate('board.studio.title.presets', 'Presets')}
          detail={translate('board.presets.noWorkspace', 'Open a workspace to deploy a preset.')}
        />
      )
    case 'kanban':
      // Why: WorkspaceKanbanDrawer is a Sheet tightly coupled to the Classic
      // sidebar's own open/menu/drag state (leftSidebarStyle, onMenuOpenChange,
      // preserveOpenForMenu) that this standalone studio host cannot supply
      // without reaching into sidebar-only state. Honest empty state instead
      // of a half-wired drawer.
      return (
        <StudioEmptyState
          title={translate('board.studio.title.kanban', 'Kanban')}
          detail={translate(
            'board.studio.kanbanUnavailable',
            'The workspace Kanban board is tied to the sidebar drawer and cannot open here yet.'
          )}
        />
      )
  }
}

function StudioLoading(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-label={translate('board.studio.loading', 'Loading…')}
      className="flex h-full items-center justify-center"
    >
      <Loader2 className="size-5 animate-spin text-[var(--board-text-muted)]" />
    </div>
  )
}

// Why: rendered before the studio body so its window capture listener is
// registered ahead of any embedded page's own Esc handler.
function StudioEscapeGuard({ onClose }: { onClose: () => void }): React.JSX.Element {
  const markerRef = useRef<HTMLSpanElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(
    () =>
      listenStudioEscape(
        window,
        () => markerRef.current?.closest('[role="dialog"]') ?? null,
        () => onCloseRef.current()
      ),
    []
  )
  return <span ref={markerRef} hidden />
}

// Centered modal that hosts one existing Dobius page over the Board canvas.
// Radix Dialog gives the scrim, focus trap and outside-click close; Esc is ours.
export function BoardStudioHost({
  studio,
  worktreeId,
  onClose,
  freeCenter,
  chatTabId = null
}: BoardStudioHostProps): React.JSX.Element | null {
  const bodyRef = useRef<HTMLDivElement>(null)
  if (!studio) {
    return null
  }
  const closeLabel = translate('board.studio.close', 'Close')
  const StudioIcon = boardStudioIcon(studio)
  const subtitle = boardStudioSubtitle(studio)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <DialogContent
        // Why: the dialog portals to document.body, outside the Board's token
        // scope; this attribute re-scopes the --board-* variables onto the panel.
        data-surface="board"
        showCloseButton={false}
        aria-describedby={undefined}
        // Why: Radix focuses the first button (the header X), which pops its
        // tooltip over the studio on every open; start focus in the body instead.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          bodyRef.current?.focus({ preventScroll: true })
        }}
        className={cn(
          BOARD_FLOATING_PANEL_CLASS,
          'flex h-[min(760px,86vh)] w-[min(1100px,92vw)] max-w-none flex-col gap-0 overflow-hidden rounded-[var(--board-radius-panel)] p-0 backdrop-blur-none sm:max-w-none dark:border-[var(--board-panel-border)] dark:bg-[var(--board-panel)] dark:shadow-(--board-shadow)'
        )}
      >
        <StudioEscapeGuard onClose={onClose} />
        {/* Reference studio chrome (sym-presets-studio.png): 34px tile, 19px title, 13px subtitle. */}
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--board-panel-border)] py-4 pr-4 pl-5">
          <div className="flex min-w-0 items-center gap-3.5">
            <span
              aria-hidden
              className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-[var(--board-accent-tint)] text-[var(--board-accent)]"
            >
              <StudioIcon className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-[19px] leading-tight font-bold tracking-[-0.01em] text-[var(--board-text)]">
                {boardStudioTitle(studio)}
              </DialogTitle>
              {subtitle ? (
                <p className="mt-0.5 truncate text-[13px] text-[var(--board-text-muted)]">
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={closeLabel}
                className={cn(BOARD_ICON_BUTTON_CLASS, 'size-8 bg-[var(--board-panel-2)]')}
                onClick={onClose}
              >
                <X className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{closeLabel}</TooltipContent>
          </Tooltip>
        </header>
        <div
          ref={bodyRef}
          tabIndex={-1}
          data-board-studio-body
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto outline-none"
        >
          <RecoverableRenderErrorBoundary
            boundaryId={`board-studio-${studio}`}
            surface="modal"
            resetKey={studio}
            title={translate('board.studio.crashed', 'This studio hit an error.')}
            description={translate(
              'board.studio.crashedDetail',
              'The board underneath is still running. Retry, or close the studio.'
            )}
          >
            <Suspense fallback={<StudioLoading />}>
              <StudioBody
                studio={studio}
                worktreeId={worktreeId}
                chatTabId={chatTabId}
                freeCenter={freeCenter}
                onClose={onClose}
              />
            </Suspense>
          </RecoverableRenderErrorBoundary>
        </div>
      </DialogContent>
    </Dialog>
  )
}
