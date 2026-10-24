import { sendNotesToActiveAgentSession } from '@/lib/active-agent-note-send'
import { activeAgentNotesSendFailureMessage } from '@/lib/active-agent-note-send-result'
import { useAppStore } from '@/store'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../../shared/agent-status-types'
import { boardConsoleState } from '../board-route/board-console-activity'
import { resolveConsoleLeafId } from '../console-card/console-card-status'
import { isConsolePaused } from './board-pause'
import { recordOrder, updateOrderLane } from './board-orders'
import { DeliveryGate, type ConsoleDeliveryState, type DeliveryOutcome } from './delivery-gate'
import { summarizeDelivery } from './delivery-summary'
import { newMission } from './mission-state'
import { trackMission } from './mission-tracker'

function ownerWorktree(tabId: string): string | null {
  const byWorktree = useAppStore.getState().tabsByWorktree
  for (const [worktreeId, tabs] of Object.entries(byWorktree)) {
    if (tabs.some((t) => t.id === tabId)) {
      return worktreeId
    }
  }
  return null
}

export function consoleDeliveryState(tabId: string): ConsoleDeliveryState {
  if (!ownerWorktree(tabId)) {
    return 'gone'
  }
  if (isConsolePaused(tabId)) {
    return 'paused'
  }
  const s = useAppStore.getState()
  return boardConsoleState(tabId, {
    agentStatusByPaneKey: s.agentStatusByPaneKey,
    acknowledgedAgentsByPaneKey: s.acknowledgedAgentsByPaneKey,
    now: Date.now(),
    staleAfterMs: AGENT_STATUS_STALE_AFTER_MS
  })
}

let gate: DeliveryGate | null = null
const holdListeners = new Set<(tabId: string) => void>()

/** The app-wide typing queue (created on first use). */
export function boardDeliveryGate(): DeliveryGate {
  gate ??= new DeliveryGate({
    stateOf: consoleDeliveryState,
    send: async (tabId, text) => {
      const worktreeId = ownerWorktree(tabId)
      const leafId = resolveConsoleLeafId(useAppStore.getState().terminalLayoutsByTabId[tabId])
      if (!worktreeId || !leafId) {
        return activeAgentNotesSendFailureMessage('no-active-terminal', { explicitTarget: true })
      }
      const result = await sendNotesToActiveAgentSession({
        worktreeId,
        prompt: text,
        noteTarget: { tabId, leafId }
      })
      if (result.status === 'sent') {
        return 'sent'
      }
      // Why: "no-agent" means the agent exited and a bare shell owns the terminal.
      return result.status === 'no-agent'
        ? 'shell'
        : activeAgentNotesSendFailureMessage(result.status, { explicitTarget: true })
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    onHold: (request) => {
      for (const l of holdListeners) {
        l(request.tabId)
      }
    }
  })
  return gate
}

/** Notified when a message starts waiting on a console's dialog (for a thread note). */
export function onDeliveryHeld(listener: (tabId: string) => void): () => void {
  holdListeners.add(listener)
  return () => holdListeners.delete(listener)
}

export type OrderLaneInput = {
  tabId: string
  name: string
  text: string
  /** Typed before `text` (a goal block) but left out of the order log and mission matching. */
  prefix?: string
}

/**
 * Records one order and types each lane's text through the gate. Lanes may get
 * different text (a split group task) or the same (a directive).
 */
export async function deliverOrder(input: {
  worktreeId: string
  summary: string
  lanes: readonly OrderLaneInput[]
}): Promise<{
  orderId: string
  ok: boolean
  text: string
  outcomes: { name: string; tabId: string; outcome: DeliveryOutcome }[]
}> {
  const orderId = crypto.randomUUID()
  recordOrder({
    id: orderId,
    worktreeId: input.worktreeId,
    text: input.summary,
    createdAt: Date.now(),
    lanes: input.lanes.map((l) => ({
      tabId: l.tabId,
      name: l.name,
      outcome: null,
      deliveredAt: null
    }))
  })
  const g = boardDeliveryGate()
  const outcomes = await Promise.all(
    input.lanes.map(async (lane) => {
      const outcome = await g.enqueue({
        orderId,
        tabId: lane.tabId,
        text: `${lane.prefix ?? ''}${lane.text}`
      })
      const at = Date.now()
      updateOrderLane(orderId, lane.tabId, outcome, at)
      if (outcome.kind === 'sent') {
        trackMission(
          newMission({
            orderId,
            worktreeId: input.worktreeId,
            tabId: lane.tabId,
            name: lane.name,
            deliveredAt: at,
            busyAtDelivery: outcome.busy,
            text: lane.text
          })
        )
      }
      return { name: lane.name, tabId: lane.tabId, outcome }
    })
  )
  return { orderId, outcomes, ...summarizeDelivery(outcomes) }
}
