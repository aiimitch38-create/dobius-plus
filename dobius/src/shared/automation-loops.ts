import type {
  AutomationLoop,
  AutomationLoopState,
  AutomationLoopTarget,
  AutomationLoopTrigger
} from './automations-types'

// Pure admission rules for Board loops. Main (output-match, goal) and the
// renderer (on-idle observer) share these so both sides agree on when to fire.

// Why: loops are stored as automations, which require a valid rrule; the
// scheduler skips any automation with a loop, so this never fires.
export const LOOP_PLACEHOLDER_RRULE = 'FREQ=DAILY;BYHOUR=0;BYMINUTE=0'
export const LOOP_PATTERN_MAX_LENGTH = 200
export const LOOP_MIN_DEBOUNCE_MS = 1_000
export const LOOP_MIN_COOLDOWN_MS = 5_000
export const LOOP_MIN_CHECK_EVERY_MS = 30_000
export const LOOP_MAX_RUNS_LIMIT = 50
export const LOOP_MIN_SCHEDULE_MS = 60_000
export const LOOP_MAX_SCHEDULE_MS = 24 * 60 * 60 * 1000
// Why: user patterns run on the main process. The shape check below rejects
// the patterns that backtrack exponentially before they are saved; main also
// runs every match under a hard time budget (main/automations/loop-pattern-match.ts).
// Why: three unbounded quantifiers on a 500-char line is ~10^7 steps worst case;
// more is where polynomial backtracking starts to stall main.
const MAX_UNBOUNDED_QUANTIFIERS = 3

/**
 * Rejects pattern shapes that backtrack catastrophically: a repeated group that
 * itself contains a quantifier or alternation ((a+)+, (a|a)*, ((x*))+), any
 * backreference, and too many unbounded quantifiers overall.
 * ponytail: a shape check, not a full regex parser; a worker with a timeout is
 * the upgrade if users need arbitrary patterns.
 */
export function isUnsafeLoopPattern(pattern: string): boolean {
  type Group = { risky: boolean }
  const stack: Group[] = [{ risky: false }]
  let unbounded = 0
  let lastWasGroupClose: Group | null = null
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]
    const top = stack.at(-1)!
    const closed = lastWasGroupClose
    lastWasGroupClose = null
    if (ch === '\\') {
      if (/[1-9k]/.test(pattern[i + 1] ?? '')) {
        return true
      }
      i += 1
      continue
    }
    if (ch === '[') {
      // Skip a character class; quantifier characters inside it are literals.
      i += 1
      while (i < pattern.length && pattern[i] !== ']') {
        i += pattern[i] === '\\' ? 2 : 1
      }
      continue
    }
    if (ch === '(') {
      stack.push({ risky: false })
      continue
    }
    if (ch === ')') {
      const group = stack.length > 1 ? stack.pop()! : top
      // A risky group makes its parent risky too, so ((a+))+ is still caught.
      if (group.risky) {
        stack.at(-1)!.risky = true
      }
      lastWasGroupClose = group
      continue
    }
    if (ch === '|') {
      top.risky = true
      continue
    }
    const brace = ch === '{' ? /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i)) : null
    const isQuantifier = ch === '*' || ch === '+' || ch === '?' || brace !== null
    if (!isQuantifier) {
      continue
    }
    // Why: an exact repeat like {12} multiplies backtracking just like + does.
    const repeats =
      ch === '*' ||
      ch === '+' ||
      (brace !== null &&
        (brace[2] === undefined ? Number(brace[1]) > 1 : brace[3] === '' || Number(brace[3]) > 1))
    if (ch === '*' || ch === '+' || (brace && brace[2] !== undefined && brace[3] === '')) {
      unbounded += 1
    }
    if (repeats && closed?.risky) {
      return true
    }
    top.risky = true
    if (brace) {
      i += brace[0].length - 1
    }
  }
  return unbounded > MAX_UNBOUNDED_QUANTIFIERS
}

export function newLoopState(): AutomationLoopState {
  return {
    paused: false,
    runCount: 0,
    lastFiredAt: null,
    outputCursor: null,
    retiredAt: null,
    lastResult: null,
    lastVerdict: null
  }
}

