import { describe, expect, it } from 'vitest'
import { builtInCommand } from './plan-builtin'
import { BOARD } from './plan-fixtures.test-support'

describe('builtInCommand', () => {
  it('runs the app’s own short commands without any model', () => {
    expect(builtInCommand('pause all', BOARD)).toMatchObject({
      kind: 'plan',
      plan: { steps: [{ kind: 'pause', target: 'all' }] }
    })
    expect(builtInCommand('zoom in', BOARD)).toMatchObject({ kind: 'plan' })
  })

  it('leaves work orders and conversation to ADAM', () => {
    expect(builtInCommand('fix the login bug', BOARD)).toEqual({ kind: 'for-adam' })
    expect(builtInCommand('spawn two reviewers for the auth code', BOARD)).toEqual({
      kind: 'for-adam'
    })
    expect(builtInCommand('i cant heear him speak', BOARD)).toEqual({ kind: 'for-adam' })
  })

  it('asks "did you mean" when a loop names a near-miss console', () => {
    expect(builtInCommand('every 10 minutes tell Clade 1 to run the tests', BOARD)).toMatchObject({
      kind: 'did-you-mean',
      suggestion: { from: 'Clade 1', to: 'Claude 1' }
    })
  })

  it('keeps an exactly named loop target', () => {
    expect(builtInCommand('every 10 minutes tell Claude 1 to run the tests', BOARD)).toMatchObject({
      kind: 'plan',
      plan: { steps: [{ kind: 'loop', target: 'Claude 1', text: 'run the tests' }] }
    })
  })
})
