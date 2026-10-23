import type { PlanBoardSnapshot } from './plan-schema'
import { closestName, nearestName, resolveTarget } from './plan-target'

// "Did you mean X?" for near-miss console/group names. Pure: the caller asks
// the user and only acts on a yes, so a guessed name never reaches a terminal
// on its own.

// Step kinds whose `target` must be a console, group, agent, role or "all".
const BOARD_TARGET_KINDS = new Set([
  'add_to_group',
  'restart',
  'kill',
  'pause',
  'resume',
  'focus',
  'kill_group',
  'dissolve_group',
  'tell',
  'forward',
  'create_group',
  'rename',
  'connect_orchestrator',
  'fit_view'
])

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)

export type NameSuggestion = { from: string; to: string }

/** First step in a raw planner reply whose target is unknown but close to a board name. */
export function planTargetSuggestion(
  raw: unknown,
  board: PlanBoardSnapshot
): NameSuggestion | null {
  if (!isObj(raw) || !Array.isArray(raw.steps)) {
    return null
  }
  for (const step of raw.steps) {
    if (!isObj(step) || typeof step.kind !== 'string' || !BOARD_TARGET_KINDS.has(step.kind)) {
      continue
    }
    const target = typeof step.target === 'string' ? step.target.trim() : ''
    if (!target || resolveTarget(target, board)) {
      continue
    }
    const to = nearestName(target, board)
    if (to) {
      return { from: target, to }
    }
  }
  return null
}

/** Copy of a raw planner reply with every step target `from` replaced by `to`. */
export function withPlanTarget(raw: unknown, suggestion: NameSuggestion): unknown {
  if (!isObj(raw) || !Array.isArray(raw.steps)) {
    return raw
  }
  return {
    ...raw,
    steps: raw.steps.map((step) =>
      isObj(step) && typeof step.target === 'string' && step.target.trim() === suggestion.from
        ? { ...step, target: suggestion.to }
        : step
    )
  }
}

const MAX_NAME_WORDS = 4

/**
 * "@Clade 1 run the tests" with no exact match -> Claude 1 + "run the tests".
 * Tries the first one to four words as the name and keeps the closest hit; null
 * when nothing is close or no message is left after the name.
 */
export function suggestMention(
  text: string,
  names: readonly string[]
): { name: string; message: string } | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('@')) {
    return null
  }
  const body = trimmed.slice(1)
  const words = [...body.matchAll(/\S+/g)]
  let best: { name: string; message: string; distance: number } | null = null
  for (let n = 1; n <= Math.min(MAX_NAME_WORDS, words.length - 1); n += 1) {
    const last = words[n - 1]
    const prefix = body
      .slice(0, (last.index ?? 0) + last[0].length)
      .replace(/[,:]+$/, '')
      .replace(/-/g, ' ')
    const message = body
      .slice((last.index ?? 0) + last[0].length)
      .replace(/^[\s,:]+/, '')
      .trim()
    const hit = message ? closestName(prefix, names) : null
    if (hit && (!best || hit.distance < best.distance)) {
      best = { name: hit.name, message, distance: hit.distance }
    }
  }
  return best ? { name: best.name, message: best.message } : null
}
