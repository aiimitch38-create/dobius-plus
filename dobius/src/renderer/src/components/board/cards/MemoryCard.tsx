import { useCallback, useEffect, useState } from 'react'
import { Brain, Send } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { getRepoIdFromWorktreeId } from '../../../../../shared/worktree-id'
import {
  MEMORY_GLOBAL_SCOPE,
  buildMemoryBrief,
  type MemoryEntry
} from '../board-studios/memory-entries'
import { listMemoryEntries } from '../board-studios/memory-entry-store'
import type { CardBodyProps } from './card-body-props'
import { memoryPushTargets, pushMemoryToConsoles, type MemoryPushCounts } from './memory-push'

/** This repo's active facts first, then global ones. */
export async function loadBriefEntries(worktreeId: string): Promise<MemoryEntry[]> {
  const [repo, global] = await Promise.all([
    listMemoryEntries(getRepoIdFromWorktreeId(worktreeId)),
    listMemoryEntries(MEMORY_GLOBAL_SCOPE)
  ])
  return [...repo, ...global]
}

function WirePicker({
  worktreeId,
  card,
  onChange
}: CardBodyProps<'memory'> & { worktreeId: string }): React.JSX.Element {
  const board = useAppStore((s) => getBoard(s, worktreeId))
  const options = [
    ...board.cards.flatMap((c) => (c.kind === 'console' ? [{ id: c.id, label: c.title }] : [])),
    ...board.groups.map((g) => ({ id: g.id, label: `@${g.name}` }))
  ]
  const wired = new Set(card.wiredCardIds)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-full bg-[var(--board-accent-tint)] px-2 py-0.5 text-[11px] font-semibold text-[var(--board-accent)]"
        >
          {translate('board.orchestrator.wired', '{{count}} wired', {
            count: card.wiredCardIds.length
          })}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">
          {translate('board.memory.wireTo', 'Push memory to')}
        </DropdownMenuLabel>
        {options.length === 0 ? (
          <div className="px-2 py-1 text-[12px] text-muted-foreground">
            {translate('board.orchestrator.noConsoles', 'No consoles on this board.')}
          </div>
        ) : (
          options.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.id}
              checked={wired.has(o.id)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(checked) =>
                onChange({
                  wiredCardIds: checked
                    ? [...card.wiredCardIds, o.id]
                    : card.wiredCardIds.filter((id) => id !== o.id)
                })
              }
            >
              {o.label}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Memory reaches an agent only through this card's Push (consoles launch clean).
export function MemoryCard({
  worktreeId,
  card,
  onChange
}: CardBodyProps<'memory'> & { worktreeId: string }): React.JSX.Element {
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null)
  const [pushing, setPushing] = useState(false)
  const [last, setLast] = useState<MemoryPushCounts | null>(null)
  const targetCount = useAppStore(
    (s) => memoryPushTargets(getBoard(s, worktreeId), card.wiredCardIds).length
  )

  const reload = useCallback(() => {
    void loadBriefEntries(worktreeId).then(setEntries, (error: unknown) => {
      console.error('Failed to load board memory:', error)
      setEntries([])
    })
  }, [worktreeId])
  useEffect(reload, [reload])

  const active = entries?.filter((e) => e.active).length ?? 0

  const push = async (): Promise<void> => {
    setPushing(true)
    try {
      // Re-read so edits made in the Memory studio since mount are what gets sent.
      const brief = buildMemoryBrief(await loadBriefEntries(worktreeId))
      if (!brief) {
        toast.message(
          translate('board.memory.nothingActive', 'Nothing active. Push would send nothing.')
        )
        return
      }
      setLast(await pushMemoryToConsoles(worktreeId, card.wiredCardIds, brief))
    } catch (error) {
      console.error('Memory push failed:', error)
      toast.error(translate('board.memory.pushFailed', 'Could not push memory.'))
    } finally {
      setPushing(false)
      reload()
    }
  }

  return (
    <div className="flex h-full flex-col gap-2 p-3 text-[var(--board-text)]">
      <div className="flex items-center gap-2">
        <Brain className="size-4 text-[var(--board-text-muted)]" />
        <span className="text-[12px] text-[var(--board-text-muted)]">
          {entries === null
            ? translate('board.studio.loading', 'Loading…')
            : translate('board.memory.activeCount', '{{count}} active facts', { count: active })}
        </span>
        <span className="ml-auto">
          <WirePicker worktreeId={worktreeId} card={card} onChange={onChange} />
        </span>
      </div>
      {targetCount === 0 ? (
        <p className="text-[12px] text-[var(--board-text-muted)]">
          {translate('board.memory.nothingWired', 'Nothing wired yet.')}
        </p>
      ) : null}
      {last ? (
        <p className="text-[12px] text-[var(--board-text-muted)]">
          {translate(
            'board.memory.pushResult',
            'Sent {{sent}} · busy {{busy}} · shell {{shell}} · failed {{failed}}',
            last
          )}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pushing || targetCount === 0 || active === 0}
        onClick={() => void push()}
        className="mt-auto flex h-8 items-center justify-center gap-1.5 rounded-full bg-[var(--board-accent)] text-[12px] font-semibold text-[var(--board-accent-fg)] disabled:opacity-40"
      >
        <Send className="size-3.5" />
        {translate('board.memory.push', 'Push to wired agents')}
      </button>
    </div>
  )
}
