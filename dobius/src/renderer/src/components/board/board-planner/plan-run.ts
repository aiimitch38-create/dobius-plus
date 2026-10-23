import { fallbackParse, type PlannerBreaker } from './plan-fallback'
import { buildPlannerPrompt, type PlanTurn } from './plan-prompt'
import type { BoardPlan, PlanBoardSnapshot } from './plan-schema'
import { extractPlanJson, validatePlan } from './plan-validate'

/** Sends one planner prompt and resolves with the model's raw reply text. */
export type PlannerTransport = (prompt: string) => Promise<string>

export type PlanOutcome =
  | { kind: 'plan'; plan: BoardPlan; source: 'planner' | 'fallback' }
  /** Planner down and the utterance is a work order the parser cannot write. */
  | { kind: 'needs-planner'; reason: string }
  /** Planner answered but both attempts were invalid. */
  | { kind: 'rejected'; reason: string }

/**
 * The planning loop: ask, validate, retry once with the rejection reason, and
 * fall back to the keyword parser when the planner is unavailable. Pure apart
 * from the injected transport.
 */
export async function runPlanner(input: {
  transport: PlannerTransport
  breaker: PlannerBreaker
  board: PlanBoardSnapshot
  turns: readonly PlanTurn[]
  utterance: string
  replyLanguage: string
  now: () => number
}): Promise<PlanOutcome> {
  const fallback = (reason: string): PlanOutcome => {
    const parsed = fallbackParse(input.utterance)
    return parsed.kind === 'plan'
      ? { kind: 'plan', plan: parsed.plan, source: 'fallback' }
      : { kind: 'needs-planner', reason }
  }
  if (input.breaker.isOpen(input.now())) {
    return fallback('breaker')
  }
  let appNote: string | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let reply: string
    try {
      reply = await input.transport(
        buildPlannerPrompt({
          board: input.board,
          turns: input.turns,
          utterance: input.utterance,
          replyLanguage: input.replyLanguage,
          appNote
        })
      )
    } catch (error) {
      input.breaker.recordFailure(input.now())
      return fallback(error instanceof Error ? error.message : String(error))
    }
    const json = extractPlanJson(reply)
    // Why: a reply with no JSON is the CLI's error text (rate limited, out of credits), not a bad plan; retrying won't help.
    if (json === null) {
      input.breaker.recordFailure(input.now())
      return fallback(reply.trim().slice(0, 200) || 'empty reply')
    }
    const validation = validatePlan(json, input.board)
    if (validation.ok) {
      input.breaker.recordSuccess()
      return { kind: 'plan', plan: validation.plan, source: 'planner' }
    }
    appNote = validation.reason
  }
  return { kind: 'rejected', reason: appNote ?? 'invalid plan' }
}
