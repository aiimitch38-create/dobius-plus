import { toast } from 'sonner'
import type { useConfirmationDialog } from '@/components/confirmation-dialog'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { translate } from '@/i18n/i18n'
import { getAgentLabel } from '@/lib/agent-catalog'
import { useAppStore } from '@/store'
import type { BoardCardOf } from '@/store/slices/board'
import { filterEnabledTuiAgents } from '../../../../../shared/tui-agent-selection'
import type { TuiAgent } from '../../../../../shared/types'
import { frameBoardCards } from '../board-canvas/board-camera-focus'
import {
  boardReplyDraft,
  requestCommandBarPrefill
} from '../board-command-bar/board-command-prefill'
import { consoleDeliveryState } from '../board-delivery/board-delivery'
import { restartConsole } from '../board-delivery/console-lifecycle'
import { pauseResultText, setConsolesPaused } from '../board-delivery/pause-consoles'
import type { BoardCardAction } from '../cards/BoardCardFrame'

type AgentListState = {
  detectedAgentIds: readonly TuiAgent[] | null
  remoteDetectedAgentIds: Readonly<Record<string, readonly TuiAgent[] | null>>
  settings: { disabledTuiAgents?: readonly unknown[] | null } | null
  repos: readonly { id: string; connectionId?: string | null }[]
  getKnownWorktreeById: (worktreeId: string) => { repoId: string } | undefined
}

/**
 * Agents a console can be relaunched as: the same detected-and-enabled list
 * the spawn picker and team composer offer (see use-board-route-data), so the
 * card menu never offers an agent the composer hides.
 */
export function boardSwitchAgents(state: AgentListState, worktreeId: string): TuiAgent[] {
  const repoId = state.getKnownWorktreeById(worktreeId)?.repoId
  const connectionId = state.repos.find((r) => r.id === repoId)?.connectionId ?? null
  const detected = connectionId
    ? state.remoteDetectedAgentIds[connectionId]
    : state.detectedAgentIds
  return filterEnabledTuiAgents(detected ?? [], state.settings?.disabledTuiAgents)
}

type Confirm = ReturnType<typeof useConfirmationDialog>

// Why: restarting or switching ends what the agent is doing, so a busy console
// asks first; an idle one restarts right away.
async function confirmIfRunning(
  confirm: Confirm,
  card: BoardCardOf<'console'>,
  verb: string
): Promise<boolean> {
  const state = consoleDeliveryState(card.tabId)
  if (state !== 'working' && state !== 'waiting' && state !== 'blocked') {
    return true
  }
  return confirm({
    title: translate('board.console.restartTitle', '{{verb}} {{name}}?', {
      verb,
      name: card.title
    }),
    description: translate(
      'board.console.restartBody',
      'It is working right now; its current turn will stop.'
    ),
    confirmLabel: verb,
    confirmVariant: 'destructive'
  })
}

/** Frames these cards on the Board and raises them; false when none are on it. */
export function focusBoardCards(worktreeId: string, cardIds: readonly string[]): boolean {
  return frameBoardCards(worktreeId, cardIds)
}

/** Pause or resume these consoles' agents, reporting the outcome as a toast. */
export async function setConsolesPausedWithToast(
  cards: readonly Pick<BoardCardOf<'console'>, 'tabId' | 'title'>[],
  paused: boolean
): Promise<void> {
  const result = await setConsolesPaused(
    cards.map((c) => ({ tabId: c.tabId, name: c.title })),
    paused
  )
  const summary = pauseResultText(result, paused)
  if (summary.ok) {
    toast.success(summary.text)
  } else {
    toast.error(summary.text)
  }
}

/** Restart in place; asks first only while the agent is mid-turn. */
export function restartConsoleConfirmed(
  worktreeId: string,
  card: BoardCardOf<'console'>,
  confirm: Confirm
): void {
  const restart = translate('board.console.restart', 'Restart')
  void confirmIfRunning(confirm, card, restart).then((ok) => ok && restartConsole(worktreeId, card))
}

/** Ends the agent, closes its terminal and removes its card, always after a confirm. */
export function killConsoleConfirmed(
  worktreeId: string,
  card: BoardCardOf<'console'>,
  confirm: Confirm
): void {
  void confirm({
    title: translate('board.console.closeTitle', 'Close {{name}}?', { name: card.title }),
    description: translate(
      'board.console.closeBody',
      'This ends the agent and closes its terminal.'
    ),
    confirmLabel: translate('board.console.closeConfirm', 'Close agent'),
    confirmVariant: 'destructive'
  }).then((ok) => {
    if (ok) {
      closeTerminalTab(card.tabId)
      useAppStore.getState().removeCards(worktreeId, [card.id])
    }
  })
}

/** Pre-fills the command bar with "@Name " so the next order goes to this console. */
export function replyToConsole(name: string): void {
  requestCommandBarPrefill(boardReplyDraft(name))
}

/** Header menu items for a console card: restart in place, switch agent, reply to it. */
export function consoleActions(
  worktreeId: string,
  card: BoardCardOf<'console'>,
  confirm: Confirm
): BoardCardAction[] {
  return [
    {
      label: translate('board.console.replyTo', 'Reply to {{name}}', { name: card.title }),
      onSelect: () => replyToConsole(card.title)
    },
    {
      label: translate('board.console.restart', 'Restart'),
      onSelect: () => restartConsoleConfirmed(worktreeId, card, confirm)
    },
    ...boardSwitchAgents(useAppStore.getState(), worktreeId)
      .filter((a) => a !== card.agentKind)
      .map((agent) => {
        const label = translate('board.console.switchTo', 'Relaunch as {{agent}}', {
          agent: getAgentLabel(agent)
        })
        return {
          label,
          onSelect: () => {
            void confirmIfRunning(confirm, card, label).then(
              (ok) => ok && restartConsole(worktreeId, card, agent)
            )
          }
        }
      })
  ]
}
