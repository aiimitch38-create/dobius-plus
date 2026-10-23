import { useEffect, useMemo, useState } from 'react'
import { Copy, GitBranch, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
import { searchRuntimeRepoBaseRefs } from '@/runtime/runtime-repo-client'
import { useAppStore } from '@/store'
import { getRepoIdFromWorktreeId } from '../../../../../shared/worktree-id'
import { filterBranches } from './board-card-extras'

const LIMIT = 200

// Read-only branch list for the board's repo, through the runtime that owns it (local or SSH).
export function BranchesCard({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const [refs, setRefs] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(null)
    searchRuntimeRepoBaseRefs(
      getSettingsForWorktreeRuntimeOwner(useAppStore.getState(), worktreeId),
      getRepoIdFromWorktreeId(worktreeId),
      '',
      LIMIT
    ).then(
      (list) => !cancelled && setRefs(list),
      (err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err))
    )
    return () => {
      cancelled = true
    }
  }, [worktreeId, generation])

  const shown = useMemo(() => filterBranches(refs ?? [], query), [refs, query])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3 text-[var(--board-text)]">
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={translate('board.branches.filter', 'Filter branches')}
          className="min-w-0 flex-1 rounded-[8px] border border-[var(--board-panel-border)] bg-transparent px-2 py-1 text-[12px]"
        />
        <button
          type="button"
          aria-label={translate('board.branches.refresh', 'Refresh branches')}
          onClick={() => setGeneration((g) => g + 1)}
          className="rounded-full p-1 text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)]"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      {error ? (
        <p className="text-[12px] text-[var(--board-text-muted)]">{error}</p>
      ) : refs === null ? (
        <p className="text-[12px] text-[var(--board-text-muted)]">
          {translate('board.studio.loading', 'Loading…')}
        </p>
      ) : shown.length === 0 ? (
        <p className="text-[12px] text-[var(--board-text-muted)]">
          {translate('board.branches.none', 'No branches match.')}
        </p>
      ) : (
        <ul data-board-wheel="native" className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
          {shown.map((ref) => (
            <li
              key={ref}
              className="group flex items-center gap-2 rounded-[8px] px-1.5 py-1 hover:bg-[var(--board-panel-2)]"
            >
              <GitBranch className="size-3.5 shrink-0 text-[var(--board-text-muted)]" />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{ref}</span>
              <button
                type="button"
                aria-label={translate('board.branches.copy', 'Copy branch name')}
                onClick={() =>
                  void navigator.clipboard.writeText(ref).then(
                    () =>
                      toast.success(translate('board.branches.copied', 'Copied {{ref}}', { ref })),
                    () => toast.error(translate('board.branches.copyFailed', 'Could not copy.'))
                  )
                }
                className="opacity-0 group-hover:opacity-100"
              >
                <Copy className="size-3.5 text-[var(--board-text-muted)]" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
