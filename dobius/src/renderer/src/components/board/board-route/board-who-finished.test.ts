import { describe, expect, it } from 'vitest'
import { whoFinishedLine } from './board-who-finished'

describe('whoFinishedLine', () => {
  it('reports nothing when no names finished', () => {
    expect(whoFinishedLine([])).toBe('Nothing finished yet.')
  })

  it('names a single finisher', () => {
    expect(whoFinishedLine(['Claude 1'])).toBe('Claude 1 finished.')
  })

  it('joins two finishers with "and"', () => {
    expect(whoFinishedLine(['Claude 1', 'Codex 2'])).toBe('Claude 1 and Codex 2 finished.')
  })

  it('collapses three or more finishers to a count', () => {
    expect(whoFinishedLine(['Claude 1', 'Codex 2', 'Claude 3'])).toBe('3 agents finished.')
  })
})
