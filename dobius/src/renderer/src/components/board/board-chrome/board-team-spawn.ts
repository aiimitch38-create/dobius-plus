import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { getAgentLabel } from '@/lib/agent-catalog'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { isTuiAgent } from '../../../../../shared/tui-agent-config'
import { animateBoardViewport, boardRevealBlockViewport } from '../board-canvas/board-camera'
import { BOARD_CONSOLE_SIZE, boardSpawnPlacements } from '../board-canvas/board-spawn-placement'
import type { BoardPoint } from '../board-canvas/board-viewport'
import { spawnConsoles } from '../board-delivery/console-lifecycle'
import { groupBoardCards, groupableCardIds } from '../board-route/board-groupable'
import type { TeamSlot } from './team-composer'

// Why: a failed spawn must be read, so it outlives sonner's 4 s default (the
// QA run screenshotted 5 s after Spawn and saw no message at all).
const SPAWN_FAILURE_TOAST_MS = 12_000
/** A console whose terminal is gone within this window "died on launch". */
export const EARLY_EXIT_WINDOW_MS = 15_000

export type TeamLaunchOutcome = {
  cardIds: string[]
  failed: number
  /** First failure's reason in plain words, or null when nothing failed. */
  reason: string | null
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Launches one console per slot; never throws — every failure is counted with a reason. */
export function launchTeam(
  worktreeId: string,
  slots: readonly TeamSlot[],
  center: BoardPoint
): TeamLaunchOutcome {
  const cardIds: string[] = []
  let failed = 0
  let reason: string | null = null
  boardSpawnPlacements(center, slots.length).forEach((position, i) => {
    const slot = slots[i]
    try {
      const result = spawnConsoles({
        worktreeId,
        agent: slot.agent,
        count: 1,
        brief: null,
        role: slot.role,
        center: {
          x: position.x + BOARD_CONSOLE_SIZE.w / 2,
          y: position.y + BOARD_CONSOLE_SIZE.h / 2
        }
      })
      cardIds.push(...result.cardIds)
      if (result.failed > 0) {
        failed += result.failed
        reason ??= translate(
          'board.team.reason.noLaunch',
          '{{agent}} could not be launched. Check that it is installed and its command in Settings > Agents.',
          { agent: getAgentLabel(slot.agent) }
        )
      }
    } catch (error) {
      console.error('[board-team] console spawn failed', error)
      failed += 1
      reason ??= errorText(error)
    }
  })
  return { cardIds, failed, reason }
}

/** Every outcome gets a toast: success, partial failure, or total failure with its reason. */
export function reportTeamLaunch(
  outcome: TeamLaunchOutcome,
  requested: number,
  name: string | null
): void {
  const started = outcome.cardIds.length
  const reason = outcome.reason ?? translate('board.team.reason.unknown', 'Unknown error.')
  if (started === 0) {
    toast.error(
      translate('board.team.failedAll', 'The team did not start: {{reason}}', { reason }),
      { duration: SPAWN_FAILURE_TOAST_MS }
    )
    return
  }
  if (outcome.failed > 0) {
    toast.error(
      translate(
        'board.team.failedSome',
        '{{failed}} of {{count}} consoles did not start: {{reason}}',
        { failed: outcome.failed, count: requested, reason }
      ),
      { duration: SPAWN_FAILURE_TOAST_MS }
    )
    return
  }
  toast.success(
    name
      ? translate('board.team.started', 'Started {{name}}: {{count}} consoles.', {
          name,
          count: started
        })
      : translate('board.team.startedUnnamed', 'Started a team of {{count}} consoles.', {
          count: started
        })
  )
}

/**
 * Warns when a just-spawned console's terminal disappears right away (its
 * agent command exited), instead of leaving a silent "Terminal closed" card.
 * Stops watching after `EARLY_EXIT_WINDOW_MS`. Returns the stop function.
 */
export function watchEarlyExits(worktreeId: string, cardIds: readonly string[]): () => void {
  const pending = new Set(cardIds)
  let stopped = false
  let unsubscribe: () => void = () => undefined
  let timer: ReturnType<typeof setTimeout> | null = null
  const stop = (): void => {
    if (stopped) {
      return
    }
    stopped = true
    unsubscribe()
    if (timer) {
      clearTimeout(timer)
    }
  }
  const check = (): void => {
    const state = useAppStore.getState()
    const liveTabs = new Set((state.tabsByWorktree[worktreeId] ?? []).map((t) => t.id))
    for (const card of getBoard(state, worktreeId).cards) {
      if (!pending.has(card.id) || card.kind !== 'console' || liveTabs.has(card.tabId)) {
        continue
      }
      pending.delete(card.id)
      toast.error(
        translate(
          'board.team.earlyExit',
          '{{name}} closed right after it started. Check the {{agent}} command in Settings > Agents, then restart it from the card menu.',
          {
            name: card.title,
            agent:
              card.agentKind && isTuiAgent(card.agentKind)
                ? getAgentLabel(card.agentKind)
                : card.title
          }
        ),
        { duration: SPAWN_FAILURE_TOAST_MS }
      )
    }
    if (pending.size === 0) {
      stop()
    }
  }
  unsubscribe = useAppStore.subscribe((state, prev) => {
    if (state.tabsByWorktree !== prev.tabsByWorktree) {
      check()
    }
  })
  timer = setTimeout(stop, EARLY_EXIT_WINDOW_MS)
  return stop
}

/**
 * Spawns one console per slot (its agent and role) as a block at `center`,
 * then frames them as one group named `name` (default "Group N"). No brief is
 * typed: each agent starts empty. Always reports the outcome as a toast and
 * returns the new card ids (empty when nothing started).
 */
export function spawnTeamOnBoard(
  worktreeId: string | null,
  slots: readonly TeamSlot[],
  center: BoardPoint,
  name: string | null = null
): string[] {
  if (!worktreeId) {
    toast.error(translate('board.spawn.noWorkspace', 'Open a workspace before spawning consoles.'))
    return []
  }
  const outcome = launchTeam(worktreeId, slots, center)
  reportTeamLaunch(outcome, slots.length, name)
  if (outcome.cardIds.length === 0) {
    return []
  }
  try {
    groupTeam(worktreeId, outcome.cardIds, name)
  } catch (error) {
    console.error('[board-team] grouping failed', error)
    toast.error(
      translate(
        'board.team.groupFailed',
        'The consoles started but could not be grouped: {{reason}}',
        { reason: errorText(error) }
      )
    )
  }
  revealTeam(worktreeId, outcome.cardIds)
  watchEarlyExits(worktreeId, outcome.cardIds)
  return outcome.cardIds
}

/** Room kept around the block for its group frame and title. */
const REVEAL_MARGIN = 48

/**
 * Brings the new block fully into the safe area (inside rails, top bar and
 * command bar). Why: when the view is full the free-spot scan falls back to
 * the right of the rightmost card, which landed the team under the right rail.
 */
export function revealTeam(worktreeId: string, cardIds: readonly string[]): void {
  const state = useAppStore.getState()
  const board = getBoard(state, worktreeId)
  const ids = new Set(cardIds)
  const cards = board.cards.filter((c) => ids.has(c.id))
  if (cards.length === 0) {
    return
  }
  const minX = Math.min(...cards.map((c) => c.x)) - REVEAL_MARGIN
  const minY = Math.min(...cards.map((c) => c.y)) - REVEAL_MARGIN
  const maxX = Math.max(...cards.map((c) => c.x + c.w)) + REVEAL_MARGIN
  const maxY = Math.max(...cards.map((c) => c.y + c.h)) + REVEAL_MARGIN
  const size = { width: window.innerWidth, height: window.innerHeight }
  const target = boardRevealBlockViewport(
    board.viewport,
    { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    size
  )
  if (target !== board.viewport) {
    animateBoardViewport(board.viewport, target, (v) => state.setViewport(worktreeId, v), { size })
  }
}

function groupTeam(worktreeId: string, cardIds: readonly string[], name: string | null): void {
  if (!name) {
    groupBoardCards(worktreeId, new Set(cardIds))
    return
  }
  // Why: same rule as the Group chip (two or more live cards), read from the
  // live board so just-spawned cards count; only the name differs.
  const state = useAppStore.getState()
  const ids = groupableCardIds(getBoard(state, worktreeId).cards, new Set(cardIds))
  if (ids) {
    state.createGroup(worktreeId, { name, cardIds: ids })
  }
}
