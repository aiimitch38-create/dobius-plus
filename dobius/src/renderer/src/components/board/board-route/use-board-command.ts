import { useCallback } from 'react'
import { useConfirmationDialog } from '@/components/confirmation-dialog'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../../shared/agent-status-types'
import { buildBoardConductorTranscript } from '../board-command-bar/board-conductor-context'
import {
  parseBoardMention,
  type BoardMention,
  type BoardMentionTarget
} from '../board-command-bar/board-mention'
import { deliverOrder } from '../board-delivery/board-delivery'
import { concernText } from '../board-planner/plan-concern-text'
import { suggestMention } from '../board-planner/plan-did-you-mean'
import { riskyTextConcerns } from '../board-planner/plan-safety'
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
  const confirm = useConfirmationDialog()

  // Why: every typed message goes through the one delivery queue, so it never
  // interleaves with another send and waits while a console is on a dialog.
  const relay = useCallback(
    async (tabIds: readonly string[], message: string) => {
      if (!worktreeId) {
        return
      }
      // Why: text typed straight at a console skips the planner, so the same risky-text screen runs here.
      const concerns = riskyTextConcerns(message, null)
      if (concerns.length > 0) {
        const ok = await confirm({
          title: translate('board.plan.confirmTitle', 'Go ahead with this?'),
          description: concerns.map(concernText).join('\n'),
          confirmLabel: translate('board.plan.confirmAction', 'Confirm')
        })
        if (!ok) {
          append({ role: 'system', text: translate('board.plan.notSent', 'Nothing was sent.') })
          return
        }
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
    [append, confirm, consoles, worktreeId]
  )

  const relayMention = useCallback(
    (mention: BoardMention) => {
      const group = board.groups.find((g) => `group:${g.id}` === mention.target.id)
      const tabIds = group
        ? consoles.filter((c) => group.cardIds.includes(c.id)).map((c) => c.tabId)
        : consoles.filter((c) => c.id === mention.target.id).map((c) => c.tabId)
      void relay(tabIds, mention.message)
    },
    [board.groups, consoles, relay]
  )

  // "@Clade 1 ..." asks "Did you mean Claude 1?" and sends only on a yes.
  const confirmNearMention = useCallback(
    async (
      text: string,
      suggestion: { name: string; message: string },
      targets: readonly BoardMentionTarget[]
    ) => {
      append({ role: 'user', text })
      const target = targets.find((t) => t.name === suggestion.name)
      const ok =
        target &&
        (await confirm({
          title: translate('board.plan.didYouMeanTitle', 'Did you mean {{name}}?', {
            name: suggestion.name
          }),
          description: suggestion.message.slice(0, 200),
          confirmLabel: translate('board.plan.didYouMeanAction', 'Use {{name}}', {
            name: suggestion.name
          })
        }))
      if (!target || !ok) {
        append({ role: 'system', text: translate('board.plan.notSent', 'Nothing was sent.') })
        return
      }
      relayMention({ target, message: suggestion.message })
    },
    [append, confirm, relayMention]
  )

  return useCallback(
    (text: string) => {
      const groups = board.groups.map((g) => ({ id: `group:${g.id}`, name: g.name }))
      const targets = [...consoles.map((c) => ({ id: c.id, name: c.title })), ...groups]
      const mention = parseBoardMention(text, targets)
      if (mention) {
        append({ role: 'user', text })
        relayMention(mention)
        return
      }
      const near = suggestMention(
        text,
        targets.map((t) => t.name)
      )
      if (near) {
        void confirmNearMention(text, near, targets)
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
    [
      append,
      ask,
      board.groups,
      confirmNearMention,
      consoles,
      planner,
      relayMention,
      workspaces,
      worktreeId
    ]
  )
}
