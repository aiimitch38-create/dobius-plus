import { randomUUID } from 'node:crypto'
import type { AgentRunContext } from '../../shared/agents'
import type { DobiusActionEvent } from '../../shared/dobius-action-events'
import { appendDobiusActionJournalEvent } from './agent-run-event-journal'

/** Context for an action that belongs to no agent run: a fresh correlation id plus what is known. */
export function newActionContext(
  fields: Omit<AgentRunContext, 'correlationId'> = {}
): AgentRunContext {
  return { correlationId: randomUUID(), ...fields }
}

/**
 * Records a significant Dobius action in ADAM's ledger. The event joins the
 * `agent.run.*` journal and is sent by the same drainer
 * (agent-run-event-delivery), so /v1/events/ingest keeps exactly one writer.
 * Never blocks on the network; a paused delivery keeps the event queued.
 */
export function emitDobiusActionEvent(
  event: Omit<DobiusActionEvent, 'ts'> & { ts?: number }
): void {
  appendDobiusActionJournalEvent({ ...event, ts: event.ts ?? Date.now() })
}
