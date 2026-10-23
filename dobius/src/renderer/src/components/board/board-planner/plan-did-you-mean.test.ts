import { describe, expect, it } from 'vitest'
import { planTargetSuggestion, suggestMention, withPlanTarget } from './plan-did-you-mean'
import { BOARD } from './plan-fixtures.test-support'
import { validatePlan } from './plan-validate'

const NAMES = ['Claude 1', 'Claude 2', 'Codex 1', 'Team A', 'Code reviewer']

describe('planTargetSuggestion', () => {
  it('suggests the closest board name for an unknown step target', () => {
    const raw = { steps: [{ kind: 'tell', target: 'Codx 1', text: 'run the tests' }], say: '' }
    expect(planTargetSuggestion(raw, BOARD)).toEqual({ from: 'Codx 1', to: 'Codex 1' })
  })
  it('ignores known targets, far misses and non-board targets', () => {
    expect(
      planTargetSuggestion({ steps: [{ kind: 'tell', target: 'Codex 1', text: 'x' }] }, BOARD)
    ).toBeNull()
    expect(
      planTargetSuggestion({ steps: [{ kind: 'kill', target: 'Totally different' }] }, BOARD)
    ).toBeNull()
    expect(
      planTargetSuggestion({ steps: [{ kind: 'open_studio', target: 'Codx 1' }] }, BOARD)
    ).toBeNull()
    expect(planTargetSuggestion(null, BOARD)).toBeNull()
  })
  it('the corrected reply validates against the board', () => {
    const raw = { steps: [{ kind: 'tell', target: 'Clade 1', text: 'run the tests' }], say: '' }
    const s = planTargetSuggestion(raw, BOARD)
    expect(s).not.toBeNull()
    expect(validatePlan(raw, BOARD).ok).toBe(false)
    const fixed = validatePlan(withPlanTarget(raw, s!), BOARD)
    expect(fixed).toMatchObject({ ok: true, plan: { steps: [{ target: 'Claude 1' }] } })
  })
})

describe('suggestMention', () => {
  it('splits a near-miss name from the message', () => {
    expect(suggestMention('@Clade 1 run the tests', NAMES)).toEqual({
      name: 'Claude 1',
      message: 'run the tests'
    })
    expect(suggestMention('@code-reviwer: check it', NAMES)).toEqual({
      name: 'Code reviewer',
      message: 'check it'
    })
  })
  it('returns null without an @, a close name, or a message', () => {
    expect(suggestMention('Clade 1 run the tests', NAMES)).toBeNull()
    expect(suggestMention('@Totally different thing to do', NAMES)).toBeNull()
    expect(suggestMention('@Clade', NAMES)).toBeNull()
  })
})
