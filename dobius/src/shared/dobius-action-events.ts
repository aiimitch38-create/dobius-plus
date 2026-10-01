import type { AgentRunContext } from './agents'

/**
 * Namespaced types of significant Dobius actions recorded in ADAM's event
 * ledger beside the `agent.run.*` stream (B3). Add a type here before emitting
 * it; the namespace is the subsystem (`git.*`, `task.*`, `agent.*`).
 */
export type DobiusActionEventType =
  | 'git.commit.landed'
  | 'agent.decision.resolved'
  | 'task.status.changed'
  | 'task.gate.resolved'

/** Actor of an action performed from the desktop UI (IPC). */
export const USER_ACTOR = 'user'
/** Actor of an action performed through the runtime RPC (CLI, agents, paired devices). */
export const RUNTIME_ACTOR = 'runtime'
/** Actor of an action Dobius performed on its own (cancellations, timeouts). */
export const DOBIUS_ACTOR = 'dobius'

export type DobiusActionEvent = {
  type: DobiusActionEventType
  /** Unix ms when the action happened. */
  ts: number
  /** `correlationId` ties the event to its subject (run, task, ...); ADAM projects the rest. */
  context: AgentRunContext
  /** Who performed the action: USER_ACTOR, RUNTIME_ACTOR, DOBIUS_ACTOR or an agent id. */
  actor: string
  /** The agent run the action belongs to, when there is one. */
  runId?: string
  payload: Record<string, unknown>
}
