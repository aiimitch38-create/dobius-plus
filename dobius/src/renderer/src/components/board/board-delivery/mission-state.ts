import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'

// Pure mission tracking: one mission per delivered order lane. A mission
// closes only on a reply that started after its own delivery, never on an
// earlier turn the agent was finishing.

export const MISSION_TIMEOUT_MS = 20 * 60 * 1000
const EXCERPT_CHARS = 280

export type Mission = {
  orderId: string
  worktreeId: string
  tabId: string
  name: string
  deliveredAt: number
  /** The console was mid-turn when the text was typed (its terminal queued it). */
  busyAtDelivery: boolean
  /** Start of the delivered text, matched against the turn's prompt. */
  textPrefix: string
  sawWorking: boolean
  /** "done" transitions seen after delivery (a busy console's first one is the old turn). */
  donesSeen: number
  lastDoneStartedAt: number | null
  state: 'running' | 'finished' | 'timeout'
  late: boolean
  reply: string | null
  finishedAt: number | null
}

const PROMPT_MATCH_CHARS = 40

export function newMission(input: {
  orderId: string
  worktreeId: string
  tabId: string
  name: string
  deliveredAt: number
  busyAtDelivery: boolean
  text: string
}): Mission {
  const { text, ...rest } = input
  return {
    ...rest,
    textPrefix: text.trim().slice(0, PROMPT_MATCH_CHARS),
    sawWorking: false,
    donesSeen: 0,
    lastDoneStartedAt: null,
    state: 'running',
    late: false,
    reply: null,
    finishedAt: null
  }
}

/** True / false when the entry's prompt says whose turn this is; null when it carries no prompt. */
function promptIsOurs(m: Mission, entry: AgentStatusEntry): boolean | null {
  const prompt = entry.prompt?.trim()
  if (!prompt || !m.textPrefix) {
    return null
  }
  return prompt.includes(m.textPrefix)
}

/** The freshest status entry among a tab's panes. */
export function latestEntryForTab(
  byPaneKey: Readonly<Record<string, AgentStatusEntry>>,
  tabId: string
): AgentStatusEntry | null {
  let best: AgentStatusEntry | null = null
  for (const [key, entry] of Object.entries(byPaneKey)) {
    if (key.startsWith(`${tabId}:`) && (!best || entry.updatedAt > best.updatedAt)) {
      best = entry
    }
  }
  return best
}

export function advanceMission(m: Mission, entry: AgentStatusEntry | null, now: number): Mission {
  if (m.state === 'finished') {
    return m
  }
  let next = m
  // Only a working episode that STARTED after delivery is ours (a busy console
  // was already working on the previous turn when we typed).
  if (entry && entry.state === 'working' && entry.stateStartedAt > m.deliveredAt && !m.sawWorking) {
    next = { ...next, sawWorking: true }
  }
  const isNewDone =
    entry !== null &&
    entry.state === 'done' &&
    entry.stateStartedAt >= m.deliveredAt &&
    entry.stateStartedAt !== m.lastDoneStartedAt
  if (entry && isNewDone) {
    next = { ...next, donesSeen: next.donesSeen + 1, lastDoneStartedAt: entry.stateStartedAt }
    const ours = promptIsOurs(m, entry)
    const replied =
      ours === true ||
      (ours === null &&
        (m.busyAtDelivery
          ? // The first done after typing into a busy console ends the OLD turn.
            next.donesSeen >= 2 && next.sawWorking
          : next.sawWorking || entry.stateStartedAt > m.deliveredAt))
    if (replied) {
      return {
        ...next,
        state: 'finished',
        late: m.state === 'timeout',
        reply: (entry.lastAssistantMessage ?? '').trim() || null,
        finishedAt: entry.stateStartedAt
      }
    }
  }
  if (next.state === 'running' && now - m.deliveredAt > MISSION_TIMEOUT_MS) {
    return { ...next, state: 'timeout' }
  }
  return next
}

export function replyExcerpt(reply: string | null): string {
  if (!reply) {
    return ''
  }
  const flat = reply.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS - 1)}…` : flat
}

/** True once every lane of an order has replied or timed out, with at least one reply. */
export function orderSettled(missions: readonly Mission[]): boolean {
  return (
    missions.length > 0 &&
    missions.every((m) => m.state !== 'running') &&
    missions.some((m) => m.state === 'finished')
  )
}

/** File name for a saved reply: outputs/<timestamp>-<console>.md */
export function outputFileName(name: string, at: number): string {
  const stamp = new Date(at).toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'console'
  return `${stamp}-${slug}.md`
}
