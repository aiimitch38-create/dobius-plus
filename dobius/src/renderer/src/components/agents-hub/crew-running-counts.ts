import type { AgentRun, CustomAgent } from '../../../../shared/agents'

export type CrewRunningCounts = {
  /** Configured agents with at least one run in progress. */
  activeAgents: number
  /** Runs in progress; one agent can have several (e.g. one per channel). */
  runningRuns: number
}

export function crewRunningCounts(agents: CustomAgent[], runs: AgentRun[]): CrewRunningCounts {
  const running = runs.filter((run) => run.status === 'running')
  const runningAgentIds = new Set(running.map((run) => run.agentId))
  return {
    activeAgents: agents.filter((agent) => runningAgentIds.has(agent.id)).length,
    runningRuns: running.length
  }
}

export function crewSubtitle(agents: CustomAgent[], runs: AgentRun[]): string {
  if (!agents.length) {
    return 'No agents configured'
  }
  const { activeAgents, runningRuns } = crewRunningCounts(agents, runs)
  const base = `${agents.length} agents · ${activeAgents} running`
  // Why: the old label showed the run count as the agent count.
  return runningRuns === activeAgents
    ? base
    : `${base} · ${runningRuns} run${runningRuns === 1 ? '' : 's'} active`
}
