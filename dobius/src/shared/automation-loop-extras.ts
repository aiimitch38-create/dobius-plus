import { normalizeLoopStopFields } from './automation-loop-stop'
import type { AutomationLoop, AutomationLoopState } from './automation-loop-types'

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
    state: {
      ...loop.state,
      ...(typeof judgedAt === 'number' ? { judgedAt } : {}),
      ...perTabRecords(rawState as Record<string, unknown>)
    }
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Per-tab output-match bookkeeping; absent (not empty) when the record never had it. */
function perTabRecords(
  s: Record<string, unknown>
): Pick<AutomationLoopState, 'outputCursors' | 'firedAtByTab'> {
  const cursors = isObj(s.outputCursors)
    ? Object.fromEntries(Object.entries(s.outputCursors).filter(([, v]) => typeof v === 'string'))
    : null
  const fired = isObj(s.firedAtByTab)
    ? Object.fromEntries(
        Object.entries(s.firedAtByTab).filter(
          ([, v]) => typeof v === 'number' && Number.isFinite(v)
        )
      )
    : null
  return {
    ...(cursors ? { outputCursors: cursors as Record<string, string> } : {}),
    ...(fired ? { firedAtByTab: fired as Record<string, number> } : {})
  }
}
