import { createNewTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { useAppStore } from '@/store'
import { fitViewportToRects } from '../board-canvas/board-viewport'
import { awaitMirroredConsoleTabs } from '../board-route/board-await-mirrored-tabs'
import type { DeployPlan, PlanConsole } from './preset-deploy-plan'

// Why: each launch starts a PTY and an agent CLI; starting 16 at once stalls
// the machine, so consoles spawn a few at a time.
const SPAWN_BATCH = 4
const SPAWN_BATCH_PAUSE_MS = 250

/** World-space room a deployed preset is centered in (clear of cards and the Thread). */
export const PRESET_DEPLOY_BLOCK = { w: 2400, h: 1400 }

function newTabIdAfter(worktreeId: string, before: ReadonlySet<string>): string | null {
  const tabs = useAppStore.getState().tabsByWorktree[worktreeId] ?? []
  return tabs.find((t) => !before.has(t.id))?.id ?? null
}

type SpawnOutcome = 'placed' | 'pending' | 'failed'

function spawnConsole(
  worktreeId: string,
  c: PlanConsole,
  onLateFailure: (count: number) => void
): SpawnOutcome {
  const state = useAppStore.getState()
  const card = {
    id: c.cardId,
    kind: 'console' as const,
    ...c.rect,
    title: c.title,
    agentKind: c.agent
  }
  const before = new Set((state.tabsByWorktree[worktreeId] ?? []).map((t) => t.id))
  if (c.agent === 'shell') {
    createNewTerminalTab(worktreeId)
    const tabId = newTabIdAfter(worktreeId, before)
    if (!tabId) {
      return 'failed'
    }
    state.addCard(worktreeId, { ...card, tabId })
    return 'placed'
  }
  const result = launchAgentInNewTab({ agent: c.agent, worktreeId, launchSource: 'unknown' })
  if (!result) {
    return 'failed'
  }
  if (result.tabId) {
    state.addCard(worktreeId, { ...card, tabId: result.tabId })
    return 'placed'
  }
  // Host-backed launch: the card appears once the mirrored tab arrives.
  awaitMirroredConsoleTabs({
    worktreeId,
    agent: c.agent,
    knownBefore: before,
    pending: [card],
    onUnbound: onLateFailure
  })
  return 'pending'
}

/**
 * Executes a deploy plan: consoles first (so groups and wiring only reference
 * cards that exist), then groups, extras, and a camera fit over the result.
 * Returns how many consoles failed to start.
 */
export async function deployPresetPlan(
  plan: DeployPlan,
  worktreeId: string,
  /** Host-backed consoles that never showed up (reported after Deploy returns). */
  onLateFailure: (count: number) => void
): Promise<{ failed: number }> {
  const placed = new Set<string>()
  let failed = 0
  for (let i = 0; i < plan.consoles.length; i += SPAWN_BATCH) {
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, SPAWN_BATCH_PAUSE_MS))
    }
    for (const c of plan.consoles.slice(i, i + SPAWN_BATCH)) {
      const outcome = spawnConsole(worktreeId, c, onLateFailure)
      if (outcome === 'failed') {
        failed += 1
      } else {
        placed.add(c.cardId)
      }
    }
  }
  const state = useAppStore.getState()
  for (const extra of plan.extras) {
    state.addCard(
      worktreeId,
      extra.kind === 'orchestrator'
        ? { ...extra, wiredCardIds: extra.wiredCardIds.filter((id) => placed.has(id)) }
        : extra
    )
  }
  for (const group of plan.groups) {
    // Why: createGroup keeps only cards already on the board; pending host
    // launches join the board later without their frame.
    if (group.cardIds.some((id) => placed.has(id))) {
      state.createGroup(worktreeId, {
        name: group.name,
        color: group.color,
        cardIds: group.cardIds
      })
    }
  }
  const rects = [...plan.consoles.map((c) => c.rect), ...plan.extras]
  state.setViewport(
    worktreeId,
    fitViewportToRects(
      rects.map((r) => ({ x: r.x, y: r.y, width: r.w, height: r.h })),
      { width: window.innerWidth, height: window.innerHeight }
    )
  )
  return { failed }
}
