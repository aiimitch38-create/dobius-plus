// Crew controls over RPC (CLI `dobius crew ...`): Pause crew, pending
// decisions, Asana drafts, the briefing and stopping a run. Each method calls
// the same main-process function as the Agents page IPC in `ipc/agents.ts`.
// Why: none of these belong on the background-agent key allowlist. Approving a
// draft posts to Asana and deciding a prompt lets an agent act, so they stay
// full-key (human) only; the allowlist is default-deny, so nothing here opts in.
//
// Yield has no twin here on purpose: only the Board window's `agents:yield`
// IPC may claim the human is working in a tile (see agent-control.ts).
import { z } from 'zod'
import type { AgentDecisionResolution } from '../../../../shared/agents'
import { getAgentsExecutionState, setAgentsPaused } from '../../../agents/agents-config-store'
import { listAgentDecisions, resolveAgentDecision } from '../../../agents/agent-decision-queue'
import { discardDraft, listDrafts } from '../../../agents/agent-draft-store'
import { approveDraftAndPost } from '../../../agents/agent-draft-approval'
import {
  dismissBriefingItems,
  listRecentBriefingItems
} from '../../../agents/agent-briefing-store'
import { listAgentRuns, stopAgentRun } from '../../../agents/agent-runner'
import { defineMethod, type RpcMethod } from '../core'
import { requiredString } from '../schemas'

const MAX_NOTE_LENGTH = 4000

const SetPaused = z.object({ paused: z.boolean() }).strict()

const DraftId = z.object({ id: requiredString('Missing draft id') }).strict()

const RunId = z.object({ runId: requiredString('Missing run id') }).strict()

// Why: only the plain approve / deny / reply choices. "Always allow", "bypass
// run" and "approve with edits" widen or rewrite what the agent may do, so they
// stay in the app's decision card.
const Decide = z
  .object({
    id: requiredString('Missing decision id'),
    choice: z.enum(['approve', 'deny', 'respond']),
    note: z.string().max(MAX_NOTE_LENGTH, 'Note is too long').optional()
  })
  .strict()
  .refine((value) => value.choice !== 'respond' || Boolean(value.note?.trim()), {
    message: 'A respond choice needs a note for the agent'
  })
  .refine((value) => value.choice === 'respond' || value.note === undefined, {
    message: 'A note is only sent with the respond choice'
  })

function toResolution(params: z.infer<typeof Decide>): AgentDecisionResolution {
  if (params.choice === 'respond') {
    return { id: params.id, action: 'respond', payload: { text: params.note } }
  }
  return { id: params.id, action: params.choice }
}

export const CREW_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'crew.state',
    params: null,
    handler: () => getAgentsExecutionState()
  }),
  defineMethod({
    name: 'crew.setPaused',
    params: SetPaused,
    handler: (params) => ({ paused: setAgentsPaused(params.paused) })
  }),
  defineMethod({
    name: 'crew.decisions',
    params: null,
    handler: () => ({ decisions: listAgentDecisions() })
  }),
  defineMethod({
    name: 'crew.decide',
    params: Decide,
    handler: async (params) => ({
      id: params.id,
      choice: params.choice,
      ...(await resolveAgentDecision(toResolution(params)))
    })
  }),
  defineMethod({
    name: 'crew.drafts',
    params: null,
    handler: () => ({ drafts: listDrafts() })
  }),
  defineMethod({
    name: 'crew.draftApprove',
    params: DraftId,
    handler: async (params) => ({ draft: await approveDraftAndPost(params.id) })
  }),
  defineMethod({
    name: 'crew.draftDiscard',
    params: DraftId,
    handler: (params) => ({ draft: discardDraft(params.id) })
  }),
  defineMethod({
    name: 'crew.briefing',
    params: null,
    handler: () => ({ items: listRecentBriefingItems() })
  }),
  defineMethod({
    name: 'crew.briefingDismiss',
    params: null,
    handler: () => {
      dismissBriefingItems()
      return { dismissed: true as const }
    }
  }),
  defineMethod({
    name: 'crew.stop',
    params: RunId,
    handler: async (params) => {
      // Why: stopAgentRun ignores unknown ids, which would let a typo look
      // like a successful stop. Say what was there before stopping.
      const run = listAgentRuns().find((candidate) => candidate.id === params.runId)
      if (!run) {
        throw new Error(`Run not found: ${params.runId}`)
      }
      await stopAgentRun(params.runId)
      return { runId: params.runId, wasRunning: run.status === 'running' }
    }
  })
]
