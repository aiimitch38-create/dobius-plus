import type { AutomationLoopTarget } from './automation-loop-types'

// Validates a persisted Board loop target (who an instruction is sent to).

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0

export function normalizeLoopTarget(raw: unknown): AutomationLoopTarget | null {
  if (!isObj(raw)) {
    return null
  }
  if (raw.type === 'tab' && isStr(raw.tabId)) {
    return { type: 'tab', tabId: raw.tabId }
  }
  if (raw.type === 'group' && isStr(raw.groupId)) {
    return { type: 'group', groupId: raw.groupId }
  }
  if (raw.type === 'board') {
    return { type: 'board' }
  }
  if (raw.type === 'orchestrator' && isStr(raw.cardId)) {
    return { type: 'orchestrator', cardId: raw.cardId }
  }
  if (raw.type === 'tabs' && Array.isArray(raw.tabIds)) {
    const tabIds = [...new Set(raw.tabIds.filter(isStr))]
    return tabIds.length > 0 ? { type: 'tabs', tabIds } : null
  }
  return null
}
