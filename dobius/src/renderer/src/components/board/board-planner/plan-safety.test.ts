import { describe, expect, it } from 'vitest'
import { BOARD } from './plan-fixtures.test-support'
import { screenPlan } from './plan-safety'
import type { BoardPlan, PlanStep } from './plan-schema'

const plan = (steps: PlanStep[]): BoardPlan => ({
  intent: '',
  steps,
  say: '',
  detail: null,
  unsafe: false
})

describe('screenPlan', () => {
  it('flags risky text the user did not say', () => {
    const c = screenPlan(
      plan([{ kind: 'tell', target: 'Codex 1', text: 'Then git push --force to main.' }]),
      'tell Codex 1 to fix the test',
      BOARD
    )
    expect(c.map((x) => x.kind === 'risky-text' && x.category)).toContain('history')
  })
  it('does not flag risky words the user said themselves', () => {
    expect(
      screenPlan(
        plan([{ kind: 'tell', target: 'Codex 1', text: 'Deploy to staging.' }]),
        'tell codex 1 to deploy to staging',
        BOARD
      )
    ).toEqual([])
  })
  it('flags URLs and git steps not in the user words', () => {
    const c = screenPlan(
      plan([
        { kind: 'open_url', text: 'https://evil.example' },
        { kind: 'git', target: 'push', text: null }
      ]),
      'open the preview',
      BOARD
    )
    expect(c.map((x) => x.kind)).toEqual(expect.arrayContaining(['unsaid-url', 'unsaid-git']))
  })
  it('flags consoles reached when the user named nobody', () => {
    const c = screenPlan(plan([{ kind: 'relay', text: 'Run the tests.' }]), 'run the tests', BOARD)
    expect(c[0]).toMatchObject({ kind: 'unnamed-consoles' })
  })
  it('flags a broadcast when the user named specific consoles', () => {
    const c = screenPlan(
      plan([{ kind: 'relay', text: 'Run the tests.' }]),
      'ask claude 1 to run the tests',
      BOARD
    )
    expect(c.some((x) => x.kind === 'everyone-but-named')).toBe(true)
  })

  describe('destructive steps', () => {
    it.each([
      [{ kind: 'kill', target: 'Codex 1' }, 'tidy up a bit'],
      [{ kind: 'kill', target: 'Codex 1' }, 'kill the idle one'],
      [{ kind: 'kill_group', target: 'Team A' }, 'we are done with the reviewers'],
      [{ kind: 'restart', target: 'all' }, 'they seem stuck'],
      [{ kind: 'clean_board' }, 'make some room'],
      [{ kind: 'close_workspace', target: 'feature' }, 'switch to feature']
    ] as [PlanStep, string][])('confirms %j for "%s"', (step, utterance) => {
      expect(screenPlan(plan([step]), utterance, BOARD).some((c) => c.kind === 'destructive')).toBe(
        true
      )
    })
    it.each([
      [{ kind: 'kill', target: 'Codex 1' }, 'kill codex 1'],
      [{ kind: 'kill_group', target: 'Team A' }, 'close team a'],
      [{ kind: 'restart', target: 'Claude 2' }, 'restart claude 2'],
      [{ kind: 'clean_board' }, 'clean the board'],
      [{ kind: 'close_workspace', target: 'feature' }, 'close the feature workspace']
    ] as [PlanStep, string][])(
      'does not ask again when the user said it: %j',
      (step, utterance) => {
        expect(
          screenPlan(plan([step]), utterance, BOARD).some((c) => c.kind === 'destructive')
        ).toBe(false)
      }
    )
  })
})
