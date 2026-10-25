import { CornerDownLeft, FolderPlus, GitBranch, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useWorktreeActivityStatus } from '@/components/sidebar/use-worktree-activity-status'
import WorktreeContextMenu from '@/components/sidebar/WorktreeContextMenu'
import { translate } from '@/i18n/i18n'
import { getLocalFileManagerLabel } from '@/lib/local-file-manager-label'
import { cn } from '@/lib/utils'
import type { WorktreeStatus } from '@/lib/worktree-status'
import { useWorktreeById } from '@/store/selectors'
import {
  BOARD_FLOATING_PANEL_CLASS,
  BOARD_MENU_CONTENT_CLASS,
  BOARD_MENU_ROW_CLASS,
  BOARD_MENU_SEPARATOR_CLASS,
  BOARD_MONO_CLASS
} from '../board-chrome/board-surface-classes'
import { formatIdleAge, type HomeRepoRow } from './home-repo-rows'

export type HomeRepoRowActions = {
  onSelect: (repoId: string) => void
  onOpen: (row: HomeRepoRow) => void
  onReveal: (row: HomeRepoRow) => void
  onRemove: (row: HomeRepoRow) => void
}

const STATUS_DOT: Record<WorktreeStatus, string> = {
  working: 'bg-[var(--board-live)]',
  permission: 'bg-[var(--board-accent)]',
  done: 'bg-[var(--board-text-muted)]',
  active: 'bg-[var(--board-text-muted)] opacity-60',
  inactive: 'bg-[var(--board-panel-border)]'
}

function activityText(status: WorktreeStatus, lastActivityAt: number | null, now: number): string {
  if (status === 'working') {
    return translate('board.home.row.working', 'working')
  }
  if (status === 'permission') {
    return translate('board.home.row.needsYou', 'needs you')
  }
  if (lastActivityAt === null) {
    return translate('board.home.row.idle', 'idle')
  }
  const age = formatIdleAge(lastActivityAt, now)
  return age
    ? translate('board.home.row.idleFor', 'idle · {{age}}', { age })
    : translate('board.home.row.justNow', 'active just now')
}