export function validateLoopPattern(
  pattern: string
): { ok: true; regex: RegExp } | { ok: false; error: string } {
  if (pattern.trim().length === 0) {
    return { ok: false, error: 'empty' }
  }
  if (pattern.length > LOOP_PATTERN_MAX_LENGTH) {
    return { ok: false, error: 'too_long' }
  }
  if (isUnsafeLoopPattern(pattern)) {
    return { ok: false, error: 'unsafe' }
  }
  try {
    return { ok: true, regex: new RegExp(pattern) }
  } catch {
    return { ok: false, error: 'invalid' }
  }
}

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const num = (v: unknown, min: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : fallback

function normalizeTarget(raw: unknown): AutomationLoopTarget | null {
  if (!isObj(raw)) {
    return null
  }
  if (raw.type === 'tab' && isStr(raw.tabId)) {
    return { type: 'tab', tabId: raw.tabId }
  }
  if (raw.type === 'group' && isStr(raw.groupId)) {
    return { type: 'group', groupId: raw.groupId }
  }
  if (raw.type === 'board') {
    return { type: 'board' }
  }
  if (raw.type === 'orchestrator' && isStr(raw.cardId)) {
    return { type: 'orchestrator', cardId: raw.cardId }
  }
  return null
}

function normalizeTrigger(raw: unknown): AutomationLoopTrigger | null {
  if (!isObj(raw)) {
    return null
  }
  if (raw.kind === 'on-idle') {
    const target = normalizeTarget(raw.target)
    return target
      ? { kind: 'on-idle', target, debounceMs: num(raw.debounceMs, LOOP_MIN_DEBOUNCE_MS, 5_000) }
      : null
  }
  if (raw.kind === 'on-output-match') {
    return isStr(raw.tabId) &&
      typeof raw.pattern === 'string' &&
      validateLoopPattern(raw.pattern).ok
      ? {
          kind: 'on-output-match',
          tabId: raw.tabId,
          pattern: raw.pattern,
          cooldownMs: num(raw.cooldownMs, LOOP_MIN_COOLDOWN_MS, 60_000)
        }
      : null
  }
  if (raw.kind === 'goal') {
    const target = normalizeTarget(raw.target)
    return target && isStr(raw.goal)
      ? {
          kind: 'goal',
          target,
          goal: raw.goal,
          checkEveryMs: num(raw.checkEveryMs, LOOP_MIN_CHECK_EVERY_MS, 120_000),
          maxRuns: Math.min(LOOP_MAX_RUNS_LIMIT, Math.round(num(raw.maxRuns, 1, 5)))
        }
      : null
  }
  if (raw.kind === 'schedule') {
    const target = normalizeTarget(raw.target)
    return target
      ? {
          kind: 'schedule',
          target,
          everyMs: Math.min(
            LOOP_MAX_SCHEDULE_MS,
            num(raw.everyMs, LOOP_MIN_SCHEDULE_MS, 15 * 60_000)
          )
        }
      : null
  }
  return null
}

/** Validates a persisted loop; null means "not a runnable loop" (legacy or corrupt). */
export function normalizeAutomationLoop(raw: unknown): AutomationLoop | null {
  if (!isObj(raw) || !isStr(raw.worktreeId)) {
    return null
  }
  const trigger = normalizeTrigger(raw.trigger)
  if (!trigger) {
    return null
  }
  const s = isObj(raw.state) ? raw.state : {}
  const stopAfterMs =
    typeof raw.stopAfterMs === 'number' && Number.isFinite(raw.stopAfterMs) && raw.stopAfterMs > 0
      ? Math.max(LOOP_MIN_SCHEDULE_MS, raw.stopAfterMs)
      : undefined
  return {
    worktreeId: raw.worktreeId,
    trigger,
    ...(stopAfterMs ? { stopAfterMs } : {}),
    state: {
      paused: s.paused === true,
      runCount: Math.round(num(s.runCount, 0, 0)),
      lastFiredAt: typeof s.lastFiredAt === 'number' ? s.lastFiredAt : null,
      outputCursor: typeof s.outputCursor === 'string' ? s.outputCursor : null,
      retiredAt: typeof s.retiredAt === 'number' ? s.retiredAt : null,
      lastResult: typeof s.lastResult === 'string' ? s.lastResult : null,
      lastVerdict: s.lastVerdict === 'met' || s.lastVerdict === 'not-met' ? s.lastVerdict : null
    }
  }
}

export function isLoopActive(state: AutomationLoopState): boolean {
  return !state.paused && state.retiredAt === null
}

/** Shared gate for every fire: a loop never fires twice inside its own minimum gap. */
export function admitLoopFire(state: AutomationLoopState, now: number, minGapMs: number): boolean {
  return isLoopActive(state) && (state.lastFiredAt === null || now - state.lastFiredAt >= minGapMs)
}

// ---- on-idle -------------------------------------------------------------

export type IdleWatch = { armed: boolean; idleSince: number | null }
export const INITIAL_IDLE_WATCH: IdleWatch = { armed: false, idleSince: null }

/**
 * Why: a loop fires once per working episode. Seeing "working" arms it; the
 * first idle/done after that starts the debounce clock; a fire disarms it, so
 * repeated idle reports for the same episode never fire twice.
 */
export function stepIdleWatch(watch: IdleWatch, working: boolean, now: number): IdleWatch {
  if (working) {
    return watch.armed && watch.idleSince === null ? watch : { armed: true, idleSince: null }
  }
  if (!watch.armed || watch.idleSince !== null) {
    return watch
  }
  return { armed: true, idleSince: now }
}

export function idleWatchDue(watch: IdleWatch, now: number, debounceMs: number): boolean {
  return watch.armed && watch.idleSince !== null && now - watch.idleSince >= debounceMs
}

// ---- on-output-match ----------------------------------------------------

export type OutputMatchDecision =
  | { fire: false; reason: 'baseline' | 'no_match' | 'cooldown' | 'inactive' }
  | { fire: true }

/**
 * The caller always advances the cursor past the judged output after this, so
 * any output range is judged exactly once. The first read only sets a baseline: old
 * scrollback never triggers a loop that was just created.
 */
export function admitOutputMatch(input: {
  state: AutomationLoopState
  hadCursor: boolean
  /** Whether the new output matched; matching itself runs time-bounded in main. */
  matched: boolean
  now: number
  cooldownMs: number
}): OutputMatchDecision {
  if (!isLoopActive(input.state)) {
    return { fire: false, reason: 'inactive' }
  }
  if (!input.hadCursor) {
    return { fire: false, reason: 'baseline' }
  }
  if (!input.matched) {
    return { fire: false, reason: 'no_match' }
  }
  if (input.state.lastFiredAt !== null && input.now - input.state.lastFiredAt < input.cooldownMs) {
    return { fire: false, reason: 'cooldown' }
  }
  return { fire: true }
}

// ---- goal ----------------------------------------------------------------

const GOAL_VERDICT_RE = /^[^A-Za-z0-9]*DOBIUS_GOAL=(MET|NOT_MET)\s*$/

export function buildGoalPrompt(goal: string): string {
  // Why: the echoed prompt line contains the placeholder, not a bare verdict,
  // so it can never be mistaken for the agent's answer.
  return `${goal.trim()}\n\nWhen you stop, print one final line that is exactly DOBIUS_GOAL=<MET|NOT_MET> saying whether this goal is now met.`
}

/** The agent's last verdict line in `lines`, or null if it has not answered yet. */
export function readGoalVerdict(lines: readonly string[]): 'met' | 'not-met' | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = GOAL_VERDICT_RE.exec(lines[i].trim())
    if (match) {
      return match[1] === 'MET' ? 'met' : 'not-met'
    }
  }
  return null
}

export type GoalDecision = 'fire' | 'wait' | 'retire-met' | 'retire-exhausted' | 'inactive'

export function admitGoalStep(input: {
  state: AutomationLoopState
  verdict: 'met' | 'not-met' | null
  now: number
  checkEveryMs: number
  maxRuns: number
}): GoalDecision {
  const { state, verdict, now } = input
  if (!isLoopActive(state)) {
    return 'inactive'
  }
  if (verdict === 'met') {
    return 'retire-met'
  }
  if (state.runCount === 0) {
    return 'fire'
  }
  // Why: no verdict means the agent is still on the last run; never stack runs.
  if (verdict === null) {
    return 'wait'
  }
  if (state.runCount >= input.maxRuns) {
    return 'retire-exhausted'
  }
  return state.lastFiredAt === null || now - state.lastFiredAt >= input.checkEveryMs
    ? 'fire'
    : 'wait'
}
