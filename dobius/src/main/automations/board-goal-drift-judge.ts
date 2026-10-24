import {
  buildGoalDriftPrompt,
  parseGoalDriftAnswer,
  type GoalDriftJudgeInput,
  type GoalDriftVerdict
} from '../../shared/board-goal-drift'
import { runLockedDownJudge, type ClaudeGoalJudgeDeps } from './loop-goal-judge'

const MAX_FIELD_CHARS = 20_000

function isInput(raw: unknown): raw is GoalDriftJudgeInput {
  if (typeof raw !== 'object' || raw === null) {
    return false
  }
  const r = raw as Record<string, unknown>
  return (
    typeof r.goalBlock === 'string' &&
    typeof r.consoleName === 'string' &&
    typeof r.report === 'string' &&
    r.goalBlock.trim().length > 0 &&
    r.goalBlock.length <= MAX_FIELD_CHARS &&
    r.report.length <= MAX_FIELD_CHARS * 4
  )
}

/** Asks the read-only loop goal judge whether a console's report serves the goal card's goal. */
export async function judgeBoardGoalDrift(
  raw: unknown,
  deps: ClaudeGoalJudgeDeps = {}
): Promise<GoalDriftVerdict> {
  if (!isInput(raw)) {
    return { verdict: null, reason: null, error: 'Invalid drift check request.' }
  }
  const { output, error } = await runLockedDownJudge(buildGoalDriftPrompt(raw), deps)
  if (output === null) {
    return { verdict: null, reason: null, error }
  }
  const answer = parseGoalDriftAnswer(output)
  return answer.verdict
    ? { ...answer, error: null }
    : { ...answer, error: 'Judge gave no clear answer.' }
}
