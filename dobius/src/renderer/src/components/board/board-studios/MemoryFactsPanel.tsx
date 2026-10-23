import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Plus, ScanSearch, StickyNote } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { getRepoIdFromWorktreeId } from '../../../../../shared/worktree-id'
import {
  MEMORY_GLOBAL_SCOPE,
  buildRefreshPrompt,
  buildScanPrompt,
  findByTitle,
  type MemoryEntry,
  type MemoryScanEffort
} from './memory-entries'
import { listMemoryEntries, moveMemoryEntry, saveMemoryEntries } from './memory-entry-store'
import { consoleAgentChoices, pickAgentConsole } from './document-generation-agents'
import { AgentCliPicker } from './GenerateDocumentAgentPicker'
import { addCardAtViewCenter } from './add-card-at-view-center'
import { StudioEmptyState } from './StudioEmptyState'
import { EntryRow, FIELD, ProposalsReview } from './MemoryFactRows'
import { useMemoryProposals } from './use-memory-proposals'

/** Board memory facts for this repo or all repos, with agent scan/refresh. */
export function MemoryFactsPanel({ worktreeId }: { worktreeId: string | null }): React.JSX.Element {
  const [scopeKind, setScopeKind] = useState<'repo' | 'global'>(worktreeId ? 'repo' : 'global')
  const repoScope = worktreeId ? getRepoIdFromWorktreeId(worktreeId) : null
  const scope = scopeKind === 'repo' && repoScope ? repoScope : MEMORY_GLOBAL_SCOPE
  const otherScope = scope === MEMORY_GLOBAL_SCOPE ? repoScope : MEMORY_GLOBAL_SCOPE
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null)
  const [otherCount, setOtherCount] = useState(0)
  const [effort, setEffort] = useState<MemoryScanEffort>('balanced')
  const [agent, setAgent] = useState<string | null>(null)
  const [tabId, setTabId] = useState<string | null>(null)
  const board = useAppStore((s) => (worktreeId ? getBoard(s, worktreeId) : null))
  const choices = board ? consoleAgentChoices(board.cards) : []
  const picked = pickAgentConsole(choices, agent, tabId)
  const target = picked?.target ?? null
  const { state: proposalsState, request, reset, setProposals } = useMemoryProposals(worktreeId)
  // Why: saves and scope moves each read-modify-write persisted UI; one at a time keeps both.
  const writes = useRef<Promise<unknown>>(Promise.resolve())

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
    if (otherScope) {
      listMemoryEntries(otherScope).then(
        (list) => !cancelled && setOtherCount(list.length),
        (error: unknown) => console.error('Failed to count memory:', error)
      )
    }
    return () => {
      cancelled = true
    }
  }, [scope, otherScope])

  const commit = useCallback(
    (next: MemoryEntry[]) => {
      setEntries(next)
      writes.current = writes.current
        .then(() => saveMemoryEntries(scope, next))
        .catch((error: unknown) => {
          console.error('Failed to save memory:', error)
          toast.error(translate('board.memory.saveFailed', 'Could not save memory.'))
        })
    },
    [scope]
  )

  /** "Applies to": moves one fact between this repo and all repos. */
  const moveEntry = (entry: MemoryEntry): void => {
    if (!otherScope) {
      return
    }
    setEntries((list) => list?.filter((e) => e.id !== entry.id) ?? list)
    writes.current = writes.current
      .then(() => moveMemoryEntry(scope, otherScope, entry.id))
      .then((moved) => {
        setEntries(moved.from)
        setOtherCount(moved.to.length)
      })
      .catch((error: unknown) => {
        console.error('Failed to move memory:', error)
        toast.error(translate('board.memory.saveFailed', 'Could not save memory.'))
      })
  }

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
            <span className="ml-1.5 tabular-nums opacity-70">
              {value === scopeKind ? entries.length : otherCount}
            </span>
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
          {choices.length === 0 ? (
            <span className="text-[12px] text-[var(--board-text-muted)]">
              {translate('board.memory.noConsoles', 'No consoles')}
            </span>
          ) : (
            <AgentCliPicker
              choices={choices}
              agent={picked?.agent ?? null}
              tabId={target?.tabId ?? null}
              disabled={proposalsState.status === 'waiting'}
              onPick={(nextAgent, nextTab) => {
                setAgent(nextAgent)
                setTabId(nextTab)
              }}
            />
          )}
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
              canRefresh={Boolean(worktreeId && target) && proposalsState.status !== 'waiting'}
              scopeKind={scopeKind}
              canMove={Boolean(otherScope)}
              onMove={() => moveEntry(entry)}
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
