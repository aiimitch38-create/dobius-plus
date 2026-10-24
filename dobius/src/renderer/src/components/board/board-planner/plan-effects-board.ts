import { translate } from '@/i18n/i18n'
import { runWorktreeBatchDelete } from '@/components/sidebar/delete-worktree-flow'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import { getBoard, type BoardCard } from '@/store/slices/board'
import { boardSpawnBlockSize } from '../board-canvas/board-spawn-placement'
import {
  BOARD_ZOOM_STEP,
  fitViewportToRects,
  zoomViewportBy,
  type BoardPoint
} from '../board-canvas/board-viewport'
import {
  cleanDeadLanes,
  cleanResultText,
  agentOrDefault,
  consoleByName,
  spawnConsoles
} from '../board-delivery/console-lifecycle'
import { deleteBoardGroupAndConsoles } from '../board-groups/group-lifecycle'
import { presetCatalog } from '../board-presets/preset-catalog'
import { deployPresetPlan, PRESET_DEPLOY_BLOCK } from '../board-presets/preset-deploy'
import { buildCatalogDeployPlan, initialLaneAgents } from '../board-presets/preset-deploy-plan'
import { presetAgentLabel } from '../board-presets/PresetAgentIcon'
import type { BoardStudioId } from '../board-studios/board-studio-ids'
import type { PlanEffects, StepResult } from './plan-execute'
import type { PlanStudio } from './plan-schema'
import { cardEffects } from './plan-effects-cards'
import { gitEffect } from './plan-effects-git'
import { pickWorkspace } from './plan-workspace'
import { getRepoIdFromWorktreeId } from '../../../../../shared/worktree-id'

export type PlanConfirm = (options: {
  title: string
  description?: string
  /** Monospace block, one entry per line. */
  details?: readonly string[]
  confirmLabel?: string
  confirmVariant?: 'default' | 'destructive'
}) => Promise<boolean>

export type BoardEffectsContext = {
  worktreeId: string
  workspaces: readonly { id: string; name: string }[]
  openStudio: (studio: BoardStudioId) => void
  closeStudio: () => void
  /** Center of a free area of the visible board big enough for `block`. */
  freeCenter: (block: { w: number; h: number }) => BoardPoint
  /** The Board's own undo stack (same as Cmd+Z); false when there is nothing to undo. */
  history: { undo: () => boolean; redo: () => boolean }
  /** Asks the user before git and other actions that leave the board. */
  confirm: PlanConfirm
}

export type BoardEffects = Omit<
  PlanEffects,
  'deliver' | 'forward' | 'handoff' | 'lifecycle' | 'cancelLatest' | 'report' | 'loop'
>

const done = (text: string): StepResult => ({ ok: true, text })
const failed = (text: string): StepResult => ({ ok: false, text })
const notBuilt = (what: string): StepResult =>
  failed(translate('board.plan.notBuilt', '{{what}} is not available on the Board yet.', { what }))

const STUDIO_IDS: Partial<Record<PlanStudio, BoardStudioId>> = {
  docs: 'docs',
  code: 'code',
  markdown: 'markdown',
  skills: 'skills',
  loops: 'loops',
  memory: 'memory',
  'mission map': 'mission-map',
  presets: 'presets',
  chat: 'chat',
  settings: 'settings'
}

function rectsOf(cards: readonly BoardCard[]) {
  return cards.map((c) => ({ x: c.x, y: c.y, width: c.w, height: c.h }))
}

