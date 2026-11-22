import { Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { VertexTaskAutoFix } from '../../../../shared/vertex-task-types'

function label(autoFix: VertexTaskAutoFix): string {
  switch (autoFix.status) {
    case 'queued':
      return translate(
        'kanban.autoFix.queued',
        'Fix agent queued: starts when the crew is running and a slot is free'
      )
    case 'starting':
      return translate('kanban.autoFix.starting', 'Starting a fix agent…')
    case 'dispatched':
      return autoFix.branch
        ? translate('kanban.autoFix.dispatchedOn', 'Fix agent dispatched on {{branch}}', {
            branch: autoFix.branch
          })
        : translate('kanban.autoFix.dispatched', 'Fix agent dispatched')
    case 'ended':
      return translate('kanban.autoFix.ended', 'Fix agent stopped running; review its branch')
    case 'skipped':
      return translate('kanban.autoFix.skipped', 'Auto-fix skipped: {{reason}}', {
        reason: autoFix.reason ?? ''
      })
    case 'failed':
      return translate('kanban.autoFix.failed', 'Auto-fix failed: {{reason}}', {
        reason: autoFix.reason ?? ''
      })
  }
}

export function openAutoFixConsole(worktreeId: string): void {
  if (activateAndRevealWorktree(worktreeId, { keepView: true }) === false) {
    toast.error(translate('board.home.openFailed', 'That workspace could not be opened.'))
    return
  }
  // Why: consoles live on the Board canvas, which shows when no studio is open.
  useAppStore.getState().setBoardStudio(null)
  useAppStore.getState().setActiveView('board')
}

/** Outside the card's main button: a button may not sit inside another. */
export function BugAutoFixMarker({ autoFix }: { autoFix: VertexTaskAutoFix }): React.JSX.Element {
  const worktreeId =
    autoFix.status === 'dispatched' || autoFix.status === 'ended' ? autoFix.worktreeId : undefined
  return (
    <div
      data-testid="kanban-card-autofix"
      className="flex items-center gap-1.5 px-3 pb-3 text-[10px] text-kanban-muted-foreground"
      title={autoFix.reason ?? undefined}
    >
      <Wrench
        aria-hidden
        className={cn(
          'size-3 shrink-0',
          autoFix.status === 'failed' && 'text-kanban-red',
          (autoFix.status === 'starting' || autoFix.status === 'dispatched') && 'text-kanban-accent'
        )}
      />
      <span className="min-w-0 flex-1 truncate">{label(autoFix)}</span>
      {worktreeId ? (
        <button
          type="button"
          onClick={() => openAutoFixConsole(worktreeId)}
          className="shrink-0 font-medium text-kanban-accent underline-offset-2 hover:underline"
        >
          {translate('kanban.autoFix.openConsole', 'Open console')}
        </button>
      ) : null}
    </div>
  )
}
