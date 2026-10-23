import {
  PLAN_MAX_STEPS,
  TERMINAL_STEP_KINDS,
  type BoardPlan,
  type PlanBoardSnapshot,
  type PlanStep
} from './plan-schema'
import { parseStep } from './plan-step-parse'
import { resolveTarget, targetConsoleNames } from './plan-target'

export type PlanValidation = { ok: true; plan: BoardPlan } | { ok: false; reason: string }

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length

// A short identical directive ("commit", "stop using mocks") may go to many lanes whole.
const DIRECTIVE_MAX_WORDS = 6
const ASKS_USER = /\b(do you want|would you like|should i|shall i|can you confirm)\b/i
const SPLIT_AMONG = /\b(split|divide|share)\b.*\bamong (yourselves|you|the group)\b/i
const CLAIMS_DONE = /\b(i|i've|i have)\s+(sent|spawned|created|opened|closed|started|deployed)\b/i

/** Extracts the first JSON object from a model reply (tolerates code fences and prose around it). */
export function extractPlanJson(reply: string): unknown {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return null
  }
  try {
    return JSON.parse(reply.slice(start, end + 1))
  } catch {
    return null
  }
}

function terminalText(step: PlanStep): string | null {
  return step.kind === 'tell' ||
    step.kind === 'relay' ||
    step.kind === 'forward' ||
    step.kind === 'loop'
    ? step.text
    : null
}

/** App-side checks; any failure is sent back to the planner once as the reason. */
export function validatePlan(raw: unknown, board: PlanBoardSnapshot): PlanValidation {
  if (!isObj(raw)) {
    return { ok: false, reason: 'reply was not a JSON object' }
  }
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : []
  if (rawSteps.length > PLAN_MAX_STEPS) {
    return { ok: false, reason: `more than ${PLAN_MAX_STEPS} steps` }
  }
  const steps: PlanStep[] = []
  for (const rawStep of rawSteps) {
    const step = parseStep(rawStep, board)
    if (typeof step === 'string') {
      return { ok: false, reason: step }
    }
    steps.push(step)
  }
  const say = str(raw.say) ?? str(raw.spoken) ?? ''
  const plan: BoardPlan = {
    intent: str(raw.intent) ?? '',
    steps,
    say,
    detail: str(raw.detail),
    unsafe: raw.unsafe === true
  }
  const texts = steps.flatMap((s) => terminalText(s) ?? [])
  for (const t of texts) {
    if (ASKS_USER.test(t)) {
      return {
        ok: false,
        reason: 'a relay/tell contains a question for the user; ask the user in "say" instead'
      }
    }
    if (SPLIT_AMONG.test(t)) {
      return {
        ok: false,
        reason: 'do not tell lanes to split work among themselves; send one tell per member'
      }
    }
  }
  const tells = steps.filter((s): s is Extract<PlanStep, { kind: 'tell' }> => s.kind === 'tell')
  const seen = new Set<string>()
  for (const tell of tells) {
    const norm = tell.text.toLowerCase().replace(/\s+/g, ' ')
    if (wordCount(tell.text) > DIRECTIVE_MAX_WORDS && seen.has(norm)) {
      return {
        ok: false,
        reason: 'the same task went to several lanes; give each member a different slice'
      }
    }
    seen.add(norm)
    const target = resolveTarget(tell.target, board)
    if (
      target &&
      targetConsoleNames(target).length > 1 &&
      wordCount(tell.text) > DIRECTIVE_MAX_WORDS
    ) {
      return {
        ok: false,
        reason: `"${tell.target}" has several consoles; split the task into one tell per member`
      }
    }
  }
  const delivers = steps.some((s) => (TERMINAL_STEP_KINDS as readonly string[]).includes(s.kind))
  if (delivers && say.trim().endsWith('?')) {
    return {
      ok: false,
      reason: '"say" asks a question while steps already deliver work; ask or act, not both'
    }
  }
  if (steps.length > 0 && ASKS_USER.test(say)) {
    return { ok: false, reason: '"say" asks permission for an action it is already taking' }
  }
  if (steps.length === 0 && !plan.unsafe && CLAIMS_DONE.test(say) && !say.trim().endsWith('?')) {
    return { ok: false, reason: '"say" reports something as done but there are no steps' }
  }
  return { ok: true, plan }
}
