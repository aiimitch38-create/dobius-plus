import { useEffect, useMemo } from 'react'
import { useAppStore } from '@/store'
import { useWorktreesForRepo } from '@/store/selectors'
import { getBoard, type BoardCardOf, type BoardState } from '@/store/slices/board'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { getAgentLabel } from '@/lib/agent-catalog'
import { filterEnabledTuiAgents } from '../../../../../shared/tui-agent-selection'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../../shared/agent-status-types'
import type { BoardAgentOption } from '../board-chrome/BoardAgentPicker'
import type { BoardProjectOption, BoardWorkspaceTab } from '../board-chrome/BoardTopBar'
import { boardConsoleActivity } from './board-console-activity'
import { boardUsageSummary, type BoardUsageSummary } from './board-usage-summary'
import { boardWorkspaceTabs } from './board-workspace-tabs'

export type BoardRouteData = {
  worktreeId: string | null
  repoId: string | null
  board: BoardState
  consoles: BoardCardOf<'console'>[]
  projects: BoardProjectOption[]
  workspaces: BoardWorkspaceTab[]
  live: number
  needsYou: number
  agents: BoardAgentOption[]
  usage: BoardUsageSummary | null
}

export function useBoardRouteData(): BoardRouteData {
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  // Why: the Board is per worktree, so its project is the worktree's repo;
  // activeRepoId can still be null when only the worktree was activated.
  const repoId = useAppStore(
    (s) =>
      (s.activeWorktreeId ? s.getKnownWorktreeById(s.activeWorktreeId)?.repoId : null) ??
      s.activeRepoId
  )
  const repos = useAppStore((s) => s.repos)
  const boardsByWorktree = useAppStore((s) => s.boardsByWorktree)
  const worktrees = useWorktreesForRepo(repoId)
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const acknowledgedAgentsByPaneKey = useAppStore((s) => s.acknowledgedAgentsByPaneKey)
  // Why: re-derive freshness whenever the status feed ticks.
  useAppStore((s) => s.agentStatusEpoch)
  const defaultAgent = useAppStore((s) => s.settings?.defaultTuiAgent)
  const disabledAgents = useAppStore((s) => s.settings?.disabledTuiAgents)
  const connectionId = repos.find((r) => r.id === repoId)?.connectionId ?? null
  const { detectedIds } = useDetectedAgents(repoId ? connectionId : undefined)

  const rateLimits = useAppStore((s) => s.rateLimits)
  // Why: the status bar that normally triggers the fetch sits under the Board.
  useEffect(() => {
    const { rateLimits: current, fetchRateLimits } = useAppStore.getState()
    if (!current.claude && !current.codex && !current.gemini) {
      void fetchRateLimits()
    }
  }, [])
  const usage = useMemo(
    () =>
      boardUsageSummary([
        rateLimits.claude,
        rateLimits.codex,
        rateLimits.gemini,
        rateLimits.opencodeGo,
        rateLimits.kimi,
        rateLimits.minimax
      ]),
    [rateLimits]
  )

  const board = getBoard({ boardsByWorktree }, worktreeId)
  const consoles = useMemo(
    () => board.cards.filter((c): c is BoardCardOf<'console'> => c.kind === 'console'),
    [board.cards]
  )

  const workspaces = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const [id, b] of Object.entries(boardsByWorktree)) {
      counts[id] = b.cards.filter((c) => c.kind === 'console').length
    }
    return boardWorkspaceTabs(worktrees, counts)
  }, [boardsByWorktree, worktrees])

  // Computed per render (cheap): subscribing to statusEpoch re-renders as entries go stale.
  const { live, needsYou } = boardConsoleActivity(
    consoles.map((c) => c.tabId),
    {
      agentStatusByPaneKey,
      acknowledgedAgentsByPaneKey,
      now: Date.now(),
      staleAfterMs: AGENT_STATUS_STALE_AFTER_MS
    }
  )

  const agents = useMemo(() => {
    const enabled = filterEnabledTuiAgents(detectedIds ?? [], disabledAgents)
    // 'blank' means "no default agent", not a launchable agent.
    const preferred = defaultAgent && defaultAgent !== 'blank' ? defaultAgent : null
    const ordered =
      preferred && enabled.includes(preferred)
        ? [preferred, ...enabled.filter((a) => a !== preferred)]
        : enabled
    return ordered.map((id) => ({ id, label: getAgentLabel(id) }))
  }, [defaultAgent, detectedIds, disabledAgents])

  const projects = useMemo(() => repos.map((r) => ({ id: r.id, name: r.displayName })), [repos])

  return {
    worktreeId,
    repoId,
    board,
    consoles,
    projects,
    workspaces,
    live,
    needsYou,
    agents,
    usage
  }
}
