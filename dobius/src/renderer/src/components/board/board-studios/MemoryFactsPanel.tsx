import React, { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, ScanSearch, StickyNote } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { notePushTargets } from '../cards/note-push'
import { getRepoIdFromWorktreeId } from '../../../../../shared/worktree-id'
import {
  MEMORY_GLOBAL_SCOPE,
  buildRefreshPrompt,
  buildScanPrompt,
  findByTitle,
  type MemoryEntry,
  type MemoryScanEffort
} from './memory-entries'
import { listMemoryEntries, saveMemoryEntries } from './memory-entry-store'
import { addCardAtViewCenter } from './add-card-at-view-center'
import { StudioEmptyState } from './StudioEmptyState'
import { EntryRow, FIELD, ProposalsReview } from './MemoryFactRows'
import { useMemoryProposals } from './use-memory-proposals'

/** Board memory facts for this repo or all repos, with agent scan/refresh. */
export function MemoryFactsPanel({ worktreeId }: { worktreeId: string | null }): React.JSX.Element {
  const [scopeKind, setScopeKind] = useState<'repo' | 'global'>(worktreeId ? 'repo' : 'global')
  const scope =
    scopeKind === 'repo' && worktreeId ? getRepoIdFromWorktreeId(worktreeId) : MEMORY_GLOBAL_SCOPE
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null)
  const [effort, setEffort] = useState<MemoryScanEffort>('balanced')
  const [tabId, setTabId] = useState<string | null>(null)
  const board = useAppStore((s) => (worktreeId ? getBoard(s, worktreeId) : null))
  const targets = board ? notePushTargets(board) : []
  const target = targets.find((t) => t.tabId === tabId) ?? targets[0] ?? null
  const { state: proposalsState, request, reset, setProposals } = useMemoryProposals(worktreeId)

  useEffect(() => {
    let cancelled = false
    setEntries(null)
    listMemoryEntries(scope).then(
      (list) => !cancelled && setEntries(list),
      (error: unknown) => {
        console.error('Failed to load memory:', error)
        if (!cancelled) {
          setEntries([])
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [scope])

  const commit = useCallback(
    (next: MemoryEntry[]) => {
      setEntries(next)
      saveMemoryEntries(scope, next).catch((error: unknown) => {
        console.error('Failed to save memory:', error)
        toast.error(translate('board.memory.saveFailed', 'Could not save memory.'))
      })
    },
    [scope]
  )

  const ask = async (prompt: string): Promise<void> => {
    if (!target) {
      toast.message(translate('board.memory.needConsole', 'Add a console to the board first.'))
      return
    }
    const error = await request(target.tabId, target.title, prompt)
    if (error) {
      toast.error(error)
    }
  }

  const addCardToBoard = (): void => {
    if (!worktreeId) {
      return
    }
    addCardAtViewCenter(worktreeId, 'memory')
    toast.success(translate('board.memory.cardAdded', 'Memory card added to the board.'))
  }

  if (!entries) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-[var(--board-text-muted)]" />
      </div>
    )
  }

  const proposals = proposalsState.status === 'ready' ? proposalsState.proposals : []
  const dropProposal = (i: number): void => setProposals(proposals.filter((_, j) => j !== i))
  const acceptProposal = (i: number): void => {
    const p = proposals[i]
    const replaces = findByTitle(entries, p.title)
    commit(
      replaces
        ? entries.map((e) => (e.id === replaces.id ? { ...e, ...p } : e))
        : [...entries, { id: crypto.randomUUID(), ...p, active: true }]
    )
    dropProposal(i)
  }

  return (
    <div className="scrollbar-sleek h-full min-h-0 space-y-4 overflow-y-auto px-6 py-4">
      <div className="flex flex-wrap items-center gap-2">
        {(['repo', 'global'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={scopeKind === value}
            disabled={value === 'repo' && !worktreeId}
            onClick={() => setScopeKind(value)}
            className={cn(
              'rounded-[8px] px-3 py-1 text-[12px] text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)] disabled:opacity-40',
              scopeKind === value && 'bg-[var(--board-accent-tint)] text-[var(--board-text)]'
            )}
          >
            {value === 'repo'
              ? translate('board.studio.memory.scopeRepo', 'This project')
              : translate('board.memory.scopeAllRepos', 'All repos')}
          </button>
        ))}
        <span className="ml-auto" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            commit([
              ...entries,
              {
                id: crypto.randomUUID(),
                category: 'context',
                title: translate('board.memory.newTitle', 'New fact'),
                fact: '',
                active: false
              }
            ])
          }
        >
          <Plus className="size-3.5" />
          {translate('board.memory.add', 'Add fact')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!worktreeId}
          onClick={addCardToBoard}
        >
          <StickyNote className="size-3.5" />
          {translate('board.memory.addCard', 'Memory card on board')}
        </Button>
      </div>

      {scopeKind === 'repo' && worktreeId ? (
        <section className="flex flex-wrap items-center gap-2 rounded-[12px] bg-[var(--board-panel-2)] p-3">
          <ScanSearch className="size-4 text-[var(--board-text-muted)]" />
          <span className="text-[12px] text-[var(--board-text)]">
            {translate('board.memory.scanLabel', 'Scan this repo with')}
          </span>
          <select
            value={target?.tabId ?? ''}
            onChange={(e) => setTabId(e.target.value)}
            disabled={targets.length === 0}
            aria-label={translate('board.memory.scanConsole', 'Console')}
            className={cn(FIELD, 'w-auto')}
          >
            {targets.length === 0 ? (
              <option value="">{translate('board.memory.noConsoles', 'No consoles')}</option>
            ) : (
              targets.map((t) => (
                <option key={t.tabId} value={t.tabId}>
                  {t.title}
                </option>
              ))
            )}
          </select>
          <select
            value={effort}
            onChange={(e) => setEffort(e.target.value as MemoryScanEffort)}
            aria-label={translate('board.memory.effort', 'Effort')}
            className={cn(FIELD, 'w-auto')}
          >
            <option value="quick">{translate('board.memory.effortQuick', 'Quick')}</option>
            <option value="balanced">{translate('board.memory.effortBalanced', 'Balanced')}</option>
            <option value="thorough">{translate('board.memory.effortThorough', 'Thorough')}</option>
          </select>
          <Button
            type="button"
            size="sm"
            disabled={!target || proposalsState.status === 'waiting'}
            onClick={() => void ask(buildScanPrompt(effort))}
          >
            {translate('board.memory.scan', 'Scan')}
          </Button>
          {proposalsState.status === 'waiting' ? (
            <span className="flex items-center gap-1.5 text-[12px] text-[var(--board-text-muted)]">
              <Loader2 className="size-3.5 animate-spin" />
              {translate(
                'board.memory.waiting',
                '{{name}} is reading the repo. You can close this; the answer is kept in the repo.',
                { name: proposalsState.consoleTitle }
              )}
              <Button type="button" variant="ghost" size="sm" onClick={reset}>
                {translate('board.memory.stopWaiting', 'Stop waiting')}
              </Button>
            </span>
          ) : null}
          {proposalsState.status === 'error' ? (
            <span className="text-[12px] text-[var(--board-text-muted)]">
              {proposalsState.message}
            </span>
          ) : null}
        </section>
      ) : null}

      {proposals.length > 0 ? (
        <ProposalsReview
          proposals={proposals}
          entries={entries}
          onAccept={acceptProposal}
          onDrop={dropProposal}
          onEdit={(i, p) => setProposals(proposals.map((q, j) => (j === i ? p : q)))}
        />
      ) : null}

      {entries.length === 0 ? (
        <StudioEmptyState
          title={translate(
            'board.memory.empty',
            'Scan the repo with a CLI, or write the first fact yourself.'
          )}
        />
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              canRefresh={scopeKind === 'repo' && Boolean(target)}
              onChange={(patch) =>
                commit(entries.map((e) => (e.id === entry.id ? { ...e, ...patch } : e)))
              }
              onDelete={() => commit(entries.filter((e) => e.id !== entry.id))}
              onRefresh={() => void ask(buildRefreshPrompt(entry.title))}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
