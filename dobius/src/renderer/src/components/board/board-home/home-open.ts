import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { BOARD_CHROME_INSETS } from '../board-canvas/board-reveal'
import { boardFreeSpawnCenter } from '../board-canvas/board-spawn-placement'
import { screenToWorld, type BoardPoint } from '../board-canvas/board-viewport'
import type { BoardPreset } from '../board-presets/board-preset'
import { presetCatalog } from '../board-presets/preset-catalog'
import { deployPresetPlan, PRESET_DEPLOY_BLOCK } from '../board-presets/preset-deploy'
import {
  buildCatalogDeployPlan,
  buildUserDeployPlan,
  initialLaneAgents,
  userPresetAgents,
  userPresetLanes,
  type DeployPlan
} from '../board-presets/preset-deploy-plan'
import { presetAgentLabel } from '../board-presets/PresetAgentIcon'

export type HomePresetChoice =
  | { kind: 'catalog'; id: string }
  | { kind: 'user'; preset: BoardPreset }
  | null

type Confirm = (options: {
  title: string
  description?: string
  confirmLabel?: string
}) => Promise<boolean>

// Same free-spot rule the Board uses for spawns (BoardRoute.freeCenter), read
// from the target workspace's saved board since the Board is not mounted yet.
function freeCenterFor(worktreeId: string, block: { w: number; h: number }): BoardPoint {
  const board = getBoard(useAppStore.getState(), worktreeId)
  const v = board.viewport
  const inset = BOARD_CHROME_INSETS
  const topLeft = screenToWorld({ x: inset.left, y: inset.top }, v)
  const bottomRight = screenToWorld(
    { x: window.innerWidth - inset.right, y: window.innerHeight - inset.bottom },
    v
  )
  return boardFreeSpawnCenter(
    { x: topLeft.x, y: topLeft.y, w: bottomRight.x - topLeft.x, h: bottomRight.y - topLeft.y },
    block,
    board.cards
  )
}

function buildPlan(choice: Exclude<HomePresetChoice, null>, worktreeId: string): DeployPlan | null {
  const center = freeCenterFor(worktreeId, PRESET_DEPLOY_BLOCK)
  const newId = (): string => crypto.randomUUID()
  if (choice.kind === 'catalog') {
    const preset = presetCatalog().find((p) => p.id === choice.id)
    return preset
      ? buildCatalogDeployPlan(preset, initialLaneAgents(preset.lanes), center, {
          newId,
          agentLabel: presetAgentLabel
        })
      : null
  }
  const lanes = userPresetLanes(
    choice.preset,
    translate('board.presets.ungrouped', 'Loose consoles')
  )
  return buildUserDeployPlan(choice.preset, lanes, userPresetAgents(choice.preset, lanes), center, {
    newId
  })
}

/**
 * Opens a workspace on the Board, then (optionally) deploys a preset into it
 * through the same plan + deploy path as the Presets studio, including its
 * "Start N consoles?" confirmation. Returns false when nothing was opened.
 */
export async function openWorkspaceOnBoard(
  worktreeId: string | null,
  choice: HomePresetChoice,
  confirm: Confirm
): Promise<boolean> {
  if (!worktreeId) {
    toast.message(translate('board.topBar.noWorkspaces', 'That project has no workspaces yet.'))
    return false
  }
  let plan: DeployPlan | null = null
  if (choice) {
    // Plan against the target board before switching, so the confirm shows on Home.
    plan = buildPlan(choice, worktreeId)
    if (plan?.needsConfirm) {
      const ok = await confirm({
        title: translate('board.presets.confirmTitle', 'Start {{count}} consoles?', {
          count: plan.consoles.length
        }),
        description: translate(
          'board.presets.confirmBody',
          'Each console launches its own agent, which uses your plan limits and machine resources.'
        ),
        confirmLabel: translate('board.presets.confirmAction', 'Start {{count}}', {
          count: plan.consoles.length
        })
      })
      if (!ok) {
        return false
      }
    }
  }
  if (activateAndRevealWorktree(worktreeId, { keepView: true }) === false) {
    toast.error(translate('board.home.openFailed', 'That workspace could not be opened.'))
    return false
  }
  useAppStore.getState().setActiveView('board')
  if (plan) {
    const total = plan.consoles.length
    const reportFailed = (failed: number): void => {
      toast.error(
        translate('board.presets.partial', '{{failed}} of {{count}} consoles did not start.', {
          failed,
          count: total
        })
      )
    }
    try {
      const { failed } = await deployPresetPlan(plan, worktreeId, reportFailed)
      if (failed > 0) {
        reportFailed(failed)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }
  return true
}
