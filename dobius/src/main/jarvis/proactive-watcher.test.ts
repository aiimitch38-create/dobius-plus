import { describe, expect, it, vi } from 'vitest'
import type { TerminalActivity } from './terminal-history-context'
import {
  COOLDOWN_MS,
  MAX_STALENESS_MS,
  MIN_SILENCE_MS,
  ProactiveWatcher,
  classifyOutcome,
  decideProactive,
  isQuietHours
} from './proactive-watcher'

const NOON = new Date(2026, 7, 29, 12, 0, 0).getTime()

function activity(overrides: Partial<TerminalActivity> = {}): TerminalActivity {
  return {
    worktreePath: '/Users/bayou/Projects (Code)/dobius-adam',
    lastActiveAt: NOON - MIN_SILENCE_MS - 1_000,
    recentOutput: 'Tests  1 failed | 29 passed (30)',
    ...overrides
  }
}

function input(overrides: Partial<Parameters<typeof decideProactive>[0]> = {}) {
  return {
    activities: [activity()],
    now: NOON,
    lastSpokeAt: 0,
    announced: new Map<string, number>(),
    settings: { enabled: true },
    ...overrides
  }
}

describe('classifyOutcome', () => {
  it('reads a vitest failure line as failed', () => {
    expect(classifyOutcome('Tests  1 failed | 29 passed (30)')).toBe('failed')
  })

  it('reads a clean vitest run as passed', () => {
    expect(classifyOutcome('Tests  339 passed (339)')).toBe('passed')
  })

  it('reads a vite build line as passed', () => {
    expect(classifyOutcome('✓ built in 2m 2s')).toBe('passed')
  })

  it('reads a failure glyph as failed', () => {
    expect(classifyOutcome('✗ build/lint')).toBe('failed')
  })

  it('says nothing about a tail with no completion marker', () => {
    // The gate that kills the false positives: an agent sitting at a permission
    // prompt is quiet, and quiet is not the same as finished.
    expect(classifyOutcome('Do you want to proceed? 1. Yes  2. No')).toBeNull()
    expect(classifyOutcome('bayou@mac dobius %')).toBeNull()
  })

  it('lets a failure outrank a pass in the same run', () => {
    expect(classifyOutcome('Test Files  1 failed | 29 passed (30)')).toBe('failed')
  })
})

describe('classifyOutcome — successes that contain a failure word', () => {
  // Each of these strings was produced by this repo's own tooling during this
  // build. Announcing any of them as a failure is the "intolerable if it is
  // wrong" risk the design names.
  it('does not call "exit code 0" a failure', () => {
    expect(classifyOutcome('process finished with exit code 0')).toBe('passed')
  })

  it('does not call "0 errors" a failure', () => {
    expect(classifyOutcome('Found 0 errors. Done.')).toBe('passed')
  })

  it('does not call "no errors" a failure', () => {
    expect(classifyOutcome('Compiled with no errors, built in 400ms')).toBe('passed')
  })

  it('does not call "0 failed" a failure', () => {
    expect(classifyOutcome('Tests  0 failed | 12 passed')).toBe('passed')
  })

  it('still catches a real non-zero exit', () => {
    expect(classifyOutcome('process finished with exit code 1')).toBe('failed')
  })
})

describe('classifyOutcome — a filename is not an outcome', () => {
  // Regression: `error` was matched as a bare substring, so a filename
  // containing it made a PASSING run announce as a failure. This repo's own
  // src/ holds ten files with `error` in the name, so it fired constantly.
  it('reads a green vitest run that names error-related test files as passed', () => {
    const tail = [
      ' ✓ src/shared/codex-auth-errors.test.ts (12 tests) 30ms',
      ' ✓ src/shared/git-remote-error.test.ts (8 tests) 12ms',
      '',
      ' Test Files  2 passed (2)',
      '      Tests  20 passed (20)'
    ].join('\n')
    expect(classifyOutcome(tail)).toBe('passed')
  })

  it('reads a clean vite build listing an ErrorBoundary chunk as passed', () => {
    const tail = ['out/renderer/assets/ErrorBoundary-Ab12Cd.js   4.10 kB', '✓ built in 2m 2s'].join(
      '\n'
    )
    expect(classifyOutcome(tail)).toBe('passed')
  })

  it('still reads a real vitest failure as failed, path and all', () => {
    const tail = [
      ' FAIL  src/main/window/attach-main-window-services.test.ts',
      ' Test Files  1 failed | 29 passed (30)'
    ].join('\n')
    expect(classifyOutcome(tail)).toBe('failed')
  })

  it('still reads a thrown error as failed once its path is stripped', () => {
    expect(classifyOutcome('Error: ENOENT, open /tmp/missing.json')).toBe('failed')
  })
})

