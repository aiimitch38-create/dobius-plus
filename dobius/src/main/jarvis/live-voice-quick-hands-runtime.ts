// The live runtime behind the quick hands: the same terminal list, read and
// send calls `dobius terminal` uses, and the Claude usage store `dobius usage` reads.
import { basename } from 'node:path'
import type {
  RuntimeTerminalRead,
  RuntimeTerminalSummary,
  RuntimeTerminalVisualLayout,
  RuntimeTerminalVisualLayoutNode
} from '../../shared/runtime-types'
import { usageSummaryForRuntime } from '../ipc/usage-access'
import { QuickHandCancelled, QuickHandRefused, type QuickHandsDeps } from './live-voice-quick-hands'
import { branchLabel, cleanTitle, type QuickTerminal } from './live-voice-terminal-target'

/** The runtime calls the quick hands use; the same ones `dobius terminal list/send/read` serve. */
export type QuickHandsRuntime = {
  listTerminals: (
    worktreeSelector?: string,
    limit?: number
  ) => Promise<{
    terminals: RuntimeTerminalSummary[]
    truncated?: boolean
    visualLayouts?: RuntimeTerminalVisualLayout[]
  }>
  readTerminal: (handle: string, opts?: { limit?: number }) => Promise<RuntimeTerminalRead>
  sendTerminal: (
    handle: string,
    action: { text?: string },
    options?: { beforeWrite?: (ptyId: string) => void | Promise<void> }
  ) => Promise<unknown>
  getDriver: (ptyId: string) => { kind: string }
  getTerminalAgentStatus: (
    handle: string
  ) => Promise<{ isRunningAgent: boolean; status: string | null }>
}

const READ_TAIL_LINES = 40
// Why above the runtime's default of 200: a cut-off list makes "type" refuse.
const LIST_LIMIT = 1_000

/**
 * A terminal as the voice names it. Why the tab title first: it is the tab's
 * label as the window resolves it, so Carson's own rename wins there; the
 * pane title (Claude's topic) also answers. A terminal with neither is
 * called by its branch.
 */
export function quickTerminalOf(
  summary: Pick<RuntimeTerminalSummary, 'handle' | 'title' | 'branch' | 'worktreePath'>,
  tabTitle: string | null | undefined
): QuickTerminal {
  const titles = [...new Set([cleanTitle(tabTitle), cleanTitle(summary.title)].filter(Boolean))]
  const labels = titles.length > 0 ? titles : [branchLabel(summary.branch)].filter(Boolean)
  return {
    handle: summary.handle,
    name: labels[0] ?? 'terminal',
    labels,
    project: summary.worktreePath ? basename(summary.worktreePath) : ''
  }
}

/** Tab id -> the tab's title, from the listing's window layouts. */
export function tabTitlesOf(layouts: RuntimeTerminalVisualLayout[] | undefined): Map<string, string> {
  const titles = new Map<string, string>()
  const walk = (node: RuntimeTerminalVisualLayoutNode): void => {
    if (node.type === 'group') {
      for (const tab of node.tabs) {
        if (tab.title) {
          titles.set(tab.tabId, tab.title)
        }
      }
    } else {
      walk(node.first)
      walk(node.second)
    }
  }
  for (const layout of layouts ?? []) {
    walk(layout.root)
  }
  return titles
}

/** Quick hands backed by the live runtime and the Claude usage store. */
export function createRuntimeQuickHands(
  getRuntime: () => QuickHandsRuntime | null
): QuickHandsDeps {
  const runtime = (): QuickHandsRuntime => {
    const current = getRuntime()
    if (!current) {
      throw new QuickHandRefused('runtime not ready')
    }
    return current
  }
  return {
    listTerminals: async () => {
      const result = await runtime().listTerminals(undefined, LIST_LIMIT)
      const tabTitles = tabTitlesOf(result.visualLayouts)
      return {
        truncated: result.truncated === true,
        terminals: result.terminals.map((terminal) =>
          quickTerminalOf(terminal, tabTitles.get(terminal.tabId))
        )
      }
    },
    typeInto: async (handle, text, isCurrent) => {
      const current = runtime()
      let wrote = false
      const refusal = (reason: string, ended = false): Error => {
        if (wrote) {
          return new Error(reason)
        }
        return ended ? new QuickHandCancelled(reason) : new QuickHandRefused(reason)
      }
      // Why checked before every write: the call may end, a phone may take
      // the terminal (desktop input is then locked, as terminal.send rules),
      // or a permission prompt may appear, which typed text must never answer.
      const beforeWrite = async (ptyId: string): Promise<void> => {
        if (!isCurrent()) {
          throw refusal('the call ended', true)
        }
        if (current.getDriver(ptyId).kind === 'mobile') {
          throw refusal('terminal is driven from the phone')
        }
        const agent = await current.getTerminalAgentStatus(handle)
        if (agent.status === 'permission') {
          throw refusal('terminal is waiting on a permission prompt')
        }
        if (!isCurrent()) {
          throw refusal('the call ended', true)
        }
        wrote = true
      }
      try {
        await current.sendTerminal(handle, { text }, { beforeWrite })
      } catch (error) {
        if (wrote || error instanceof QuickHandRefused || error instanceof QuickHandCancelled) {
          throw error
        }
        throw new QuickHandRefused(error instanceof Error ? error.message : String(error))
      }
    },
    readTail: async (handle) =>
      (await runtime().readTerminal(handle, { limit: READ_TAIL_LINES })).tail,
    weekUsage: async () => {
      // Why no rescan (fresh = false): the last scan answers at once; a
      // rescan reads every session log and could take seconds.
      const result = await usageSummaryForRuntime('claude', 'all', '7d', false)
      const summary = result.summary as {
        estimatedCostUsd?: number | null
        sessions?: number
        hasAnyClaudeData?: boolean
      }
      if (!summary.hasAnyClaudeData || typeof summary.estimatedCostUsd !== 'number') {
        return null
      }
      return { costUsd: summary.estimatedCostUsd, sessions: summary.sessions ?? 0 }
    }
  }
}
