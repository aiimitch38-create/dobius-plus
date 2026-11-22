import type {
  AgentDraftComment,
  AgentsExecutionState,
  BriefingItem,
  PendingAgentDecision
} from '../../shared/agents'
import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'

const DECISION_CHOICES = ['approve', 'deny', 'respond'] as const
type DecisionChoice = (typeof DECISION_CHOICES)[number]

function isDecisionChoice(value: string): value is DecisionChoice {
  return (DECISION_CHOICES as readonly string[]).includes(value)
}

function oneLine(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export function formatCrewState(state: AgentsExecutionState): string {
  const lines = [state.paused ? 'Crew is paused.' : 'Crew is running.']
  if (state.status === 'unreadable') {
    lines.push(
      `The crew control file could not be read (${state.filePath}: ${state.detail ?? 'unknown problem'}), so the crew stays paused until it is fixed.`
    )
  }
  return lines.join('\n')
}

export function formatDecisions(result: { decisions: PendingAgentDecision[] }): string {
  if (result.decisions.length === 0) {
    return 'No agent requests are waiting.'
  }
  return result.decisions
    .map((decision) => {
      const label = decision.title ?? decision.displayName ?? decision.toolName
      return `${decision.id}  ${decision.agentId}  ${decision.toolName}  ${oneLine(label)}`
    })
    .join('\n')
}

export function formatDrafts(result: { drafts: AgentDraftComment[] }): string {
  if (result.drafts.length === 0) {
    return 'No drafted comments.'
  }
  return result.drafts
    .map(
      (draft) =>
        `${draft.id}  ${draft.status}  asana:${draft.target.gid}  ${draft.agentId}  ${oneLine(draft.body)}`
    )
    .join('\n')
}

export function formatBriefing(result: { items: BriefingItem[] }): string {
  if (result.items.length === 0) {
    return 'The briefing is empty.'
  }
  return result.items
    .map(
      (item) =>
        `${new Date(item.ts).toISOString()}  ${item.urgency}  ${item.agentId}  ${oneLine(item.summary)}`
    )
    .join('\n')
}

function getDecisionChoice(flags: Map<string, string | boolean>): DecisionChoice {
  const choice = getRequiredStringFlag(flags, 'choice')
  if (!isDecisionChoice(choice)) {
    throw new RuntimeClientError('invalid_argument', '--choice must be approve, deny or respond')
  }
  return choice
}

export const CREW_HANDLERS: Record<string, CommandHandler> = {
  'crew status': async ({ client, json }) => {
    const result = await client.call<AgentsExecutionState>('crew.state')
    printResult(result, json, formatCrewState)
  },
  'crew pause': async ({ client, json }) => {
    const result = await client.call<{ paused: boolean }>('crew.setPaused', { paused: true })
    printResult(result, json, (value) =>
      value.paused ? 'Crew paused.' : 'Crew could not be paused.'
    )
  },
  'crew resume': async ({ client, json }) => {
    const result = await client.call<{ paused: boolean }>('crew.setPaused', { paused: false })
    printResult(result, json, (value) =>
      value.paused ? 'Crew is still paused.' : 'Crew resumed.'
    )
  },
  'crew decisions': async ({ client, json }) => {
    const result = await client.call<{ decisions: PendingAgentDecision[] }>('crew.decisions')
    printResult(result, json, formatDecisions)
  },
  'crew decide': async ({ flags, client, json }) => {
    const id = getRequiredStringFlag(flags, 'id')
    const choice = getDecisionChoice(flags)
    const note = getOptionalStringFlag(flags, 'note')
    if (choice === 'respond' && !note?.trim()) {
      throw new RuntimeClientError('invalid_argument', '--choice respond needs --note <text>')
    }
    if (choice !== 'respond' && flags.has('note')) {
      throw new RuntimeClientError('invalid_argument', '--note only goes with --choice respond')
    }
    const result = await client.call<{ id: string; choice: DecisionChoice; note?: string }>(
      'crew.decide',
      { id, choice, ...(choice === 'respond' ? { note } : {}) }
    )
    printResult(result, json, (value) =>
      [`Decision ${value.id}: ${value.choice}.`, value.note].filter(Boolean).join('\n')
    )
  },
  'crew drafts': async ({ client, json }) => {
    const result = await client.call<{ drafts: AgentDraftComment[] }>('crew.drafts')
    printResult(result, json, formatDrafts)
  },
  'crew draft approve': async ({ flags, client, json }) => {
    const result = await client.call<{ draft: AgentDraftComment }>('crew.draftApprove', {
      id: getRequiredStringFlag(flags, 'id')
    })
    printResult(result, json, (value) => `Draft ${value.draft.id} posted to Asana.`)
  },
  'crew draft discard': async ({ flags, client, json }) => {
    const result = await client.call<{ draft: AgentDraftComment }>('crew.draftDiscard', {
      id: getRequiredStringFlag(flags, 'id')
    })
    printResult(result, json, (value) => `Draft ${value.draft.id} discarded.`)
  },
  'crew briefing': async ({ client, json }) => {
    const result = await client.call<{ items: BriefingItem[] }>('crew.briefing')
    printResult(result, json, formatBriefing)
  },
  'crew briefing dismiss': async ({ client, json }) => {
    const result = await client.call<{ dismissed: true }>('crew.briefingDismiss')
    printResult(result, json, () => 'Briefing cleared.')
  },
  'crew stop': async ({ flags, client, json }) => {
    const result = await client.call<{ runId: string; wasRunning: boolean }>('crew.stop', {
      runId: getRequiredStringFlag(flags, 'run-id')
    })
    printResult(result, json, (value) =>
      value.wasRunning
        ? `Run ${value.runId} stopped.`
        : `Run ${value.runId} was not running; nothing to stop.`
    )
  }
}
