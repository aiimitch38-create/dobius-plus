import type { PlannerTransport } from './plan-run'

const POLL_MS = 1_000
export const PLANNER_TIMEOUT_MS = 90_000

/**
 * Planner transport over the existing Voice Conductor command path: the
 * prompt asks for a JSON-only plan; the first reply is the answer.
 * ponytail: rides the conductor (keeps Dobius's model routing and settings);
 * a dedicated one-shot planner IPC is the upgrade if the conductor's own tools
 * get in the way.
 */
export function conductorPlannerTransport(): PlannerTransport {
  return async (prompt) => {
    const requestId = crypto.randomUUID()
    const sent = await window.api.agents.conductorCommand({ requestId, transcript: prompt })
    if (!sent.ok) {
      throw new Error(sent.error)
    }
    const started = Date.now()
    while (Date.now() - started < PLANNER_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      const reply = await window.api.agents.conductorReply({ requestId, sinceTs: 0 })
      if (reply?.message) {
        return reply.message
      }
    }
    throw new Error('planner timed out')
  }
}
