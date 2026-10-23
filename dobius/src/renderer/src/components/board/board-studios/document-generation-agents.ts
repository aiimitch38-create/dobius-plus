// Which agent CLI does a studio job (write a document, scan memory): the
// board's consoles grouped by the CLI they run. Pure: no DOM, no store.

export type AgentConsole = { cardId: string; tabId: string; title: string }

export type AgentChoice = {
  /** Agent kind as stored on the console card (claude, codex, gemini…). */
  agent: string
  /** That CLI's consoles, the most recently used (top-most) first. */
  consoles: AgentConsole[]
}

type ConsoleLike = {
  kind: string
  id: string
  z: number
  title: string
  tabId?: string
  agentKind?: string
}

/** Agent CLIs running on the board, each with its consoles; the current agent's group comes first. */
export function consoleAgentChoices(cards: readonly ConsoleLike[]): AgentChoice[] {
  const consoles = cards
    .filter((c) => c.kind === 'console' && c.tabId && c.agentKind)
    .sort((a, b) => b.z - a.z)
  const byAgent = new Map<string, AgentConsole[]>()
  for (const c of consoles) {
    const list = byAgent.get(c.agentKind!) ?? []
    list.push({ cardId: c.id, tabId: c.tabId!, title: c.title })
    byAgent.set(c.agentKind!, list)
  }
  return [...byAgent].map(([agent, list]) => ({ agent, consoles: list }))
}

/**
 * The console that does the job: the chosen agent's chosen console, else that
 * agent's most recent console. With no choice yet, the current agent (the
 * console used last) is the default.
 */
export function pickAgentConsole(
  choices: readonly AgentChoice[],
  agent: string | null,
  tabId: string | null
): { agent: string; target: AgentConsole } | null {
  const choice = choices.find((c) => c.agent === agent) ?? choices[0]
  if (!choice) {
    return null
  }
  const target = choice.consoles.find((c) => c.tabId === tabId) ?? choice.consoles[0]
  return { agent: choice.agent, target }
}
