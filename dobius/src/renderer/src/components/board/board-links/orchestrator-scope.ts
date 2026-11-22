// What an orchestrator card may do with a typed message. Each refusal executes
// nothing; the main command bar keeps workspace and undo/redo actions.
import { translate } from '@/i18n/i18n'
import type { OrchestratorRoute } from '../../../../../shared/board-orchestrator-relay'

// Why shared: `dobius orchestration send --to board:<id>` routes in main exactly like the card.
export {
  routeOrchestratorMessage,
  type OrchestratorRoute,
  type ScopedConsole
} from '../../../../../shared/board-orchestrator-relay'

export function orchestratorRefusalText(
  reason: Extract<OrchestratorRoute, { kind: 'refuse' }>['reason']
): string {
  switch (reason) {
    case 'outside-scope':
      return translate(
        'board.orchestrator.refuseScope',
        'That console isn’t wired to this card, so nothing was sent. Tap Connect to wire it.'
      )
    case 'ambiguous':
      return translate(
        'board.orchestrator.refuseAmbiguous',
        'Several wired consoles have that name, so nothing was sent. Rename one first.'
      )
    case 'workspace':
      return translate(
        'board.orchestrator.refuseWorkspace',
        'Workspaces are managed from the main command bar, not from an orchestrator card.'
      )
    case 'undo':
      return translate(
        'board.orchestrator.refuseUndo',
        'Undo and redo work from the main command bar only.'
      )
    case 'nothing-wired':
      return translate(
        'board.orchestrator.refuseNothingWired',
        'No consoles are wired yet. Tap Connect, or spawn one with +.'
      )
  }
}
