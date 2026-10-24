// Optional drift check for goal cards: after a wired console finishes a turn,
// the read-only loop goal judge (main) says whether its report serves the goal.
// It only flags the card; it never types anything or acts on a console.
import { create } from 'zustand'
import type { GoalDriftJudgeInput, GoalDriftVerdict } from '../../../../../shared/board-goal-drift'
import { formatGoalBlock } from './goal-block'
import type { GoalCard } from './goal-targets'

/** One judge run per goal and console at most this often (each run is a claude -p call). */
export const GOAL_DRIFT_MIN_INTERVAL_MS = 5 * 60 * 1000
const LINE_MAX_CHARS = 140

export type GoalDriftFlag = { tabId: string; consoleName: string; line: string; at: number }

type DriftFlagsState = {
  byGoal: Record<string, GoalDriftFlag[]>
  set: (goalId: string, flag: GoalDriftFlag) => void
  clear: (goalId: string, tabId: string) => void
}

// Why: session-only, so a judge verdict never lands in the board's undo history or saved config.
export const useGoalDriftFlags = create<DriftFlagsState>((set) => ({
  byGoal: {},
  set: (goalId, flag) =>
    set((s) => ({
      byGoal: {
        ...s.byGoal,
        [goalId]: [...(s.byGoal[goalId] ?? []).filter((f) => f.tabId !== flag.tabId), flag]
      }
    })),
  clear: (goalId, tabId) =>
    set((s) =>
      s.byGoal[goalId]?.some((f) => f.tabId === tabId)
        ? { byGoal: { ...s.byGoal, [goalId]: s.byGoal[goalId].filter((f) => f.tabId !== tabId) } }
        : s
    )
}))

export type GoalDriftJudge = (input: GoalDriftJudgeInput) => Promise<GoalDriftVerdict>

const defaultJudge: GoalDriftJudge = (input) => window.api.automations.goalDriftJudge(input)
const lastRunAt = new Map<string, number>()
const running = new Set<string>()

function firstLine(text: string): string {
  const line =
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  return line.length > LINE_MAX_CHARS ? `${line.slice(0, LINE_MAX_CHARS - 1)}…` : line
}

/**
 * Runs the judge for one finished report when the goal has drift check on and
 * the per-console interval has passed. Returns the flag it raised, or null.
 */
export async function runGoalDriftCheck(
  input: { goal: GoalCard; tabId: string; consoleName: string; report: string; now: number },
  judge: GoalDriftJudge = defaultJudge
): Promise<GoalDriftFlag | null> {
  const { goal, tabId, consoleName, report, now } = input
  const key = `${goal.id}:${tabId}`
  const last = lastRunAt.get(key)
  const goalBlock = formatGoalBlock([goal])
  if (
    !goal.driftCheck ||
    !goalBlock ||
    !report.trim() ||
    running.has(key) ||
    (last !== undefined && now - last < GOAL_DRIFT_MIN_INTERVAL_MS)
  ) {
    return null
  }
  running.add(key)
  lastRunAt.set(key, now)
  try {
    const result = await judge({ goalBlock, consoleName, report })
    if (result.verdict === 'on-goal') {
      useGoalDriftFlags.getState().clear(goal.id, tabId)
      return null
    }
    if (result.verdict !== 'off-goal') {
      if (result.error) {
        console.warn('[board-goal] drift check gave no verdict:', result.error)
      }
      return null
    }
    const flag = { tabId, consoleName, line: result.reason ?? firstLine(report), at: now }
    useGoalDriftFlags.getState().set(goal.id, flag)
    return flag
  } catch (error) {
    console.warn('[board-goal] drift check failed:', error)
    return null
  } finally {
    running.delete(key)
  }
}

export function resetGoalDriftForTest(): void {
  lastRunAt.clear()
  running.clear()
  useGoalDriftFlags.setState({ byGoal: {} })
}
