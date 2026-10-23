import React from 'react'
import { LayoutDashboard } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { BOARD_MONO_CLASS, BOARD_PILL_BUTTON_CLASS } from '../board-chrome/board-surface-classes'
import { addFileCardToBoard } from './board-file-card'
import { EditorPanel, FileExplorer } from './board-studio-lazy-pages'
import { StudioEmptyState } from './StudioEmptyState'

// File explorer + editor side by side. Both existing components read the
// active worktree from the store, so the studio only works for that worktree.
export function CodeStudio({
  worktreeId,
  onClose
}: {
  worktreeId: string | null
  onClose: () => void
}): React.JSX.Element {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const hasOpenFile = useAppStore((s) =>
    worktreeId ? s.openFiles.some((f) => f.worktreeId === worktreeId) : false
  )
  // Why: only a plain file tab can become a board card; diffs and previews have no single path.
  const activeFile = useAppStore((s) => {
    const id = worktreeId ? s.activeFileIdByWorktree[worktreeId] : null
    const file = id ? s.openFiles.find((f) => f.id === id) : undefined
    return file && file.mode === 'edit' && !file.isUntitled ? file : null
  })
  if (!worktreeId) {
    return (
      <StudioEmptyState
        title={translate('board.studio.code.noWorkspace', 'Open a workspace to browse its code.')}
      />
    )
  }
  if (activeWorktreeId !== worktreeId) {
    return (
      <StudioEmptyState
        title={translate(
          'board.studio.code.inactiveWorkspace',
          'The code browser follows the active workspace. Switch to this board’s workspace to browse its files.'
        )}
      />
    )
  }
  return (
    <div className="flex h-full min-h-0 min-w-0">
      <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--board-panel-border)] bg-background">
        <FileExplorer />
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {activeFile ? (
          <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-[var(--board-panel-border)] pr-2 pl-4">
            <span
              className={cn(
                'min-w-0 truncate text-[12px] text-[var(--board-text-muted)]',
                BOARD_MONO_CLASS
              )}
              title={activeFile.relativePath}
            >
              {activeFile.relativePath}
            </span>
            <button
              type="button"
              onClick={() => {
                addFileCardToBoard(worktreeId, activeFile.filePath)
                onClose()
              }}
              className={cn(BOARD_PILL_BUTTON_CLASS, 'flex shrink-0 items-center gap-1.5')}
            >
              <LayoutDashboard className="size-3.5" />
              {translate('board.studio.addToBoard', 'Add to board')}
            </button>
          </div>
        ) : null}
        {hasOpenFile ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <EditorPanel />
          </div>
        ) : (
          <StudioEmptyState
            title={translate('board.studio.code.pickFile', 'Pick a file to open it here.')}
          />
        )}
      </section>
    </div>
  )
}
