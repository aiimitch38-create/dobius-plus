import { normalizeLoopStopFields } from './automation-loop-stop'
import type { AutomationLoop } from './automation-loop-types'

/**
 * Optional loop fields layered on the validated base loop: the stop rules,
 * "keep running behind other tabs", and the agent-judged goal fields. Invalid
 * values are dropped so a corrupt record still loads with legacy behavior.
 */
export function withLoopExtras(raw: Record<string, unknown>, loop: AutomationLoop): AutomationLoop {
  const rawTrigger = typeof raw.trigger === 'object' && raw.trigger !== null ? raw.trigger : {}
  const judge = (rawTrigger as Record<string, unknown>).judge
  const rawState = typeof raw.state === 'object' && raw.state !== null ? raw.state : {}
  const judgedAt = (rawState as Record<string, unknown>).judgedAt
  return {
    ...loop,
    ...normalizeLoopStopFields(raw),
    ...(typeof raw.background === 'boolean' ? { background: raw.background } : {}),
    trigger:
      loop.trigger.kind === 'goal' && (judge === 'agent' || judge === 'self')
        ? { ...loop.trigger, judge }
        : loop.trigger,
    state: typeof judgedAt === 'number' ? { ...loop.state, judgedAt } : loop.state
  }
}
