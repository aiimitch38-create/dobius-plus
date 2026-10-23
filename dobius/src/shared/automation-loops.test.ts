import { describe, expect, it } from 'vitest'
import {
  INITIAL_IDLE_WATCH,
  LOOP_PATTERN_MAX_LENGTH,
  admitGoalStep,
  admitLoopFire,
  admitOutputMatch,
  buildGoalPrompt,
  idleWatchDue,
  newLoopState,
  normalizeAutomationLoop,
  readGoalVerdict,
  stepIdleWatch,
  isUnsafeLoopPattern,
  validateLoopPattern
} from './automation-loops'

const active = newLoopState()

describe('validateLoopPattern', () => {
  it('accepts a valid regex and rejects empty, oversized and broken ones', () => {
    expect(validateLoopPattern('error|fail').ok).toBe(true)
    expect(validateLoopPattern('  ')).toEqual({ ok: false, error: 'empty' })
    expect(validateLoopPattern('a'.repeat(LOOP_PATTERN_MAX_LENGTH + 1))).toEqual({
      ok: false,
      error: 'too_long'
    })
    expect(validateLoopPattern('(')).toEqual({ ok: false, error: 'invalid' })
  })
})

describe('isUnsafeLoopPattern', () => {
  it.each([
    '(a+)+$',
    '(a*)*',
    '((a+))+',
    '(a|a)*',
    '(x+y){2,}',
    '(\\d+)+',
    '(.)\\1',
    '(?<n>a)\\k<n>',
    '.*.*.*.*x'
  ])('rejects %s', (pattern) => {
    expect(isUnsafeLoopPattern(pattern)).toBe(true)
    expect(validateLoopPattern(pattern)).toEqual({ ok: false, error: 'unsafe' })
  })
  it.each([
    'FAIL',
    'error|fail',
    'tests? (passed|failed)',
    '(abc)+',
    '[a+]+',
    '\\d{1,3} errors',
    '(a+)?',
    '^ERR.*$'
  ])('accepts %s', (pattern) => {
    expect(isUnsafeLoopPattern(pattern)).toBe(false)
  })
})

describe('normalizeAutomationLoop (migration)', () => {
  it('treats legacy automations without a loop as not-a-loop', () => {
    expect(normalizeAutomationLoop(undefined)).toBeNull()
    expect(normalizeAutomationLoop(null)).toBeNull()
  })
  it('fills missing state and clamps limits', () => {
    const loop = normalizeAutomationLoop({
      worktreeId: 'wt',
      trigger: {
        kind: 'goal',
        target: { type: 'tab', tabId: 't' },
        goal: 'ship',
        maxRuns: 999,
        checkEveryMs: 1
      }
    })
    expect(loop?.state).toEqual(newLoopState())
    expect(loop?.trigger).toMatchObject({ maxRuns: 50, checkEveryMs: 30_000 })
  })
  it('drops loops with an invalid pattern or unknown kind', () => {
    expect(
      normalizeAutomationLoop({
        worktreeId: 'wt',
        trigger: { kind: 'on-output-match', tabId: 't', pattern: '(' }
      })
    ).toBeNull()
    expect(normalizeAutomationLoop({ worktreeId: 'wt', trigger: { kind: 'cron' } })).toBeNull()
  })
})

describe('admitLoopFire', () => {
  it('blocks paused, retired and too-soon fires', () => {
    expect(admitLoopFire(active, 100, 50)).toBe(true)
    expect(admitLoopFire({ ...active, paused: true }, 100, 50)).toBe(false)
    expect(admitLoopFire({ ...active, retiredAt: 1 }, 100, 50)).toBe(false)
    expect(admitLoopFire({ ...active, lastFiredAt: 80 }, 100, 50)).toBe(false)
    expect(admitLoopFire({ ...active, lastFiredAt: 50 }, 100, 50)).toBe(true)
  })
})

describe('on-idle watch', () => {
  it('fires once per working episode after the debounce', () => {
    let w = stepIdleWatch(INITIAL_IDLE_WATCH, false, 0)
    expect(w.armed).toBe(false)
    w = stepIdleWatch(w, true, 10)
    w = stepIdleWatch(w, false, 20)
    expect(idleWatchDue(w, 24, 5)).toBe(false)
    expect(idleWatchDue(w, 25, 5)).toBe(true)
    // repeated idle reports keep the original idle start
    expect(stepIdleWatch(w, false, 30)).toBe(w)
  })
  it('going back to working during the debounce cancels it', () => {
    let w = stepIdleWatch(stepIdleWatch(INITIAL_IDLE_WATCH, true, 0), false, 10)
    w = stepIdleWatch(w, true, 12)
    expect(idleWatchDue(w, 100, 5)).toBe(false)
  })
  it('a disarmed watch (after firing) needs new work before it can fire again', () => {
    const fired = INITIAL_IDLE_WATCH
    expect(idleWatchDue(stepIdleWatch(fired, false, 50), 100, 5)).toBe(false)
  })
})

describe('admitOutputMatch', () => {
  const base = { state: active, hadCursor: true, matched: true, now: 1_000, cooldownMs: 100 }
  it('first read is a baseline, never a fire', () => {
    expect(admitOutputMatch({ ...base, hadCursor: false })).toEqual({
      fire: false,
      reason: 'baseline'
    })
  })
  it('fires on a match', () => {
    expect(admitOutputMatch(base)).toEqual({ fire: true })
  })
  it('respects cooldown, inactive loops and no match', () => {
    expect(admitOutputMatch({ ...base, state: { ...active, lastFiredAt: 950 } })).toEqual({
      fire: false,
      reason: 'cooldown'
    })
    expect(admitOutputMatch({ ...base, state: { ...active, paused: true } }).fire).toBe(false)
    expect(admitOutputMatch({ ...base, matched: false })).toEqual({
      fire: false,
      reason: 'no_match'
    })
  })
})

describe('goal', () => {
  it('never reads the echoed prompt as a verdict', () => {
    expect(readGoalVerdict(buildGoalPrompt('ship it').split('\n'))).toBeNull()
  })
  it('reads the last verdict line, tolerating TUI bullets', () => {
    expect(readGoalVerdict(['⏺ DOBIUS_GOAL=NOT_MET', 'more', '  DOBIUS_GOAL=MET  '])).toBe('met')
    expect(readGoalVerdict(['⏺ DOBIUS_GOAL=NOT_MET'])).toBe('not-met')
  })
  const step = (over: Partial<Parameters<typeof admitGoalStep>[0]>) =>
    admitGoalStep({
      state: active,
      verdict: null,
      now: 1_000,
      checkEveryMs: 100,
      maxRuns: 3,
      ...over
    })
  it('fires first, waits for a verdict, refires after checkEvery, retires when met or exhausted', () => {
    expect(step({})).toBe('fire')
    const ran = { ...active, runCount: 1, lastFiredAt: 950 }
    expect(step({ state: ran })).toBe('wait')
    expect(step({ state: ran, verdict: 'not-met' })).toBe('wait')
    expect(step({ state: { ...ran, lastFiredAt: 800 }, verdict: 'not-met' })).toBe('fire')
    expect(step({ state: ran, verdict: 'met' })).toBe('retire-met')
    expect(step({ state: { ...ran, runCount: 3, lastFiredAt: 0 }, verdict: 'not-met' })).toBe(
      'retire-exhausted'
    )
    expect(step({ state: { ...active, paused: true } })).toBe('inactive')
  })
})
