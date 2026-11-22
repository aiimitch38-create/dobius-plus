// `dobius automations create --loop` / `edit`: the loop flags, checked here so
// a mistake is caught before anything is sent. Main checks them again.
import { LOOP_MAX_RUNS_LIMIT } from '../../shared/automation-loops'
import { getOptionalPositiveIntegerFlag, getOptionalStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'
import { BOARD_CARD_ADDRESS_PREFIX } from '../selectors'

type Flags = Map<string, string | boolean>

export type LoopCreateFlags = {
  goal: string
  maxIterations: number
  stopWhen?: string
  card?: string
}

export type LoopUpdateFlags = {
  goal?: string
  maxIterations?: number
  stopWhen?: string | null
  card?: string
}

const LOOP_ONLY_FLAGS = ['goal', 'max-iterations', 'stop-when', 'card'] as const

function maxIterations(flags: Flags): number | undefined {
  const value = getOptionalPositiveIntegerFlag(flags, 'max-iterations')
  if (value !== undefined && value > LOOP_MAX_RUNS_LIMIT) {
    throw new RuntimeClientError(
      'loop_iteration_cap',
      `--max-iterations is at most ${LOOP_MAX_RUNS_LIMIT} (each iteration is a paid agent run); got ${value}.`
    )
  }
  return value
}

function card(flags: Flags): string | undefined {
  if (!flags.has('card')) {
    return undefined
  }
  const raw = getOptionalStringFlag(flags, 'card')?.trim() ?? ''
  const name = (raw.startsWith(BOARD_CARD_ADDRESS_PREFIX) ? raw.slice(BOARD_CARD_ADDRESS_PREFIX.length) : raw).trim()
  // Why refuse: an empty --card would otherwise mean "the whole Board".
  if (!name) {
    throw new RuntimeClientError('invalid_argument', '--card needs a card id or title (leave it out to loop over the whole Board)')
  }
  return name
}

export function isLoopCreate(flags: Flags): boolean {
  const loop = flags.get('loop')
  if (typeof loop === 'string') {
    throw new RuntimeClientError('invalid_argument', '--loop does not take a value')
  }
  if (loop !== true) {
    const stray = LOOP_ONLY_FLAGS.find((flag) => flags.has(flag))
    if (stray) {
      throw new RuntimeClientError('invalid_argument', `--${stray} needs --loop`)
    }
    return false
  }
  return true
}

export function getLoopCreateFlags(flags: Flags): LoopCreateFlags {
  const goal = getOptionalStringFlag(flags, 'goal')?.trim()
  if (!goal) {
    throw new RuntimeClientError('invalid_argument', 'A loop needs --goal <text>')
  }
  const cap = maxIterations(flags)
  if (cap === undefined) {
    throw new RuntimeClientError(
      'invalid_argument',
      `A loop needs --max-iterations <n> (1 to ${LOOP_MAX_RUNS_LIMIT}) so it cannot run forever`
    )
  }
  for (const flag of ['trigger', 'schedule', 'precheck', 'repo', 'reuse-session'] as const) {
    if (flags.has(flag)) {
      throw new RuntimeClientError('invalid_argument', `--${flag} does not apply to a loop`)
    }
  }
  const stopWhen = getOptionalStringFlag(flags, 'stop-when')?.trim()
  const target = card(flags)
  return {
    goal,
    maxIterations: cap,
    ...(stopWhen ? { stopWhen } : {}),
    ...(target ? { card: target } : {})
  }
}

/** Loop edits for `automations edit`, or undefined when none of the loop flags is set. */
export function getLoopUpdateFlags(flags: Flags): LoopUpdateFlags | undefined {
  if (!LOOP_ONLY_FLAGS.some((flag) => flags.has(flag))) {
    return undefined
  }
  const goal = getOptionalStringFlag(flags, 'goal')?.trim()
  if (flags.has('goal') && !goal) {
    throw new RuntimeClientError('invalid_argument', '--goal needs text')
  }
  const rawStop = flags.get('stop-when')
  if (rawStop === true) {
    throw new RuntimeClientError('invalid_argument', '--stop-when needs a command, or "" to remove it')
  }
  const cap = maxIterations(flags)
  const target = card(flags)
  return {
    ...(goal ? { goal } : {}),
    ...(cap !== undefined ? { maxIterations: cap } : {}),
    // "" removes the stop command.
    ...(typeof rawStop === 'string' ? { stopWhen: rawStop.trim() || null } : {}),
    ...(target ? { card: target } : {})
  }
}
