import { describe, expect, it } from 'vitest'
import type { BoardState } from '@/store/slices/board'
import {
  BOARD_TARGET_KEY,
  DEFAULT_LOOP_FORM,
  buildLoopTrigger,
  loopStopAfterMs,
  loopStopFields,
  loopTargetTabIds,
  parseTargetKey
} from './loop-form'

describe('schedule loops in the form', () => {
  it('builds an every-N-minutes trigger on every console', () => {
    const result = buildLoopTrigger({
      ...DEFAULT_LOOP_FORM,
      kind: 'schedule',
      targetKey: BOARD_TARGET_KEY,
      instruction: 'One-line status, please.',
      everyMin: 20
    })
    expect(result).toEqual({
      ok: true,
      trigger: { kind: 'schedule', target: { type: 'board' }, everyMs: 20 * 60_000 }
    })
  })

  it('clamps to at least one minute and needs an instruction', () => {
    const tiny = buildLoopTrigger({
      ...DEFAULT_LOOP_FORM,
      kind: 'schedule',
      targetKey: 'tab:t1',
      instruction: 'x',
      everyMin: 0
    })
    expect(tiny.ok && tiny.trigger.kind === 'schedule' && tiny.trigger.everyMs).toBe(60_000)
    expect(
      buildLoopTrigger({ ...DEFAULT_LOOP_FORM, kind: 'schedule', targetKey: 'tab:t1' }).ok
    ).toBe(false)
  })

  it('resolves the board target to every console, including ones added later', () => {
    expect(parseTargetKey(BOARD_TARGET_KEY)).toEqual({ type: 'board' })
    const board = {
      cards: [
        { id: 'a', kind: 'console', tabId: 't1' },
        { id: 'n', kind: 'note' },
        { id: 'b', kind: 'console', tabId: 't2' }
      ],
      groups: []
    } as unknown as BoardState
    expect(loopTargetTabIds({ type: 'board' }, board)).toEqual(['t1', 't2'])
  })

  it('turns the time limit into milliseconds, 0 meaning no limit', () => {
    expect(loopStopAfterMs({ stopAfterMin: 0 })).toBeUndefined()
    expect(loopStopAfterMs({ stopAfterMin: 90 })).toBe(90 * 60_000)
    expect(loopStopAfterMs({ stopAfterMin: Number.NaN })).toBeUndefined()
  })

  it('targets the consoles wired to an orchestrator', () => {
    expect(parseTargetKey('orchestrator:o1')).toEqual({ type: 'orchestrator', cardId: 'o1' })
    const board = {
      cards: [
        { id: 'a', kind: 'console', tabId: 't1' },
        { id: 'b', kind: 'console', tabId: 't2' },
        { id: 'o1', kind: 'orchestrator', wiredCardIds: ['b'] }
      ],
      groups: []
    } as unknown as BoardState
    expect(loopTargetTabIds({ type: 'orchestrator', cardId: 'o1' }, board)).toEqual(['t2'])
  })
})

describe('loopStopFields', () => {
  it('collects every stop rule, ignoring a run cap on goal loops', () => {
    expect(
      loopStopFields({
        kind: 'schedule',
        stopAfterMin: 30,
        stopAfterRuns: 4,
        stopCommand: ' pnpm test '
      })
    ).toEqual({
      ok: true,
      fields: { stopAfterMs: 30 * 60_000, stopAfterRuns: 4, stopCommand: 'pnpm test' }
    })
    expect(
      loopStopFields({ kind: 'goal', stopAfterMin: 0, stopAfterRuns: 4, stopCommand: '' })
    ).toEqual({ ok: true, fields: {} })
  })
  it('refuses a stop command that is unsafe to run unattended', () => {
    for (const stopCommand of ['rm -rf dist', 'pnpm test; git push', 'git reset --hard']) {
      expect(
        loopStopFields({ kind: 'on-idle', stopAfterMin: 0, stopAfterRuns: 0, stopCommand }).ok
      ).toBe(false)
    }
  })
  it('zero stop values mean "never" and save without stop fields', () => {
    expect(
      loopStopFields({ kind: 'schedule', stopAfterMin: 0, stopAfterRuns: 0, stopCommand: '' })
    ).toEqual({ ok: true, fields: {} })
  })
  it('explains quotes, wildcards and ~ when refusing a shell-shaped stop command', () => {
    for (const stopCommand of ["'rm' -rf ~", 'pnpm test *', 'ls ~']) {
      expect(
        loopStopFields({ kind: 'on-idle', stopAfterMin: 0, stopAfterRuns: 0, stopCommand })
      ).toEqual({
        ok: false,
        error: 'Use one plain command — no quotes, wildcards, ~, pipes, ; & > or $'
      })
    }
  })
})
