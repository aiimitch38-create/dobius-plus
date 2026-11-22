// Crew controls over RPC (CLI `dobius crew ...`): Pause crew, pending
// decisions, Asana drafts, the briefing and stopping a run. Each method calls
// the same main-process function as the Agents page IPC in `ipc/agents.ts`.
// Why: interactive terminals hold the full runtime key, so an agent can call
// these too. Resuming the crew, approving a draft and answering a decision
// each wait for a human click in an in-app dialog (confirm-gate.ts); pausing,
// discarding, dismissing, stopping and the read-only methods do not.
//
// Yield has no twin here on purpose: only the Board window's `agents:yield`
// IPC may claim the human is working in a tile (see agent-control.ts).
import { z } from 'zod'
import type { AgentDecisionResolution } from '../../../../shared/agents'
import { getAgentsExecutionState, setAgentsPaused } from '../../../agents/agents-config-store'
import { listAgentDecisions, resolveAgentDecision } from '../../../agents/agent-decision-queue'
import { discardDraft, getDraft, listDrafts } from '../../../agents/agent-draft-store'
import { approveDraftAndPost } from '../../../agents/agent-draft-approval'
import { dismissBriefingItems, listRecentBriefingItems } from '../../../agents/agent-briefing-store'
import { listAgentRuns, stopAgentRun } from '../../../agents/agent-runner'
import { defineMethod, type RpcMethod } from '../core'
import { requiredString } from '../schemas'
import {
  confirmText,
  decisionConfirmRequest,
  describeCaller,
  type ConfirmationGate
} from './confirm-gate'
import { appConfirmationGate } from './crew-confirm'

const MAX_NOTE_LENGTH = 4000

// Why: two CLI stops of the same run at once would interrupt it twice and post
// two "cancelled" notifications. The second call waits on nothing and reports.
const stoppingRunIds = new Set<string>()

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

export function buildCrewMethods(requireConfirmation: ConfirmationGate): RpcMethod[] {
  return [
    defineMethod({
      name: 'crew.state',
      params: null,
      handler: () => getAgentsExecutionState()
    }),
    defineMethod({
      name: 'crew.setPaused',
      params: SetPaused,
      handler: async (params, ctx) => {
        if (params.paused) {
          return { paused: setAgentsPaused(true) }
        }
        const state = getAgentsExecutionState()
        // Unreadable: setAgentsPaused refuses with the reason, no need to ask.
        if (state.status !== 'unreadable') {
          if (!state.paused) {
            return { paused: false }
          }
          await requireConfirmation(
            {
              title: 'Resume the agent crew?',
              message: 'Something outside the app asked to resume the agent crew.',
              detail: `${describeCaller(ctx)}\n\nAgents, heartbeats and automatic dispatches will start running again.`,
              confirmLabel: 'Resume crew'
            },
            ctx
          )
        }
        return { paused: setAgentsPaused(false) }
      }
    }),
    defineMethod({
      name: 'crew.decisions',
      params: null,
      handler: () => ({ decisions: listAgentDecisions() })
    }),
    defineMethod({
      name: 'crew.decide',
      params: Decide,
      handler: async (params, ctx) => {
        const decision = listAgentDecisions().find((entry) => entry.id === params.id)
        if (!decision) {
          throw new Error('Decision not found')
        }
        await requireConfirmation(
          decisionConfirmRequest(decision, params.choice, params.note, ctx),
          ctx
        )
        // resolveAgentDecision looks the id up again, so a decision answered in
        // the app while the dialog was open is refused here, not answered twice.
        return {
          id: params.id,
          choice: params.choice,
          ...(await resolveAgentDecision(toResolution(params)))
        }
      }
    }),
    defineMethod({
      name: 'crew.drafts',
      params: null,
      handler: () => ({ drafts: listDrafts() })
    }),
    defineMethod({
      name: 'crew.draftApprove',
      params: DraftId,
      handler: async (params, ctx) => {
        const draft = getDraft(params.id)
        if (!draft) {
          throw new Error('Draft not found')
        }
        if (draft.status !== 'pending') {
          throw new Error('Only pending drafts can be approved')
        }
        await requireConfirmation(
          {
            title: 'Post this comment to Asana?',
            message: `Post the agent's drafted comment to Asana task ${confirmText(draft.target.gid, 'task id')}?`,
            detail: `${describeCaller(ctx)}\n\nAgent: ${confirmText(draft.agentId, 'agent id')}\n\n${confirmText(draft.body, 'draft')}`,
            confirmLabel: 'Post to Asana'
          },
          ctx
        )
        // approveDraftAndPost re-checks that the draft is still pending.
        return { draft: await approveDraftAndPost(params.id) }
      }
    }),
    defineMethod({
      name: 'crew.draftDiscard',
      params: DraftId,
      handler: (params) => {
        // Why: the app only offers Discard on pending drafts. An approved one is
        // already on Asana, so relabelling it "discarded" would mislead.
        const existing = getDraft(params.id)
        if (existing && existing.status !== 'pending') {
          throw new Error(`Only pending drafts can be discarded (this one is ${existing.status})`)
        }
        return { draft: discardDraft(params.id) }
      }
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
        // Why: a finished run needs no stop, and calling the runner anyway could
        // relabel a run that is still cleaning up as cancelled.
        if (run.status !== 'running') {
          return { runId: params.runId, wasRunning: false }
        }
        if (stoppingRunIds.has(params.runId)) {
          return { runId: params.runId, wasRunning: true }
        }
        stoppingRunIds.add(params.runId)
        try {
          await stopAgentRun(params.runId)
        } finally {
          stoppingRunIds.delete(params.runId)
        }
        return { runId: params.runId, wasRunning: true }
      }
    })
  ]
}

export const CREW_METHODS: RpcMethod[] = buildCrewMethods(appConfirmationGate)
