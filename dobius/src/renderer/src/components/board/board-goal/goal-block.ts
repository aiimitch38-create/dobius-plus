// The short goal block reminders type into an agent and the orchestrator
// prompt can embed. Pure: no store, no DOM.
import type { BoardCardOf } from '@/store/slices/board'

export type GoalBlockSource = Pick<BoardCardOf<'goal'>, 'goal' | 'criteria' | 'dont'>

// Why: each line stays one line so a pasted block never reads as several prompts.
const flat = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** "3/5 done" counts for the card header. */
export function goalProgress(card: Pick<GoalBlockSource, 'criteria'>): {
  done: number
  total: number
} {
  const live = card.criteria.filter((c) => flat(c.text))
  return { done: live.filter((c) => c.done).length, total: live.length }
}

function oneGoalBlock(card: GoalBlockSource): string | null {
  const goal = flat(card.goal)
  if (!goal) {
    return null
  }
  const open = card.criteria
    .filter((c) => !c.done)
    .map((c) => flat(c.text))
    .filter(Boolean)
  const dont = card.dont.map((d) => flat(d.text)).filter(Boolean)
  return [
    `Main goal: ${goal}`,
    ...(open.length > 0 ? [`Done means: ${open.join('; ')}`] : []),
    ...(dont.length > 0 ? [`Don't: ${dont.join('; ')}`] : [])
  ].join('\n')
}

/**
 * "Main goal: … / Done means: … (unchecked items) / Don't: …", one block per
 * goal with text, separated by a blank line. Null when no goal has text.
 */
export function formatGoalBlock(goals: readonly GoalBlockSource[]): string | null {
  const blocks = goals.map(oneGoalBlock).filter((b): b is string => b !== null)
  return blocks.length > 0 ? blocks.join('\n\n') : null
}
