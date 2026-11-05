import type { DobiusAwarenessClient, DobiusTerminal, DobiusWorktreeStatus } from '../adapters/dobius.js'

export interface TerminalDiscoveryClient extends DobiusAwarenessClient {
  terminalList(limit?: number, worktree?: string): Promise<{ terminals: DobiusTerminal[] }>
  terminalShow(handle: string): Promise<{ terminal: DobiusTerminal }>
}

export type ResolvedTerminal = {
  terminalHandle: string
  worktreeId: string
  worktreePath: string
  title: string
  branch: string | null
  agentState: string | null
  confidence: number
}

export class AmbiguousTerminalError extends Error {
  constructor(readonly candidates: ResolvedTerminal[]) {
    super(`Terminal target is ambiguous: ${candidates.length} candidates`)
  }
}

const normalized = (value: unknown): string => String(value ?? '').trim().toLowerCase()

export class ProjectTerminalResolver {
  constructor(private readonly client: TerminalDiscoveryClient) {}

  async resolve(input: { terminalHandle?: string; projectQuery?: string; terminalQuery?: string }): Promise<ResolvedTerminal> {
    if (input.terminalHandle) {
      const [shown, live] = await Promise.all([this.client.terminalShow(input.terminalHandle), this.client.worktreePs(100)])
      return this.toResolved(shown.terminal, live.worktrees, input)
    }
    const [terminalResult, live] = await Promise.all([this.client.terminalList(100), this.client.worktreePs(100)])
    const projectQuery = normalized(input.projectQuery)
    const terminalQuery = normalized(input.terminalQuery)
    const candidates = terminalResult.terminals
      .filter((terminal) => terminal.connected !== false && terminal.writable !== false)
      .filter((terminal) => !input.terminalHandle || terminal.handle === input.terminalHandle)
      .filter((terminal) => !projectQuery || [terminal.worktreePath, terminal.worktreeId, terminal.branch]
        .some((value) => normalized(value).includes(projectQuery)))
      .filter((terminal) => !terminalQuery || [terminal.title, terminal.handle]
        .some((value) => normalized(value).includes(terminalQuery)))
      .map((terminal) => this.toResolved(terminal, live.worktrees, input))
      .sort((left, right) => right.confidence - left.confidence || left.terminalHandle.localeCompare(right.terminalHandle))

    if (!candidates.length) throw new Error('No writable terminal matches the requested target')
    if (candidates.length > 1 && candidates[0]!.confidence === candidates[1]!.confidence) {
      throw new AmbiguousTerminalError(candidates.slice(0, 10))
    }
    return candidates[0]!
  }

  private toResolved(
    terminal: DobiusTerminal,
    worktrees: DobiusWorktreeStatus[],
    input: { terminalHandle?: string; projectQuery?: string; terminalQuery?: string }
  ): ResolvedTerminal {
    const tabId = normalized(terminal.tabId)
    const worktree = worktrees.find((item) => item.worktreeId === terminal.worktreeId)
    const agent = worktree?.agents.find((item) => normalized(item.paneKey).startsWith(`${tabId}:`))
    let confidence = 0.5
    if (input.terminalHandle && terminal.handle === input.terminalHandle) confidence = 1
    else {
      if (input.projectQuery && normalized(terminal.worktreePath).includes(normalized(input.projectQuery))) confidence += 0.2
      if (input.terminalQuery && normalized(terminal.title).includes(normalized(input.terminalQuery))) confidence += 0.2
    }
    return {
      terminalHandle: terminal.handle,
      worktreeId: String(terminal.worktreeId ?? ''),
      worktreePath: String(terminal.worktreePath ?? ''),
      title: String(terminal.title ?? ''),
      branch: terminal.branch ? String(terminal.branch) : null,
      agentState: agent?.state ?? null,
      confidence
    }
  }
}
