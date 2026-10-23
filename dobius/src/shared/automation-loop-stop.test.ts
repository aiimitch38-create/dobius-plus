import { describe, expect, it } from 'vitest'
import {
  LOOP_STOP_CHECK_MAX_DELAY_MS,
  LOOP_STOP_CHECK_MIN_DELAY_MS,
  runsExhausted,
  stopCheckDue,
  stopCommandProblem
} from './automation-loop-stop'
import { normalizeAutomationLoop } from './automation-loops'

describe('stopCommandProblem', () => {
  it.each([
    'pnpm run build',
    'pnpm exec vitest run',
    'npm test',
    'cargo test',
    'go test ./...',
    'git diff --exit-code',
    'pytest -k login'
  ])('allows the plain check "%s"', (command) => {
    expect(stopCommandProblem(command)).toBeNull()
  })
  it.each([
    ['', 'empty'],
    ['pnpm test && git push', 'shell'],
    ['pnpm test; rm -rf ~', 'shell'],
    ['echo $(whoami)', 'shell'],
    ['pnpm test > out.txt', 'shell'],
    ['rm -rf dist', 'destructive'],
    ['sudo make test', 'destructive'],
    ['git reset --hard', 'destructive'],
    ['pnpm install', 'destructive'],
    ['npm publish', 'destructive'],
    ['eslint . --fix', 'destructive'],
    ['find . -delete', 'destructive'],
    ['/bin/rm -r build', 'destructive'],
    ['claude --dangerously-skip-permissions', 'destructive'],
    // Quoting would let the shell strip quotes after the word check ran.
    ["'rm' -rf ~", 'shell'],
    ['r"m" -rf build', 'shell'],
    ['pytest -k "login"', 'shell'],
    ['ls *', 'shell'],
    ['bash -c pnpm-test', 'destructive'],
    ['node -e process.exit', 'destructive'],
    ['python3 -m pytest', 'destructive'],
    ['npx rimraf dist', 'destructive'],
    ['pnpm exec rm -r dist', 'destructive'],
    ['perl5 -e die', 'destructive'],
    ['tar xf a.tar -C /', 'destructive']
  ])('refuses "%s" (%s)', (command, problem) => {
    expect(stopCommandProblem(command)).toBe(problem)
  })
  it('refuses overly long commands', () => {
    expect(stopCommandProblem(`pnpm test ${'a'.repeat(300)}`)).toBe('too_long')
  })
})

describe('stopCheckDue', () => {
  it('waits for the minimum delay and for idle, up to the maximum delay', () => {
    const base = { pendingSince: 0, targetsWorking: false }
    expect(stopCheckDue({ ...base, pendingSince: null, now: 1e9 })).toBe(false)
    expect(stopCheckDue({ ...base, now: LOOP_STOP_CHECK_MIN_DELAY_MS - 1 })).toBe(false)
    expect(stopCheckDue({ ...base, now: LOOP_STOP_CHECK_MIN_DELAY_MS })).toBe(true)
    expect(
      stopCheckDue({ ...base, targetsWorking: true, now: LOOP_STOP_CHECK_MAX_DELAY_MS - 1 })
    ).toBe(false)
    expect(stopCheckDue({ ...base, targetsWorking: true, now: LOOP_STOP_CHECK_MAX_DELAY_MS })).toBe(
      true
    )
  })
})

describe('runsExhausted', () => {
  it('only applies with a cap', () => {
    expect(runsExhausted(undefined, 99)).toBe(false)
    expect(runsExhausted(3, 2)).toBe(false)
    expect(runsExhausted(3, 3)).toBe(true)
  })
})

describe('normalizeAutomationLoop stop fields', () => {
  const trigger = { kind: 'on-idle', target: { type: 'board' }, debounceMs: 5_000 }
  it('keeps a run cap and a stop command', () => {
    expect(
      normalizeAutomationLoop({
        worktreeId: 'w',
        trigger,
        stopAfterRuns: 4,
        stopCommand: ' pnpm test ',
        state: { stopCheckSince: 12 }
      })
    ).toMatchObject({ stopAfterRuns: 4, stopCommand: 'pnpm test', state: { stopCheckSince: 12 } })
  })
  it('drops invalid values', () => {
    const loop = normalizeAutomationLoop({
      worktreeId: 'w',
      trigger,
      stopAfterRuns: 0,
      stopCommand: 'x'.repeat(500)
    })
    expect(loop).not.toHaveProperty('stopAfterRuns')
    expect(loop).not.toHaveProperty('stopCommand')
    expect(loop?.state.stopCheckSince).toBeNull()
  })
})
