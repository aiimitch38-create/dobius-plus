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

export const BOARD_LOOP_TEMPLATES: readonly BoardLoopTemplate[] = [
  {
    id: 'progress-checkin',
    title: 'Progress check-in',
    description: 'Ask every running agent for a short status summary on a fixed schedule.',
    icon: 'activity',
    trigger: { kind: 'schedule', everyMinutes: 15 },
    target: 'every-console',
    instruction:
      'Summarize in two sentences what you completed since the last check-in and what you are working on next. Do not start new work.',
    stop: { timeLimitMinutes: 120 }
  },
  {
    id: 'idle-nudge',
    title: 'Idle nudge',
    description: 'Nudge an agent that has gone quiet, so long-running tasks keep moving.',
    icon: 'zap',
    trigger: { kind: 'on-idle', debounceMs: 120000 },
    target: 'selected',
    instruction:
      'If you have unfinished work, continue it now. If you are finished or blocked, reply with your final status. Keep the reply under three sentences.',
    stop: { maxRuns: 10 }
  },
  {
    id: 'build-rescue',
    title: 'Build rescue',
    description: 'When a build error appears in the output, ask the agent to fix the cause.',
    icon: 'life-buoy',
    trigger: {
      kind: 'on-output-match',
      pattern: 'error TS\\d{4}:|Build failed|Module not found',
      cooldownMs: 180000
    },
    target: 'every-console',
    instruction:
      'The build just failed. Read the newest compiler or bundler error, fix its root cause, and rerun the build to confirm it passes. Do not touch unrelated files.',
    stop: { untilCommandPasses: 'pnpm run build' }
  },
  {
    id: 'test-watch',
    title: 'Test watcher',
    description: 'React to failing test output by sending a targeted fix request.',
    icon: 'flask-conical',
    trigger: {
      kind: 'on-output-match',
      pattern: '\\b\\d+ failed\\b|Tests:\\s*\\d+ failed|FAIL\\b',
      cooldownMs: 180000
    },
    target: 'every-console',
    instruction:
      'Tests just failed. Pick the first failing test, fix the smallest possible cause, then rerun that test to confirm it turns green.',
    stop: { untilCommandPasses: 'pnpm exec vitest run' }
  },
  {
    id: 'commit-checkpoint',
    title: 'Commit checkpoint',
    description: 'Periodically commit staged progress so work is never lost.',
    icon: 'git-commit',
    trigger: { kind: 'schedule', everyMinutes: 30 },
    target: 'every-console',
    instruction:
      'Review your uncommitted changes. If they form a coherent unit, stage exactly the files you changed and create one commit with a concise message describing the why. Do not commit or push anything else.',
    stop: { maxRuns: 16 }
  },
  {
    id: 'review-sweep',
    title: 'Review sweep',
    description: 'A slow loop that asks for a lightweight self review on a schedule.',
    icon: 'eye',
    trigger: { kind: 'schedule', everyMinutes: 45 },
    target: 'group',
    instruction:
      'Reread the files you changed in this session. List at most three concrete problems worth fixing, ranked by severity. Fix only the top item, then stop.',
    stop: { timeLimitMinutes: 240 }
  },
  {
    id: 'standup-summary',
    title: 'Standup summary',
    description: 'Collect an hourly written standup from every console on the board.',
    icon: 'clock',
    trigger: { kind: 'schedule', everyMinutes: 60 },
    target: 'every-console',
    instruction:
      'Write a standup entry with three short lines: done, doing, and blockers. Include file names for anything you touched. Do not run commands.',
    stop: { timeLimitMinutes: 480 }
  }
]

export function getLoopTemplate(id: string): BoardLoopTemplate | undefined {
  return BOARD_LOOP_TEMPLATES.find((template) => template.id === id)
}
