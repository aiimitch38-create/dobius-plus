import React, { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CustomAgent } from '../../../../../shared/agents'
import { AgentMemoryView } from '@/components/agents/AgentMemoryView'
import { useAgentIdentityFiles } from '@/components/agents/use-agent-identity-files'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { buildMemoryPushPrompt } from './memory-studio-notes'
import { MemoryFactsPanel } from './MemoryFactsPanel'
import { ProjectKnowledgePanel } from './ProjectKnowledgePanel'
import { PushToConsoleMenu } from './PushToConsoleMenu'
import { StudioEmptyState } from './StudioEmptyState'

type MemoryView = 'facts' | 'crew' | 'knowledge'

// Memory studio: board memory facts (per repo + all repos, scan/refresh), crew
// agent memory (editable) and project knowledge (read-only). Every note can be
// pushed into a console; facts reach agents through a memory card's Push.
export function MemoryStudio({ worktreeId }: { worktreeId: string | null }): React.JSX.Element {
  const [view, setView] = useState<MemoryView>('facts')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label={translate('board.studio.memory.views', 'Memory views')}
        className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--board-panel-border)] px-2"
      >
        {(['facts', 'crew', 'knowledge'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            onClick={() => setView(value)}
            className={cn(
              'rounded-[8px] px-3 py-1 text-[12px] text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)]',
              view === value && 'bg-[var(--board-accent-tint)] text-[var(--board-text)]'
            )}
          >
            {value === 'facts'
              ? translate('board.studio.memory.viewFacts', 'Facts')
              : value === 'crew'
                ? translate('board.studio.memory.viewCrew', 'Crew')
                : translate('board.studio.memory.viewKnowledge', 'Project knowledge')}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {view === 'facts' ? (
          <MemoryFactsPanel worktreeId={worktreeId} />
        ) : view === 'crew' ? (
          <CrewMemoryPanel worktreeId={worktreeId} />
        ) : (
          <ProjectKnowledgePanel worktreeId={worktreeId} />
        )}
      </div>
    </div>
  )
}

// Crew memory: pick an agent on the left, edit its memory.md on the right.
// Reuses the same file hook + view the Agents page uses, so saves honor the
// on-disk conflict guard.
function CrewMemoryPanel({ worktreeId }: { worktreeId: string | null }): React.JSX.Element {
  const [agents, setAgents] = useState<CustomAgent[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const { agentFiles, setAgentFiles, saveAgentFiles, reportAgentFileSaveError } =
    useAgentIdentityFiles(selectedAgentId)

  useEffect(() => {
    let cancelled = false
    window.api.agents.list().then(
      (list) => {
        if (cancelled) {
          return
        }
        setAgents(list)
        setSelectedAgentId((prev) => prev ?? list[0]?.id ?? null)
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error))
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [])

  const selectedAgent = agents?.find((a) => a.id === selectedAgentId) ?? null

  const saveMemory = async (): Promise<void> => {
    if (!selectedAgentId) {
      return
    }
    setSaving(true)
    try {
      await saveAgentFiles(selectedAgentId, { names: ['memory'] })
    } catch (error) {
      reportAgentFileSaveError(
        error,
        translate('board.studio.memory.saveFailed', 'Could not save memory')
      )
    } finally {
      setSaving(false)
    }
  }

  const resetSession = async (): Promise<void> => {
    if (!selectedAgentId) {
      return
    }
    setResetting(true)
    try {
      setAgents(await window.api.agents.resetSession(selectedAgentId))
    } catch (error) {
      console.error('Failed to reset agent session:', error)
      toast.error(translate('board.studio.memory.resetFailed', 'Could not start a new session'))
    } finally {
      setResetting(false)
    }
  }

  if (loadError) {
    return (
      <StudioEmptyState
        title={translate('board.studio.memory.loadFailed', 'Could not load your crew.')}
        detail={loadError}
      />
    )
  }
  if (!agents) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-[var(--board-text-muted)]" />
      </div>
    )
  }
  if (agents.length === 0) {
    return (
      <StudioEmptyState
        title={translate('board.studio.memory.noAgents', 'No crew agents yet.')}
        detail={translate(
          'board.studio.memory.noAgentsDetail',
          'Create an agent on the Agents page and its memory will show up here.'
        )}
      />
    )
  }
  return (
    <div className="flex h-full min-h-0">
      <nav
        aria-label={translate('board.studio.memory.agentList', 'Crew agents')}
        className="scrollbar-sleek w-56 shrink-0 overflow-y-auto border-r border-[var(--board-panel-border)] p-2"
      >
        {agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            aria-current={agent.id === selectedAgentId || undefined}
            onClick={() => setSelectedAgentId(agent.id)}
            className={cn(
              'flex w-full flex-col items-start rounded-[10px] px-3 py-2 text-left hover:bg-[var(--board-panel-2)]',
              agent.id === selectedAgentId && 'bg-[var(--board-accent-tint)]'
            )}
          >
            <span className="truncate text-[13px] font-medium text-[var(--board-text)]">
              {agent.name}
            </span>
            {agent.description ? (
              <span className="line-clamp-1 text-[11px] text-[var(--board-text-muted)]">
                {agent.description}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {selectedAgent ? (
          <div className="flex h-10 shrink-0 items-center justify-end border-b border-[var(--board-panel-border)] px-4">
            <PushToConsoleMenu
              worktreeId={worktreeId}
              prompt={buildMemoryPushPrompt({
                title: selectedAgent.name,
                filePath: `~/.dobius/agents/${selectedAgent.id}/memory.md`,
                content: agentFiles.memory
              })}
            />
          </div>
        ) : null}
        {selectedAgent ? (
          <AgentMemoryView
            agent={selectedAgent}
            memory={agentFiles.memory}
            saving={saving}
            resetting={resetting}
            onMemoryChange={(memory) => setAgentFiles({ ...agentFiles, memory })}
            onResetSession={() => void resetSession()}
            onSave={() => void saveMemory()}
          />
        ) : null}
      </section>
    </div>
  )
}
