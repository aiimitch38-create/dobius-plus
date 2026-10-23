import { useCallback } from 'react'
import { useAppStore } from '@/store'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../../shared/agent-status-types'
import { buildBoardConductorTranscript } from '../board-command-bar/board-conductor-context'
import { parseBoardMention } from '../board-command-bar/board-mention'
import { deliverOrder } from '../board-delivery/board-delivery'
import { boardConsoleState } from './board-console-activity'
import type { BoardConductor } from './use-board-conductor'
import type { BoardRouteData } from './use-board-route-data'

/**
 * "@Name text" relays straight to that console (or every console in that group)
 * through the guarded send path; anything else goes to the Voice Conductor with
 * a plain-text summary of the board.
 */
export function useBoardCommand(
  data: BoardRouteData,
  conductor: BoardConductor,
  /** Typed planner; when given it handles everything except direct @mentions. */
  planner?: (text: string) => Promise<void>
): (text: string) => void {
  const { worktreeId, board, consoles, workspaces } = data
  const { append, ask } = conductor

  // Why: every typed message goes through the one delivery queue, so it never
  // interleaves with another send and waits while a console is on a dialog.
  const relay = useCallback(
    async (tabIds: readonly string[], message: string) => {
      if (!worktreeId) {
        return
      }
      const lanes = tabIds.map((tabId) => ({
        tabId,
        name: consoles.find((c) => c.tabId === tabId)?.title ?? tabId,
        text: message
      }))
      const result = await deliverOrder({ worktreeId, summary: message, lanes })
      append({
        role: 'system',
        ...(result.ok ? {} : { tone: 'error' as const }),
        text: result.text
      })
    },
    [append, consoles, worktreeId]
  )

  return useCallback(
    (text: string) => {
      const groups = board.groups.map((g) => ({ id: `group:${g.id}`, name: g.name }))
      const targets = [...consoles.map((c) => ({ id: c.id, name: c.title })), ...groups]
      const mention = parseBoardMention(text, targets)
      if (mention) {
        append({ role: 'user', text })
        const group = board.groups.find((g) => `group:${g.id}` === mention.target.id)
        const tabIds = group
          ? consoles.filter((c) => group.cardIds.includes(c.id)).map((c) => c.tabId)
          : consoles.filter((c) => c.id === mention.target.id).map((c) => c.tabId)
        void relay(tabIds, mention.message)
        return
      }
      if (planner) {
        void planner(text)
        return
      }
      const state = useAppStore.getState()
      const activity = {
        agentStatusByPaneKey: state.agentStatusByPaneKey,
        acknowledgedAgentsByPaneKey: state.acknowledgedAgentsByPaneKey,
        now: Date.now(),
        staleAfterMs: AGENT_STATUS_STALE_AFTER_MS
      }
      const byId = new Map(consoles.map((c) => [c.id, c.title]))
      const transcript = buildBoardConductorTranscript(
        {
          workspace: workspaces.find((w) => w.id === worktreeId)?.name ?? worktreeId ?? '',
          consoles: consoles.map((c) => ({
            name: c.title,
            agent: c.agentKind,
            status: boardConsoleState(c.tabId, activity)
          })),
          groups: board.groups.map((g) => ({
            name: g.name,
            members: g.cardIds.flatMap((id) => byId.get(id) ?? [])
          }))
        },
        text
      )
      void ask(text, transcript)
    },
    [append, ask, board.groups, consoles, planner, relay, workspaces, worktreeId]
  )
}
