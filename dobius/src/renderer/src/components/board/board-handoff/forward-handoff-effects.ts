// Planner effects for "forward" (when the source consoles finish, their replies
// go to another console as one digest) and "handoff" (one console writes a brief,
// a fresh console of another agent takes over with it). Built on the Board's
// order registry, delivery gate and mission tracker.
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { getAgentLabel } from '@/lib/agent-catalog'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { useAppStore } from '@/store'
import { isTuiAgent } from '../../../../../shared/tui-agent-config'
import { BOARD_CONSOLE_SIZE } from '../board-canvas/board-spawn-placement'
import { deliverOrder } from '../board-delivery/board-delivery'
import { withGoalPrefix } from '../board-goal/goal-reminders'
import { latestOrder, onOrdersChanged } from '../board-delivery/board-orders'
import { consoleByName } from '../board-delivery/console-lifecycle'
import { orderSettled, type Mission } from '../board-delivery/mission-state'
import { missionsForOrder, onMissionEvent } from '../board-delivery/mission-tracker'
import type { StepResult } from '../board-planner/plan-execute'
import {
  extractHandoffBrief,
  tabHasAgentStatus,
  forwardDigest,
  handoffBriefMessage,
  handoffSummaryRequest,
  splitForward
} from './forward-digest'

// Why: the reference waits about four minutes for the brief before spawning anyway.
const HANDOFF_WAIT_MS = 4 * 60 * 1000
const SPAWN_GAP = 40

let handoffRunning = false
const AGENT_READY_WAIT_MS = 3 * 60 * 1000
const AGENT_READY_POLL_MS = 1_000

/** Polls until the tab's agent reports any status (past launch and trust prompts). */
function waitForAgentReady(tabId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const check = (): void => {
      if (tabHasAgentStatus(useAppStore.getState().agentStatusByPaneKey, tabId)) {
        resolve(true)
      } else if (Date.now() >= deadline) {
        resolve(false)
      } else {
        window.setTimeout(check, AGENT_READY_POLL_MS)
      }
    }
    check()
  })
}

function consolesNamed(worktreeId: string, names: readonly string[]) {
  return names.flatMap((n) => consoleByName(worktreeId, n) ?? [])
}

/** Resolves once `ready(missions)` holds for the order, or after `timeoutMs` (null). */
function waitForMissions(
  orderId: string,
  ready: (missions: Mission[]) => boolean,
  timeoutMs: number
): Promise<Mission[] | null> {
  const now = missionsForOrder(orderId)
  if (ready(now)) {
    return Promise.resolve(now)
  }
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      off()
      resolve(null)
    }, timeoutMs)
    const off = onMissionEvent((event) => {
      const id = event.kind === 'settled' ? event.orderId : event.mission.orderId
      if (id !== orderId) {
        return
      }
      const current = missionsForOrder(orderId)
      if (ready(current)) {
        window.clearTimeout(timer)
        off()
        resolve(current)
      }
    })
  })
}

type ForwardInput = {
  to: string[]
  text: string
  source: string | null
  mode: 'split' | 'broadcast'
}
type BoardOrder = NonNullable<ReturnType<typeof latestOrder>>
type ConsoleRef = NonNullable<ReturnType<typeof consoleByName>>

// ponytail: armed for up to a day in this window; a restart forgets it, like the order registry.
const FORWARD_ARM_MS = 24 * 60 * 60 * 1000

/** Waits for the order's source lanes to settle, then delivers their replies. */
function armForward(
  worktreeId: string,
  order: BoardOrder,
  input: ForwardInput,
  destinations: ConsoleRef[],
  sourceTab: string | undefined
): void {
  const fromSources = (missions: Mission[]): Mission[] =>
    sourceTab ? missions.filter((m) => m.tabId === sourceTab) : missions
  void waitForMissions(order.id, (m) => orderSettled(fromSources(m)), FORWARD_ARM_MS).then(
    async (missions) => {
      const replies = fromSources(missions ?? [])
        .filter((m) => m.state === 'finished' && m.reply)
        .map((m) => ({ name: m.name, text: m.reply! }))
      if (replies.length === 0) {
        return
      }
      const names = destinations.map((d) => d.title)
      const texts =
        input.mode === 'broadcast'
          ? names.map(() => forwardDigest(order.text, replies, input.text))
          : splitForward(order.text, replies, input.text, names)
      const result = await deliverOrder({
        worktreeId,
        summary: translate('board.forward.summary', 'Forwarded results: {{ask}}', {
          ask: input.text
        }),
        lanes: withGoalPrefix(
          texts.map((text, i) => ({
            tabId: destinations[i].tabId,
            name: destinations[i].title,
            text
          }))
        )
      })
      toast[result.ok ? 'success' : 'error'](result.text)
    }
  )
}