export function boardEffects(ctx: BoardEffectsContext): BoardEffects {
  const { worktreeId } = ctx
  const state = () => useAppStore.getState()
  const board = () => getBoard(state(), worktreeId)
  const groupNamed = (name: string) =>
    board().groups.find((g) => g.name.toLowerCase() === name.toLowerCase()) ?? null
  const spawn = (count: number, cli: string | null, role: string | null, brief: string) =>
    spawnConsoles({
      worktreeId,
      agent: agentOrDefault(cli),
      count,
      brief,
      role,
      center: ctx.freeCenter(boardSpawnBlockSize(count))
    })
  const spawnText = (n: number, failedCount: number): StepResult =>
    n > 0
      ? done(translate('board.plan.spawned', 'Started {{count}} console(s).', { count: n }))
      : failed(
          translate('board.plan.spawnFailed', '{{count}} console(s) did not start.', {
            count: failedCount
          })
        )

  return {
    ...cardEffects(ctx),
    spawn: async ({ count, cli, role, group, brief }) => {
      const { cardIds, failed: f } = spawn(count, cli, role, brief)
      if (group && cardIds.length >= 2) {
        state().createGroup(worktreeId, {
          name: group === 'auto' ? presetAgentLabel(agentOrDefault(cli)) : group,
          cardIds
        })
      }
      return spawnText(cardIds.length, f)
    },
    addToGroup: async (name, { count, cli, role, brief }) => {
      const group = groupNamed(name)
      if (!group) {
        return failed(translate('board.plan.noGroup', 'No group named {{name}}.', { name }))
      }
      const { cardIds, failed: f } = spawn(count, cli, role, brief)
      state().addToGroup(worktreeId, group.id, cardIds)
      return spawnText(cardIds.length, f)
    },
    groupAction: async (kind, name, members) => {
      if (kind === 'create_group') {
        const ids = members.flatMap((m) => consoleByName(worktreeId, m)?.id ?? [])
        // Why: a group of one is just a console; the Board requires two.
        if (ids.length < 2) {
          return failed(
            translate('board.plan.groupTooSmall', 'A group needs at least two consoles.')
          )
        }
        state().createGroup(worktreeId, { name, cardIds: ids })
        return done(
          translate('board.plan.grouped', 'Grouped {{count}} consoles as {{name}}.', {
            count: ids.length,
            name
          })
        )
      }
      const group = groupNamed(name)
      if (!group) {
        return failed(translate('board.plan.noGroup', 'No group named {{name}}.', { name }))
      }
      if (kind === 'dissolve_group') {
        state().dissolveGroup(worktreeId, group.id)
        return done(
          translate('board.plan.ungrouped', 'Ungrouped {{name}}; its consoles stay.', {
            name: group.name
          })
        )
      }
      deleteBoardGroupAndConsoles(worktreeId, group.id)
      return done(
        translate('board.plan.groupClosed', 'Closed {{name}} and its {{count}} console(s).', {
          name: group.name,
          count: members.length
        })
      )
    },
    rename: async (target, name) => {
      const card = consoleByName(worktreeId, target)
      if (card) {
        state().updateCard(worktreeId, card.id, { title: name })
        return done(
          translate('board.plan.renamed', 'Renamed {{from}} to {{to}}.', { from: target, to: name })
        )
      }
      const group = groupNamed(target)
      if (group) {
        state().updateGroup(worktreeId, group.id, { name })
        return done(
          translate('board.plan.renamed', 'Renamed {{from}} to {{to}}.', { from: target, to: name })
        )
      }
      return failed(translate('board.plan.noTarget', 'No matching console on the board.'))
    },
    cleanBoard: async () => done(cleanResultText(await cleanDeadLanes(worktreeId))),
    deployPreset: async (name) => {
      const preset = presetCatalog().find((p) => p.name.toLowerCase() === name.toLowerCase())
      if (!preset) {
        return failed(translate('board.plan.noPreset', 'No preset named {{name}}.', { name }))
      }
      const center = ctx.freeCenter(PRESET_DEPLOY_BLOCK)
      const plan = buildCatalogDeployPlan(preset, initialLaneAgents(preset.lanes), center, {
        newId: () => crypto.randomUUID(),
        agentLabel: presetAgentLabel
      })
      const { failed: f } = await deployPresetPlan(plan, worktreeId, (late) =>
        console.warn(`[board-planner] ${late} preset console(s) never appeared`)
      )
      return done(
        translate(
          'board.plan.deployed',
          'Deployed {{name}} ({{count}} consoles, {{failed}} failed).',
          { name: preset.name, count: plan.consoles.length, failed: f }
        )
      )
    },
    camera: async (kind, consoles) => {
      const vp = board().viewport
      const size = { width: window.innerWidth, height: window.innerHeight }
      const center = { x: size.width / 2, y: size.height / 2 }
      if (kind === 'fit_view' || kind === 'focus') {
        const cards =
          consoles === null
            ? board().cards
            : consoles.flatMap((n) => consoleByName(worktreeId, n) ?? [])
        if (cards.length === 0) {
          return failed(translate('board.plan.nothingToFit', 'Nothing to frame.'))
        }
        state().setViewport(worktreeId, fitViewportToRects(rectsOf(cards), size))
        return done(
          translate('board.plan.framed', 'Framed {{count}} card(s).', { count: cards.length })
        )
      }
      const factor =
        kind === 'zoom_in'
          ? BOARD_ZOOM_STEP
          : kind === 'zoom_out'
            ? 1 / BOARD_ZOOM_STEP
            : 1 / vp.zoom
      state().setViewport(worktreeId, zoomViewportBy(vp, factor, center))
      return done(translate('board.plan.zoomed', 'Zoomed.'))
    },
    openStudio: async (target) => {
      const id = STUDIO_IDS[target]
      if (!id) {
        return notBuilt(target)
      }
      ctx.openStudio(id)
      return done(translate('board.plan.opened', 'Opened {{name}}.', { name: target }))
    },
    closePanel: async () => {
      ctx.closeStudio()
      return done(translate('board.plan.closed', 'Closed the panel.'))
    },
    history: async (kind) => {
      const changed = kind === 'undo' ? ctx.history.undo() : ctx.history.redo()
      if (!changed) {
        return failed(
          kind === 'undo'
            ? translate('board.plan.nothingToUndo', 'Nothing to undo.')
            : translate('board.plan.nothingToRedo', 'Nothing to redo.')
        )
      }
      return done(
        kind === 'undo'
          ? translate('board.plan.undone', 'Undid the last board change.')
          : translate('board.plan.redone', 'Redid the last board change.')
      )
    },
    pickTool: async (tool) => {
      state().setTool(worktreeId, tool)
      return done(translate('board.plan.tool', 'Switched to {{tool}}.', { tool }))
    },
    setTheme: async (theme) => {
      await state().updateSettings({ theme })
      return done(translate('board.plan.theme', 'Theme set to {{theme}}.', { theme }))
    },
    workspace: async (kind, target, text) => {
      if (kind === 'new') {
        state().openModal('new-workspace-composer', {
          initialRepoId: getRepoIdFromWorktreeId(worktreeId),
          telemetrySource: 'sidebar'
        })
        return done(translate('board.plan.newWorkspace', 'Opened New workspace.'))
      }
      const pick = target ? pickWorkspace(ctx.workspaces, worktreeId, target) : undefined
      if (!pick) {
        return failed(
          translate('board.plan.noWorkspace', 'No workspace {{name}}.', { name: target ?? '' })
        )
      }
      if (kind === 'rename') {
        const name = text?.trim()
        if (!name) {
          return failed(translate('board.plan.renameNeedsName', 'Say the new name.'))
        }
        await state().updateWorktreeMeta(pick.id, { displayName: name })
        return done(
          translate('board.plan.renamed', 'Renamed {{from}} to {{to}}.', {
            from: pick.name,
            to: name
          })
        )
      }
      if (kind === 'close') {
        // Why: removing a workspace deletes its folder; always use Classic's own
        // delete dialog (forced on) so the user confirms with its full warnings.
        runWorktreeBatchDelete([pick.id], { forceConfirm: true })
        return done(
          translate('board.plan.closeAsked', 'Asked to confirm removing {{name}}.', {
            name: pick.name
          })
        )
      }
      activateAndRevealWorktree(pick.id, { keepView: true })
      return done(translate('board.plan.switched', 'Switched to {{name}}.', { name: pick.name }))
    },
    git: gitEffect(worktreeId, ctx.confirm)
  }
}
