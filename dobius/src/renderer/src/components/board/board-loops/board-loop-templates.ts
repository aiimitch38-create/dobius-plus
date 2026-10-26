export type BoardLoopTemplate = {
  id: string
  title: string
  description: string
  icon: 'activity' | 'zap' | 'life-buoy' | 'flask-conical' | 'git-commit' | 'eye' | 'clock'
  trigger:
    | { kind: 'schedule'; everyMinutes: number }
    | { kind: 'on-idle'; debounceMs: number }
    | { kind: 'on-output-match'; pattern: string; cooldownMs: number }
  target: 'every-console' | 'selected' | 'group'
  instruction: string
  stop: {
    maxRuns?: number
    timeLimitMinutes?: number
    untilCommandPasses?: string
  }
}

// Copy mirrors the reference studio (sym-loops-*.png); the stops keep every
// schedule template from running forever when the user forgets about it.
export const BOARD_LOOP_TEMPLATES: readonly BoardLoopTemplate[] = [
  {
    id: 'progress-check',
    title: 'Progress check',
    description:
      'Every 15 min, each agent reports what it finished, what’s next, and anything blocking it.',
    icon: 'activity',
    trigger: { kind: 'schedule', everyMinutes: 15 },
    target: 'every-console',
    instruction:
      'Give a one-line status update: what you just finished, what you are doing next, and anything blocking you.',
    stop: { timeLimitMinutes: 240 }
  },
  {
    id: 'keep-moving',
    title: 'Keep them moving',
    description:
      'Whenever an agent goes idle, it’s told to pick up the next task so the swarm never stalls.',
    icon: 'zap',
    // Why: an idle loop fires once its whole target has settled, so it targets one
    // console by default; pick more and it waits for all of them to go idle.
    trigger: { kind: 'on-idle', debounceMs: 120000 },
    target: 'selected',
    instruction:
      'You are idle. Pick up the next most valuable task from your plan or the task board and start on it now. If nothing is left, reply with your final status in one line.',
    stop: { maxRuns: 20 }
  },
  {
    id: 'build-rescue',
    title: 'Build rescue',
    description:
      'The moment a console prints FAILED, that agent is told to stop and fix the failure first.',
    icon: 'life-buoy',
    trigger: { kind: 'on-output-match', pattern: 'FAILED', cooldownMs: 180000 },
    target: 'every-console',
    instruction:
      'Your console just printed FAILED. Stop what you are doing, read the failure above, fix its root cause, and rerun to confirm it passes before continuing. Do not touch unrelated files.',
    stop: {}
  },
  {
    id: 'test-watchdog',
    title: 'Test watchdog',
    description: 'Every 30 min, the test suite runs and failures are fixed on the spot.',
    icon: 'flask-conical',
    trigger: { kind: 'schedule', everyMinutes: 30 },
    target: 'every-console',
    instruction:
      'Run the test suite now. If anything fails, fix the smallest cause and rerun until it is green. Report the pass/fail counts in one line.',
    stop: { timeLimitMinutes: 480 }
  },
  {
    id: 'commit-checkpoint',
    title: 'Commit checkpoint',
    description:
      'Every 20 min, working changes are committed with a clear message so progress is never lost.',
    icon: 'git-commit',
    trigger: { kind: 'schedule', everyMinutes: 20 },
    target: 'every-console',
    instruction:
      'Review your uncommitted changes. If they form a coherent unit, stage exactly the files you changed and create one commit with a clear message describing the why. Do not push.',
    stop: { maxRuns: 24 }
  },
  {
    id: 'review-sweep',
    title: 'Review sweep',
    description:
      'Every 30 min, recent changes are reviewed for bugs and dead code, and anything found is fixed.',
    icon: 'eye',
    trigger: { kind: 'schedule', everyMinutes: 30 },
    target: 'every-console',
    instruction:
      'Reread the files you changed in the last 30 minutes. Look for bugs and dead code, fix what you find, and list what you changed in one line each.',
    stop: { timeLimitMinutes: 240 }
  },
  {
    id: 'hourly-standup',
    title: 'Hourly standup',
    description: 'Once an hour, every agent writes a short standup: done, doing, blocked.',
    icon: 'clock',
    trigger: { kind: 'schedule', everyMinutes: 60 },
    target: 'every-console',
    instruction:
      'Write a standup entry with three short lines: done, doing, and blocked. Include file names for anything you touched. Do not run commands.',
    stop: { timeLimitMinutes: 480 }
  }
]

export function getLoopTemplate(id: string): BoardLoopTemplate | undefined {
  return BOARD_LOOP_TEMPLATES.find((template) => template.id === id)
}
