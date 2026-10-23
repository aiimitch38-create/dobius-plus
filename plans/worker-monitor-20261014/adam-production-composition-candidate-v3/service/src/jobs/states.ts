export const JOB_STATES = [
  'received',
  'interpreting',
  'awaiting_clarification',
  'planning',
  'awaiting_approval',
  'preflight',
  'running',
  'monitoring',
  'recovering',
  'verifying',
  'awaiting_external',
  'completed',
  'reported',
  'followup_due',
  'cancelled',
  'rolled_back',
  'failed',
  'blocked'
] as const

export type JobState = (typeof JOB_STATES)[number]

export const TERMINAL_JOB_STATES = new Set<JobState>([
  'reported',
  'cancelled',
  'rolled_back',
  'failed',
  'blocked'
])

const TRANSITIONS: Record<JobState, readonly JobState[]> = {
  received: ['interpreting', 'cancelled', 'failed'],
  interpreting: ['awaiting_clarification', 'planning', 'cancelled', 'failed'],
  awaiting_clarification: ['interpreting', 'cancelled', 'blocked'],
  planning: ['awaiting_approval', 'preflight', 'cancelled', 'failed'],
  awaiting_approval: ['preflight', 'cancelled', 'blocked'],
  preflight: ['running', 'awaiting_approval', 'cancelled', 'failed', 'blocked'],
  running: ['monitoring', 'recovering', 'verifying', 'awaiting_external', 'cancelled', 'failed'],
  monitoring: ['running', 'recovering', 'verifying', 'awaiting_external', 'cancelled', 'failed'],
  recovering: ['running', 'awaiting_approval', 'rolled_back', 'failed', 'blocked', 'cancelled'],
  verifying: ['completed', 'recovering', 'failed', 'blocked'],
  awaiting_external: ['running', 'verifying', 'followup_due', 'cancelled', 'blocked'],
  completed: ['reported', 'followup_due'],
  reported: [],
  followup_due: ['running', 'cancelled', 'blocked'],
  cancelled: [],
  rolled_back: [],
  failed: [],
  blocked: ['planning', 'running', 'cancelled']
}

export function canTransition(from: JobState, to: JobState): boolean {
  return TRANSITIONS[from].includes(to)
}