describe('isQuietHours', () => {
  it('is quiet inside a window that wraps midnight', () => {
    expect(isQuietHours(new Date(2026, 7, 29, 23, 0).getTime(), 22, 8)).toBe(true)
    expect(isQuietHours(new Date(2026, 7, 29, 3, 0).getTime(), 22, 8)).toBe(true)
  })

  it('is not quiet during the working day', () => {
    expect(isQuietHours(NOON, 22, 8)).toBe(false)
  })

  it('is never quiet when the window is empty', () => {
    expect(isQuietHours(NOON, 8, 8)).toBe(false)
  })
})

describe('decideProactive — the four gates, each on its own', () => {
  it('speaks when every gate passes', () => {
    const decision = decideProactive(input())
    expect(decision?.text).toBe('The run in dobius-adam failed.')
  })

  it('GATE 1 — says nothing without a completion marker', () => {
    const decision = decideProactive(
      input({ activities: [activity({ recentOutput: 'Do you want to proceed? 1. Yes' })] })
    )
    expect(decision).toBeNull()
  })

  it('GATE 2 — says nothing about a terminal that is still busy', () => {
    const decision = decideProactive(
      input({ activities: [activity({ lastActiveAt: NOON - (MIN_SILENCE_MS - 5_000) })] })
    )
    expect(decision).toBeNull()
  })

  it('GATE 3 — says nothing about yesterday, however loud it was', () => {
    const decision = decideProactive(
      input({ activities: [activity({ lastActiveAt: NOON - (MAX_STALENESS_MS + 60_000) })] })
    )
    expect(decision).toBeNull()
  })

  it('GATE 4 — says nothing inside the cooldown', () => {
    const decision = decideProactive(input({ lastSpokeAt: NOON - (COOLDOWN_MS - 60_000) }))
    expect(decision).toBeNull()
  })

  it('GATE 4 — speaks again once the cooldown has expired', () => {
    const decision = decideProactive(input({ lastSpokeAt: NOON - (COOLDOWN_MS + 1_000) }))
    expect(decision).not.toBeNull()
  })

  it('is off unless it is turned on', () => {
    // Default OFF. A proactive feature without a mute is a defect.
    expect(decideProactive(input({ settings: { enabled: false } }))).toBeNull()
  })

  it('says nothing during quiet hours', () => {
    const midnight = new Date(2026, 7, 29, 23, 30).getTime()
    const decision = decideProactive(
      input({
        now: midnight,
        activities: [activity({ lastActiveAt: midnight - MIN_SILENCE_MS - 1_000 })]
      })
    )
    expect(decision).toBeNull()
  })
})

describe('decideProactive — one utterance, not four', () => {
  it('collapses four simultaneous completions into a single message', () => {
    const activities = ['alpha', 'beta', 'gamma', 'delta'].map((name) =>
      activity({
        worktreePath: `/Users/bayou/Projects (Code)/${name}`,
        lastActiveAt: NOON - MIN_SILENCE_MS - 1_000
      })
    )
    const decision = decideProactive(input({ activities }))
    expect(decision).not.toBeNull()
    // One string, and it covers all four so none can be announced again.
    expect(decision?.text).toContain('4 runs just finished')
    expect(decision?.announced).toHaveLength(4)
  })

  it('names the failures when several finish together', () => {
    const activities = [
      activity({ worktreePath: '/x/alpha', recentOutput: 'Tests  1 failed | 2 passed' }),
      activity({ worktreePath: '/x/beta', recentOutput: '✓ built in 1s' })
    ]
    const decision = decideProactive(input({ activities }))
    expect(decision?.text).toBe('2 runs just finished. alpha failed.')
  })

  it('reports all clean when nothing failed', () => {
    const activities = [
      activity({ worktreePath: '/x/alpha', recentOutput: '✓ built in 1s' }),
      activity({ worktreePath: '/x/beta', recentOutput: 'Tests  9 passed (9)' })
    ]
    expect(decideProactive(input({ activities }))?.text).toBe('2 runs just finished. All clean.')
  })

  it('does not announce the same completion twice', () => {
    const one = activity()
    const announced = new Map([[one.worktreePath, one.lastActiveAt]])
    expect(decideProactive(input({ activities: [one], announced }))).toBeNull()
  })

  it('does announce the SAME terminal again after new output', () => {
    const first = activity()
    const announced = new Map([[first.worktreePath, first.lastActiveAt]])
    const second = activity({ lastActiveAt: first.lastActiveAt + 60_000 })
    const decision = decideProactive(
      input({ activities: [second], announced, now: second.lastActiveAt + MIN_SILENCE_MS + 1_000 })
    )
    expect(decision).not.toBeNull()
  })
})