export async function forwardResults(worktreeId: string, input: ForwardInput): Promise<StepResult> {
  const sourceTab = input.source ? consoleByName(worktreeId, input.source)?.tabId : undefined
  const destinations = consolesNamed(worktreeId, input.to)
  if (destinations.length === 0) {
    return { ok: false, text: translate('board.delivery.nobody', 'No console to send to.') }
  }
  const targets = destinations.map((d) => d.title).join(', ')
  const order = latestOrder(worktreeId)
  const servesSource = (o: BoardOrder): boolean =>
    !sourceTab || o.lanes.some((l) => l.tabId === sourceTab)
  if (!order || !servesSource(order)) {
    // Why: a forward given before its order waits for the next order to the source.
    const previousId = order?.id ?? null
    const off = onOrdersChanged(() => {
      const next = latestOrder(worktreeId)
      if (next && next.id !== previousId && servesSource(next)) {
        off()
        armForward(worktreeId, next, input, destinations, sourceTab)
      }
    })
    window.setTimeout(off, FORWARD_ARM_MS)
    return {
      ok: true,
      text: translate(
        'board.forward.armedNoOrder',
        'No order yet. When the next order finishes, its replies go to {{targets}}.',
        { targets }
      )
    }
  }
  armForward(worktreeId, order, input, destinations, sourceTab)
  const sources = order.lanes
    .filter((l) => !sourceTab || l.tabId === sourceTab)
    .map((l) => l.name)
    .join(', ')
  return {
    ok: true,
    text: translate(
      'board.forward.armed',
      'When {{sources}} finish, their replies go to {{targets}}.',
      {
        sources,
        targets
      }
    )
  }
}

async function runHandoff(
  worktreeId: string,
  agent: Parameters<typeof launchAgentInNewTab>[0]['agent'],
  source: { tabId: string; title: string; x: number; y: number; w: number }
): Promise<void> {
  const asked = await deliverOrder({
    worktreeId,
    summary: translate('board.handoff.summary', 'Handoff brief from {{name}}', {
      name: source.title
    }),
    lanes: [{ tabId: source.tabId, name: source.title, text: handoffSummaryRequest() }]
  })
  const missions = asked.ok
    ? await waitForMissions(
        asked.orderId,
        (m) => m.some((x) => x.state !== 'running'),
        HANDOFF_WAIT_MS
      )
    : null
  const brief = extractHandoffBrief(missions?.find((m) => m.state === 'finished')?.reply ?? null)
  const launched = launchAgentInNewTab({ agent, worktreeId, launchSource: 'unknown' })
  if (!launched?.tabId) {
    toast.error(
      translate('board.handoff.spawnFailed', 'Could not start {{agent}} for the handoff.', {
        agent: getAgentLabel(agent)
      })
    )
    return
  }
  const title = translate('board.handoff.title', '{{agent}} (from {{name}})', {
    agent: getAgentLabel(agent),
    name: source.title
  })
  useAppStore.getState().addCard(worktreeId, {
    kind: 'console',
    tabId: launched.tabId,
    agentKind: agent,
    title,
    x: source.x + source.w + SPAWN_GAP,
    y: source.y,
    ...BOARD_CONSOLE_SIZE
  })
  if (!brief) {
    toast.message(
      translate('board.handoff.noBrief', '{{name}} sent no brief, so {{title}} starts clean.', {
        name: source.title,
        title
      })
    )
    return
  }
  const message = handoffBriefMessage(source.title, brief)
  // Why: a fresh console has no status yet and the gate would treat it as idle;
  // typing now could land in its shell or a folder-trust prompt.
  if (!(await waitForAgentReady(launched.tabId, AGENT_READY_WAIT_MS))) {
    await navigator.clipboard
      .writeText(message)
      .catch((error: unknown) => console.debug('[board-handoff] clipboard write failed', error))
    toast.error(
      translate(
        'board.handoff.notReady',
        '{{title}} did not become ready, so the brief was not typed. It is on your clipboard to paste.',
        { title }
      )
    )
    return
  }
  const result = await deliverOrder({
    worktreeId,
    summary: translate('board.handoff.briefSummary', 'Handoff brief to {{title}}', { title }),
    lanes: withGoalPrefix([{ tabId: launched.tabId, name: title, text: message }])
  })
  toast[result.ok ? 'success' : 'error'](result.text)
}

export async function handoffTask(
  worktreeId: string,
  input: { cli: string; source: string | null }
): Promise<StepResult> {
  if (!isTuiAgent(input.cli)) {
    return {
      ok: false,
      text: translate('board.handoff.unknownAgent', '{{cli}} is not an agent Dobius can start.', {
        cli: input.cli
      })
    }
  }
  const named = input.source ? consoleByName(worktreeId, input.source) : null
  const lanes = latestOrder(worktreeId)?.lanes ?? []
  const source =
    named ?? (lanes.length === 1 && !input.source ? consoleByName(worktreeId, lanes[0].name) : null)
  if (!source) {
    return {
      ok: false,
      text: translate(
        'board.handoff.oneSource',
        'Handoff needs exactly one source console. Name the one to hand off from.'
      )
    }
  }
  if (handoffRunning) {
    return {
      ok: false,
      text: translate(
        'board.handoff.busy',
        'A handoff is already in progress. Try again after it lands.'
      )
    }
  }
  handoffRunning = true
  void runHandoff(worktreeId, input.cli, source).finally(() => {
    handoffRunning = false
  })
  return {
    ok: true,
    text: translate(
      'board.handoff.started',
      'Asked {{name}} for a brief. A fresh {{agent}} console takes over when it arrives (up to 4 minutes).',
      { name: source.title, agent: getAgentLabel(input.cli) }
    )
  }
}
