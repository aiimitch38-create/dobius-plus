import { planTargetSuggestion, type NameSuggestion } from './plan-did-you-mean'
import { fallbackParse } from './plan-fallback'
import type { BoardPlan, PlanBoardSnapshot } from './plan-schema'

export type BuiltInOutcome =
  | { kind: 'plan'; plan: BoardPlan }
  /** The command names a near miss of a board name; the app asks before using `suggestion.to`. */
  | { kind: 'did-you-mean'; suggestion: NameSuggestion; raw: unknown }
  /** Not one of the app's own commands: it goes to ADAM. */
  | { kind: 'for-adam' }

/**
 * The short commands the app runs itself, with no model: "pause all", "fit the
 * board", "open loops", "every 10 minutes ...". Anything else is ADAM's.
 */
export function builtInCommand(utterance: string, board: PlanBoardSnapshot): BuiltInOutcome {
  const parsed = fallbackParse(utterance)
  if (parsed.kind !== 'plan') {
    return { kind: 'for-adam' }
  }
  // Why: the keyword parser cannot see the board; a misheard name it pulled
  // out ("tell Clade 1 to ...") gets a "did you mean" question.
  const suggestion = planTargetSuggestion(parsed.plan, board)
  return suggestion
    ? { kind: 'did-you-mean', suggestion, raw: parsed.plan }
    : { kind: 'plan', plan: parsed.plan }
}
