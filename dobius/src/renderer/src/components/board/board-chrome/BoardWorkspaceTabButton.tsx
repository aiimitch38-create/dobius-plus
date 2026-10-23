import React, { useState } from 'react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

export type BoardWorkspaceTab = { id: string; name: string; count?: number }

type BoardWorkspaceTabButtonProps = {
  workspace: BoardWorkspaceTab
  active: boolean
  onSelect: (id: string) => void
  onRename: (id: string, name: string) => void
}

// Double-click renames in place; Enter/blur saves, Esc cancels.
export function BoardWorkspaceTabButton({
  workspace,
  active,
  onSelect,
  onRename
}: BoardWorkspaceTabButtonProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(workspace.name)

  const commit = (): void => {
    setEditing(false)
    const next = value.trim()
    if (next && next !== workspace.name) {
      onRename(workspace.id, next)
    }
  }

  const className = cn(
    'flex h-[25px] shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[13px] font-semibold transition-colors',
    active
      ? 'border-[var(--board-accent)] bg-[var(--board-accent-tint)] text-[var(--board-text)]'
      : 'border-transparent text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)] hover:text-[var(--board-text)]'
  )

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        aria-label={translate('board.topBar.renameWorkspace', 'Workspace name')}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit()
          } else if (event.key === 'Escape') {
            setValue(workspace.name)
            setEditing(false)
          }
        }}
        className={cn(className, 'w-36 bg-[var(--board-panel)] outline-none')}
      />
    )
  }

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title={translate('board.topBar.renameHint', 'Double-click to rename')}
      onClick={() => onSelect(workspace.id)}
      onDoubleClick={() => {
        setValue(workspace.name)
        setEditing(true)
      }}
      className={className}
    >
      <span className="max-w-36 truncate">{workspace.name}</span>
      {workspace.count ? (
        <span
          className={cn(
            'min-w-[17px] rounded-full px-1 text-center text-[11px] leading-[17px] tabular-nums',
            active
              ? 'bg-[var(--board-panel)] text-[var(--board-accent)]'
              : 'bg-[var(--board-panel-2)]'
          )}
        >
          {workspace.count}
        </span>
      ) : null}
    </button>
  )
}