describe('ProactiveWatcher', () => {
  /**
   * The watcher is fed a MUTABLE list and a MUTABLE clock, because the thing
   * under test is what changes between ticks. Handing it the same activity
   * twice tests nothing: priming already covers that case, and the result would
   * look like a pass for the wrong reason.
   */
  function harness(initial: TerminalActivity[]) {
    const state = { activities: initial, now: NOON }
    const speak = vi.fn(async () => undefined)
    const instance = new ProactiveWatcher({
      historyRoot: '/tmp/history',
      readSettings: () => ({ enabled: true }),
      speak,
      now: () => state.now,
      readActivity: () => state.activities
    })
    /** Simulates new output landing in a terminal, then going quiet again. */
    const newOutput = (overrides: Partial<TerminalActivity> = {}): void => {
      state.now += MIN_SILENCE_MS + 60_000
      state.activities = [activity({ lastActiveAt: state.now - MIN_SILENCE_MS - 1_000, ...overrides })]
    }
    return { instance, speak, state, newOutput }
  }

  it('primes on the first tick and says nothing', async () => {
    // Opening the app must not announce a job that finished four minutes before
    // launch — it passes every gate, but it is not news.
    const { instance, speak } = harness([activity()])
    await instance.tick()
    expect(speak).not.toHaveBeenCalled()
  })

  it('never announces a completion that was already there at launch', async () => {
    const { instance, speak } = harness([activity()])
    await instance.tick()
    await instance.tick()
    await instance.tick()
    expect(speak).not.toHaveBeenCalled()
  })

  it('speaks about a completion that lands after priming', async () => {
    const { instance, speak, newOutput } = harness([activity()])
    await instance.tick()
    newOutput()
    await instance.tick()
    expect(speak).toHaveBeenCalledWith('The run in dobius-adam failed.')
  })

  it('does not repeat itself once the cooldown has expired', async () => {
    // The cooldown alone would hide a repeat, so the clock is pushed well past
    // it: silence here has to come from the already-announced set.
    const { instance, speak, state, newOutput } = harness([activity()])
    await instance.tick()
    newOutput()
    await instance.tick()
    state.now += COOLDOWN_MS * 2
    await instance.tick()
    expect(speak).toHaveBeenCalledTimes(1)
  })

  it('stays silent while the setting is off', async () => {
    const speak = vi.fn(async () => undefined)
    const instance = new ProactiveWatcher({
      historyRoot: '/tmp/history',
      readSettings: () => ({ enabled: false }),
      speak,
      now: () => NOON,
      readActivity: () => [activity()]
    })
    await instance.tick()
    await instance.tick()
    expect(speak).not.toHaveBeenCalled()
  })

  it('survives an unreadable history directory', async () => {
    const speak = vi.fn(async () => undefined)
    const instance = new ProactiveWatcher({
      historyRoot: '/tmp/history',
      readSettings: () => ({ enabled: true }),
      speak,
      now: () => NOON,
      readActivity: () => {
        throw new Error('ENOENT')
      }
    })
    await expect(instance.tick()).resolves.toBeUndefined()
    expect(speak).not.toHaveBeenCalled()
  })

  it('survives a failing speak call', async () => {
    const speak = vi.fn(async () => {
      throw new Error('no network')
    })
    const state = { activities: [activity()], now: NOON }
    const instance = new ProactiveWatcher({
      historyRoot: '/tmp/history',
      readSettings: () => ({ enabled: true }),
      speak,
      now: () => state.now,
      readActivity: () => state.activities
    })
    await instance.tick()
    state.now += MIN_SILENCE_MS + 60_000
    state.activities = [activity({ lastActiveAt: state.now - MIN_SILENCE_MS - 1_000 })]
    await expect(instance.tick()).resolves.toBeUndefined()
    expect(speak).toHaveBeenCalledTimes(1)
  })

  it('start is idempotent and stop clears the timer', () => {
    const { instance } = harness([])
    instance.start()
    instance.start()
    instance.stop()
    instance.stop()
  })
})
