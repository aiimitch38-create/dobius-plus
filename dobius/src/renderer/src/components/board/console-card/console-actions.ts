import type { useConfirmationDialog } from '@/components/confirmation-dialog'
import { translate } from '@/i18n/i18n'
import { getAgentLabel } from '@/lib/agent-catalog'
import type { BoardCardOf } from '@/store/slices/board'
import type { TuiAgent } from '../../../../../shared/types'
import { consoleDeliveryState } from '../board-delivery/board-delivery'
import { restartConsole } from '../board-delivery/console-lifecycle'
import type { BoardCardAction } from '../cards/BoardCardFrame'

const SWITCH_AGENTS: readonly TuiAgent[] = ['claude', 'codex', 'gemini', 'opencode', 'grok']

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

/** Header menu items for a console card: restart in place and switch agent. */
export function consoleActions(
  worktreeId: string,
  card: BoardCardOf<'console'>,
  confirm: Confirm
): BoardCardAction[] {
  const restart = translate('board.console.restart', 'Restart')
  return [
    {
      label: restart,
      onSelect: () => {
        void confirmIfRunning(confirm, card, restart).then(
          (ok) => ok && restartConsole(worktreeId, card)
        )
      }
    },
    ...SWITCH_AGENTS.filter((a) => a !== card.agentKind).map((agent) => {
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