function HomeRepoRowView({
  row,
  selected,
  now,
  actions
}: {
  row: HomeRepoRow
  selected: boolean
  now: number
  actions: HomeRepoRowActions
}): React.JSX.Element {
  // Same status-dot semantics as the sidebar workspace cards.
  const status = useWorktreeActivityStatus(row.worktreeId ?? '')
  const fileManager = getLocalFileManagerLabel()
  // Why: right-click gets the sidebar's workspace menu (pin, mark read, copy
  // path, sleep, delete, move to group) for the row's landing workspace.
  const landingWorktree = useWorktreeById(row.worktreeId)

  const rowView = (
    <div
      id={`home-repo-${row.repoId}`}
      role="option"
      aria-selected={selected}
      data-current={row.isActive ? 'true' : undefined}
      onClick={() => actions.onSelect(row.repoId)}
      onDoubleClick={() => actions.onOpen(row)}
      className={cn(
        'group/row flex h-12 cursor-default items-center gap-3 rounded-[12px] px-3 transition-colors',
        selected ? 'bg-[var(--board-accent-tint)]' : 'hover:bg-[var(--board-panel-2)]'
      )}
    >
      <span className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[status])} aria-hidden />
      <div className={cn('flex min-w-0 flex-1 items-baseline gap-0 text-[13px]', BOARD_MONO_CLASS)}>
        <span className="min-w-0 truncate text-[var(--board-text-muted)]" title={row.path}>
          {row.parentPath}
        </span>
        <span className="shrink-0 font-semibold text-[var(--board-text)]">{row.name}</span>
      </div>
      {row.isActive ? (
        <span className="shrink-0 rounded-full bg-[var(--board-accent-tint)] px-2 py-0.5 text-[11px] font-semibold text-[var(--board-accent)]">
          {translate('board.home.row.active', 'active')}
        </span>
      ) : null}
      <span className="w-24 shrink-0 text-right text-[12px] text-[var(--board-text-muted)] tabular-nums">
        {activityText(status, row.lastActivityAt, now)}
      </span>
      <span
        className={cn(
          'flex w-28 shrink-0 items-center justify-end gap-1 text-[12px] text-[var(--board-text-muted)]',
          BOARD_MONO_CLASS
        )}
      >
        {row.branch ? (
          <span className="flex max-w-full items-center gap-1 rounded-full border border-[var(--board-panel-border)] px-2 py-0.5">
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{row.branch}</span>
          </span>
        ) : null}
      </span>
      <div className="flex w-[104px] shrink-0 items-center justify-end gap-1">
        {selected ? (
          <Button
            size="xs"
            className="h-7 rounded-full bg-[var(--board-accent)] px-3 text-[12px] font-semibold text-[var(--board-accent-fg)] hover:bg-[var(--board-accent)] hover:brightness-110"
            onClick={(e) => {
              e.stopPropagation()
              actions.onOpen(row)
            }}
          >
            {translate('board.home.row.board', 'Board')}
            <CornerDownLeft className="size-3.5" />
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={translate('board.home.row.more', 'More actions for {{name}}', {
                name: row.name
              })}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'rounded-full text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)] hover:text-[var(--board-text)]',
                !selected && 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100'
              )}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            data-surface="board"
            align="end"
            sideOffset={6}
            className={cn(BOARD_MENU_CONTENT_CLASS, 'min-w-[200px]')}
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem
              className={BOARD_MENU_ROW_CLASS}
              onSelect={() => actions.onReveal(row)}
            >
              {translate('board.home.row.reveal', 'Reveal in {{app}}', { app: fileManager })}
            </DropdownMenuItem>
            <DropdownMenuSeparator className={BOARD_MENU_SEPARATOR_CLASS} />
            <DropdownMenuItem
              className={cn(BOARD_MENU_ROW_CLASS, 'text-[var(--board-danger-text)]')}
              onSelect={() => actions.onRemove(row)}
            >
              {translate('board.home.row.remove', 'Remove from list')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
  return landingWorktree ? (
    <WorktreeContextMenu worktree={landingWorktree}>{rowView}</WorktreeContextMenu>
  ) : (
    rowView
  )
}

export function HomeRepoList({
  rows,
  selectedRepoId,
  now,
  actions,
  onAddRepo
}: {
  rows: readonly HomeRepoRow[]
  selectedRepoId: string | null
  now: number
  actions: HomeRepoRowActions
  onAddRepo: () => void
}): React.JSX.Element {
  return (
    <section className="w-full">
      <div className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold tracking-[0.05em] text-[var(--board-text-muted)] uppercase">
        {translate('board.home.repos', 'Repos')}
        <span className="tabular-nums">{rows.length}</span>
      </div>
      <div className={cn(BOARD_FLOATING_PANEL_CLASS, 'rounded-[var(--board-radius-panel)] p-1.5')}>
        {rows.length > 0 ? (
          <div
            role="listbox"
            aria-label={translate('board.home.repos', 'Repos')}
            aria-activedescendant={selectedRepoId ? `home-repo-${selectedRepoId}` : undefined}
            className="flex max-h-[min(40vh,360px)] flex-col gap-0.5 overflow-y-auto scrollbar-sleek"
          >
            {rows.map((row) => (
              <HomeRepoRowView
                key={row.repoId}
                row={row}
                selected={row.repoId === selectedRepoId}
                now={now}
                actions={actions}
              />
            ))}
          </div>
        ) : null}
        <button
          type="button"
          onClick={onAddRepo}
          className={cn(
            'flex h-12 w-full items-center gap-3 rounded-[12px] border border-dashed border-[var(--board-panel-border)] px-3 text-left text-[13px] hover:bg-[var(--board-panel-2)]',
            rows.length > 0 && 'mt-1.5'
          )}
        >
          <FolderPlus className="size-4 text-[var(--board-text-muted)]" />
          <span className="font-semibold">{translate('board.home.addRepo', 'Add a repo')}</span>
          <span className="text-[var(--board-text-muted)]">
            {translate('board.home.addRepoHint', 'Pick a folder and it shows up here.')}
          </span>
        </button>
      </div>
    </section>
  )
}
